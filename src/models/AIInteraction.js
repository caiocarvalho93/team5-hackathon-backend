const mongoose = require('mongoose');

const aiInteractionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  role: {
    type: String,
    enum: ['ALUMNI', 'STUDENT', 'ADMIN'],
    required: true,
    index: true
  },
  toolType: {
    type: String,
    enum: ['ALUMNI_TUTOR_HELP', 'STUDENT_MAMBA_HELP', 'OBSERVER_TAGGER', 'ADMIN_ANALYTICS'],
    required: true,
    index: true
  },
  track: {
    type: String,
    enum: ['SOFTWARE_ENGINEERING', 'CYBER_SECURITY', 'IT', 'AI', 'OTHER'],
    required: true
  },
  subcategory: {
    type: String,
    trim: true
  },
  inputText: {
    type: String,
    required: true,
    maxlength: 5000
  },
  inputMetadata: {
    characterCount: Number,
    wordCount: Number,
    language: String,
    containsCode: Boolean,
    urgencyLevel: String,
    complexity: String
  },
  output: {
    structured: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    userResponse: {
      type: String,
      maxlength: 10000
    },
    rawResponse: String // Full AI response before processing
  },
  analytics: {
    topicOneLine: {
      type: String,
      maxlength: 80,
      required: true
    },
    keywords: [{
      type: String,
      maxlength: 30
    }],
    superShortAnswer: {
      type: String,
      maxlength: 60
    },
    difficultyEstimate: {
      type: String,
      enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']
    },
    confidenceScore: {
      type: Number,
      min: 0,
      max: 1
    },
    topicCategories: [String],
    learningObjectives: [String],
    prerequisiteKnowledge: [String]
  },
  costMeta: {
    tokensUsed: {
      input: Number,
      output: Number,
      total: Number
    },
    estimatedCost: Number,
    model: String,
    processingTime: Number // in milliseconds
  },
  status: {
    type: String,
    enum: ['SUCCESS', 'FAILED', 'RATE_LIMITED', 'REFUSED', 'TIMEOUT', 'INVALID_INPUT'],
    required: true,
    index: true
  },
  errorInfo: {
    errorCode: String,
    errorMessage: String,
    retryCount: { type: Number, default: 0 },
    lastRetryAt: Date
  },
  requestId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  sessionId: String, // For grouping related interactions
  userAgent: String,
  ipAddress: String,
  refusalReason: String, // For STUDENT_MAMBA_HELP refusals
  qualityMetrics: {
    responseRelevance: { type: Number, min: 0, max: 100 },
    responseCompleteness: { type: Number, min: 0, max: 100 },
    responseClarity: { type: Number, min: 0, max: 100 },
    overallQuality: { type: Number, min: 0, max: 100 }
  },
  feedback: {
    userRating: { type: Number, min: 1, max: 5 },
    userFeedback: String,
    wasHelpful: Boolean,
    followUpNeeded: Boolean,
    reportedIssue: Boolean,
    issueDescription: String
  },
  followUp: {
    hasFollowUp: { type: Boolean, default: false },
    followUpInteractionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AIInteraction' },
    isFollowUpTo: { type: mongoose.Schema.Types.ObjectId, ref: 'AIInteraction' }
  },
  moderation: {
    flagged: { type: Boolean, default: false },
    flagReason: String,
    flaggedAt: Date,
    reviewed: { type: Boolean, default: false },
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approved: Boolean
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance and analytics
aiInteractionSchema.index({ userId: 1, createdAt: -1 });
aiInteractionSchema.index({ toolType: 1, track: 1, createdAt: -1 });
aiInteractionSchema.index({ status: 1, createdAt: -1 });
aiInteractionSchema.index({ 'analytics.keywords': 1 });
aiInteractionSchema.index({ sessionId: 1 });

// Virtual for processing time in seconds
aiInteractionSchema.virtual('processingTimeSeconds').get(function() {
  return this.costMeta?.processingTime ? this.costMeta.processingTime / 1000 : 0;
});

// Virtual for cost efficiency
aiInteractionSchema.virtual('costEfficiency').get(function() {
  if (!this.costMeta?.estimatedCost || !this.feedback?.userRating) return null;
  return this.feedback.userRating / this.costMeta.estimatedCost;
});

// Pre-save middleware for input analysis
aiInteractionSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('inputText')) {
    const input = this.inputText;
    
    this.inputMetadata = {
      characterCount: input.length,
      wordCount: input.split(/\s+/).length,
      containsCode: /```|`|\bfunction\b|\bclass\b|\bdef\b|\bimport\b/.test(input),
      language: this.detectLanguage(input)
    };
  }
  next();
});

// Method to detect programming language in input
aiInteractionSchema.methods.detectLanguage = function(text) {
  const patterns = {
    javascript: /\b(function|const|let|var|=>|console\.log)\b/i,
    python: /\b(def|import|from|print|if __name__)\b/i,
    java: /\b(public class|public static void|System\.out)\b/i,
    cpp: /\b(#include|iostream|std::cout|int main)\b/i,
    sql: /\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE)\b/i,
    html: /<[^>]+>/,
    css: /\{[^}]*\}/
  };
  
  for (const [lang, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) return lang;
  }
  
  return 'unknown';
};

// Method to add user feedback
aiInteractionSchema.methods.addFeedback = function(feedbackData) {
  this.feedback = {
    ...this.feedback,
    ...feedbackData,
    providedAt: new Date()
  };
  
  // Update quality metrics based on feedback
  if (feedbackData.userRating) {
    this.qualityMetrics.overallQuality = feedbackData.userRating * 20;
  }
  
  return this.save({ validateBeforeSave: false });
};

