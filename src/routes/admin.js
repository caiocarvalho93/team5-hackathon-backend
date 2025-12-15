const express = require('express');
const User = require('../models/User');
const Post = require('../models/Post');
const Answer = require('../models/Answer');
const Booking = require('../models/Booking');
const AIInteraction = require('../models/AIInteraction');
const { authenticate, adminOnly } = require('../middleware/auth');
const { validate, sanitizeInput, adminUserUpdateSchema, verificationReviewSchema } = require('../middleware/validation');
const { asyncHandler, sendSuccess, sendError } = require('../middleware/errorHandler');
const { z } = require('zod');

const router = express.Router();

// Apply authentication and admin check to all routes
router.use(authenticate);
router.use(adminOnly);
router.use(sanitizeInput);

// @route   GET /api/v1/admin/dashboard
// @desc    Get admin dashboard statistics
// @access  Private (Admin only)
router.get('/dashboard',
  asyncHandler(async (req, res) => {
    const { timeframe = 'month' } = req.query;
    
    const startDate = new Date();
    if (timeframe === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (timeframe === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
    } else {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }
    
    const [
      totalUsers,
      newUsers,
      totalPosts,
      newPosts,
      totalBookings,
      newBookings,
      pendingVerifications,
      aiInteractions
    ] = await Promise.all([
      User.countDocuments({ isActive: true }),
      User.countDocuments({ createdAt: { $gte: startDate }, isActive: true }),
      Post.countDocuments(),
      Post.countDocuments({ createdAt: { $gte: startDate } }),
      Booking.countDocuments(),
      Booking.countDocuments({ createdAt: { $gte: startDate } }),
      User.countDocuments({ role: 'ALUMNI', tutorStatus: 'PENDING' }),
      AIInteraction.countDocuments({ createdAt: { $gte: startDate } })
    ]);
    
    // User distribution by role
    const userDistribution = await User.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);
    
    // Track distribution
    const trackDistribution = await User.aggregate([
      { $match: { role: 'ALUMNI', 'verification.track': { $exists: true } } },
      { $group: { _id: '$verification.track', count: { $sum: 1 } } }
    ]);
    
    // Recent activity
    const recentUsers = await User.find({ isActive: true })
      .select('profile role createdAt')
      .sort({ createdAt: -1 })
      .limit(5);
    
    const recentPosts = await Post.find()
      .populate('authorId', 'profile role')
      .select('title feedType track createdAt')
      .sort({ createdAt: -1 })
      .limit(5);
    
    const stats = {
      overview: {
        totalUsers,
        newUsers,
        totalPosts,
        newPosts,
        totalBookings,
        newBookings,
        pendingVerifications,
        aiInteractions
      },
      distribution: {
        users: userDistribution,
        tracks: trackDistribution
      },
      recent: {
        users: recentUsers,
        posts: recentPosts
      }
    };
    
    sendSuccess(res, { stats }, 'Admin dashboard data retrieved');
  })
);

// @route   GET /api/v1/admin/users
// @desc    Get all users with filtering and pagination
// @access  Private (Admin only)
router.get('/users',
  asyncHandler(async (req, res) => {
    const { 
      role, 
      tutorStatus, 
      track, 
      isActive, 
      search,
      limit = 20, 
      page = 1,
      sort = 'recent'
    } = req.query;
    
    // Build query
    const query = {};
    
    if (role) query.role = role;
    if (tutorStatus) query.tutorStatus = tutorStatus;
    if (track) query['verification.track'] = track;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    if (search) {
      query.$or = [
        { 'profile.firstName': new RegExp(search, 'i') },
        { 'profile.lastName': new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') }
      ];
    }
    
    // Build sort options
    let sortOptions = {};
    switch (sort) {
      case 'name':
        sortOptions = { 'profile.firstName': 1, 'profile.lastName': 1 };
        break;
      case 'xp':
        sortOptions = { 'gamification.currentXP': -1 };
        break;
      case 'oldest':
        sortOptions = { createdAt: 1 };
        break;
      default:
        sortOptions = { createdAt: -1 };
    }
    
    const skip = (page - 1) * limit;
    
    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password -refreshTokens')
        .populate('verification.reviewedBy', 'profile.firstName profile.lastName')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(query)
    ]);
    
    sendSuccess(res, {
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }, 'Users retrieved successfully');
  })
);

