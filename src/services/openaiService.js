const OpenAI = require('openai');
const { z } = require('zod');
const { logger } = require('../config/database');
const AIInteraction = require('../models/AIInteraction');

// Response schemas for structured outputs
const alumniResponseSchema = z.object({
  topicOneLine: z.string().max(80),
  keywords: z.array(z.string().max(30)).min(5).max(10),
  superShortAnswer: z.string().max(60),
  fullAnswer: z.string().max(1200)
});

const studentResponseSchema = z.object({
  coachMessage: z.string().max(900),
  skillsMap: z.array(z.string()).min(3).max(8),
  nextSteps: z.array(z.string()).length(3),
  difficultyEstimate: z.enum(['easy', 'medium', 'hard']),
  refusal: z.boolean()
});

class OpenAIService {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.model = 'gpt-4-1106-preview'; // Use GPT-4 Turbo for better performance
    this.maxRetries = 2;
    this.timeout = 30000; // 30 seconds
    this.rateLimitCache = new Map(); // Simple in-memory rate limiting
  }

  // Rate limiting disabled for hackathon demo - unlimited requests
  checkRateLimit(userId, toolType) {
    // No rate limiting - allow unlimited requests for hackathon demo
    return true;
  }

  // Generate cache key for identical prompts
  generateCacheKey(toolType, track, questionText) {
    const crypto = require('crypto');
    const content = `${toolType}_${track}_${questionText}`;
    return crypto.createHash('md5').update(content).digest('hex');
  }

  // Alumni AI Tutoring Help
  async alumniTutorHelp(userId, questionData) {
    const requestId = `alumni_${userId}_${Date.now()}`;
    const startTime = Date.now();
    
    try {
      // Validate input
      const { questionText, track, subcategory = 'N/A' } = questionData;
      
      if (!questionText || questionText.length < 10) {
        throw new Error('Question must be at least 10 characters long');
      }
      
      if (questionText.length > 2000) {
        throw new Error('Question is too long (max 2000 characters)');
      }
      
      // Check rate limits
      this.checkRateLimit(userId, 'ALUMNI_TUTOR_HELP');
      
      // Check cache for identical prompts
      const cacheKey = this.generateCacheKey('ALUMNI_TUTOR_HELP', track, questionText);
      // In production, implement Redis cache here
      
      // Prepare system prompt
      const systemPrompt = `You are "PeerTrack+ Tutor Intelligence Console". You MUST output VALID JSON in this EXACT format:
{
  "topicOneLine": "Brief topic description (max 80 chars)",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "superShortAnswer": "Ultra-brief answer (max 60 chars)",
  "fullAnswer": "Complete explanation with steps and examples (max 1200 chars)"
}

Requirements:
- topicOneLine: Concise topic description, max 80 characters
- keywords: 5-10 relevant technical terms, each max 30 characters
- superShortAnswer: Ultra-brief answer, max 60 characters
- fullAnswer: Complete explanation with steps and examples, max 1200 characters

You are helping a tutor provide better assistance to students. Give accurate, educational help.`;

      const userPrompt = `Track: ${track}
Subcategory: ${subcategory}
Question: ${questionText}`;

      // Call OpenAI with structured output
      const response = await this.callStructured(
        systemPrompt,
        userPrompt,
        alumniResponseSchema,
        { requestId, userId, toolType: 'ALUMNI_TUTOR_HELP' }
      );
      
      const processingTime = Date.now() - startTime;
      
      // Store interaction
      const interaction = new AIInteraction({
        userId,
        role: 'ALUMNI',
        toolType: 'ALUMNI_TUTOR_HELP',
        track,
        subcategory,
        inputText: questionText,
        output: {
          structured: response,
          userResponse: response.fullAnswer,
          rawResponse: JSON.stringify(response)
        },
        analytics: {
          topicOneLine: response.topicOneLine,
          keywords: response.keywords,
          superShortAnswer: response.superShortAnswer,
          difficultyEstimate: this.estimateDifficulty(questionText, response.keywords),
          confidenceScore: 0.9 // High confidence for successful responses
        },
        costMeta: {
          tokensUsed: {
            input: this.estimateTokens(systemPrompt + userPrompt),
            output: this.estimateTokens(JSON.stringify(response)),
            total: this.estimateTokens(systemPrompt + userPrompt + JSON.stringify(response))
          },
          estimatedCost: this.estimateCost(systemPrompt + userPrompt + JSON.stringify(response)),
          model: this.model,
          processingTime
        },
        status: 'SUCCESS',
        requestId
      });
      
      await interaction.save();
      
      logger.info(`Alumni AI help completed: ${requestId}`);
      
      return {
        success: true,
        analytics: {
          topicOneLine: response.topicOneLine,
          keywords: response.keywords,
          superShortAnswer: response.superShortAnswer
        },
        fullAnswer: response.fullAnswer,
        requestId
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      // Store failed interaction
      const interaction = new AIInteraction({
        userId,
        role: 'ALUMNI',
        toolType: 'ALUMNI_TUTOR_HELP',
        track: questionData.track,
        subcategory: questionData.subcategory,
        inputText: questionData.questionText || '',
        output: {
          structured: {},
          userResponse: this.getFallbackMessage('ALUMNI'),
          rawResponse: ''
        },
        analytics: {
          topicOneLine: 'AI unavailable',
          keywords: [],
          superShortAnswer: 'Try again later',
          confidenceScore: 0
        },
        costMeta: {
          processingTime,
          model: this.model
        },
        status: 'FAILED',
        errorInfo: {
          errorMessage: error.message,
          errorCode: error.code || 'UNKNOWN'
        },
        requestId
      });
      
      await interaction.save();
      
      logger.error(`Alumni AI help failed: ${requestId}`, error);
      
      return {
        success: false,
        analytics: {
          topicOneLine: 'AI unavailable',
          keywords: [],
          superShortAnswer: 'Try again later'
        },
        fullAnswer: this.getFallbackMessage('ALUMNI'),
        error: error.message,
        requestId
      };
    }
  }

  // Student AI Mamba Helper
  async studentMambaHelper(userId, questionData) {
    const requestId = `student_${userId}_${Date.now()}`;
    const startTime = Date.now();
    
    try {
      // Validate input
      const { questionText, track } = questionData;
      
      if (!questionText || questionText.length < 8) {
        throw new Error('Question must be at least 8 characters long');
      }
      
      // Check rate limits
      this.checkRateLimit(userId, 'STUDENT_MAMBA_HELP');
      
      // Apply pre-filters
      const filterResult = this.applyPreFilters(questionText, track);
      if (filterResult.refused) {
        return this.createRefusalResponse(userId, questionData, filterResult.reason, requestId);
      }
      
      // Prepare system prompt
      const systemPrompt = `You are "Mamba Helper 🐍24", a professional coach inspired by Kobe Bryant's dedication to practice and improvement. You help with coding, math, and science questions. You NEVER provide final answers or full solutions. Instead, you provide hints, guiding questions, break down the problem, and teach the METHOD to solve it.

For MATH questions:
- Break down the problem into steps
- Teach the method (e.g., "To multiply large numbers, break them into parts...")
- Give a similar easier example they can practice
- NEVER give the final numerical answer

For CODING questions:
- Provide hints and pseudocode
- Ask guiding questions
- Suggest what to research

CRITICAL: You MUST respond with VALID JSON in this EXACT format:
{
  "coachMessage": "Your coaching message here (max 900 chars)",
  "skillsMap": ["skill1", "skill2", "skill3"],
  "nextSteps": ["step 1", "step 2", "step 3"],
  "difficultyEstimate": "easy",
  "refusal": false
}

Rules:
- coachMessage: Your main coaching response with hints and method explanation
- skillsMap: 3-8 relevant skills/topics
- nextSteps: Exactly 3 action steps
- difficultyEstimate: Must be "easy", "medium", or "hard"
- refusal: Set to true ONLY for inappropriate content (not for math/science questions)

Remember: You're training them to think like champions. Teach the METHOD, not the answer! 🐍24`;

      const userPrompt = `Track: ${track}
Question: ${questionText}
Goal: Provide hints only, no full solution. Help them practice their way to greatness! 🐍24`;

      // Call OpenAI with structured output
      const response = await this.callStructured(
        systemPrompt,
        userPrompt,
        studentResponseSchema,
        { requestId, userId, toolType: 'STUDENT_MAMBA_HELP' }
      );
      
      const processingTime = Date.now() - startTime;
      
      // Store interaction
      const interaction = new AIInteraction({
        userId,
        role: 'STUDENT',
        toolType: 'STUDENT_MAMBA_HELP',
        track,
        inputText: questionText,
        output: {
          structured: response,
          userResponse: response.coachMessage,
          rawResponse: JSON.stringify(response)
        },
        analytics: {
          topicOneLine: this.extractTopic(response.skillsMap),
          keywords: response.skillsMap,
          difficultyEstimate: this.mapDifficultyToEnum(response.difficultyEstimate),
          confidenceScore: response.refusal ? 0.5 : 0.8
        },
        costMeta: {
          tokensUsed: {
            input: this.estimateTokens(systemPrompt + userPrompt),
            output: this.estimateTokens(JSON.stringify(response)),
            total: this.estimateTokens(systemPrompt + userPrompt + JSON.stringify(response))
          },
          estimatedCost: this.estimateCost(systemPrompt + userPrompt + JSON.stringify(response)),
          model: this.model,
          processingTime
        },
        status: 'SUCCESS',
        requestId,
        refusalReason: response.refusal ? 'AI refused to provide direct answer' : null
      });
      
      await interaction.save();
      
      logger.info(`Student Mamba help completed: ${requestId}`);
      
      return {
        success: true,
        coachMessage: response.coachMessage,
        skillsMap: response.skillsMap,
        nextSteps: response.nextSteps,
        difficultyEstimate: response.difficultyEstimate,
        refusal: response.refusal,
        requestId
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      // Store failed interaction
      const interaction = new AIInteraction({
        userId,
        role: 'STUDENT',
        toolType: 'STUDENT_MAMBA_HELP',
        track: questionData.track,
        inputText: questionData.questionText || '',
        output: {
          structured: {},
          userResponse: this.getFallbackMessage('STUDENT'),
          rawResponse: ''
        },
        analytics: {
          topicOneLine: 'AI unavailable',
          keywords: [],
          confidenceScore: 0
        },
        costMeta: {
          processingTime,
          model: this.model
        },
        status: 'FAILED',
        errorInfo: {
          errorMessage: error.message,
          errorCode: error.code || 'UNKNOWN'
        },
        requestId
      });
      
      await interaction.save();
      
      logger.error(`Student Mamba help failed: ${requestId}`, error);
      
      return {
        success: false,
        coachMessage: this.getFallbackMessage('STUDENT'),
        skillsMap: ['general'],
        nextSteps: ['Try again later', 'Check your internet connection', 'Book a tutor session'],
        difficultyEstimate: 'medium',
        refusal: false,
        error: error.message,
        requestId
      };
    }
  }

  // Apply pre-filters for student questions
  applyPreFilters(questionText, track) {
    const text = questionText.toLowerCase();
    
    // Filter 1: Track missing
    if (!track) {
      return { refused: true, reason: 'Pick a track first.' };
    }
    
    // Filter 2: Non-academic topic - VERY OPEN for educational content
    // Allow: coding, math, science, history, language, any learning topic
    // Only block: clearly non-educational content
    const blockedTopics = ['gossip', 'celebrity', 'dating', 'relationship advice', 'horoscope'];
    const isBlockedTopic = blockedTopics.some(topic => text.includes(topic));
    
    // Check if it has numbers (likely math) or any educational intent
    const hasNumbers = /\d/.test(text);
    const hasQuestionWords = ['what', 'how', 'why', 'explain', 'help', 'understand', 'learn', 'teach', 'practice'].some(w => text.includes(w));
    
    if (isBlockedTopic && !hasNumbers && !hasQuestionWords) {
      return { refused: true, reason: 'Let\'s focus on learning! Ask me about coding, math, science, or any academic topic. 🐍24' };
    }
    
    // Filter 3: Direct answer requests
    const directAnswerPatterns = [
      'give me the answer', 'just give me', 'solve it', 'solve this', 'what is the answer',
      'tell me the solution', 'show me the code', 'write the code', 'complete code',
      'full solution', 'entire solution', 'do my homework', 'solve my assignment'
    ];
    if (directAnswerPatterns.some(pattern => text.includes(pattern))) {
      return { refused: true, reason: 'I can\'t give you the final answer - that would rob you of the learning! Let me guide you to discover it yourself. Champions are made through practice, not shortcuts! 🐍24' };
    }
    
    // Filter 4: Too short - but allow math expressions
    const hasMathExpression = /\d+\s*(times|x|\*|plus|\+|minus|-|divided|\/)\s*\d+/.test(text);
    if (questionText.length < 15 && !hasMathExpression) {
      return { refused: true, reason: 'Give me a bit more detail! What are you trying to learn? 🐍24' };
    }
    
    // Filter 5: Profanity/harassment (basic check)
    const inappropriateWords = ['damn', 'shit', 'fuck', 'stupid', 'idiot', 'hate'];
    if (inappropriateWords.some(word => text.includes(word))) {
      return { refused: true, reason: 'Let\'s keep our training session professional and focused on learning. Rephrase your question and let\'s get back to building greatness! 🐍24' };
    }
    
    // Filter 6: Illegal/hacking content
    const illegalPatterns = ['hack into', 'break into', 'steal', 'pirate', 'crack password', 'ddos', 'malware'];
    if (illegalPatterns.some(pattern => text.includes(pattern))) {
      return { refused: true, reason: 'I only help with ethical learning and development. Let\'s focus on building positive skills that make the world better! 🐍24' };
    }
    
    // Filter 7: Personal data requests
    if (text.includes('personal') && (text.includes('data') || text.includes('information'))) {
      return { refused: true, reason: 'I don\'t handle personal data questions. Let\'s focus on technical skills and coding challenges! 🐍24' };
    }
    
    // Filter 8: Jailbreak attempts
    const jailbreakPatterns = ['ignore rules', 'ignore instructions', 'act as', 'pretend you are', 'forget you are'];
    if (jailbreakPatterns.some(pattern => text.includes(pattern))) {
      return { refused: true, reason: 'Nice try, but I\'m here to help you learn coding, not play games! What technical challenge can I help you practice? 🐍24' };
    }
    
    // Filter 9: Screenshot mentions without text
    if (text.includes('screenshot') && questionText.length < 50) {
      return { refused: true, reason: 'I can\'t see images, but I can help if you paste the key details or error messages as text! 🐍24' };
    }
    
    // Filter 10: Repeated questions (would need session tracking in production)
    // This would require Redis or database tracking of recent questions
    
    return { refused: false };
  }

  // Create refusal response
  async createRefusalResponse(userId, questionData, reason, requestId) {
    const interaction = new AIInteraction({
      userId,
      role: 'STUDENT',
      toolType: 'STUDENT_MAMBA_HELP',
      track: questionData.track,
      inputText: questionData.questionText,
      output: {
        structured: { refusal: true },
        userResponse: reason,
        rawResponse: ''
      },
      analytics: {
        topicOneLine: 'Request refused',
        keywords: ['refusal'],
        confidenceScore: 1.0
      },
      status: 'REFUSED',
      requestId,
      refusalReason: reason
    });
    
    await interaction.save();
    
    return {
      success: true,
      coachMessage: reason,
      skillsMap: ['communication'],
      nextSteps: [
        'Rephrase your question',
        'Be more specific about the technical challenge',
        'Book a tutor session for detailed help'
      ],
      difficultyEstimate: 'easy',
      refusal: true,
      requestId
    };
  }

  // Core OpenAI API call with structured output
  async callStructured(systemPrompt, userPrompt, schema, metadata = {}) {
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
          max_tokens: 1500,

        });
        
        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No response content from OpenAI');
        }
        
        // Parse and validate JSON
        let parsedResponse;
        try {
          parsedResponse = JSON.parse(content.trim());
        } catch (parseError) {
          if (retryCount < this.maxRetries) {
            retryCount++;
            logger.warn(`JSON parse failed, retrying (${retryCount}/${this.maxRetries})`);
            continue;
          }
          throw new Error('Invalid JSON response from OpenAI');
        }
        
        // Validate against schema
        const validatedResponse = schema.parse(parsedResponse);
        
        return validatedResponse;
        
      } catch (error) {
        retryCount++;
        
        if (retryCount > this.maxRetries) {
          logger.error('OpenAI API call failed after retries:', error);
          throw error;
        }
        
        logger.warn(`OpenAI API call failed, retrying (${retryCount}/${this.maxRetries}):`, error.message);
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }
  }

  // Utility methods
  estimateTokens(text) {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  estimateCost(text) {
    const tokens = this.estimateTokens(text);
    // GPT-4 Turbo pricing (approximate)
    return (tokens / 1000) * 0.01; // $0.01 per 1K tokens
  }

  estimateDifficulty(questionText, keywords) {
    const advancedKeywords = ['algorithm', 'optimization', 'architecture', 'design pattern', 'scalability', 'performance'];
    const intermediateKeywords = ['function', 'class', 'object', 'array', 'loop', 'condition'];
    
    const hasAdvanced = advancedKeywords.some(keyword => 
      questionText.toLowerCase().includes(keyword) || 
      keywords.some(k => k.toLowerCase().includes(keyword))
    );
    
    const hasIntermediate = intermediateKeywords.some(keyword => 
      questionText.toLowerCase().includes(keyword) || 
      keywords.some(k => k.toLowerCase().includes(keyword))
    );
    
    if (hasAdvanced) return 'ADVANCED';
    if (hasIntermediate) return 'INTERMEDIATE';
    return 'BEGINNER';
  }

  extractTopic(skillsMap) {
    if (!skillsMap || skillsMap.length === 0) return 'General topic';
    return skillsMap.slice(0, 3).join(' ').substring(0, 80);
  }

  mapDifficultyToEnum(difficulty) {
    const mapping = {
      'easy': 'BEGINNER',
      'medium': 'INTERMEDIATE', 
      'hard': 'ADVANCED'
    };
    return mapping[difficulty?.toLowerCase()] || 'INTERMEDIATE';
  }

  getFallbackMessage(role) {
    if (role === 'ALUMNI') {
      return 'AI is temporarily unavailable. Please retry in a moment. You can also consult documentation or reach out to the community for assistance.';
    } else {
      return 'Hey champion! 🐍24 I\'m having some technical difficulties right now. Try again in a moment, or book a tutor session for immediate help. Keep practicing!';
    }
  }
}

module.exports = new OpenAIService();