const mongoose = require('mongoose');

const endorsementSchema = new mongoose.Schema({
  endorserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  message: {
    type: String,
    trim: true,
    maxlength: 500
  },
  skills: [{
    type: String,
    trim: true,
    maxlength: 50
  }],
  category: {
    type: String,
    enum: ['TECHNICAL_EXPERTISE', 'MENTORSHIP_QUALITY', 'COMMUNICATION', 'PROBLEM_SOLVING', 'LEADERSHIP', 'COLLABORATION'],
    required: true
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    required: true
  },
  relationship: {
    type: String,
    enum: ['PEER', 'MENTEE', 'COLLEAGUE', 'PROJECT_PARTNER', 'OTHER'],
    required: true
  },
  context: {
    sessionCount: { type: Number, default: 0 },
    projectsWorkedTogether: [String],
    timeWorkedTogether: String, // e.g., "3 months", "1 year"
    specificExamples: [String]
  },
  visibility: {
    type: String,
    enum: ['PUBLIC', 'PRIVATE', 'CONNECTIONS_ONLY'],
    default: 'PUBLIC'
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'HIDDEN', 'REPORTED', 'DELETED'],
    default: 'ACTIVE'
  },
  xpAwarded: {
    type: Boolean,
    default: false
  },
  xpAmount: {
    type: Number,
    default: 50
  },
  awardedAt: Date,
  analytics: {
    helpfulVotes: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    shares: { type: Number, default: 0 }
  },
  interactions: {
    helpfulVotedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    reportedBy: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reason: String,
      reportedAt: { type: Date, default: Date.now }
    }]
  },
  moderation: {
    flagged: { type: Boolean, default: false },
    flaggedAt: Date,
    flaggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    flagReason: String,
    reviewed: { type: Boolean, default: false },
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    moderationNotes: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound unique index to prevent duplicate endorsements
endorsementSchema.index({ endorserId: 1, targetId: 1 }, { unique: true });
endorsementSchema.index({ targetId: 1, status: 1, createdAt: -1 });
endorsementSchema.index({ category: 1, rating: -1 });

// Virtual for endorsement weight based on endorser's reputation
endorsementSchema.virtual('weight').get(function() {
  // This will be populated when we populate the endorser
  if (this.endorser && this.endorser.gamification) {
    return Math.min(this.endorser.gamification.currentXP * 0.001, 2.0);
  }
  return 1.0; // Default weight
});

// Virtual for credibility score
endorsementSchema.virtual('credibilityScore').get(function() {
  let score = this.rating * 20; // Base score from rating (20-100)
  
  // Boost for detailed message
  if (this.message && this.message.length > 100) score += 10;
  
  // Boost for specific skills mentioned
  if (this.skills && this.skills.length > 0) score += 5;
  
  // Boost for context provided
  if (this.context.sessionCount > 0) score += 5;
  if (this.context.specificExamples && this.context.specificExamples.length > 0) score += 10;
  
  // Boost for helpful votes
  score += Math.min(this.analytics.helpfulVotes * 2, 20);
  
  return Math.min(score, 100);
});

// Pre-save middleware for validation
endorsementSchema.pre('save', function(next) {
  // Prevent self-endorsement
  if (this.endorserId.toString() === this.targetId.toString()) {
    return next(new Error('Users cannot endorse themselves'));
  }
  
  // Ensure skills are unique and clean
  if (this.skills) {
    this.skills = [...new Set(this.skills.map(skill => skill.toLowerCase().trim()))];
  }
  
  next();
});

// Method to mark as helpful
endorsementSchema.methods.markHelpful = function(userId) {
  if (!this.interactions.helpfulVotedBy.includes(userId)) {
    this.interactions.helpfulVotedBy.push(userId);
    this.analytics.helpfulVotes += 1;
    return this.save({ validateBeforeSave: false });
  }
  return Promise.resolve(this);
};

// Method to report endorsement
endorsementSchema.methods.report = function(userId, reason) {
  const existingReport = this.interactions.reportedBy.find(
    report => report.userId.toString() === userId.toString()
  );
  
  if (!existingReport) {
    this.interactions.reportedBy.push({
      userId,
      reason,
      reportedAt: new Date()
    });
    
    // Auto-flag if multiple reports
    if (this.interactions.reportedBy.length >= 2) {
      this.moderation.flagged = true;
      this.moderation.flaggedAt = new Date();
      this.moderation.flagReason = 'Multiple user reports';
    }
    
    return this.save({ validateBeforeSave: false });
  }
  return Promise.resolve(this);
};

// Method to increment view count
endorsementSchema.methods.incrementViews = function() {
  this.analytics.views += 1;
  return this.save({ validateBeforeSave: false });
};

// Static method to get user's endorsements received
endorsementSchema.statics.getUserEndorsements = function(userId, options = {}) {
  const {
    category = null,
    limit = 20,
    includePrivate = false,
    sortBy = 'recent'
  } = options;
  
  const match = {
    targetId: mongoose.Types.ObjectId(userId),
    status: 'ACTIVE'
  };
  
  if (category) {
    match.category = category;
  }
  
  if (!includePrivate) {
    match.visibility = { $ne: 'PRIVATE' };
  }
  
  let sort = {};
  switch (sortBy) {
    case 'rating':
      sort = { rating: -1, createdAt: -1 };
      break;
    case 'helpful':
      sort = { 'analytics.helpfulVotes': -1, createdAt: -1 };
      break;
    default:
      sort = { createdAt: -1 };
  }
  
  return this.find(match)
    .populate('endorserId', 'profile.firstName profile.lastName profile.displayName profile.avatar gamification.currentXP gamification.level role')
    .sort(sort)
    .limit(limit);
};

// Static method to get user's endorsements given
endorsementSchema.statics.getUserEndorsementsGiven = function(userId, limit = 20) {
  return this.find({
    endorserId: mongoose.Types.ObjectId(userId),
    status: 'ACTIVE'
  })
    .populate('targetId', 'profile.firstName profile.lastName profile.displayName profile.avatar role')
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Static method to get endorsement statistics
endorsementSchema.statics.getEndorsementStats = function(userId) {
  return this.aggregate([
    {
      $facet: {
        received: [
          {
            $match: {
              targetId: mongoose.Types.ObjectId(userId),
              status: 'ACTIVE'
            }
          },
          {
            $group: {
              _id: null,
              totalReceived: { $sum: 1 },
              avgRating: { $avg: '$rating' },
              totalHelpfulVotes: { $sum: '$analytics.helpfulVotes' },
              categoryBreakdown: {
                $push: {
                  category: '$category',
                  rating: '$rating'
                }
              }
            }
          }
        ],
        given: [
          {
            $match: {
              endorserId: mongoose.Types.ObjectId(userId),
              status: 'ACTIVE'
            }
          },
          {
            $group: {
              _id: null,
              totalGiven: { $sum: 1 },
              avgRatingGiven: { $avg: '$rating' }
            }
          }
        ]
      }
    }
  ]);
};

// Static method to get top endorsed users
endorsementSchema.statics.getTopEndorsedUsers = function(category = null, timeframe = 'all', limit = 20) {
  const now = new Date();
  let matchCondition = { status: 'ACTIVE' };
  
  if (category) {
    matchCondition.category = category;
  }
  
  if (timeframe !== 'all') {
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
    }
    if (startDate) {
      matchCondition.createdAt = { $gte: startDate };
    }
  }
  
  return this.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: '$targetId',
        endorsementCount: { $sum: 1 },
        avgRating: { $avg: '$rating' },
        totalHelpfulVotes: { $sum: '$analytics.helpfulVotes' },
        weightedScore: {
          $avg: {
            $multiply: ['$rating', { $ifNull: ['$weight', 1] }]
          }
        }
      }
    },
    {
      $addFields: {
        overallScore: {
          $add: [
            { $multiply: ['$avgRating', 20] },
            { $multiply: ['$endorsementCount', 5] },
            { $multiply: ['$totalHelpfulVotes', 2] }
          ]
        }
      }
    },
    { $sort: { overallScore: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $unwind: '$user' },
    {
      $project: {
        userId: '$_id',
        endorsementCount: 1,
        avgRating: 1,
        totalHelpfulVotes: 1,
        overallScore: 1,
        'user.profile.firstName': 1,
        'user.profile.lastName': 1,
        'user.profile.displayName': 1,
        'user.profile.avatar': 1,
        'user.role': 1,
        'user.gamification.level': 1
      }
    }
  ]);
};

// Static method to check if endorsement exists
endorsementSchema.statics.checkEndorsementExists = function(endorserId, targetId) {
  return this.findOne({
    endorserId: mongoose.Types.ObjectId(endorserId),
    targetId: mongoose.Types.ObjectId(targetId)
  });
};

// Static method to get skill endorsements
endorsementSchema.statics.getSkillEndorsements = function(userId, skill) {
  return this.find({
    targetId: mongoose.Types.ObjectId(userId),
    skills: { $in: [skill.toLowerCase()] },
    status: 'ACTIVE',
    visibility: { $ne: 'PRIVATE' }
  })
    .populate('endorserId', 'profile.firstName profile.lastName profile.displayName profile.avatar')
    .sort({ rating: -1, createdAt: -1 });
};

module.exports = mongoose.model('Endorsement', endorsementSchema);