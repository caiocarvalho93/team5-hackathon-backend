const express = require('express');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { authenticate, authorize, bookingRateLimit } = require('../middleware/auth');
const { validate, sanitizeInput, createBookingSchema, updateBookingSchema, bookingFeedbackSchema } = require('../middleware/validation');
const { asyncHandler, sendSuccess, sendError } = require('../middleware/errorHandler');
const { z } = require('zod');

const router = express.Router();

// Apply authentication to all booking routes
router.use(authenticate);
router.use(sanitizeInput);

// @route   GET /api/v1/bookings/my
// @desc    Get current user's bookings (student view)
// @access  Private
router.get('/my',
  asyncHandler(async (req, res) => {
    const bookings = await Booking.find({ studentId: req.userId })
      .populate('tutorId', 'profile')
      .sort({ startDateTime: -1 })
      .limit(20);
    
    const formatted = bookings.map(b => ({
      _id: b._id,
      start: b.startDateTime,
      end: b.endDateTime,
      tutorName: b.tutorId?.profile?.firstName + ' ' + b.tutorId?.profile?.lastName,
      status: b.status,
      title: `Session with ${b.tutorId?.profile?.firstName || 'Tutor'}`
    }));
    
    sendSuccess(res, { bookings: formatted }, 'Your bookings retrieved');
  })
);

// @route   GET /api/v1/bookings/tutor/requests
// @desc    Get booking requests for tutor (Alumni view)
// @access  Private (Alumni only)
router.get('/tutor/requests',
  authorize('ALUMNI'),
  asyncHandler(async (req, res) => {
    const bookings = await Booking.find({ 
      tutorId: req.userId,
      status: { $in: ['REQUESTED', 'CONFIRMED'] }
    })
      .populate('studentId', 'profile')
      .sort({ startDateTime: 1 });
    
    const formatted = bookings.map(b => ({
      _id: b._id,
      start: b.startDateTime,
      end: b.endDateTime,
      studentName: b.studentId?.profile?.firstName + ' ' + b.studentId?.profile?.lastName,
      studentId: b.studentId?._id,
      status: b.status,
      topic: b.topic || 'General Session',
      title: `${b.status === 'REQUESTED' ? '⏳ ' : '✅ '}${b.studentId?.profile?.firstName || 'Student'}`
    }));
    
    sendSuccess(res, { bookings: formatted }, 'Tutor booking requests retrieved');
  })
);

// @route   PUT /api/v1/bookings/:bookingId/confirm
// @desc    Confirm a booking request (Alumni only)
// @access  Private (Alumni only)
router.put('/:bookingId/confirm',
  authorize('ALUMNI'),
  asyncHandler(async (req, res) => {
    const { bookingId } = req.params;
    
    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return sendError(res, 'Booking not found', 404, 'BOOKING_NOT_FOUND');
    }
    
    if (!booking.tutorId.equals(req.userId)) {
      return sendError(res, 'Access denied', 403, 'ACCESS_DENIED');
    }
    
    if (booking.status !== 'REQUESTED') {
      return sendError(res, 'Booking is not in requested status', 400, 'INVALID_STATUS');
    }
    
    booking.status = 'CONFIRMED';
    booking.confirmedAt = new Date();
    await booking.save();
    
    // Update the slot status in tutor's calendar
    const User = require('../models/User');
    const tutor = await User.findById(req.userId);
    if (tutor && tutor.calendarSlots) {
      const slotIndex = tutor.calendarSlots.findIndex(s => 
        new Date(s.start).getTime() === new Date(booking.startDateTime).getTime()
      );
      if (slotIndex !== -1) {
        tutor.calendarSlots[slotIndex].status = 'booked';
        await tutor.save();
      }
    }
    
    await booking.populate('studentId', 'profile');
    
    sendSuccess(res, { booking }, 'Booking confirmed successfully');
  })
);

// @route   PUT /api/v1/bookings/:bookingId/reject
// @desc    Reject a booking request (Alumni only)
// @access  Private (Alumni only)
router.put('/:bookingId/reject',
  authorize('ALUMNI'),
  asyncHandler(async (req, res) => {
    const { bookingId } = req.params;
    const { reason } = req.body;
    
    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return sendError(res, 'Booking not found', 404, 'BOOKING_NOT_FOUND');
    }
    
    if (!booking.tutorId.equals(req.userId)) {
      return sendError(res, 'Access denied', 403, 'ACCESS_DENIED');
    }
    
    if (booking.status !== 'REQUESTED') {
      return sendError(res, 'Booking is not in requested status', 400, 'INVALID_STATUS');
    }
    
    booking.status = 'CANCELLED';
    booking.cancellationReason = reason || 'Rejected by tutor';
    await booking.save();
    
    sendSuccess(res, { booking }, 'Booking rejected');
  })
);

