const express = require('express');
const User = require('../models/User');
const { authenticate, authorize, checkOwnership } = require('../middleware/auth');
const { validate, sanitizeInput, updateProfileSchema, availabilitySchema } = require('../middleware/validation');
const { asyncHandler, sendSuccess, sendError } = require('../middleware/errorHandler');
const { z } = require('zod');

const router = express.Router();

// Apply authentication to all user routes
router.use(authenticate);
router.use(sanitizeInput);

// @route   GET /api/v1/users/profile
// @desc    Get current user profile
// @access  Private
router.get('/profile',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId)
      .select('-password -refreshTokens')
      .populate('verification.reviewedBy', 'profile.firstName profile.lastName');
    
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    sendSuccess(res, { user }, 'Profile retrieved successfully');
  })
);

// @route   PUT /api/v1/users/profile
// @desc    Update user profile
// @access  Private
router.put('/profile',
  validate(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId);
    
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    // Update profile fields
    Object.keys(req.body).forEach(key => {
      if (key === 'socialLinks') {
        user.socialLinks = { ...user.socialLinks, ...req.body.socialLinks };
      } else {
        user.profile[key] = req.body[key];
      }
    });
    
    await user.save();
    
    sendSuccess(res, { 
      user: {
        _id: user._id,
        profile: user.profile,
        socialLinks: user.socialLinks
      }
    }, 'Profile updated successfully');
  })
);

// @route   PUT /api/v1/users/availability
// @desc    Update tutor availability (Alumni only)
// @access  Private (Alumni only)
router.put('/availability',
  authorize('ALUMNI'),
  validate(availabilitySchema),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId);
    
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    user.availability = req.body.availability;
    await user.save();
    
    sendSuccess(res, { 
      availability: user.availability 
    }, 'Availability updated successfully');
  })
);

// @route   GET /api/v1/users/me/availability
// @desc    Get current tutor's calendar availability slots
// @access  Private (Alumni only)
router.get('/me/availability',
  authorize('ALUMNI'),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId);
    
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    sendSuccess(res, { 
      availability: user.calendarSlots || [] 
    }, 'Availability retrieved');
  })
);

// @route   POST /api/v1/users/me/availability
// @desc    Add a new availability slot (Alumni only)
// @access  Private (Alumni only)
router.post('/me/availability',
  authorize('ALUMNI'),
  asyncHandler(async (req, res) => {
    const { start, end, title } = req.body;
    
    const user = await User.findById(req.userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    // Initialize calendarSlots if not exists
    if (!user.calendarSlots) {
      user.calendarSlots = [];
    }
    
    const mongoose = require('mongoose');
    const newSlot = {
      _id: new mongoose.Types.ObjectId(),
      start: new Date(start),
      end: new Date(end),
      title: title || 'Available',
      status: 'available',
      createdAt: new Date()
    };
    
    user.calendarSlots.push(newSlot);
    await user.save();
    
    sendSuccess(res, { slot: newSlot }, 'Availability slot added', 201);
  })
);

// @route   DELETE /api/v1/users/me/availability/:slotId
// @desc    Delete an availability slot (Alumni only)
// @access  Private (Alumni only)
router.delete('/me/availability/:slotId',
  authorize('ALUMNI'),
  asyncHandler(async (req, res) => {
    const { slotId } = req.params;
    
    const user = await User.findById(req.userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    if (!user.calendarSlots) {
      return sendError(res, 'Slot not found', 404, 'SLOT_NOT_FOUND');
    }
    
    const slotIndex = user.calendarSlots.findIndex(s => s._id.toString() === slotId);
    if (slotIndex === -1) {
      return sendError(res, 'Slot not found', 404, 'SLOT_NOT_FOUND');
    }
    
    user.calendarSlots.splice(slotIndex, 1);
    await user.save();
    
    sendSuccess(res, null, 'Availability slot deleted');
  })
);

// @route   GET /api/v1/users/tutors
// @desc    Get list of all approved tutors
// @access  Private
router.get('/tutors',
  asyncHandler(async (req, res) => {
    const tutors = await User.find({
      role: 'ALUMNI',
      tutorStatus: 'APPROVED',
      isActive: true
    }).select('profile verification.track calendarSlots gamification.level');
    
    sendSuccess(res, { tutors }, 'Tutors retrieved');
  })
);

// @route   GET /api/v1/users/tutors/:tutorId/availability
// @desc    Get a specific tutor's availability (for students to view)
// @access  Private
router.get('/tutors/:tutorId/availability',
  asyncHandler(async (req, res) => {
    const { tutorId } = req.params;
    
    const tutor = await User.findById(tutorId);
    if (!tutor || tutor.role !== 'ALUMNI') {
      return sendError(res, 'Tutor not found', 404, 'TUTOR_NOT_FOUND');
    }
    
    // Return only future available slots
    const now = new Date();
    const availableSlots = (tutor.calendarSlots || []).filter(slot => 
      new Date(slot.end) > now && slot.status !== 'booked'
    );
    
    sendSuccess(res, { 
      tutor: {
        _id: tutor._id,
        profile: tutor.profile,
        track: tutor.verification?.track
      },
      availability: availableSlots 
    }, 'Tutor availability retrieved');
  }));

// @route   GET /api/v1/users/leaderboard
// @desc    Get gamification leaderboard
// @access  Private
router.get('/leaderboard',
  asyncHandler(async (req, res) => {
    const { role, timeframe = 'all' } = req.query;
    
    const leaderboard = await User.getLeaderboard(role, timeframe);
    
    sendSuccess(res, { leaderboard }, 'Leaderboard retrieved successfully');
  })
);

// @route   GET /api/v1/users/search
// @desc    Search users by name or skills
// @access  Private
router.get('/search',
  asyncHandler(async (req, res) => {
    const { q, role, track, limit = 20, page = 1 } = req.query;
    
    if (!q || q.length < 2) {
      return sendError(res, 'Search query must be at least 2 characters', 400, 'INVALID_QUERY');
    }
    
    const query = {
      isActive: true,
      $or: [
        { 'profile.firstName': new RegExp(q, 'i') },
        { 'profile.lastName': new RegExp(q, 'i') },
        { 'profile.displayName': new RegExp(q, 'i') }
      ]
    };
    
    if (role) query.role = role;
    if (track) query['verification.track'] = track;
    
    const skip = (page - 1) * limit;
    
    const [users, total] = await Promise.all([
      User.find(query)
        .select('profile role gamification verification.track createdAt')
        .sort({ 'gamification.currentXP': -1 })
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
    }, 'User search completed');
  })
);

// @route   GET /api/v1/users/:userId
// @desc    Get user profile by ID
// @access  Private
router.get('/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    const user = await User.findById(userId)
      .select('profile role gamification verification.track createdAt socialLinks');
    
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    // Return public profile for non-admin users
    if (req.userId !== userId && req.user.role !== 'ADMIN') {
      const publicProfile = {
        _id: user._id,
        profile: {
          firstName: user.profile.firstName,
          lastName: user.profile.lastName,
          displayName: user.profile.displayName,
          avatar: user.profile.avatar,
          bio: user.profile.bio
        },
        role: user.role,
        gamification: {
          level: user.gamification.level,
          badges: user.gamification.badges,
          totalSessions: user.gamification.totalSessions
        },
        track: user.verification?.track,
        socialLinks: user.socialLinks,
        memberSince: user.createdAt
      };
      
      return sendSuccess(res, { user: publicProfile }, 'Public profile retrieved');
    }
    
    sendSuccess(res, { user }, 'User profile retrieved');
  })
);

