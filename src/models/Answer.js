const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true,
    index: true
  },
  authorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  content: {
    type: String,
    required: true,
    trim: true,
    minlength: 10,
    maxlength: 3000
  },
  attachments: [{
    filename: String,
    originalName: String,
    mimetype: String,
    size: Number,
    url: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  codeSnippets: [{
    language: String,
    code: String,
    description: String
  }],
  status: {
    type: String,
    enum: ['ACTIVE', 'DELETED', 'FLAGGED', 'HIDDEN'],
    default: 'ACTIVE'
  },
  analytics: {
    upvotes: { type: Number, default: 0 },
    downvotes: { type: Number, default: 0 },
    reports: { type: Number, default: 0 },
    helpfulMarks: { type: Number, default: 0 },
    views: { type: Number, default: 0 }
  },
  interactions: {
    upvotedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    downvotedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    markedHelpfulBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    reportedBy: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reason: String,
      reportedAt: { type: Date, default: Date.now }
    }]
  },
  quality: {
    aiQualityScore: { type: Number, min: 0, max: 100 },
    lengthScore: { type: Number, min: 0, max: 100 },
    helpfulnessScore: { type: Number, min: 0, max: 100 },
    overallScore: { type: Number, min: 0, max: 100 },
    lastScored: Date
  },
  moderation: {
    flaggedAt: Date,
    flaggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    flagReason: String,
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    moderationNotes: String,
    autoFlagged: { type: Boolean, default: false }
  },
  isBestAnswer: { type: Boolean, default: false },
  isAccepted: { type: Boolean, default: false },
  acceptedAt: Date,
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  xpAwarded: { type: Boolean, default: false },
  xpAmount: { type: Number, default: 0 }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
answerSchema.index({ postId: 1, createdAt: -1 });
answerSchema.index({ authorId: 1, createdAt: -1 });
answerSchema.index({ 'analytics.upvotes': -1 });
answerSchema.index({ 'quality.overallScore': -1 });

// Virtual for helpfulness ratio
answerSchema.virtual('helpfulnessRatio').get(function() {
  const total = this.analytics.upvotes + this.analytics.downvotes;
  if (total === 0) return 0;
  return this.analytics.upvotes / total;
});

// Virtual for engagement score
answerSchema.virtual('engagementScore').get(function() {
  return (this.analytics.upvotes * 3) + 
         (this.analytics.helpfulMarks * 5) + 
         (this.isBestAnswer ? 20 : 0) + 
         (this.isAccepted ? 15 : 0) - 
         (this.analytics.downvotes * 2);
});

// Pre-save middleware for quality scoring
answerSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('content')) {
    this.calculateQualityScore();
  }
  next();
});

// Method to calculate quality score
answerSchema.methods.calculateQualityScore = function() {
  const content = this.content;
  
  // Length score (optimal range: 100-1000 characters)
  const length = content.length;
  let lengthScore = 0;
  if (length < 50) lengthScore = length * 2;
  else if (length <= 1000) lengthScore = 100;
  else lengthScore = Math.max(0, 100 - (length - 1000) * 0.1);
  
  // Basic quality indicators
  const hasCodeExample = /```|`/.test(content);
  const hasSteps = /\d+\.|step|first|second|then|next|finally/i.test(content);
  const hasExplanation = content.split(/[.!?]/).length > 3;
  const hasLinks = /https?:\/\//.test(content);
  
  let qualityBonus = 0;
  if (hasCodeExample) qualityBonus += 20;
  if (hasSteps) qualityBonus += 15;
  if (hasExplanation) qualityBonus += 10;
  if (hasLinks) qualityBonus += 5;
  
  // Helpfulness score based on user interactions
  const totalVotes = this.analytics.upvotes + this.analytics.downvotes;
  let helpfulnessScore = 50; // Base score
  
  if (totalVotes > 0) {
    helpfulnessScore = (this.analytics.upvotes / totalVotes) * 100;
  }
  
  helpfulnessScore += this.analytics.helpfulMarks * 10;
  
  // Overall score
  const overallScore = Math.min(100, (lengthScore * 0.3) + (qualityBonus * 0.4) + (helpfulnessScore * 0.3));
  
  this.quality = {
    lengthScore: Math.round(lengthScore),
    aiQualityScore: Math.round(qualityBonus),
    helpfulnessScore: Math.round(helpfulnessScore),
    overallScore: Math.round(overallScore),
    lastScored: new Date()
  };
};

// Method to add upvote
answerSchema.methods.addUpvote = function(userId) {
  if (!this.interactions.upvotedBy.includes(userId)) {
    this.interactions.upvotedBy.push(userId);
    this.analytics.upvotes += 1;
    
    // Remove from downvotes if exists
    const downvoteIndex = this.interactions.downvotedBy.indexOf(userId);
    if (downvoteIndex > -1) {
      this.interactions.downvotedBy.splice(downvoteIndex, 1);
      this.analytics.downvotes -= 1;
    }
    
    this.calculateQualityScore();
    return this.save({ validateBeforeSave: false });
  }
  return Promise.resolve(this);
};

// Method to add downvote
answerSchema.methods.addDownvote = function(userId) {
  if (!this.interactions.downvotedBy.includes(userId)) {
    this.interactions.downvotedBy.push(userId);
    this.analytics.downvotes += 1;
    
    // Remove from upvotes if exists
    const upvoteIndex = this.interactions.upvotedBy.indexOf(userId);
    if (upvoteIndex > -1) {
      this.interactions.upvotedBy.splice(upvoteIndex, 1);
      this.analytics.upvotes -= 1;
    }
    
    this.calculateQualityScore();
    return this.save({ validateBeforeSave: false });
  }
  return Promise.resolve(this);
};

// Method to mark as helpful
answerSchema.methods.markHelpful = function(userId) {
  if (!this.interactions.markedHelpfulBy.includes(userId)) {
    this.interactions.markedHelpfulBy.push(userId);
    this.analytics.helpfulMarks += 1;
    this.calculateQualityScore();
    return this.save({ validateBeforeSave: false });
  }
  return Promise.resolve(this);
};

// Method to accept answer
answerSchema.methods.acceptAnswer = function(acceptedBy) {
  this.isAccepted = true;
  this.acceptedAt = new Date();
  this.acceptedBy = acceptedBy;
  return this.save({ validateBeforeSave: false });
};

// Method to mark as best answer
answerSchema.methods.markAsBest = function() {
  this.isBestAnswer = true;
  return this.save({ validateBeforeSave: false });
};

// Static method to get top answers for a post
answerSchema.statics.getTopAnswers = function(postId, limit = 10) {
  return this.find({ postId, status: 'ACTIVE' })
    .populate('authorId', 'profile.firstName profile.lastName profile.displayName profile.avatar gamification.level role')
    .sort({ 
      isBestAnswer: -1, 
      isAccepted: -1, 
      'quality.overallScore': -1, 
      'analytics.upvotes': -1,
      createdAt: 1 
    })
    .limit(limit);
};

// Static method to get user's best answers
answerSchema.statics.getUserBestAnswers = function(userId, limit = 20) {
  return this.find({ 
    authorId: userId, 
    status: 'ACTIVE',
    $or: [
      { isBestAnswer: true },
      { isAccepted: true },
      { 'analytics.upvotes': { $gte: 5 } }
    ]
  })
    .populate('postId', 'title track feedType')
    .sort({ 'quality.overallScore': -1, 'analytics.upvotes': -1 })
    .limit(limit);
};

module.exports = mongoose.model('Answer', answerSchema);