const mongoose = require('mongoose');

/**
 * LearningSession Model
 * 
 * Tracks a student's learning journey across multiple AI interactions.
 * This creates a "conversation memory" that helps the AI understand context
 * and provide better, more personalized guidance.
 * 
 * GENIUS FEATURE: Sessions cluster related questions, so when a student
 * asks about "React hooks" then "useEffect", the AI knows they're learning
 * the same topic and can build on previous explanations.
 */
const learningSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Session context
  context: {
    track: {
      type: String,
      enum: ['SOFTWARE_ENGINEERING', 'CYBER_SECURITY', 'IT', 'AI', 'OTHER'],
      required: true
    },
    primaryTopic: String,
    relatedTopics: [String],
    difficulty: {
      type: String,
      enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']
    },
    learningGoal: String
  },
  
  // All interactions in this session
  interactions: [{
    interactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AIInteraction'
    },
    timestamp: Date,
    inputSummary: String,
    outputSummary: String,
    wasHelpful: Boolean,
    topicProgression: String  // What new concept was introduced
  }],
  
  // Learning progression tracking
  progression: {
    conceptsIntroduced: [{
      concept: String,
      introducedAt: Date,
      masteryLevel: { type: Number, min: 0, max: 100, default: 0 }
    }],
    questionsAsked: { type: Number, default: 0 },
    hintsProvided: { type: Number, default: 0 },
    breakthroughMoments: [{  // When student "gets it"
      concept: String,
      timestamp: Date,
      triggerInteraction: { type: mongoose.Schema.Types.ObjectId, ref: 'AIInteraction' }
    }],
    strugglingAreas: [{
      topic: String,
      attempts: Number,
      lastAttempt: Date
    }]
  },
  
  // Session summary (for future agent context)
  summary: {
    mainTopicsCovered: [String],
    keyLearnings: [String],
    unresolvedQuestions: [String],
    recommendedNextSteps: [String],
    sessionQuality: { type: Number, min: 0, max: 100 }
  },
  
  // For agent training - conversation pairs
  trainingPairs: [{
    userMessage: String,
    assistantResponse: String,
    context: String,
    quality: { type: Number, min: 0, max: 5 }
  }],
  
  // Session state
  status: {
    type: String,
    enum: ['ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED'],
    default: 'ACTIVE'
  },
  
  startedAt: {
    type: Date,
    default: Date.now
  },
  lastActivityAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  
  // Duration tracking
  totalDuration: { type: Number, default: 0 }, // in seconds
  activeTime: { type: Number, default: 0 }     // actual engagement time
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
learningSessionSchema.index({ userId: 1, status: 1 });
learningSessionSchema.index({ 'context.track': 1, 'context.primaryTopic': 1 });
learningSessionSchema.index({ lastActivityAt: -1 });

// Virtual for session duration in minutes
learningSessionSchema.virtual('durationMinutes').get(function() {
  return Math.round(this.totalDuration / 60);
});

// Virtual for engagement rate
learningSessionSchema.virtual('engagementRate').get(function() {
  if (this.totalDuration === 0) return 0;
  return (this.activeTime / this.totalDuration * 100).toFixed(1);
});

// Method to add interaction to session
learningSessionSchema.methods.addInteraction = async function(interaction, outputSummary) {
  this.interactions.push({
    interactionId: interaction._id,
    timestamp: new Date(),
    inputSummary: interaction.inputText.substring(0, 200),
    outputSummary: outputSummary?.substring(0, 200),
    topicProgression: interaction.analytics?.topicOneLine
  });
  
  this.progression.questionsAsked += 1;
  this.lastActivityAt = new Date();
  
  // Update topics
  if (interaction.analytics?.keywords) {
    for (const keyword of interaction.analytics.keywords) {
      if (!this.context.relatedTopics.includes(keyword)) {
        this.context.relatedTopics.push(keyword);
      }
    }
  }
  
  // Add training pair
  this.trainingPairs.push({
    userMessage: interaction.inputText,
    assistantResponse: interaction.output?.userResponse || '',
    context: this.context.primaryTopic,
    quality: interaction.feedback?.userRating || 3
  });
  
  return this.save();
};

// Method to mark concept as learned
learningSessionSchema.methods.markBreakthrough = async function(concept, interactionId) {
  this.progression.breakthroughMoments.push({
    concept,
    timestamp: new Date(),
    triggerInteraction: interactionId
  });
  
  // Update mastery level
  const conceptIndex = this.progression.conceptsIntroduced.findIndex(c => c.concept === concept);
  if (conceptIndex >= 0) {
    this.progression.conceptsIntroduced[conceptIndex].masteryLevel = 
      Math.min(100, this.progression.conceptsIntroduced[conceptIndex].masteryLevel + 25);
  }
  
  return this.save();
};

