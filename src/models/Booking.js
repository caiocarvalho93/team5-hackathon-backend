const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  tutorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  startDateTime: {
    type: Date,
    required: true,
    index: true
  },
  endDateTime: {
    type: Date,
    required: true
  },
  timezone: {
    type: String,
    required: true,
    default: 'UTC'
  },
  status: {
    type: String,
    enum: ['REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'],
    default: 'REQUESTED',
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
  sessionType: {
    type: String,
    enum: ['ONE_ON_ONE', 'GROUP', 'WORKSHOP', 'CODE_REVIEW', 'MOCK_INTERVIEW'],
    default: 'ONE_ON_ONE'
  },
  meetingDetails: {
    platform: {
      type: String,
      enum: ['GOOGLE_MEET', 'ZOOM', 'TEAMS', 'DISCORD', 'IN_PERSON'],
      default: 'GOOGLE_MEET'
    },
    meetingUrl: String,
    meetingId: String,
    password: String,
    location: String, // For in-person meetings
    dialInNumber: String
  },
  sessionNotes: {
    studentPrep: String, // What student wants to cover
    tutorPrep: String,   // Tutor's preparation notes
    agenda: [String],    // Session agenda items
    materials: [String], // Required materials/links
    objectives: [String] // Learning objectives
  },
  sessionSummary: {
    topicsCovered: [String],
    keyLearnings: [String],
    nextSteps: [String],
    resourcesShared: [String],
    homeworkAssigned: String,
    followUpNeeded: Boolean,
    actualDuration: Number // in minutes
  },
  feedback: {
    studentRating: { type: Number, min: 1, max: 5 },
    studentFeedback: String,
    tutorRating: { type: Number, min: 1, max: 5 },
    tutorFeedback: String,
    sessionQuality: { type: Number, min: 1, max: 5 },
    technicalIssues: Boolean,
    wouldRecommend: Boolean
  },
  payment: {
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    status: {
      type: String,
      enum: ['FREE', 'PAID', 'PENDING', 'REFUNDED'],
      default: 'FREE'
    },
    transactionId: String,
    paidAt: Date
  },
  reminders: {
    studentReminded: { type: Boolean, default: false },
    tutorReminded: { type: Boolean, default: false },
    remindersSent: [Date],
    lastReminderAt: Date
  },
  xpTracking: {
    xpAwarded: { type: Boolean, default: false },
    xpAmount: { type: Number, default: 0 },
    awardedAt: Date,
    bonusXP: { type: Number, default: 0 },
    bonusReason: String
  },
  cancellation: {
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: Date,
    reason: String,
    refundIssued: Boolean,
    cancellationFee: Number
  },
  rescheduling: {
    rescheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rescheduledAt: Date,
    originalStartTime: Date,
    reason: String,
    rescheduledCount: { type: Number, default: 0 }
  },
  attendance: {
    studentJoinedAt: Date,
    tutorJoinedAt: Date,
    studentLeftAt: Date,
    tutorLeftAt: Date,
    actualStartTime: Date,
    actualEndTime: Date
  },
  quality: {
    preparationScore: { type: Number, min: 0, max: 100 },
    engagementScore: { type: Number, min: 0, max: 100 },
    outcomeScore: { type: Number, min: 0, max: 100 },
    overallScore: { type: Number, min: 0, max: 100 }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound unique index to prevent double booking
bookingSchema.index({ tutorId: 1, startDateTime: 1 }, { unique: true });
bookingSchema.index({ studentId: 1, startDateTime: 1 });
bookingSchema.index({ status: 1, startDateTime: 1 });

// Virtual for session duration
bookingSchema.virtual('duration').get(function() {
  return Math.round((this.endDateTime - this.startDateTime) / (1000 * 60)); // in minutes
});

// Virtual for time until session
bookingSchema.virtual('timeUntilSession').get(function() {
  const now = new Date();
  const diff = this.startDateTime - now;
  return Math.round(diff / (1000 * 60)); // in minutes
});

// Virtual for session status description
bookingSchema.virtual('statusDescription').get(function() {
  const statusMap = {
    'REQUESTED': 'Waiting for tutor confirmation',
    'CONFIRMED': 'Session confirmed',
    'COMPLETED': 'Session completed',
    'CANCELLED': 'Session cancelled',
    'NO_SHOW': 'Student did not attend',
    'RESCHEDULED': 'Session rescheduled'
  };
  return statusMap[this.status] || this.status;
});

// Pre-save middleware for end time calculation
bookingSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('startDateTime')) {
    // Default session length is 60 minutes
    if (!this.endDateTime) {
      this.endDateTime = new Date(this.startDateTime.getTime() + 60 * 60 * 1000);
    }
  }
  next();
});

// Method to confirm booking
bookingSchema.methods.confirm = function(meetingDetails = {}) {
  this.status = 'CONFIRMED';
  if (Object.keys(meetingDetails).length > 0) {
    this.meetingDetails = { ...this.meetingDetails, ...meetingDetails };
  }
  return this.save();
};

// Method to complete session
bookingSchema.methods.complete = function(sessionSummary = {}) {
  this.status = 'COMPLETED';
  if (Object.keys(sessionSummary).length > 0) {
    this.sessionSummary = { ...this.sessionSummary, ...sessionSummary };
  }
  
  // Mark for XP awarding if not already done
  if (!this.xpTracking.xpAwarded) {
    this.xpTracking.xpAmount = 100; // Base XP for completed session
    this.xpTracking.xpAwarded = false; // Will be processed by background job
  }
  
  return this.save();
};

