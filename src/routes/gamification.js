const express = require('express');
const { z } = require('zod');
const gamificationService = require('../services/gamificationService');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, sanitizeInput } = require('../middleware/validation');
const { asyncHandler, sendSuccess, sendError } = require('../middleware/errorHandler');

const router = express.Router();

// Apply authentication to all gamification routes
router.use(authenticate);
router.use(sanitizeInput);

// Validation schemas
const endorsementSchema = z.object({
  endorseeId: z.string().min(1, 'Endorsee ID is required'),
  message: z.string().max(500, 'Message must be less than 500 characters').optional()
});

const leaderboardSchema = z.object({
  role: z.enum(['STUDENT', 'ALUMNI', 'ADMIN']).optional(),
  timeframe: z.enum(['week', 'month', 'all']).default('all'),
  limit: z.number().min(1).max(100).default(50)
});

// @route   GET /api/v1/gamification/stats
// @desc    Get user's gamification statistics
// @access  Private
router.get('/stats',
  asyncHandler(async (req, res) => {
    const stats = await gamificationService.getUserStats(req.userId);
    
    sendSuccess(res, { stats }, 'Gamification stats retrieved successfully');
  })
);

// @route   GET /api/v1/gamification/leaderboard
// @desc    Get gamification leaderboard
// @access  Private
router.get('/leaderboard',
  validate(leaderboardSchema.partial()),
  asyncHandler(async (req, res) => {
    const { role, timeframe = 'all', limit = 50 } = req.query;
    
    const leaderboard = await gamificationService.getLeaderboard(
      role, 
      timeframe, 
      parseInt(limit)
    );
    
    sendSuccess(res, { 
      leaderboard,
      filters: { role, timeframe, limit: parseInt(limit) }
    }, 'Leaderboard retrieved successfully');
  })
);

// @route   POST /api/v1/gamification/endorse
// @desc    Endorse another alumni
// @access  Private (Alumni only)
router.post('/endorse',
  authorize('ALUMNI'),
  validate(endorsementSchema),
  asyncHandler(async (req, res) => {
    const { endorseeId, message = '' } = req.body;
    
    const result = await gamificationService.createEndorsement(
      req.userId,
      endorseeId,
      message
    );
    
    sendSuccess(res, {
      endorsement: result.endorsement,
      xpAwarded: result.xpAwarded,
      levelUp: result.levelUp,
      newBadges: result.newBadges
    }, 'Endorsement created successfully');
  })
);

// @route   GET /api/v1/gamification/endorsements/:userId
// @desc    Get endorsements for a user
// @access  Private
router.get('/endorsements/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { limit = 10, page = 1 } = req.query;
    
    const Endorsement = require('../models/Endorsement');
    
    const skip = (page - 1) * limit;
    
    const [endorsements, total] = await Promise.all([
      Endorsement.find({ endorseeId: userId })
        .populate('endorserId', 'profile.firstName profile.lastName profile.displayName profile.avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Endorsement.countDocuments({ endorseeId: userId })
    ]);
    
    sendSuccess(res, {
      endorsements,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }, 'Endorsements retrieved successfully');
  })
);

// @route   GET /api/v1/gamification/transactions
// @desc    Get user's XP transaction history
// @access  Private
router.get('/transactions',
  asyncHandler(async (req, res) => {
    const { limit = 20, page = 1, actionType } = req.query;
    
    const PointTransaction = require('../models/PointTransaction');
    
    const query = { userId: req.userId };
    if (actionType) {
      query.actionType = actionType;
    }
    
    const skip = (page - 1) * limit;
    
    const [transactions, total] = await Promise.all([
      PointTransaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select('actionType pointsAwarded previousXP newXP previousLevel newLevel createdAt metadata'),
      PointTransaction.countDocuments(query)
    ]);
    
    sendSuccess(res, {
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }, 'Transaction history retrieved successfully');
  })
);

// @route   GET /api/v1/gamification/badges
// @desc    Get available badges and user's progress
// @access  Private
router.get('/badges',
  asyncHandler(async (req, res) => {
    const User = require('../models/User');
    
    const user = await User.findById(req.userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    const availableBadges = gamificationService.BADGES;
    const userBadges = user.gamification.badges || [];
    
    const badgeProgress = Object.entries(availableBadges).map(([key, badge]) => ({
      key,
      name: badge.name,
      description: badge.description,
      earned: userBadges.includes(badge.name),
      earnedAt: userBadges.includes(badge.name) ? 
        user.gamification.badgeEarnedDates?.[badge.name] : null
    }));
    
    sendSuccess(res, {
      badges: badgeProgress,
      totalEarned: userBadges.length,
      totalAvailable: Object.keys(availableBadges).length
    }, 'Badge information retrieved successfully');
  })
);

// @route   GET /api/v1/gamification/analytics
// @desc    Get gamification analytics (Admin only)
// @access  Private (Admin only)
router.get('/analytics',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { timeframe = 'month' } = req.query;
    
    const analytics = await gamificationService.getAnalytics(timeframe);
    
    sendSuccess(res, { analytics }, 'Gamification analytics retrieved successfully');
  })
);

// @route   POST /api/v1/gamification/award-xp
// @desc    Manually award XP (Admin only)
// @access  Private (Admin only)
router.post('/award-xp',
  authorize('ADMIN'),
  validate(z.object({
    userId: z.string().min(1, 'User ID is required'),
    actionType: z.string().min(1, 'Action type is required'),
    amount: z.number().min(1, 'Amount must be positive'),
    reason: z.string().max(200, 'Reason must be less than 200 characters').optional()
  })),
  asyncHandler(async (req, res) => {
    const { userId, actionType, amount, reason } = req.body;
    
    const result = await gamificationService.awardXP(
      userId,
      actionType,
      amount,
      {
        adminAwarded: true,
        adminId: req.userId,
        reason,
        idempotencyKey: `admin_${req.userId}_${userId}_${Date.now()}`
      }
    );
    
    sendSuccess(res, {
      xpAwarded: result.xpAwarded,
      newXP: result.newXP,
      levelUp: result.levelUp,
      newBadges: result.newBadges
    }, 'XP awarded successfully');
  })
);

// @route   GET /api/v1/gamification/level-info/:level
// @desc    Get information about a specific level
// @access  Private
router.get('/level-info/:level',
  asyncHandler(async (req, res) => {
    const level = parseInt(req.params.level);
    
    if (level < 1 || level > 10) {
      return sendError(res, 'Invalid level', 400, 'INVALID_LEVEL');
    }
    
    const levelThreshold = gamificationService.LEVEL_THRESHOLDS.find(t => t.level === level);
    const nextLevelThreshold = gamificationService.LEVEL_THRESHOLDS.find(t => t.level === level + 1);
    
    const levelInfo = {
      level,
      minXP: levelThreshold.minXP,
      nextLevelXP: nextLevelThreshold?.minXP || null,
      xpRange: nextLevelThreshold ? 
        nextLevelThreshold.minXP - levelThreshold.minXP : null,
      isMaxLevel: !nextLevelThreshold
    };
    
    sendSuccess(res, { levelInfo }, 'Level information retrieved successfully');
  })
);

module.exports = router;