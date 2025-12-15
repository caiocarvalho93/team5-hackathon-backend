const express = require('express');
const { z } = require('zod');
const openaiService = require('../services/openaiService');
const intelligentAgentService = require('../services/intelligentAgentService');
const { authenticate, authorize, aiRateLimit } = require('../middleware/auth');
const { validate, sanitizeInput } = require('../middleware/validation');
const { asyncHandler, sendSuccess, sendError } = require('../middleware/errorHandler');
const { aiTutorHelpSchema, aiMambaHelpSchema, aiFeedbackSchema } = require('../middleware/validation');
const AIInteraction = require('../models/AIInteraction');
const KnowledgePattern = require('../models/KnowledgePattern');
const LearningSession = require('../models/LearningSession');
const AgentTrainingData = require('../models/AgentTrainingData');

const router = express.Router();

// Apply authentication and rate limiting to all AI routes
router.use(authenticate);
router.use(aiRateLimit);
router.use(sanitizeInput);

// Care Network for linking tutors to students
const TutorCareNetwork = require('../models/TutorCareNetwork');

// @route   POST /api/v1/ai/alumni-tutor-help
// @desc    Alumni AI Tutoring Help
// @access  Private (Alumni only)
router.post('/alumni-tutor-help',
  authorize('ALUMNI'),
  validate(aiTutorHelpSchema),
  asyncHandler(async (req, res) => {
    const result = await openaiService.alumniTutorHelp(req.userId, req.body);
    
    if (result.success) {
      // If tutor is helping a specific student, link them in care network
      // This happens when tutor uses AI to prepare for helping a student
      if (req.body.studentId) {
        try {
          await TutorCareNetwork.linkTutorToStudent(req.body.studentId, req.userId);
          console.log(`🤝 [CARE NETWORK] Linked tutor ${req.userId} to student ${req.body.studentId}`);
        } catch (err) {
          console.error('Care network link error (non-critical):', err.message);
        }
      }
      
      sendSuccess(res, {
        analytics: result.analytics,
        fullAnswer: result.fullAnswer,
        requestId: result.requestId
      }, 'AI tutoring help completed');
    } else {
      sendError(res, result.error || 'AI service temporarily unavailable', 502, 'AI_SERVICE_ERROR', {
        requestId: result.requestId,
        fallbackAnswer: result.fullAnswer
      });
    }
  })
);

// Struggle Detection Services (non-breaking addition)
const StruggleSignalService = require('../services/StruggleSignalService');
const StruggleScoringService = require('../services/StruggleScoringService');
const TutorAlertService = require('../services/TutorAlertService');

// @route   POST /api/v1/ai/student-mamba-help
// @desc    Student AI Mamba Helper
// @access  Private (Students only)
router.post('/student-mamba-help',
  authorize('STUDENT'),
  validate(aiMambaHelpSchema),
  asyncHandler(async (req, res) => {
    const result = await openaiService.studentMambaHelper(req.userId, req.body);
    
    if (result.success) {
      // === STRUGGLE DETECTION INTEGRATION (non-blocking) ===
      // This runs after the AI response, doesn't affect the student experience
      try {
        // Get the saved interaction for signal extraction
        const interaction = await AIInteraction.findOne({ requestId: result.requestId });
        if (interaction) {
          // Extract signals from this interaction
          const signalResult = await StruggleSignalService.extractSignalsFromInteraction(interaction, { windowHours: 24 });
          console.log(`🔍 [STRUGGLE] Signals extracted: ${signalResult.created} created, ${signalResult.skipped} skipped`);
          
          // Recompute struggle score
          const profile = await StruggleScoringService.recomputeForUser(req.userId);
          console.log(`📊 [STRUGGLE] Profile updated: score=${profile?.struggleScore}, level=${profile?.supportLevel}, trend=${profile?.trend}`);
          
          // Create tutor alerts if needed (respects cooldown)
          const alerts = await TutorAlertService.createAlertsIfNeeded(req.userId);
          if (alerts.length > 0) {
            console.log(`🚨 [STRUGGLE] Alerts created: ${alerts.length} tutors notified`);
          }
        }
      } catch (struggleErr) {
        // Log but don't fail the request - struggle detection is supplementary
        console.error('Struggle detection error (non-critical):', struggleErr.message);
      }
      // === END STRUGGLE DETECTION ===

      sendSuccess(res, {
        coachMessage: result.coachMessage,
        skillsMap: result.skillsMap,
        nextSteps: result.nextSteps,
        difficultyEstimate: result.difficultyEstimate,
        refusal: result.refusal,
        requestId: result.requestId
      }, result.refusal ? 'Request processed with guidance' : 'Mamba coaching completed');
    } else {
      sendError(res, result.error || 'AI service temporarily unavailable', 502, 'AI_SERVICE_ERROR', {
        requestId: result.requestId,
        fallbackMessage: result.coachMessage
      });
    }
  })
);