// @route   GET /api/v1/bookings
// @desc    Get user's bookings
// @access  Private
router.get('/',
  asyncHandler(async (req, res) => {
    const { status, role, limit = 20, page = 1 } = req.query;
    
    // Build query based on user role
    let query = {};
    
    if (req.user.role === 'STUDENT') {
      query.studentId = req.userId;
    } else if (req.user.role === 'ALUMNI') {
      query.tutorId = req.userId;
    } else if (req.user.role === 'ADMIN') {
      // Admin can see all bookings, optionally filtered by role
      if (role === 'student') {
        query.studentId = { $exists: true };
      } else if (role === 'tutor') {
        query.tutorId = { $exists: true };
      }
    }
    
    if (status) {
      query.status = status;
    }
    
    const skip = (page - 1) * limit;
    
    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .populate('studentId', 'profile role')
        .populate('tutorId', 'profile role verification.track')
        .sort({ startDateTime: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Booking.countDocuments(query)
    ]);
    
    sendSuccess(res, {
      bookings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }, 'Bookings retrieved successfully');
  })
);

// @route   POST /api/v1/bookings
// @desc    Create new booking request
// @access  Private (Students only)
router.post('/',
  authorize('STUDENT'),
  asyncHandler(async (req, res) => {
    const { tutorId, startDateTime, endDateTime, slotId, topic } = req.body;
    
    // Validate tutor exists and is alumni
    const tutor = await User.findById(tutorId);
    if (!tutor || tutor.role !== 'ALUMNI') {
      return sendError(res, 'Invalid tutor', 400, 'INVALID_TUTOR');
    }
    
    // Parse dates
    const sessionStart = new Date(startDateTime);
    const sessionEnd = endDateTime ? new Date(endDateTime) : new Date(sessionStart.getTime() + 60 * 60 * 1000);
    
    // Check for existing booking at this time
    const conflictingBooking = await Booking.findOne({
      tutorId,
      status: { $in: ['CONFIRMED', 'REQUESTED'] },
      startDateTime: { $lt: sessionEnd },
      endDateTime: { $gt: sessionStart }
    });
    
    if (conflictingBooking) {
      return sendError(res, 'This time slot is no longer available', 409, 'TIME_CONFLICT');
    }
    
    // Create booking with tutor's track
    const booking = new Booking({
      studentId: req.userId,
      tutorId,
      startDateTime: sessionStart,
      endDateTime: sessionEnd,
      track: tutor.verification?.track || 'SOFTWARE_ENGINEERING',
      subcategory: topic || 'General Session',
      status: 'REQUESTED'
    });
    
    await booking.save();
    
    // Mark the slot as pending in tutor's calendar
    if (slotId && tutor.calendarSlots) {
      const slotIndex = tutor.calendarSlots.findIndex(s => s._id.toString() === slotId);
      if (slotIndex !== -1) {
        tutor.calendarSlots[slotIndex].status = 'pending';
        tutor.calendarSlots[slotIndex].bookingId = booking._id;
        await tutor.save();
      }
    }
    
    await booking.populate(['studentId', 'tutorId'], 'profile role');
    
    sendSuccess(res, { booking }, 'Booking request sent! The tutor will confirm.', 201);
  })
);

// @route   GET /api/v1/bookings/:bookingId
// @desc    Get booking details
// @access  Private
router.get('/:bookingId',
  asyncHandler(async (req, res) => {
    const { bookingId } = req.params;
    
    const booking = await Booking.findById(bookingId)
      .populate('studentId', 'profile role gamification.level')
      .populate('tutorId', 'profile role verification.track gamification.level');
    
    if (!booking) {
      return sendError(res, 'Booking not found', 404, 'BOOKING_NOT_FOUND');
    }
    
    // Check access permissions
    const hasAccess = booking.studentId._id.equals(req.userId) || 
                     booking.tutorId._id.equals(req.userId) || 
                     req.user.role === 'ADMIN';
    
    if (!hasAccess) {
      return sendError(res, 'Access denied', 403, 'ACCESS_DENIED');
    }
    
    sendSuccess(res, { booking }, 'Booking retrieved successfully');
  })
);