// @route   GET /api/v1/admin/users/:userId
// @desc    Get detailed user information
// @access  Private (Admin only)
router.get('/users/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    const user = await User.findById(userId)
      .select('-password')
      .populate('verification.reviewedBy', 'profile.firstName profile.lastName');
    
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    // Get user's activity stats
    const [postCount, bookingCount, aiInteractionCount] = await Promise.all([
      Post.countDocuments({ authorId: userId }),
      Booking.countDocuments({
        $or: [{ studentId: userId }, { tutorId: userId }]
      }),
      AIInteraction.countDocuments({ userId })
    ]);
    
    const userDetails = {
      ...user.toObject(),
      activityStats: {
        posts: postCount,
        bookings: bookingCount,
        aiInteractions: aiInteractionCount
      }
    };
    
    sendSuccess(res, { user: userDetails }, 'User details retrieved');
  })
);

// @route   PUT /api/v1/admin/users/:userId
// @desc    Update user (admin actions)
// @access  Private (Admin only)
router.put('/users/:userId',
  validate(adminUserUpdateSchema),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    const user = await User.findById(userId);
    
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    // Update allowed fields
    if (req.body.role !== undefined) {
      user.role = req.body.role;
    }
    
    if (req.body.tutorStatus !== undefined) {
      user.tutorStatus = req.body.tutorStatus;
    }
    
    if (req.body.isActive !== undefined) {
      user.isActive = req.body.isActive;
    }
    
    if (req.body.gamification) {
      user.gamification = { ...user.gamification, ...req.body.gamification };
    }
    
    await user.save();
    
    sendSuccess(res, { 
      user: {
        _id: user._id,
        role: user.role,
        tutorStatus: user.tutorStatus,
        isActive: user.isActive,
        gamification: user.gamification
      }
    }, 'User updated successfully');
  })
);

// @route   GET /api/v1/admin/verifications
// @desc    Get pending Alumni verifications
// @access  Private (Admin only)
router.get('/verifications',
  asyncHandler(async (req, res) => {
    const { status = 'PENDING', limit = 20, page = 1 } = req.query;
    
    const query = {
      role: 'ALUMNI',
      tutorStatus: status
    };
    
    const skip = (page - 1) * limit;
    
    const [verifications, total] = await Promise.all([
      User.find(query)
        .select('profile verification tutorStatus createdAt')
        .populate('verification.reviewedBy', 'profile.firstName profile.lastName')
        .sort({ 'verification.submittedAt': -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(query)
    ]);
    
    sendSuccess(res, {
      verifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }, 'Verifications retrieved successfully');
  })
);

// @route   POST /api/v1/admin/verifications/:userId/review
// @desc    Review Alumni verification
// @access  Private (Admin only)
router.post('/verifications/:userId/review',
  validate(verificationReviewSchema),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { action, rejectionReason } = req.body;
    
    const user = await User.findById(userId);
    
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    if (user.role !== 'ALUMNI') {
      return sendError(res, 'User is not an Alumni', 400, 'INVALID_USER_ROLE');
    }
    
    if (user.tutorStatus !== 'PENDING') {
      return sendError(res, 'Verification is not pending', 400, 'INVALID_STATUS');
    }
    
    // Update verification status
    if (action === 'APPROVE') {
      user.tutorStatus = 'APPROVED';
      user.verification.reviewedAt = new Date();
      user.verification.reviewedBy = req.userId;
      user.verification.rejectionReason = null;
      
      // Award XP for approval
      await user.addXP(50, 'Alumni verification approved');
    } else if (action === 'REJECT') {
      user.tutorStatus = 'REJECTED';
      user.verification.reviewedAt = new Date();
      user.verification.reviewedBy = req.userId;
      user.verification.rejectionReason = rejectionReason;
    }
    
    await user.save();
    
    sendSuccess(res, { 
      user: {
        _id: user._id,
        profile: user.profile,
        tutorStatus: user.tutorStatus,
        verification: user.verification
      }
    }, `Verification ${action.toLowerCase()}d successfully`);
  })
);