// @route   POST /api/v1/ai/feedback
// @desc    Submit feedback for AI interaction
// @access  Private
router.post('/feedback',
  validate(aiFeedbackSchema),
  asyncHandler(async (req, res) => {
    const { interactionId, ...feedbackData } = req.body;
    
    // Find the interaction
    const interaction = await AIInteraction.findById(interactionId);
    if (!interaction) {
      return sendError(res, 'AI interaction not found', 404, 'INTERACTION_NOT_FOUND');
    }
    
    // Check ownership
    if (interaction.userId.toString() !== req.userId.toString()) {
      return sendError(res, 'You can only provide feedback for your own interactions', 403, 'ACCESS_DENIED');
    }
    
    // Add feedback
    await interaction.addFeedback(feedbackData);
    
    sendSuccess(res, null, 'Feedback submitted successfully');
  })
);

// @route   GET /api/v1/ai/history
// @desc    Get user's AI interaction history
// @access  Private
router.get('/history',
  asyncHandler(async (req, res) => {
    const { toolType, limit = 20, page = 1 } = req.query;
    
    const query = { userId: req.userId };
    if (toolType) {
      query.toolType = toolType;
    }
    
    const skip = (page - 1) * limit;
    
    const [interactions, total] = await Promise.all([
      AIInteraction.find(query)
        .select('toolType track analytics.topicOneLine status createdAt feedback.userRating requestId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      AIInteraction.countDocuments(query)
    ]);
    
    sendSuccess(res, {
      interactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }, 'AI interaction history retrieved');
  })
);

// @route   GET /api/v1/ai/interaction/:id
// @desc    Get specific AI interaction details
// @access  Private
router.get('/interaction/:id',
  asyncHandler(async (req, res) => {
    const interaction = await AIInteraction.findById(req.params.id);
    
    if (!interaction) {
      return sendError(res, 'AI interaction not found', 404, 'INTERACTION_NOT_FOUND');
    }
    
    // Check ownership (or admin access)
    if (interaction.userId.toString() !== req.userId.toString() && req.user.role !== 'ADMIN') {
      return sendError(res, 'Access denied', 403, 'ACCESS_DENIED');
    }
    
    sendSuccess(res, { interaction }, 'AI interaction retrieved');
  })
);

// @route   GET /api/v1/ai/analytics/trending
// @desc    Get trending AI topics (Admin only)
// @access  Private (Admin only)
router.get('/analytics/trending',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { timeframe = 'week', limit = 20 } = req.query;
    
    const trendingTopics = await AIInteraction.getTrendingTopics(timeframe, parseInt(limit));
    
    sendSuccess(res, { trendingTopics }, 'Trending topics retrieved');
  })
);

// @route   GET /api/v1/ai/analytics/curriculum/:track
// @desc    Get curriculum insights for a track (Admin only)
// @access  Private (Admin only)
router.get('/analytics/curriculum/:track',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { track } = req.params;
    const { timeframe = 'month' } = req.query;
    
    const insights = await AIInteraction.getCurriculumInsights(track, timeframe);
    
    sendSuccess(res, { insights }, 'Curriculum insights retrieved');
  })
);

