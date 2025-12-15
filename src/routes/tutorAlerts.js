const express = require("express");
const router = express.Router();
const TutorAlert = require("../models/TutorAlert");
const TutorAlertService = require("../services/TutorAlertService");
const TutorCareNetwork = require("../models/TutorCareNetwork");
const { authenticate, authorize } = require("../middleware/auth");
const { asyncHandler, sendSuccess, sendError } = require("../middleware/errorHandler");

// All routes require authentication
router.use(authenticate);

// @route   GET /api/v1/tutor/alerts
// @desc    Get unread alerts for tutor
// @access  Private (ALUMNI)
router.get("/alerts",
  authorize("ALUMNI"),
  asyncHandler(async (req, res) => {
    const alerts = await TutorAlertService.getAlertsForTutor(req.userId, 20);
    const unreadCount = await TutorAlertService.getUnreadCount(req.userId);
    
    // Format alerts with supportive language
    const formattedAlerts = alerts.map(alert => ({
      id: alert._id,
      studentName: alert.studentId?.profile?.displayName || 
                   `${alert.studentId?.profile?.firstName || ''} ${alert.studentId?.profile?.lastName || ''}`.trim() ||
                   'A learner',
      topic: alert.topic,
      urgency: alert.urgency,
      message: alert.reasonSummary,
      createdAt: alert.createdAt,
      isRead: alert.isRead
    }));
    
    sendSuccess(res, { 
      alerts: formattedAlerts, 
      unreadCount 
    }, "Alerts retrieved");
  })
);

// @route   PATCH /api/v1/tutor/alerts/:id/read
// @desc    Mark alert as read
// @access  Private (ALUMNI)
router.patch("/alerts/:id/read",
  authorize("ALUMNI"),
  asyncHandler(async (req, res) => {
    const alert = await TutorAlertService.markAsRead(req.params.id, req.userId);
    
    if (!alert) {
      return sendError(res, "Alert not found", 404, "ALERT_NOT_FOUND");
    }
    
    sendSuccess(res, { success: true }, "Alert marked as read");
  })
);

// @route   GET /api/v1/tutor/care-network
// @desc    Get students in tutor's care network
// @access  Private (ALUMNI)
router.get("/care-network",
  authorize("ALUMNI"),
  asyncHandler(async (req, res) => {
    const networks = await TutorCareNetwork.find({ tutorIds: req.userId })
      .populate('studentId', 'profile.firstName profile.lastName profile.displayName gamification.level');
    
    const students = networks.map(n => ({
      studentId: n.studentId._id,
      name: n.studentId.profile?.displayName || 
            `${n.studentId.profile?.firstName} ${n.studentId.profile?.lastName}`,
      level: n.studentId.gamification?.level || 1,
      lastInteraction: n.lastInteractionAt
    }));
    
    sendSuccess(res, { 
      students,
      totalStudents: students.length 
    }, "Care network retrieved");
  })
);

// @route   GET /api/v1/tutor/stats
// @desc    Get tutor impact stats
// @access  Private (ALUMNI)
router.get("/stats",
  authorize("ALUMNI"),
  asyncHandler(async (req, res) => {
    const networks = await TutorCareNetwork.find({ tutorIds: req.userId });
    const studentsHelped = networks.length;
    
    const alertsResponded = await TutorAlert.countDocuments({ 
      tutorId: req.userId, 
      isRead: true 
    });
    
    sendSuccess(res, {
      stats: {
        studentsHelped,
        alertsResponded,
        impactScore: studentsHelped * 10 + alertsResponded * 5
      }
    }, "Tutor stats retrieved");
  })
);

// @route   POST /api/v1/tutor/link-student/:studentId
// @desc    Link tutor to student's care network (when tutor helps student)
// @access  Private (ALUMNI)
router.post("/link-student/:studentId",
  authorize("ALUMNI"),
  asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    
    await TutorCareNetwork.linkTutorToStudent(studentId, req.userId);
    console.log(`🤝 [CARE NETWORK] Linked tutor ${req.userId} to student ${studentId}`);
    
    sendSuccess(res, { linked: true }, "Student added to your care network");
  })
);

module.exports = router;