// @route   GET /api/v1/admin/posts
// @desc    Get all posts for moderation
// @access  Private (Admin only)
router.get('/posts',
  asyncHandler(async (req, res) => {
    const { 
      feedType, 
      track, 
      flagged,
      limit = 20, 
      page = 1 
    } = req.query;
    
    const query = {};
    
    if (feedType) query.feedType = feedType;
    if (track) query.track = track;
    if (flagged === 'true') query.flagged = true;
    
    const skip = (page - 1) * limit;
    
    const [posts, total] = await Promise.all([
      Post.find(query)
        .populate('authorId', 'profile role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Post.countDocuments(query)
    ]);
    
    sendSuccess(res, {
      posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }, 'Posts retrieved successfully');
  })
);

// @route   DELETE /api/v1/admin/posts/:postId
// @desc    Delete post (admin moderation)
// @access  Private (Admin only)
router.delete('/posts/:postId',
  asyncHandler(async (req, res) => {
    const { postId } = req.params;
    const { reason } = req.body;
    
    const post = await Post.findById(postId);
    
    if (!post) {
      return sendError(res, 'Post not found', 404, 'POST_NOT_FOUND');
    }
    
    // Delete associated answers
    await Answer.deleteMany({ postId });
    
    // Delete the post
    await Post.findByIdAndDelete(postId);
    
    // Log moderation action (in production, store in audit log)
    console.log(`Admin ${req.userId} deleted post ${postId}. Reason: ${reason || 'No reason provided'}`);
    
    sendSuccess(res, null, 'Post deleted successfully');
  })
);

// @route   GET /api/v1/admin/ai-interactions
// @desc    Get AI interaction analytics
// @access  Private (Admin only)
router.get('/ai-interactions',
  asyncHandler(async (req, res) => {
    const { 
      toolType, 
      track, 
      status,
      timeframe = 'month',
      limit = 20, 
      page = 1 
    } = req.query;
    
    const startDate = new Date();
    if (timeframe === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (timeframe === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
    } else {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }
    
    const query = {
      createdAt: { $gte: startDate }
    };
    
    if (toolType) query.toolType = toolType;
    if (track) query.track = track;
    if (status) query.status = status;
    
    const skip = (page - 1) * limit;
    
    const [interactions, total, analytics] = await Promise.all([
      AIInteraction.find(query)
        .populate('userId', 'profile role')
        .select('toolType track status analytics costMeta createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      AIInteraction.countDocuments(query),
      AIInteraction.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalInteractions: { $sum: 1 },
            successfulInteractions: {
              $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] }
            },
            totalCost: { $sum: '$costMeta.estimatedCost' },
            avgProcessingTime: { $avg: '$costMeta.processingTime' }
          }
        }
      ])
    ]);
    
    const summary = analytics[0] || {
      totalInteractions: 0,
      successfulInteractions: 0,
      totalCost: 0,
      avgProcessingTime: 0
    };
    
    sendSuccess(res, {
      interactions,
      summary: {
        ...summary,
        successRate: summary.totalInteractions > 0 
          ? (summary.successfulInteractions / summary.totalInteractions * 100).toFixed(1)
          : 0
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }, 'AI interactions retrieved successfully');
  })
);

// @route   GET /api/v1/admin/system-health
// @desc    Get system health metrics
// @access  Private (Admin only)
router.get('/system-health',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const [
      activeUsers,
      recentLogins,
      recentAIInteractions,
      failedAIInteractions,
      systemErrors
    ] = await Promise.all([
      User.countDocuments({ 
        lastActiveAt: { $gte: oneHourAgo },
        isActive: true 
      }),
      User.countDocuments({ 
        lastLoginAt: { $gte: oneDayAgo } 
      }),
      AIInteraction.countDocuments({ 
        createdAt: { $gte: oneHourAgo } 
      }),
      AIInteraction.countDocuments({ 
        createdAt: { $gte: oneHourAgo },
        status: 'FAILED'
      }),
      // In production, query error logs
      0
    ]);
    
    const health = {
      status: 'healthy', // Would be determined by various metrics
      metrics: {
        activeUsers,
        recentLogins,
        recentAIInteractions,
        failedAIInteractions,
        systemErrors,
        aiSuccessRate: recentAIInteractions > 0 
          ? ((recentAIInteractions - failedAIInteractions) / recentAIInteractions * 100).toFixed(1)
          : 100
      },
      timestamp: now
    };
    
    // Determine overall health status
    if (failedAIInteractions > recentAIInteractions * 0.1) {
      health.status = 'degraded';
    }
    
    if (systemErrors > 10 || failedAIInteractions > recentAIInteractions * 0.3) {
      health.status = 'unhealthy';
    }
    
    sendSuccess(res, { health }, 'System health retrieved');
  })
);

module.exports = router;