// @route   GET /api/v1/ai/analytics/knowledge-gaps/:track
// @desc    Detect knowledge gaps for a track (Admin only)
// @access  Private (Admin only)
router.get('/analytics/knowledge-gaps/:track',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { track } = req.params;
    const { limit = 10 } = req.query;
    
    const knowledgeGaps = await AIInteraction.detectKnowledgeGaps(track, parseInt(limit));
    
    sendSuccess(res, { knowledgeGaps }, 'Knowledge gaps detected');
  })
);

// @route   GET /api/v1/ai/analytics/overview
// @desc    Get AI usage analytics overview (Admin only)
// @access  Private (Admin only)
router.get('/analytics/overview',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { timeframe = 'month' } = req.query;
    
    const analytics = await AIInteraction.getAnalytics(timeframe);
    
    sendSuccess(res, { analytics }, 'AI analytics overview retrieved');
  })
);

// @route   POST /api/v1/ai/interaction/:id/flag
// @desc    Flag AI interaction for moderation
// @access  Private
router.post('/interaction/:id/flag',
  validate(z.object({
    reason: z.string().min(1).max(200)
  })),
  asyncHandler(async (req, res) => {
    const interaction = await AIInteraction.findById(req.params.id);
    
    if (!interaction) {
      return sendError(res, 'AI interaction not found', 404, 'INTERACTION_NOT_FOUND');
    }
    
    await interaction.flag(req.body.reason, req.userId);
    
    sendSuccess(res, null, 'AI interaction flagged for review');
  })
);

// @route   GET /api/v1/ai/stats/user
// @desc    Get user's AI usage statistics
// @access  Private
router.get('/stats/user',
  asyncHandler(async (req, res) => {
    const { timeframe = 'month' } = req.query;
    
    const stats = await AIInteraction.getAnalytics(timeframe, { userId: req.userId });
    
    // Get user's interaction breakdown
    const breakdown = await AIInteraction.aggregate([
      {
        $match: {
          userId: req.userId,
          createdAt: {
            $gte: new Date(Date.now() - (timeframe === 'week' ? 7 : timeframe === 'month' ? 30 : 365) * 24 * 60 * 60 * 1000)
          }
        }
      },
      {
        $group: {
          _id: '$toolType',
          count: { $sum: 1 },
          avgRating: { $avg: '$feedback.userRating' },
          successRate: {
            $avg: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] }
          }
        }
      }
    ]);
    
    sendSuccess(res, {
      overview: stats[0] || {
        totalInteractions: 0,
        avgRating: 0,
        successRate: 0
      },
      breakdown
    }, 'User AI statistics retrieved');
  })
);

// ============================================================================
// INTELLIGENT AGENT ROUTES - THE GENIUS ENGINEERING 🧠
// ============================================================================

// @route   POST /api/v1/ai/smart-help
// @desc    Smart AI help - auto-routes to Mamba Coach or Deployment Helper
// @access  Private (Students only)
// @note    This is the MAIN endpoint - it detects if you need hints or direct answers
router.post('/smart-help',
  authorize('STUDENT'),
  validate(aiMambaHelpSchema),
  asyncHandler(async (req, res) => {
    const result = await intelligentAgentService.processStudentQuestion(req.userId, req.body);
    
    if (result.success) {
      sendSuccess(res, result, 
        result.agentType === 'DEPLOYMENT_HELPER' 
          ? 'Direct solution provided' 
          : 'Mamba coaching completed 🐍24'
      );
    } else {
      sendError(res, result.error || 'AI service temporarily unavailable', 502, 'AI_SERVICE_ERROR', {
        requestId: result.requestId,
        agentType: result.agentType
      });
    }
  })
);

// @route   GET /api/v1/ai/session/current
// @desc    Get current learning session
// @access  Private (Students only)
router.get('/session/current',
  authorize('STUDENT'),
  asyncHandler(async (req, res) => {
    const { track = 'SOFTWARE_ENGINEERING' } = req.query;
    
    const session = await LearningSession.getOrCreateSession(req.userId, track);
    await session.populate('interactions.interactionId', 'analytics.topicOneLine output.userResponse');
    
    sendSuccess(res, { 
      session: {
        sessionId: session.sessionId,
        context: session.context,
        progression: session.progression,
        interactionCount: session.interactions.length,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt
      }
    }, 'Current session retrieved');
  })
);

