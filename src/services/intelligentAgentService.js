const OpenAI = require('openai');
const { z } = require('zod');
const { logger } = require('../config/database');
const AIInteraction = require('../models/AIInteraction');
const KnowledgePattern = require('../models/KnowledgePattern');
const LearningSession = require('../models/LearningSession');
const AgentTrainingData = require('../models/AgentTrainingData');

/**
 * IntelligentAgentService
 * 
 * THE BRAIN OF PEERTRACK+ 🧠
 * 
 * This service orchestrates multiple AI agents:
 * 1. Mamba Coach - Guided learning (hints only)
 * 2. Deployment Helper - Direct answers for config/IDE issues
 * 3. Pattern Matcher - Finds similar solved problems
 * 4. Training Pipeline - Captures data for future agents
 * 
 * GENIUS ENGINEERING:
 * - Auto-detects if question needs direct answer vs guided hints
 * - Builds knowledge patterns from every interaction
 * - Creates training data for future fine-tuned models
 * - Tracks learning sessions for personalized help
 */

// Response schemas
const deploymentHelperSchema = z.object({
  problemIdentified: z.string().max(100),
  directSolution: z.string().max(2000),
  codeExample: z.string().optional(),
  additionalSteps: z.array(z.string()).max(5),
  preventionTip: z.string().max(200),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW'])
});

const enhancedMambaSchema = z.object({
  coachMessage: z.string().max(1200),
  conceptBreakdown: z.array(z.string()).min(2).max(5),
  guidingQuestions: z.array(z.string()).min(1).max(3),
  practiceChallenge: z.string().max(300),
  skillsMap: z.array(z.string()).min(3).max(8),
  nextSteps: z.array(z.string()).length(3),
  difficultyEstimate: z.enum(['easy', 'medium', 'hard']),
  refusal: z.boolean()
});

class IntelligentAgentService {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.model = 'gpt-3.5-turbo'; // Changed for reliability
    this.maxRetries = 2;
    