// Method to complete session with summary
learningSessionSchema.methods.complete = async function() {
  this.status = 'COMPLETED';
  this.completedAt = new Date();
  this.totalDuration = (this.completedAt - this.startedAt) / 1000;
  
  // Generate summary
  this.summary = {
    mainTopicsCovered: [...new Set(this.context.relatedTopics)].slice(0, 10),
    keyLearnings: this.progression.breakthroughMoments.map(b => b.concept),
    unresolvedQuestions: this.progression.strugglingAreas
      .filter(s => s.attempts >= 2)
      .map(s => s.topic),
    sessionQuality: this.calculateQuality()
  };
  
  return this.save();
};

// Calculate session quality
learningSessionSchema.methods.calculateQuality = function() {
  let score = 50; // Base score
  
  // Bonus for breakthroughs
  score += this.progression.breakthroughMoments.length * 10;
  
  // Bonus for engagement
  if (this.interactions.length >= 3) score += 10;
  if (this.interactions.length >= 5) score += 10;
  
  // Penalty for too many struggles
  const highStruggleAreas = this.progression.strugglingAreas.filter(s => s.attempts >= 3);
  score -= highStruggleAreas.length * 5;
  
  return Math.max(0, Math.min(100, score));
};

// Static method to get or create active session
learningSessionSchema.statics.getOrCreateSession = async function(userId, track) {
  // Look for recent active session (within 30 minutes)
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  
  let session = await this.findOne({
    userId,
    status: 'ACTIVE',
    lastActivityAt: { $gte: thirtyMinutesAgo }
  });
  
  if (!session) {
    session = new this({
      sessionId: `session_${userId}_${Date.now()}`,
      userId,
      context: { track },
      status: 'ACTIVE'
    });
    await session.save();
  }
  
  return session;
};

// Static method to get learning analytics for a user
learningSessionSchema.statics.getUserLearningAnalytics = async function(userId, timeframe = 'month') {
  const startDate = new Date();
  if (timeframe === 'week') startDate.setDate(startDate.getDate() - 7);
  else if (timeframe === 'month') startDate.setMonth(startDate.getMonth() - 1);
  else startDate.setFullYear(startDate.getFullYear() - 1);
  
  return this.aggregate([
    {
      $match: {
        userId: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: null,
        totalSessions: { $sum: 1 },
        totalQuestions: { $sum: '$progression.questionsAsked' },
        totalBreakthroughs: { $sum: { $size: '$progression.breakthroughMoments' } },
        avgSessionQuality: { $avg: '$summary.sessionQuality' },
        totalLearningTime: { $sum: '$totalDuration' },
        topicsLearned: { $addToSet: '$context.relatedTopics' }
      }
    },
    {
      $project: {
        totalSessions: 1,
        totalQuestions: 1,
        totalBreakthroughs: 1,
        avgSessionQuality: 1,
        totalLearningTimeHours: { $divide: ['$totalLearningTime', 3600] },
        uniqueTopics: {
          $size: {
            $reduce: {
              input: '$topicsLearned',
              initialValue: [],
              in: { $setUnion: ['$$value', '$$this'] }
            }
          }
        }
      }
    }
  ]);
};

// Static method to export high-quality training conversations
learningSessionSchema.statics.exportTrainingConversations = async function(minQuality = 4) {
  const sessions = await this.find({
    status: 'COMPLETED',
    'summary.sessionQuality': { $gte: 60 }
  }).populate('interactions.interactionId');
  
  const conversations = [];
  
  for (const session of sessions) {
    const highQualityPairs = session.trainingPairs.filter(p => p.quality >= minQuality);
    
    if (highQualityPairs.length >= 2) {
      conversations.push({
        sessionId: session.sessionId,
        track: session.context.track,
        topic: session.context.primaryTopic,
        messages: highQualityPairs.map(p => ([
          { role: 'user', content: p.userMessage },
          { role: 'assistant', content: p.assistantResponse }
        ])).flat(),
        metadata: {
          sessionQuality: session.summary.sessionQuality,
          breakthroughs: session.progression.breakthroughMoments.length,
          duration: session.durationMinutes
        }
      });
    }
  }
  
  return conversations;
};

module.exports = mongoose.model('LearningSession', learningSessionSchema);