// Method to flag for moderation
aiInteractionSchema.methods.flag = function(reason, flaggedBy = null) {
  this.moderation.flagged = true;
  this.moderation.flagReason = reason;
  this.moderation.flaggedAt = new Date();
  if (flaggedBy) this.moderation.flaggedBy = flaggedBy;
  
  return this.save({ validateBeforeSave: false });
};

// Static method to get user interaction history
aiInteractionSchema.statics.getUserHistory = function(userId, toolType = null, limit = 50) {
  const match = { userId: mongoose.Types.ObjectId(userId) };
  if (toolType) match.toolType = toolType;
  
  return this.find(match)
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('toolType track inputText analytics.topicOneLine status createdAt feedback.userRating');
};

// Static method to get analytics data
aiInteractionSchema.statics.getAnalytics = function(timeframe = 'month', filters = {}) {
  const now = new Date();
  let startDate;
  
  switch (timeframe) {
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'year':
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(0);
  }
  
  const match = { createdAt: { $gte: startDate } };
  if (filters.toolType) match.toolType = filters.toolType;
  if (filters.track) match.track = filters.track;
  if (filters.status) match.status = filters.status;
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          toolType: '$toolType',
          track: '$track',
          status: '$status'
        },
        count: { $sum: 1 },
        avgProcessingTime: { $avg: '$costMeta.processingTime' },
        totalCost: { $sum: '$costMeta.estimatedCost' },
        avgRating: { $avg: '$feedback.userRating' },
        successRate: {
          $avg: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] }
        }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

// Static method to get trending topics
aiInteractionSchema.statics.getTrendingTopics = function(timeframe = 'week', limit = 20) {
  const now = new Date();
  let startDate;
  
  switch (timeframe) {
    case 'day':
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
  }
  
  return this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        status: 'SUCCESS'
      }
    },
    { $unwind: '$analytics.keywords' },
    {
      $group: {
        _id: '$analytics.keywords',
        count: { $sum: 1 },
        tracks: { $addToSet: '$track' },
        avgRating: { $avg: '$feedback.userRating' },
        recentInteractions: { $push: '$analytics.topicOneLine' }
      }
    },
    { $sort: { count: -1 } },
    { $limit: limit },
    {
      $project: {
        keyword: '$_id',
        count: 1,
        tracks: 1,
        avgRating: 1,
        sampleTopics: { $slice: ['$recentInteractions', 3] }
      }
    }
  ]);
};

// Static method to get curriculum insights
aiInteractionSchema.statics.getCurriculumInsights = function(track, timeframe = 'month') {
  const now = new Date();
  let startDate;
  
  switch (timeframe) {
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'quarter':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
  }
  
  return this.aggregate([
    {
      $match: {
        track,
        createdAt: { $gte: startDate },
        status: 'SUCCESS'
      }
    },
    {
      $group: {
        _id: '$analytics.difficultyEstimate',
        count: { $sum: 1 },
        topics: { $addToSet: '$analytics.topicOneLine' },
        keywords: { $push: '$analytics.keywords' },
        avgRating: { $avg: '$feedback.userRating' },
        strugglingAreas: {
          $push: {
            $cond: [
              { $lt: ['$feedback.userRating', 3] },
              '$analytics.topicOneLine',
              null
            ]
          }
        }
      }
    },
    {
      $project: {
        difficulty: '$_id',
        count: 1,
        sampleTopics: { $slice: ['$topics', 10] },
        topKeywords: {
          $slice: [
            {
              $reduce: {
                input: '$keywords',
                initialValue: [],
                in: { $concatArrays: ['$$value', '$$this'] }
              }
            },
            20
          ]
        },
        avgRating: 1,
        strugglingTopics: {
          $filter: {
            input: '$strugglingAreas',
            cond: { $ne: ['$$this', null] }
          }
        }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

// Static method to detect knowledge gaps
aiInteractionSchema.statics.detectKnowledgeGaps = function(track, limit = 10) {
  return this.aggregate([
    {
      $match: {
        track,
        status: 'SUCCESS',
        'feedback.userRating': { $exists: true }
      }
    },
    {
      $group: {
        _id: '$analytics.topicOneLine',
        avgRating: { $avg: '$feedback.userRating' },
        interactionCount: { $sum: 1 },
        lowRatingCount: {
          $sum: { $cond: [{ $lt: ['$feedback.userRating', 3] }, 1, 0] }
        },
        keywords: { $addToSet: '$analytics.keywords' }
      }
    },
    {
      $addFields: {
        gapScore: {
          $multiply: [
            { $divide: ['$lowRatingCount', '$interactionCount'] },
            '$interactionCount'
          ]
        }
      }
    },
    {
      $match: {
        interactionCount: { $gte: 3 }, // Minimum interactions for statistical significance
        gapScore: { $gte: 0.3 } // At least 30% low ratings
      }
    },
    { $sort: { gapScore: -1 } },
    { $limit: limit },
    {
      $project: {
        topic: '$_id',
        avgRating: 1,
        interactionCount: 1,
        lowRatingPercentage: { $divide: ['$lowRatingCount', '$interactionCount'] },
        gapScore: 1,
        relatedKeywords: { $slice: [{ $reduce: { input: '$keywords', initialValue: [], in: { $concatArrays: ['$$value', '$$this'] } } }, 10] }
      }
    }
  ]);
};

module.exports = mongoose.model('AIInteraction', aiInteractionSchema);