// @route   PUT /api/v1/bookings/:bookingId
// @desc    Update booking (status, details, etc.)
// @access  Private
router.put('/:bookingId',
  validate(updateBookingSchema),
  asyncHandler(async (req, res) => {
    const { bookingId } = req.params;
    
    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return sendError(res, 'Booking not found', 404, 'BOOKING_NOT_FOUND');
    }
    
    // Check permissions for different updates
    const isStudent = booking.studentId.equals(req.userId);
    const isTutor = booking.tutorId.equals(req.userId);
    const isAdmin = req.user.role === 'ADMIN';
    
    if (!isStudent && !isTutor && !isAdmin) {
      return sendError(res, 'Access denied', 403, 'ACCESS_DENIED');
    }
    
    // Handle status changes
    if (req.body.status) {
      const newStatus = req.body.status;
      
      // Students can only cancel their own bookings
      if (isStudent && newStatus === 'CANCELLED' && booking.status === 'REQUESTED') {
        booking.status = newStatus;
      }
      // Tutors can confirm or cancel bookings
      else if (isTutor && ['CONFIRMED', 'CANCELLED'].includes(newStatus)) {
        booking.status = newStatus;
      }
      // Tutors can mark sessions as completed
      else if (isTutor && newStatus === 'COMPLETED' && booking.status === 'CONFIRMED') {
        booking.status = newStatus;
        booking.completedAt = new Date();
        
        // Award XP for completed session
        const student = await User.findById(booking.studentId);
        const tutor = await User.findById(booking.tutorId);
        
        if (student) {
          await student.updateOne({
            $inc: { 'gamification.totalSessions': 1 }
          });
          await student.addXP(20, 'Completed tutoring session');
        }
        
        if (tutor) {
          await tutor.updateOne({
            $inc: { 'gamification.totalSessions': 1 }
          });
          await tutor.addXP(25, 'Conducted tutoring session');
        }
      }
      // Admins can change to any status
      else if (isAdmin) {
        booking.status = newStatus;
        if (newStatus === 'COMPLETED') {
          booking.completedAt = new Date();
        }
      }
      else {
        return sendError(res, 'Invalid status change', 400, 'INVALID_STATUS_CHANGE');
      }
    }
    
    // Update other fields based on permissions
    if (req.body.meetingDetails && isTutor) {
      booking.meetingDetails = { ...booking.meetingDetails, ...req.body.meetingDetails };
    }
    
    if (req.body.sessionSummary && isTutor) {
      booking.sessionSummary = { ...booking.sessionSummary, ...req.body.sessionSummary };
    }
    
    if (req.body.sessionNotes && (isStudent || isTutor)) {
      booking.sessionNotes = { ...booking.sessionNotes, ...req.body.sessionNotes };
    }
    
    booking.updatedAt = new Date();
    await booking.save();
    
    sendSuccess(res, { booking }, 'Booking updated successfully');
  })
);

// @route   POST /api/v1/bookings/:bookingId/feedback
// @desc    Submit feedback for completed session
// @access  Private
router.post('/:bookingId/feedback',
  validate(bookingFeedbackSchema),
  asyncHandler(async (req, res) => {
    const { bookingId } = req.params;
    
    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return sendError(res, 'Booking not found', 404, 'BOOKING_NOT_FOUND');
    }
    
    if (booking.status !== 'COMPLETED') {
      return sendError(res, 'Can only provide feedback for completed sessions', 400, 'SESSION_NOT_COMPLETED');
    }
    
    // Check if user is part of this booking
    const isStudent = booking.studentId.equals(req.userId);
    const isTutor = booking.tutorId.equals(req.userId);
    
    if (!isStudent && !isTutor) {
      return sendError(res, 'Access denied', 403, 'ACCESS_DENIED');
    }
    
    // Determine feedback type and update accordingly
    if (isStudent) {
      if (booking.feedback.studentFeedback) {
        return sendError(res, 'Student feedback already submitted', 400, 'FEEDBACK_EXISTS');
      }
      
      booking.feedback.studentFeedback = {
        ...req.body,
        submittedAt: new Date()
      };
      
      // Award XP to tutor based on rating
      if (req.body.rating >= 4) {
        const tutor = await User.findById(booking.tutorId);
        if (tutor) {
          await tutor.addXP(req.body.rating * 2, 'Positive session feedback');
        }
      }
    } else if (isTutor) {
      if (booking.feedback.tutorFeedback) {
        return sendError(res, 'Tutor feedback already submitted', 400, 'FEEDBACK_EXISTS');
      }
      
      booking.feedback.tutorFeedback = {
        ...req.body,
        submittedAt: new Date()
      };
    }
    
    await booking.save();
    
    sendSuccess(res, { 
      feedback: booking.feedback 
    }, 'Feedback submitted successfully');
  })
);