// @route   GET /api/v1/ai/session/analytics
// @desc    Get user's learning analytics
// @access  Private
router.get('/session/analytics',
  asyncHandler(async (req, res) => {
    const { timeframe = 'month' } = req.query;
    
    const analytics = await LearningSession.getUserLearningAnalytics(req.userId, timeframe);
    
    sendSuccess(res, { 
      analytics: analytics[0] || {
        totalSessions: 0,
        totalQuestions: 0,
        totalBreakthroughs: 0,
        avgSessionQuality: 0,
        totalLearningTimeHours: 0,
        uniqueTopics: 0
      }
    }, 'Learning analytics retrieved');
  })
);

// @route   POST /api/v1/ai/session/:sessionId/breakthrough
// @desc    Mark a concept as learned (breakthrough moment)
// @access  Private (Students only)
router.post('/session/:sessionId/breakthrough',
  authorize('STUDENT'),
  validate(z.object({
    concept: z.string().min(1).max(100),
    interactionId: z.string().optional()
  })),
  asyncHandler(async (req, res) => {
    const session = await LearningSession.findOne({ 
      sessionId: req.params.sessionId,
      userId: req.userId 
    });
    
    if (!session) {
      return sendError(res, 'Session not found', 404, 'SESSION_NOT_FOUND');
    }
    
    await session.markBreakthrough(req.body.concept, req.body.interactionId);
    
    sendSuccess(res, { 
      breakthroughs: session.progression.breakthroughMoments 
    }, 'Breakthrough recorded! 🎉');
  })
);

// @route   GET /api/v1/ai/knowledge/search
// @desc    Search knowledge patterns
// @access  Private
router.get('/knowledge/search',
  asyncHandler(async (req, res) => {
    const { q, track, type, limit = 10 } = req.query;
    
    if (!q || q.length < 3) {
      return sendError(res, 'Search query must be at least 3 characters', 400, 'INVALID_QUERY');
    }
    
    const matches = await KnowledgePattern.findBestMatches(
      q, 
      track || 'SOFTWARE_ENGINEERING',
      type || null,
      parseInt(limit)
    );
    
    sendSuccess(res, {
      results: matches.map(m => ({
        patternId: m.pattern.patternId,
        title: m.pattern.title,
        description: m.pattern.description,
        patternType: m.pattern.patternType,
        difficulty: m.pattern.difficulty,
        score: m.score,
        resolutionRate: m.pattern.resolutionRate
      })),
      total: matches.length
    }, 'Knowledge search completed');
  })
);

// @route   GET /api/v1/ai/knowledge/:patternId
// @desc    Get specific knowledge pattern
// @access  Private
router.get('/knowledge/:patternId',
  asyncHandler(async (req, res) => {
    const pattern = await KnowledgePattern.findOne({ patternId: req.params.patternId });
    
    if (!pattern) {
      return sendError(res, 'Knowledge pattern not found', 404, 'PATTERN_NOT_FOUND');
    }
    
    sendSuccess(res, { pattern }, 'Knowledge pattern retrieved');
  })
);

// ============================================================================
// ADMIN: TRAINING DATA MANAGEMENT
// ============================================================================

// @route   GET /api/v1/ai/training/datasets
// @desc    Get all training datasets (Admin only)
// @access  Private (Admin only)
router.get('/training/datasets',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const datasets = await AgentTrainingData.find()
      .select('datasetId datasetName targetAgent format stats status createdAt')
      .sort({ createdAt: -1 });
    
    sendSuccess(res, { datasets }, 'Training datasets retrieved');
  })
);