// @route   POST /api/v1/users/verification/submit
// @desc    Submit Alumni verification
// @access  Private (Alumni only)
router.post('/verification/submit',
  authorize('ALUMNI'),
  validate(z.object({
    track: z.enum(['SOFTWARE_ENGINEERING', 'CYBER_SECURITY', 'IT', 'AI', 'OTHER']),
    subcategory: z.string().max(100).optional(),
    proofType: z.enum(['FILE', 'TEXT']),
    proofData: z.string().min(10).max(1000)
  })),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId);
    
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    if (user.tutorStatus === 'APPROVED') {
      return sendError(res, 'Already approved as tutor', 400, 'ALREADY_APPROVED');
    }
    
    // Update verification data
    user.verification = {
      ...req.body,
      submittedAt: new Date(),
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null
    };
    
    user.tutorStatus = 'PENDING';
    await user.save();
    
    sendSuccess(res, { 
      verification: user.verification,
      tutorStatus: user.tutorStatus
    }, 'Verification submitted successfully');
  })
);

// @route   GET /api/v1/users/tutors/available
// @desc    Get available tutors for booking
// @access  Private (Students only)
router.get('/tutors/available',
  authorize('STUDENT'),
  asyncHandler(async (req, res) => {
    const { track, date } = req.query;
    
    const query = {
      role: 'ALUMNI',
      tutorStatus: 'APPROVED',
      isActive: true
    };
    
    if (track) {
      query['verification.track'] = track;
    }
    
    const tutors = await User.find(query)
      .select('profile verification.track verification.subcategory availability gamification.level socialLinks')
      .sort({ 'gamification.currentXP': -1 });
    
    // Filter by availability if date provided
    let availableTutors = tutors;
    if (date) {
      const requestedDate = new Date(date);
      const dayOfWeek = requestedDate.getDay();
      
      availableTutors = tutors.filter(tutor => 
        tutor.availability.some(slot => slot.dayOfWeek === dayOfWeek)
      );
    }
    
    sendSuccess(res, { 
      tutors: availableTutors,
      total: availableTutors.length
    }, 'Available tutors retrieved');
  })
);

// @route   PUT /api/v1/users/preferences
// @desc    Update user preferences
// @access  Private
router.put('/preferences',
  validate(z.object({
    emailNotifications: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    weeklyDigest: z.boolean().optional(),
    mentorshipReminders: z.boolean().optional()
  })),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId);
    
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    user.preferences = { ...user.preferences, ...req.body };
    await user.save();
    
    sendSuccess(res, { 
      preferences: user.preferences 
    }, 'Preferences updated successfully');
  })
);

// @route   GET /api/v1/users/stats/dashboard
// @desc    Get user dashboard statistics
// @access  Private
router.get('/stats/dashboard',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId);
    
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    
    const stats = {
      profile: {
        level: user.gamification.level,
        currentXP: user.gamification.currentXP,
        badges: user.gamification.badges,
        memberSince: user.createdAt
      },
      activity: {
        totalSessions: user.gamification.totalSessions,
        totalAnswers: user.gamification.totalAnswers,
        totalPosts: user.gamification.totalPosts,
        endorsementsReceived: user.gamification.endorsementsReceived
      }
    };
    
    // Add role-specific stats
    if (user.role === 'ALUMNI') {
      stats.tutoring = {
        status: user.tutorStatus,
        track: user.verification?.track,
        subcategory: user.verification?.subcategory,
        availabilitySlots: user.availability?.length || 0
      };
    }
    
    sendSuccess(res, { stats }, 'Dashboard statistics retrieved');
  })
);

module.exports = router;