// @route   GET /api/v1/bookings/availability/:tutorId
// @desc    Get tutor's available time slots
// @access  Private (Students only)
router.get('/availability/:tutorId',
  authorize('STUDENT'),
  asyncHandler(async (req, res) => {
    const { tutorId } = req.params;
    const { date, days = 7 } = req.query;
    
    const tutor = await User.findById(tutorId);
    
    if (!tutor || tutor.role !== 'ALUMNI' || tutor.tutorStatus !== 'APPROVED') {
      return sendError(res, 'Invalid or unapproved tutor', 400, 'INVALID_TUTOR');
    }
    
    const startDate = date ? new Date(date) : new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + parseInt(days));
    
    // Get existing bookings in the date range
    const existingBookings = await Booking.find({
      tutorId,
      status: { $in: ['CONFIRMED', 'REQUESTED'] },
      startDateTime: { $gte: startDate, $lte: endDate }
    }).select('startDateTime endDateTime');
    
    // Generate available slots based on tutor's availability
    const availableSlots = [];
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      
      // Find availability for this day
      const dayAvailability = tutor.availability.filter(slot => slot.dayOfWeek === dayOfWeek);
      
      for (const slot of dayAvailability) {
        const [startHour, startMinute] = slot.startTime.split(':').map(Number);
        const [endHour, endMinute] = slot.endTime.split(':').map(Number);
        
        // Generate hourly slots
        for (let hour = startHour; hour < endHour; hour++) {
          const slotStart = new Date(d);
          slotStart.setHours(hour, startMinute, 0, 0);
          
          const slotEnd = new Date(slotStart);
          slotEnd.setHours(hour + 1, startMinute, 0, 0);
          
          // Skip past slots
          if (slotStart <= new Date()) continue;
          
          // Check for conflicts
          const hasConflict = existingBookings.some(booking => 
            slotStart < booking.endDateTime && slotEnd > booking.startDateTime
          );
          
          if (!hasConflict) {
            availableSlots.push({
              startDateTime: slotStart,
              endDateTime: slotEnd,
              duration: 60 // minutes
            });
          }
        }
      }
    }
    
    sendSuccess(res, { 
      tutor: {
        _id: tutor._id,
        profile: tutor.profile,
        verification: tutor.verification
      },
      availableSlots,
      dateRange: { startDate, endDate }
    }, 'Available slots retrieved successfully');
  })
);

// @route   GET /api/v1/bookings/stats/dashboard
// @desc    Get booking statistics for dashboard
// @access  Private
router.get('/stats/dashboard',
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
    
    let query = {
      createdAt: { $gte: startDate }
    };
    
    // Filter by user role
    if (req.user.role === 'STUDENT') {
      query.studentId = req.userId;
    } else if (req.user.role === 'ALUMNI') {
      query.tutorId = req.userId;
    }
    
    const [totalBookings, completedBookings, cancelledBookings, upcomingBookings] = await Promise.all([
      Booking.countDocuments(query),
      Booking.countDocuments({ ...query, status: 'COMPLETED' }),
      Booking.countDocuments({ ...query, status: 'CANCELLED' }),
      Booking.countDocuments({ 
        ...query, 
        status: { $in: ['REQUESTED', 'CONFIRMED'] },
        startDateTime: { $gte: new Date() }
      })
    ]);
    
    const stats = {
      totalBookings,
      completedBookings,
      cancelledBookings,
      upcomingBookings,
      completionRate: totalBookings > 0 ? (completedBookings / totalBookings * 100).toFixed(1) : 0
    };
    
    sendSuccess(res, { stats }, 'Booking statistics retrieved');
  })
);

module.exports = router;