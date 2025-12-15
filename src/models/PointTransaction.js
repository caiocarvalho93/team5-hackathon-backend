const mongoose = require('mongoose');

const pointTransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'QA_ANSWER',
      'SESSION_COMPLETED',
      'ENDORSEMENT_RECEIVED',
      'POST_CREATED',
      'ANSWER_UPVOTED',
      'BEST_ANSWER',
      'HELPFUL_MARK',
      'STREAK_BONUS',
      'LEVEL_BONUS',
      'REFERRAL_BONUS',
      'COMMUNITY_CONTRIBUTION',
      'MENTOR_EXCELLENCE',
      'PENALTY_DEDUCTION',
      'ADMIN_ADJUSTMENT'
    ]
  },
  points: {
    type: Number,
    required: true
  },
  sourceType: {
    type: String,
    required: true,
    enum: ['POST', 'ANSWER', 'SESSION', 'ENDORSEMENT', 'USER', 'SYSTEM', 'ADMIN']
  },
  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  description: {
    type: String,
    required: true,
    maxlength: 200
  },
  idempotencyKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  metadata: {
    sessionDuration: Number,
    answerQuality: Number,
    streakCount: Number,
    multiplier: { type: Number, default: 1 },
    bonusReason: String,
    adminNotes: String
  },
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED', 'REVERSED'],
    default: 'COMPLETED'
  },
  reversalInfo: {
    reversedAt: Date,
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reversalReason: String,
    reversalTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PointTransaction' }
  },
  batchId: String, // For bulk operations
  processedAt: { type: Date, default: Date.now },
  expiresAt: Date // For temporary point awards
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
pointTransactionSchema.index({ userId: 1, createdAt: -1 });
pointTransactionSchema.index({ action: 1, createdAt: -1 });
pointTransactionSchema.index({ sourceType: 1, sourceId: 1 });
pointTransactionSchema.index({ status: 1 });
pointTransactionSchema.index({ batchId: 1 });

// Virtual for effective points (considering reversals)
pointTransactionSchema.virtual('effectivePoints').get(function() {
  return this.status === 'REVERSED' ? 0 : this.points;
});

// Static method to create transaction with idempotency
pointTransactionSchema.statics.createTransaction = async function(transactionData) {
  try {
    const transaction = new this(transactionData);
    await transaction.save();
    return { success: true, transaction };
  } catch (error) {
    if (error.code === 11000) { // Duplicate key error
      const existing = await this.findOne({ idempotencyKey: transactionData.idempotencyKey });
      return { success: true, transaction: existing, duplicate: true };
    }
    throw error;
  }
};

// Static method to calculate user's total XP
pointTransactionSchema.statics.calculateUserXP = function(userId) {
  return this.aggregate([
    {
      $match: {
        userId: mongoose.Types.ObjectId(userId),
        status: { $in: ['COMPLETED'] }
      }
    },
    {
      $group: {
        _id: null,
        totalXP: { $sum: '$points' },
        transactionCount: { $sum: 1 },
        lastTransaction: { $max: '$createdAt' }
      }
    }
  ]);
};

// Static method to get user's XP breakdown
pointTransactionSchema.statics.getXPBreakdown = function(userId, timeframe = 'all') {
  const now = new Date();
  let matchCondition = {
    userId: mongoose.Types.ObjectId(userId),
    status: 'COMPLETED'
  };
  
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
        _id: '$action',
        totalPoints: { $sum: '$points' },
        count: { $sum: 1 },
        avgPoints: { $avg: '$points' },
        lastEarned: { $max: '$createdAt' }
      }
    },
    { $sort: { totalPoints: -1 } }
  ]);
};

// Static method to get leaderboard data
pointTransactionSchema.statics.getLeaderboard = function(timeframe = 'all', limit = 50) {
  const now = new Date();
  let matchCondition = { status: 'COMPLETED' };
  
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
        _id: '$userId',
        totalXP: { $sum: '$points' },
        transactionCount: { $sum: 1 },
        lastActivity: { $max: '$createdAt' }
      }
    },
    { $sort: { totalXP: -1 } },
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
        totalXP: 1,
        transactionCount: 1,
        lastActivity: 1,
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

// Static method to get XP trends
pointTransactionSchema.statics.getXPTrends = function(userId, days = 30) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  
  return this.aggregate([
    {
      $match: {
        userId: mongoose.Types.ObjectId(userId),
        status: 'COMPLETED',
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        },
        dailyXP: { $sum: '$points' },
        transactionCount: { $sum: 1 }
      }
    },
    {
      $project: {
        date: {
          $dateFromParts: {
            year: '$_id.year',
            month: '$_id.month',
            day: '$_id.day'
          }
        },
        dailyXP: 1,
        transactionCount: 1
      }
    },
    { $sort: { date: 1 } }
  ]);
};

// Static method to reverse transaction
pointTransactionSchema.statics.reverseTransaction = async function(transactionId, reversedBy, reason) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Find original transaction
    const originalTransaction = await this.findById(transactionId).session(session);
    if (!originalTransaction) {
      throw new Error('Transaction not found');
    }
    
    if (originalTransaction.status === 'REVERSED') {
      throw new Error('Transaction already reversed');
    }
    
    // Create reversal transaction
    const reversalTransaction = new this({
      userId: originalTransaction.userId,
      action: 'PENALTY_DEDUCTION',
      points: -originalTransaction.points,
      sourceType: 'SYSTEM',
      sourceId: originalTransaction._id,
      description: `Reversal: ${reason}`,
      idempotencyKey: `reversal_${transactionId}_${Date.now()}`,
      metadata: {
        adminNotes: reason
      }
    });
    
    await reversalTransaction.save({ session });
    
    // Update original transaction
    originalTransaction.status = 'REVERSED';
    originalTransaction.reversalInfo = {
      reversedAt: new Date(),
      reversedBy,
      reversalReason: reason,
      reversalTransactionId: reversalTransaction._id
    };
    
    await originalTransaction.save({ session });
    
    await session.commitTransaction();
    return { success: true, reversalTransaction };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Static method to bulk create transactions
pointTransactionSchema.statics.bulkCreateTransactions = async function(transactions) {
  const batchId = new mongoose.Types.ObjectId().toString();
  const transactionsWithBatch = transactions.map(t => ({
    ...t,
    batchId,
    processedAt: new Date()
  }));
  
  try {
    const result = await this.insertMany(transactionsWithBatch, { ordered: false });
    return { success: true, created: result.length, batchId };
  } catch (error) {
    // Handle partial success in case of duplicate keys
    const created = error.result?.result?.insertedIds ? Object.keys(error.result.result.insertedIds).length : 0;
    return { success: true, created, batchId, errors: error.writeErrors };
  }
};

// Method to generate idempotency key
pointTransactionSchema.statics.generateIdempotencyKey = function(userId, action, sourceId, timestamp = Date.now()) {
  return `${userId}_${action}_${sourceId}_${timestamp}`;
};

// Static method for admin adjustments
pointTransactionSchema.statics.adminAdjustment = async function(userId, points, reason, adminId) {
  const idempotencyKey = this.generateIdempotencyKey(userId, 'ADMIN_ADJUSTMENT', adminId);
  
  return this.createTransaction({
    userId,
    action: 'ADMIN_ADJUSTMENT',
    points,
    sourceType: 'ADMIN',
    sourceId: adminId,
    description: `Admin adjustment: ${reason}`,
    idempotencyKey,
    metadata: {
      adminNotes: reason
    }
  });
};

module.exports = mongoose.model('PointTransaction', pointTransactionSchema);