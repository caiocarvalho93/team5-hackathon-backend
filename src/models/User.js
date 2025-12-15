const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: function() { return !this.googleId; },
    minlength: 8
  },
  googleId: {
    type: String,
    sparse: true
  },
  role: {
    type: String,
    enum: ['ADMIN', 'ALUMNI', 'STUDENT'],
    required: true
  },
  profile: {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    displayName: { type: String, trim: true },
    avatar: { type: String, default: '' },
    bio: { type: String, maxlength: 500, default: '' },
    phone: { type: String, trim: true },
    timezone: { type: String, default: 'UTC' }
  },
  tutorStatus: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: function() { return this.role === 'ALUMNI' ? 'PENDING' : undefined; }
  },
  verification: {
    track: { type: String },
    subcategory: { type: String },
    proofType: {
      type: String,
      enum: ['TEXT', 'FILE'],
      required: false
    },
    proofData: { type: String },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING'
    },
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String }
  },
  gamification: {
    currentXP: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    badges: [{ type: String }],
    totalSessions: { type: Number, default: 0 },
    totalAnswers: { type: Number, default: 0 },
    totalPosts: { type: Number, default: 0 },
    endorsementsReceived: { type: Number, default: 0 },
    endorsementsGiven: { type: Number, default: 0 }
  },
  availability: [{
    dayOfWeek: { type: Number, min: 0, max: 6 }, // 0 = Sunday
    startTime: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
    endTime: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
    timezone: { type: String, default: 'UTC' }
  }],
  // Calendar slots for tutor availability (specific date/time slots)
  calendarSlots: [{
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    title: { type: String, default: 'Available' },
    status: { type: String, enum: ['available', 'pending', 'booked'], default: 'available' },
    bookedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }],
  activityControl: {
    lastQAPostAt: { type: Date },
    lastCommunityPostAt: { type: Date },
    lastAlumniPostAt: { type: Date },
    qnaPostsLastHour: { type: Number, default: 0 },
    alumniAnswersLastHour: { type: Number, default: 0 },
    lockUntil: { type: Date },
    warningCount: { type: Number, default: 0 },
    lastWarningAt: { type: Date }
  },
  preferences: {
    emailNotifications: { type: Boolean, default: true },
    pushNotifications: { type: Boolean, default: true },
    weeklyDigest: { type: Boolean, default: true },
    mentorshipReminders: { type: Boolean, default: true }
  },
  socialLinks: {
    linkedin: { type: String, trim: true },
    github: { type: String, trim: true },
    portfolio: { type: String, trim: true },
    twitter: { type: String, trim: true }
  },
  refreshTokens: [{ 
    token: String, 
    createdAt: { type: Date, default: Date.now },
    expiresAt: Date,
    deviceInfo: String
  }],
  lastLoginAt: { type: Date },
  lastActiveAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
  emailVerified: { type: Boolean, default: false },
  twoFactorEnabled: { type: Boolean, default: false }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.profile.firstName} ${this.profile.lastName}`;
});

// Virtual for display name fallback
userSchema.virtual('displayNameOrFull').get(function() {
  return this.profile.displayName || this.fullName;
});

// Virtual for level calculation
userSchema.virtual('calculatedLevel').get(function() {
  const xp = this.gamification.currentXP;
  if (xp < 100) return 1;
  if (xp < 500) return 2;
  if (xp < 1500) return 3;
  if (xp < 3500) return 4;
  if (xp < 7500) return 5;
  return Math.floor(Math.log2(xp / 1000)) + 6;
});

// Pre-save middleware for password hashing (SAFE: prevents double-hash)
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  // If password already looks like a bcryptONLYMYDUMMIESHERE
  if (typeof this.password === 'string' && this.password.startsWith('$2')) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save middleware for display name
userSchema.pre('save', function(next) {
  if (!this.profile.displayName) {
    this.profile.displayName = this.fullName;
  }
  next();
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Method to update last active
userSchema.methods.updateLastActive = function() {
  this.lastActiveAt = new Date();
  return this.save({ validateBeforeSave: false });
};

// Method to add refresh token
userSchema.methods.addRefreshToken = function(token, expiresAt, deviceInfo = '') {
  this.refreshTokens.push({
    token,
    expiresAt,
    deviceInfo,
    createdAt: new Date()
  });
  
  // Keep only last 5 refresh tokens
  if (this.refreshTokens.length > 5) {
    this.refreshTokens = this.refreshTokens.slice(-5);
  }
  
  return this.save({ validateBeforeSave: false });
};

// Method to remove refresh token
userSchema.methods.removeRefreshToken = function(token) {
  this.refreshTokens = this.refreshTokens.filter(rt => rt.token !== token);
  return this.save({ validateBeforeSave: false });
};

// Method to clear all refresh tokens
userSchema.methods.clearRefreshTokens = function() {
  this.refreshTokens = [];
  return this.save({ validateBeforeSave: false });
};

// Method to check if user can post
userSchema.methods.canPost = function(feedType) {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  
  if (this.activityControl.lockUntil && this.activityControl.lockUntil > now) {
    return { canPost: false, reason: 'Account temporarily locked', unlockAt: this.activityControl.lockUntil };
  }
  
  switch (feedType) {
    case 'QNA':
      if (this.activityControl.lastQAPostAt && this.activityControl.lastQAPostAt > oneHourAgo) {
        return { canPost: false, reason: 'Rate limit: 1 Q&A post per hour', nextAllowedAt: new Date(this.activityControl.lastQAPostAt.getTime() + 60 * 60 * 1000) };
      }
      break;
    case 'COMMUNITY':
      if (this.activityControl.lastCommunityPostAt && this.activityControl.lastCommunityPostAt > oneHourAgo) {
        return { canPost: false, reason: 'Rate limit: 1 community post per hour', nextAllowedAt: new Date(this.activityControl.lastCommunityPostAt.getTime() + 60 * 60 * 1000) };
      }
      break;
    case 'ALUMNI_PROFESSIONAL':
      if (this.role !== 'ALUMNI' && this.role !== 'ADMIN') {
        return { canPost: false, reason: 'Only Alumni can post in professional feed' };
      }
      break;
  }
  
  return { canPost: true };
};

// Method to update XP and level
userSchema.methods.addXP = function(points, reason = '') {
  this.gamification.currentXP += points;
  const newLevel = this.calculatedLevel;
  
  if (newLevel > this.gamification.level) {
    this.gamification.level = newLevel;
    // Award level-up badge
    const levelBadge = `Level ${newLevel}`;
    if (!this.gamification.badges.includes(levelBadge)) {
      this.gamification.badges.push(levelBadge);
    }
  }
  
  return this.save({ validateBeforeSave: false });
};

// Static method to find by email or username
userSchema.statics.findByEmailOrUsername = function(identifier) {
  return this.findOne({
    $or: [
      { email: identifier.toLowerCase() },
      { 'profile.displayName': new RegExp(`^${identifier}$`, 'i') }
    ]
  });
};

// Static method to get leaderboard
userSchema.statics.getLeaderboard = function(role = null, timeframe = 'all') {
  const match = { isActive: true };
  if (role) match.role = role;
  
  return this.aggregate([
    { $match: match },
    {
      $project: {
        fullName: { $concat: ['$profile.firstName', ' ', '$profile.lastName'] },
        displayName: '$profile.displayName',
        avatar: '$profile.avatar',
        role: 1,
        currentXP: '$gamification.currentXP',
        level: '$gamification.level',
        totalSessions: '$gamification.totalSessions',
        totalAnswers: '$gamification.totalAnswers',
        badges: '$gamification.badges'
      }
    },
    { $sort: { currentXP: -1 } },
    { $limit: 50 }
  ]);
};

module.exports = mongoose.model('User', userSchema);