// Method to cancel booking
bookingSchema.methods.cancel = function(cancelledBy, reason = '') {
  this.status = 'CANCELLED';
  this.cancellation = {
    cancelledBy,
    cancelledAt: new Date(),
    reason,
    refundIssued: false
  };
  return this.save();
};

// Method to reschedule booking
bookingSchema.methods.reschedule = function(newStartTime, rescheduledBy, reason = '') {
  this.rescheduling = {
    rescheduledBy,
    rescheduledAt: new Date(),
    originalStartTime: this.startDateTime,
    reason,
    rescheduledCount: (this.rescheduling?.rescheduledCount || 0) + 1
  };
  
  this.startDateTime = newStartTime;
  this.endDateTime = new Date(newStartTime.getTime() + this.duration * 60 * 1000);
  this.status = 'RESCHEDULED';
  
  return this.save();
};

// Method to add feedback
bookingSchema.methods.addFeedback = function(feedback, userRole) {
  if (userRole === 'STUDENT') {
    this.feedback.studentRating = feedback.rating;
    this.feedback.studentFeedback = feedback.comment;
    this.feedback.sessionQuality = feedback.sessionQuality;
    this.feedback.technicalIssues = feedback.technicalIssues;
    this.feedback.wouldRecommend = feedback.wouldRecommend;
  } else if (userRole === 'ALUMNI') {
    this.feedback.tutorRating = feedback.rating;
    this.feedback.tutorFeedback = feedback.comment;
  }
  
  return this.save();
};

// Method to check if booking can be cancelled
bookingSchema.methods.canBeCancelled = function() {
  const now = new Date();
  const hoursUntilSession = (this.startDateTime - now) / (1000 * 60 * 60);
  
  return {
    canCancel: hoursUntilSession >= 2 && ['REQUESTED', 'CONFIRMED'].includes(this.status),
    reason: hoursUntilSession < 2 ? 'Cannot cancel within 2 hours of session' : 
            !['REQUESTED', 'CONFIRMED'].includes(this.status) ? 'Session cannot be cancelled in current status' : null
  };
};

// Method to check if booking can be rescheduled
bookingSchema.methods.canBeRescheduled = function() {
  const now = new Date();
  const hoursUntilSession = (this.startDateTime - now) / (1000 * 60 * 60);
  const rescheduleCount = this.rescheduling?.rescheduledCount || 0;
  
  return {
    canReschedule: hoursUntilSession >= 4 && 
                   rescheduleCount < 2 && 
                   ['REQUESTED', 'CONFIRMED'].includes(this.status),
    reason: hoursUntilSession < 4 ? 'Cannot reschedule within 4 hours of session' :
            rescheduleCount >= 2 ? 'Maximum reschedule limit reached' :
            !['REQUESTED', 'CONFIRMED'].includes(this.status) ? 'Session cannot be rescheduled in current status' : null
  };
};

// Static method to check for conflicts
bookingSchema.statics.checkConflict = function(tutorId, startDateTime, endDateTime, excludeId = null) {
  const query = {
    tutorId,
    status: { $in: ['REQUESTED', 'CONFIRMED'] },
    $or: [
      {
        startDateTime: { $lt: endDateTime },
        endDateTime: { $gt: startDateTime }
      }
    ]
  };
  
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  
  return this.findOne(query);
};

// Static method to get user's weekly booking count
bookingSchema.statics.getWeeklyBookingCount = function(studentId, weekStart = null) {
  if (!weekStart) {
    const now = new Date();
    weekStart = new Date(now.setDate(now.getDate() - now.getDay()));
    weekStart.setHours(0, 0, 0, 0);
  }
  
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  
  return this.countDocuments({
    studentId,
    startDateTime: { $gte: weekStart, $lt: weekEnd },
    status: { $in: ['REQUESTED', 'CONFIRMED', 'COMPLETED'] }
  });
};

// Static method to get upcoming sessions
bookingSchema.statics.getUpcomingSessions = function(userId, userRole, limit = 10) {
  const now = new Date();
  const query = {
    startDateTime: { $gte: now },
    status: { $in: ['CONFIRMED', 'REQUESTED'] }
  };
  
  if (userRole === 'STUDENT') {
    query.studentId = userId;
  } else if (userRole === 'ALUMNI') {
    query.tutorId = userId;
  }
  
  return this.find(query)
    .populate('studentId', 'profile.firstName profile.lastName profile.displayName profile.avatar')
    .populate('tutorId', 'profile.firstName profile.lastName profile.displayName profile.avatar gamification.level')
    .sort({ startDateTime: 1 })
    .limit(limit);
};

// Static method to get session analytics
bookingSchema.statics.getSessionAnalytics = function(userId, userRole, timeframe = 'month') {
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
  
  const matchField = userRole === 'STUDENT' ? 'studentId' : 'tutorId';
  
  return this.aggregate([
    {
      $match: {
        [matchField]: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: null,
        totalSessions: { $sum: 1 },
        completedSessions: {
          $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] }
        },
        cancelledSessions: {
          $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] }
        },
        noShowSessions: {
          $sum: { $cond: [{ $eq: ['$status', 'NO_SHOW'] }, 1, 0] }
        },
        avgRating: { $avg: '$feedback.studentRating' },
        totalXPEarned: { $sum: '$xpTracking.xpAmount' }
      }
    }
  ]);
};

module.exports = mongoose.model('Booking', bookingSchema);