    // Bypass keywords - these get DIRECT answers
    this.bypassKeywords = [
      // Deployment
      'deploy', 'deployment', 'heroku', 'vercel', 'netlify', 'aws', 'azure', 'docker',
      'kubernetes', 'ci/cd', 'pipeline', 'build failed', 'build error', 'render',
      // IDE/Config
      'vscode', 'visual studio', 'intellij', 'eslint', 'prettier', 'tsconfig',
      'package.json', 'webpack', 'babel', 'npm install', 'yarn', 'node_modules',
      'npm error', 'npm err', 'yarn error',
      // Errors
      'error:', 'exception', 'stack trace', 'cannot find module', 'module not found',
      'syntax error', 'type error', 'reference error', 'undefined is not',
      'enoent', 'permission denied', 'port already in use', 'cors error', 'cors',
      'eacces', 'eaddrinuse', 'econnrefused',
      // Git
      'git', 'merge conflict', 'push rejected', 'pull request', 'branch', 'commit',
      'fatal:', 'git error',
      // Environment
      '.env', 'environment variable', 'config', 'configuration', 'dotenv',
      // Database
      'mongodb', 'mongoose', 'connection string', 'database error', 'postgres', 'mysql'
    ];
  }

  /**
   * MAIN ENTRY POINT - Smart routing to appropriate agent
   */
  async processStudentQuestion(userId, questionData) {
    const { questionText, track } = questionData;
    const requestId = `smart_${userId}_${Date.now()}`;
    
    try {
      // Step 1: Check if this needs direct answer (deployment/IDE help)
      const needsDirectAnswer = this.shouldBypassHints(questionText);
      
      // Step 2: Check knowledge patterns for existing solutions
      const matchedPatterns = await KnowledgePattern.findBestMatches(
        questionText, 
        track,
        needsDirectAnswer ? 'ERROR_SOLUTION' : null,
        3
      );
      
      // Step 3: Get or create learning session for context
      const session = await LearningSession.getOrCreateSession(userId, track);
      
      // Step 4: Route to appropriate agent
      let result;
      if (needsDirectAnswer) {
        result = await this.deploymentHelper(userId, questionData, matchedPatterns, requestId);
      } else {
        result = await this.enhancedMambaCoach(userId, questionData, matchedPatterns, session, requestId);
      }
      
      // Step 5: Update learning session
      if (result.interaction) {
        await session.addInteraction(result.interaction, result.response?.coachMessage || result.response?.directSolution);
      }
      
      // Step 6: Queue for training data pipeline (async)
      this.queueForTraining(result.interaction, needsDirectAnswer).catch(err => 
        logger.error('Training queue error:', err)
      );
      
      return result.response;
      
    } catch (error) {
      logger.error(`Smart agent error: ${requestId}`, error);
      throw error;
    }
  }

  /**
   * DEPLOYMENT HELPER - Direct answers for config/IDE issues
   * This BYPASSES the "hints only" rule because deployment issues
   * need exact solutions, not learning exercises.
   */
  async deploymentHelper(userId, questionData, matchedPatterns, requestId) {
    const startTime = Date.now();
    const { questionText, track } = questionData;
    
    try {
      // Check if we have a high-confidence pattern match
      if (matchedPatterns.length > 0 && matchedPatterns[0].score > 50) {
        const pattern = matchedPatterns[0].pattern;
        
        // Use cached solution if high quality
        if (pattern.learningData.avgUserRating >= 4 && pattern.solution.directAnswer) {
          await pattern.recordMatch(null, true, null);
          
          return {
            response: {
              success: true,
              agentType: 'DEPLOYMENT_HELPER',
              problemIdentified: pattern.title,
              directSolution: pattern.solution.directAnswer,
              codeExample: pattern.solution.codeExamples?.[0]?.code,
              additionalSteps: pattern.solution.steps?.map(s => s.instruction) || [],
              preventionTip: 'Check our knowledge base for similar issues!',
              confidence: 'HIGH',
              fromCache: true,
              requestId
            },
            interaction: null
          };
        }
      }
      
      // Call AI for fresh solution
      const systemPrompt = `You are the PeerTrack+ Deployment Helper - an expert in solving deployment, configuration, IDE, and environment issues.

CRITICAL: You provide DIRECT, COMPLETE solutions. Students need exact answers for these technical issues, not hints.

You MUST respond with valid JSON:
{
  "problemIdentified": "Brief description of the issue (max 100 chars)",
  "directSolution": "Complete, step-by-step solution with exact commands and code (max 2000 chars)",
  "codeExample": "Relevant code snippet if applicable",
  "additionalSteps": ["Step 1", "Step 2", ...],
  "preventionTip": "How to avoid this in the future (max 200 chars)",
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}

Be specific. Include exact commands, file paths, and code. This is NOT a learning exercise - it's troubleshooting.`;

      const userPrompt = `Track: ${track}
Issue: ${questionText}

Provide the DIRECT solution. Be specific and actionable.`;

      const response = await this.callStructured(systemPrompt, userPrompt, deploymentHelperSchema);
      const processingTime = Date.now() - startTime;
      
      // Store interaction
      const interaction = new AIInteraction({
        userId,
        role: 'STUDENT',
        toolType: 'STUDENT_MAMBA_HELP', // Same tool, different behavior
        track,
        inputText: questionText,
        output: {
          structured: response,
          userResponse: response.directSolution,
          rawResponse: JSON.stringify(response)
        },
        analytics: {
          topicOneLine: response.problemIdentified,
          keywords: this.extractKeywords(questionText),
          difficultyEstimate: 'INTERMEDIATE',
          confidenceScore: response.confidence === 'HIGH' ? 0.95 : response.confidence === 'MEDIUM' ? 0.75 : 0.5
        },
        costMeta: {
          tokensUsed: { total: this.estimateTokens(systemPrompt + userPrompt + JSON.stringify(response)) },
          estimatedCost: this.estimateCost(systemPrompt + userPrompt + JSON.stringify(response)),
          model: this.model,
          processingTime
        },
        status: 'SUCCESS',
        requestId,
        inputMetadata: {
          bypassedHints: true,
          agentType: 'DEPLOYMENT_HELPER'
        }
      });
      
      await interaction.save();
      
      // Create/update knowledge pattern for future use
      this.createPatternFromInteraction(interaction, response, 'ERROR_SOLUTION').catch(err =>
        logger.error('Pattern creation error:', err)
      );
      
      return {
        response: {
          success: true,
          agentType: 'DEPLOYMENT_HELPER',
          ...response,
          requestId
        },
        interaction
      };
      
    } catch (error) {
      logger.error(`Deployment helper error: ${requestId}`, error);
      
      return {
        response: {
          success: false,
          agentType: 'DEPLOYMENT_HELPER',
          problemIdentified: 'Unable to analyze',
          directSolution: 'I encountered an issue analyzing your problem. Please try rephrasing or check the documentation for your specific tool.',
          additionalSteps: ['Check official documentation', 'Search Stack Overflow', 'Book a tutor session'],
          preventionTip: 'Keep error messages handy when asking for help',
          confidence: 'LOW',
          error: error.message,
          requestId
        },
        interaction: null
      };
    }
  }

  /**
   * ENHANCED MAMBA COACH - Guided learning with context
   * This provides hints, not answers, to build problem-solving skills.
   */
  async enhancedMambaCoach(userId, questionData, matchedPatterns, session, requestId) {
    const startTime = Date.now();
    const { questionText, track } = questionData;
    
    try {
      // Build context from session history
      const sessionContext = session.interactions.slice(-3).map(i => 
        `Previous: ${i.inputSummary}`
      ).join('\n');
      
      // Check for pattern-based hints
      let patternHints = '';
      if (matchedPatterns.length > 0) {
        const hints = matchedPatterns[0].pattern.solution.guidedHints || [];
        if (hints.length > 0) {
          patternHints = `\nRelevant hints from knowledge base: ${hints.slice(0, 2).join('; ')}`;
        }
      }
      
      const systemPrompt = `You are "Mamba Helper 🐍24", a professional coach inspired by Kobe Bryant's dedication to practice and improvement.

CORE PHILOSOPHY: Champions are made through practice, not shortcuts. You NEVER give final answers.

For MATH: Break down the method, give similar examples, but NEVER the final numerical answer.
For CODING: Provide hints, pseudocode, guiding questions - but NEVER complete solutions.
For CONCEPTS: Explain the "why" and "how", ask probing questions to deepen understanding.

You MUST respond with valid JSON:
{
  "coachMessage": "Your main coaching message with hints and guidance (max 1200 chars)",
  "conceptBreakdown": ["Key concept 1", "Key concept 2", ...],
  "guidingQuestions": ["Question to make them think 1", "Question 2", ...],
  "practiceChallenge": "A simpler related problem they can try first",
  "skillsMap": ["skill1", "skill2", ...],
  "nextSteps": ["step 1", "step 2", "step 3"],
  "difficultyEstimate": "easy" | "medium" | "hard",
  "refusal": false
}

Set refusal=true ONLY for inappropriate content, never for legitimate learning questions.

Remember: You're training champions. Teach the METHOD, not the answer! 🐍24`;

      const userPrompt = `Track: ${track}
${sessionContext ? `Session Context:\n${sessionContext}\n` : ''}
${patternHints}

Current Question: ${questionText}

Guide them to discover the answer themselves. What concepts do they need to understand? What questions will help them think through this?`;

      const response = await this.callStructured(systemPrompt, userPrompt, enhancedMambaSchema);
      const processingTime = Date.now() - startTime;
      
      // Store interaction
      const interaction = new AIInteraction({
        userId,
        role: 'STUDENT',
        toolType: 'STUDENT_MAMBA_HELP',
        track,
        inputText: questionText,
        sessionId: session.sessionId,
        output: {
          structured: response,
          userResponse: response.coachMessage,
          rawResponse: JSON.stringify(response)
        },
        analytics: {
          topicOneLine: response.conceptBreakdown?.[0] || 'Learning session',
          keywords: response.skillsMap,
          difficultyEstimate: this.mapDifficulty(response.difficultyEstimate),
          confidenceScore: response.refusal ? 0.5 : 0.85
        },
        costMeta: {
          tokensUsed: { total: this.estimateTokens(systemPrompt + userPrompt + JSON.stringify(response)) },
          estimatedCost: this.estimateCost(systemPrompt + userPrompt + JSON.stringify(response)),
          model: this.model,
          processingTime
        },
        status: 'SUCCESS',
        requestId,
        inputMetadata: {
          bypassedHints: false,
          agentType: 'MAMBA_COACH',
          sessionId: session.sessionId
        }
      });
      
      await interaction.save();
      
      // Update pattern if matched
      if (matchedPatterns.length > 0) {
        matchedPatterns[0].pattern.recordMatch(interaction._id, true, null).catch(err =>
          logger.error('Pattern update error:', err)
        );
      }
      
      return {
        response: {
          success: true,
          agentType: 'MAMBA_COACH',
          coachMessage: response.coachMessage,
          conceptBreakdown: response.conceptBreakdown,
          guidingQuestions: response.guidingQuestions,
          practiceChallenge: response.practiceChallenge,
          skillsMap: response.skillsMap,
          nextSteps: response.nextSteps,
          difficultyEstimate: response.difficultyEstimate,
          refusal: response.refusal,
          sessionId: session.sessionId,
          requestId
        },
        interaction
      };
      
    } catch (error) {
      logger.error(`Mamba coach error: ${requestId}`, error);
      
      return {
        response: {
          success: false,
          agentType: 'MAMBA_COACH',
          coachMessage: 'Hey champion! 🐍24 I\'m having some technical difficulties. Try again in a moment, or book a tutor session!',
          conceptBreakdown: [],
          guidingQuestions: ['What specific part is confusing you?'],
          practiceChallenge: 'Try breaking the problem into smaller pieces',
          skillsMap: ['problem-solving'],
          nextSteps: ['Retry your question', 'Check documentation', 'Book a tutor'],
          difficultyEstimate: 'medium',
          refusal: false,
          error: error.message,
          requestId
        },
        interaction: null
      };
    }
  }

  /**
   * Check if question should bypass hints (deployment/IDE issues)
   */
  shouldBypassHints(questionText) {
    const text = questionText.toLowerCase();
    return this.bypassKeywords.some(kw => text.includes(kw));
  }

  /**
   * Create knowledge pattern from successful interaction
   */
  async createPatternFromInteraction(interaction, response, patternType) {
    try {
      const patternId = `pattern_${interaction.track}_${Date.now()}`;
      
      const pattern = new KnowledgePattern({
        patternId,
        patternType,
        track: interaction.track,
        difficulty: interaction.analytics.difficultyEstimate,
        title: response.problemIdentified || interaction.analytics.topicOneLine,
        description: interaction.inputText.substring(0, 500),
        triggerPatterns: [{
          pattern: this.createRegexFromText(interaction.inputText),
          weight: 1.0,
          examples: [interaction.inputText]
        }],
        keywords: (interaction.analytics.keywords || []).map(k => ({
          word: k,
          weight: 1.0,
          synonyms: []
        })),
        solution: {
          directAnswer: response.directSolution || response.coachMessage,
          guidedHints: response.conceptBreakdown || [],
          steps: (response.additionalSteps || []).map((step, i) => ({
            order: i + 1,
            instruction: step
          })),
          codeExamples: response.codeExample ? [{
            language: 'javascript',
            code: response.codeExample,
            explanation: 'Solution code',
            isCorrect: true
          }] : []
        },
        responseConfig: {
          bypassHintsOnly: patternType === 'ERROR_SOLUTION',
          urgencyLevel: patternType === 'ERROR_SOLUTION' ? 'HIGH' : 'MEDIUM'
        },
        learningData: {
          sourceInteractions: [interaction._id],
          totalMatches: 1
        },
        status: 'ACTIVE'
      });
      
      await pattern.save();
      logger.info(`Created knowledge pattern: ${patternId}`);
      
    } catch (error) {
      // Don't throw - pattern creation is optional
      logger.error('Pattern creation failed:', error);
    }
  }

  /**
   * Queue interaction for training data pipeline
   */
  async queueForTraining(interaction, isDeploymentHelp) {
    if (!interaction) return;
    
    try {
      const targetAgent = isDeploymentHelp ? 'DEPLOYMENT_HELPER' : 'MAMBA_COACH';
      const dataset = await AgentTrainingData.getOrCreateDataset(targetAgent);
      await dataset.addFromInteraction(interaction);
      
      logger.info(`Queued interaction for ${targetAgent} training`);
    } catch (error) {
      logger.error('Training queue error:', error);
    }
  }

  /**
   * Core OpenAI call with structured output
   */
  async callStructured(systemPrompt, userPrompt, schema) {
    let retryCount = 0;
    
    while (retryCount <= this.maxRetries) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: 2000
        });
        
        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error('No response from OpenAI');
        
        const parsed = JSON.parse(content.trim());
        return schema.parse(parsed);
        
      } catch (error) {
        retryCount++;
        if (retryCount > this.maxRetries) throw error;
        await new Promise(r => setTimeout(r, 1000 * retryCount));
      }
    }
  }

  // Utility methods
  extractKeywords(text) {
    const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const stopWords = ['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out'];
    return [...new Set(words.filter(w => !stopWords.includes(w)))].slice(0, 10);
  }

  createRegexFromText(text) {
    // Extract key technical terms for pattern matching
    const terms = text.match(/\b(error|failed|cannot|unable|not found|undefined|null|crash|bug|issue)\b/gi) || [];
    if (terms.length === 0) return text.substring(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return terms.join('|');
  }

  mapDifficulty(diff) {
    return { easy: 'BEGINNER', medium: 'INTERMEDIATE', hard: 'ADVANCED' }[diff] || 'INTERMEDIATE';
  }

  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  estimateCost(text) {
    return (this.estimateTokens(text) / 1000) * 0.01;
  }
}

module.exports = new IntelligentAgentService();
