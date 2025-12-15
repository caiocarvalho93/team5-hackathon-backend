const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  authorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  feedType: {
    type: String,
    enum: ['QNA', 'COMMUNITY', 'ALUMNI_PROFESSIONAL'],
    required: true,
    index: true
  },
  track: {
    type: String,
    enum: ['SOFTWARE_ENGINEERING', 'CYBER_SECURITY', 'IT', 'AI', 'OTHER'],
    required: true,
    index: true
  },
  subcategory: {
    type: String,
    trim: true,
    maxlength: 100
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
    minlength: 5
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 5000,
    minlength: 10
  },
  attachments: [{
    filename: String,
    originalName: String,
    mimetype: String,
    size: Number,
    url: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 30
  }],
  status: {
    type: String,
    enum: ['ACTIVE', 'DELETED', 'REPORTED', 'HIDDEN', 'FLAGGED'],
    default: 'ACTIVE',
    index: true
  },
  priority: {
    type: String,
    enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
    default: 'NORMAL'
  },
  difficulty: {
    type: String,
    enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'],
    default: 'INTERMEDIATE'
  },
  analytics: {
    views: { type: Number, default: 0 },
    answers: { type: Number, default: 0 },
    upvotes: { type: Number, default: 0 },
    downvotes: { type: Number, default: 0 },
    reports: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    bookmarks: { type: Number, default: 0 },
    lastActivityAt: { type: Date, default: Date.now }
  },
  aiSignal: {
    domainTags: [String],
    complexityScore: { type: Number, min: 1, max: 10 },
    recommendedTutorTags: [String],
    topicKeywords: [String],
    estimatedTimeToAnswer: Number, // in minutes
    processed: { type: Boolean, default: false },
    processedAt: Date,
    confidence: { type: Number, min: 0, max: 1 }
  },
  interactions: {
    upvotedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    downvotedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    bookmarkedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    reportedBy: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reason: String,
      reportedAt: { type: Date, default: Date.now }
    }]
  },
  moderation: {
    flaggedAt: Date,
    flaggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    flagReason: String,
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    moderationNotes: String,
    autoFlagged: { type: Boolean, default: false },
    autoFlagReason: String
  },
  seo: {
    slug: { type: String, unique: true, sparse: true },
    metaDescription: String,
    searchKeywords: [String]
  },
  engagement: {
    avgResponseTime: Number, // in minutes
    bestAnswerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Answer' },
    isResolved: { type: Boolean, default: false },
    resolvedAt: Date,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
postSchema.index({ feedType: 1, track: 1, createdAt: -1 });
postSchema.index({ authorId: 1, createdAt: -1 });
postSchema.index({ status: 1, createdAt: -1 });
postSchema.index({ 'aiSignal.complexityScore': 1 });
postSchema.index({ 'analytics.views': -1 });
postSchema.index({ 'analytics.upvotes': -1 });

// Virtual for answer count
postSchema.virtual('answerCount', {
  ref: 'Answer',
  localField: '_id',
  foreignField: 'postId',
  count: true
});

// Virtual for engagement score
postSchema.virtual('engagementScore').get(function() {
  const views = this.analytics.views || 1;
  const answers = this.analytics.answers || 0;
  const upvotes = this.analytics.upvotes || 0;
  const downvotes = this.analytics.downvotes || 0;
  
  return ((answers * 10) + (upvotes * 5) - (downvotes * 2)) / Math.log(views + 1);
});

// Virtual for time since posted
postSchema.virtual('timeAgo').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
});

// Pre-save middleware for slug generation
postSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('title')) {
    this.seo.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 100) + '-' + this._id.toString().substring(0, 8);
  }
  next();
});

// Pre-save middleware for search keywords
postSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('title') || this.isModified('content')) {
    const keywords = new Set();
    
    // Extract keywords from title and content
    const text = `${this.title} ${this.content}`.toLowerCase();
    const words = text.match(/\b\w{3,}\b/g) || [];
    
    words.forEach(word => {
      if (word.length >= 3 && word.length <= 20) {
        keywords.add(word);
      }
    });
    
    // Add track and subcategory as keywords
    keywords.add(this.track.toLowerCase());
    if (this.subcategory) {
      keywords.add(this.subcategory.toLowerCase());
    }
    
    this.seo.searchKeywords = Array.from(keywords).slice(0, 20);
  }
  next();
});

// Method to increment view count
postSchema.methods.incrementViews = function() {
  this.analytics.views += 1;
  this.analytics.lastActivityAt = new Date();
  return this.save({ validateBeforeSave: false });
};