// @route   GET /api/v1/ai/training/dataset/:targetAgent
// @desc    Get training dataset for specific agent (Admin only)
// @access  Private (Admin only)
router.get('/training/dataset/:targetAgent',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const dataset = await AgentTrainingData.getOrCreateDataset(req.params.targetAgent);
    
    sendSuccess(res, { 
      dataset: {
        datasetId: dataset.datasetId,
        datasetName: dataset.datasetName,
        targetAgent: dataset.targetAgent,
        format: dataset.format,
        stats: dataset.stats,
        trainingConfig: dataset.trainingConfig,
        status: dataset.status,
        readinessPercentage: dataset.readinessPercentage,
        exampleCount: dataset.examples.length,
        trainingRuns: dataset.trainingRuns
      }
    }, 'Training dataset retrieved');
  })
);

// @route   POST /api/v1/ai/training/auto-populate/:targetAgent
// @desc    Auto-populate training data from high-quality interactions (Admin only)
// @access  Private (Admin only)
router.post('/training/auto-populate/:targetAgent',
  authorize('ADMIN'),
  validate(z.object({
    minRating: z.number().min(1).max(5).optional(),
    limit: z.number().min(1).max(500).optional()
  })),
  asyncHandler(async (req, res) => {
    const { minRating = 4, limit = 100 } = req.body;
    
    const dataset = await AgentTrainingData.autoPopulateFromInteractions(
      req.params.targetAgent,
      minRating,
      limit
    );
    
    sendSuccess(res, {
      datasetId: dataset.datasetId,
      totalExamples: dataset.stats.totalExamples,
      newExamplesAdded: dataset.examples.length
    }, 'Training data auto-populated');
  })
);

// @route   GET /api/v1/ai/training/export/:targetAgent
// @desc    Export training data for fine-tuning (Admin only)
// @access  Private (Admin only)
router.get('/training/export/:targetAgent',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { format = 'openai', minQuality = 70 } = req.query;
    
    const dataset = await AgentTrainingData.findOne({ 
      targetAgent: req.params.targetAgent,
      status: { $ne: 'ARCHIVED' }
    });
    
    if (!dataset) {
      return sendError(res, 'Dataset not found', 404, 'DATASET_NOT_FOUND');
    }
    
    let exportData;
    if (format === 'openai') {
      exportData = dataset.exportForOpenAI(parseInt(minQuality));
    } else if (format === 'rag') {
      exportData = dataset.exportForRAG();
    } else {
      return sendError(res, 'Invalid export format', 400, 'INVALID_FORMAT');
    }
    
    // Record export
    dataset.exports.push({
      exportedAt: new Date(),
      format,
      destination: 'api',
      examplesExported: exportData.length
    });
    await dataset.save();
    
    sendSuccess(res, {
      format,
      exampleCount: exportData.length,
      data: exportData
    }, 'Training data exported');
  })
);

// @route   GET /api/v1/ai/training/conversations
// @desc    Export high-quality learning conversations (Admin only)
// @access  Private (Admin only)
router.get('/training/conversations',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { minQuality = 4 } = req.query;
    
    const conversations = await LearningSession.exportTrainingConversations(parseInt(minQuality));
    
    sendSuccess(res, {
      conversationCount: conversations.length,
      conversations
    }, 'Training conversations exported');
  })
);

// @route   GET /api/v1/ai/knowledge/export
// @desc    Export knowledge patterns for training (Admin only)
// @access  Private (Admin only)
router.get('/knowledge/export',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { track } = req.query;
    
    const trainingData = await KnowledgePattern.exportTrainingData(track || null);
    
    sendSuccess(res, {
      patternCount: trainingData.length,
      data: trainingData
    }, 'Knowledge patterns exported');
  })
);

// @route   GET /api/v1/ai/insights/struggling-topics
// @desc    Get topics students struggle with most (Admin only)
// @access  Private (Admin only)
router.get('/insights/struggling-topics',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { track = 'SOFTWARE_ENGINEERING', limit = 10 } = req.query;
    
    const gaps = await AIInteraction.detectKnowledgeGaps(track, parseInt(limit));
    
    sendSuccess(res, { 
      track,
      strugglingTopics: gaps 
    }, 'Struggling topics identified');
  })
);

module.exports = router;