// Method to add upvote
postSchema.methods.addUpvote = function(userId) {
  if (!this.interactions.upvotedBy.includes(userId)) {
    this.interactions.upvotedBy.push(userId);
    this.analytics.upvotes += 1;
    
    // Remove from downvotes if exists
    const downvoteIndex = this.interactions.downvotedBy.indexOf(userId);
    if (downvoteIndex > -1) {
      this.interactions.downvotedBy.splice(downvoteIndex, 1);
      this.analytics.downvotes -= 1;
    }
    
    this.analytics.lastActivityAt = new Date();
    return this.save({ validateBeforeSave: false });
  }
  return Promise.resolve(this);
};

// Method to add downvote
postSchema.methods.addDownvote = function(userId) {
  if (!this.interactions.downvotedBy.includes(userId)) {
    this.interactions.downvotedBy.push(userId);
    this.analytics.downvotes += 1;
    
    // Remove from upvotes if exists
    const upvoteIndex = this.interactions.upvotedBy.indexOf(userId);
    if (upvoteIndex > -1) {
      this.interactions.upvotedBy.splice(upvoteIndex, 1);
      this.analytics.upvotes -= 1;
    }
    
    this.analytics.lastActivityAt = new Date();
    return this.save({ validateBeforeSave: false });
  }
  return Promise.resolve(this);
};

// Method to report post
postSchema.methods.reportPost = function(userId, reason) {
  const existingReport = this.interactions.reportedBy.find(
    report => report.userId.toString() === userId.toString()
  );
  
  if (!existingReport) {
    this.interactions.reportedBy.push({
      userId,
      reason,
      reportedAt: new Date()
    });
    this.analytics.reports += 1;
    
    // Auto-flag if multiple reports
    if (this.analytics.reports >= 3 && this.status === 'ACTIVE') {
      this.status = 'FLAGGED';
      this.moderation.autoFlagged = true;
      this.moderation.autoFlagReason = 'Multiple user reports';
      this.moderation.flaggedAt = new Date();
    }
    
    return this.save({ validateBeforeSave: false });
  }
  return Promise.resolve(this);
};

// Static method to get trending posts
postSchema.statics.getTrending = function(feedType, track, limit = 20) {
  const match = { status: 'ACTIVE' };
  if (feedType) match.feedType = feedType;
  if (track) match.track = track;
  
  return this.aggregate([
    { $match: match },
    {
      $addFields: {
        trendingScore: {
          $add: [
            { $multiply: ['$analytics.views', 1] },
            { $multiply: ['$analytics.upvotes', 5] },
            { $multiply: ['$analytics.answers', 10] },
            { $multiply: ['$analytics.shares', 3] }
          ]
        },
        recencyBoost: {
          $divide: [
            { $subtract: [new Date(), '$createdAt'] },
            1000 * 60 * 60 * 24 // Convert to days
          ]
        }
      }
    },
    {
      $addFields: {
        finalScore: {
          $divide: ['$trendingScore', { $add: ['$recencyBoost', 1] }]
        }
      }
    },
    { $sort: { finalScore: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'users',
        localField: 'authorId',
        foreignField: '_id',
        as: 'author'
      }
    },
    { $unwind: '$author' }
  ]);
};

// Static method for advanced search
postSchema.statics.searchPosts = function(query, filters = {}) {
  const pipeline = [];
  
  // Text search
  if (query) {
    pipeline.push({
      $match: {
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { content: { $regex: query, $options: 'i' } },
          { 'seo.searchKeywords': { $in: [new RegExp(query, 'i')] } }
        ]
      }
    });
  }
  
  // Apply filters
  const match = { status: 'ACTIVE' };
  if (filters.feedType) match.feedType = filters.feedType;
  if (filters.track) match.track = filters.track;
  if (filters.difficulty) match.difficulty = filters.difficulty;
  if (filters.authorId) match.authorId = mongoose.Types.ObjectId(filters.authorId);
  
  pipeline.push({ $match: match });
  
  // Sort by relevance and recency
  pipeline.push({
    $addFields: {
      relevanceScore: {
        $add: [
          { $cond: [{ $regexMatch: { input: '$title', regex: query, options: 'i' } }, 10, 0] },
          { $multiply: ['$analytics.upvotes', 2] },
          { $multiply: ['$analytics.views', 0.1] }
        ]
      }
    }
  });
  
  pipeline.push({ $sort: { relevanceScore: -1, createdAt: -1 } });
  pipeline.push({ $limit: filters.limit || 50 });
  
  // Populate author
  pipeline.push({
    $lookup: {
      from: 'users',
      localField: 'authorId',
      foreignField: '_id',
      as: 'author'
    }
  });
  pipeline.push({ $unwind: '$author' });
  
  return this.aggregate(pipeline);
};

module.exports = mongoose.model('Post', postSchema);