const express = require("express");
const router = express.Router();
const StruggleProfile = require("../models/StruggleProfile");
const StruggleSignal = require("../models/StruggleSignal");
const { authenticate, authorize } = require("../middleware/auth");
const { asyncHandler, sendSuccess, sendError } = require("../middleware/errorHandler");

// All routes require authentication
router.use(authenticate);

// @route   GET /api/v1/struggle/profile/:studentId
// @desc    Get struggle profile for a student (tutor/admin only)
// @access  Private (ALUMNI, ADMIN)
router.get("/profile/:studentId",
  authorize("ALUMNI", "ADMIN"),
  asyncHandler(async (req, res) => {
    const profile = await StruggleProfile.findOne({ userId: req.params.studentId });
    
    if (!profile) {
      return sendSuccess(res, { profile: null }, "No struggle profile found");
    }
    
    sendSuccess(res, { profile }, "Struggle profile retrieved");
  })
);

// @route   GET /api/v1/struggle/cohort/:cohortId/heatmap
// @desc    Get cohort heatmap (admin only)
// @access  Private (ADMIN)
router.get("/cohort/:cohortId/heatmap",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const data = await StruggleProfile.aggregate([
      { $match: { cohortId: req.params.cohortId, supportLevel: "HIGH" } },
      { $group: { _id: "$lastReasonSummary", count: { $sum: 1 }, avgScore: { $avg: "$struggleScore" } } },
      { $sort: { count: -1 } }
    ]);
    
    sendSuccess(res, { heatmap: data, cohortId: req.params.cohortId }, "Cohort heatmap retrieved");
  })
);

// @route   GET /api/v1/struggle/tutor-queue
// @desc    Get students needing support (for tutors)
// @access  Private (ALUMNI)
router.get("/tutor-queue",
  authorize("ALUMNI"),
  asyncHandler(async (req, res) => {
    const TutorCareNetwork = require("../models/TutorCareNetwork");
    
    // Find students this tutor has helped
    const networks = await TutorCareNetwork.find({ tutorIds: req.userId });
    const studentIds = networks.map(n => n.studentId);
    
    // Get profiles for those students who need support
    const profiles = await StruggleProfile.find({
      userId: { $in: studentIds },
      supportLevel: { $in: ["MEDIUM", "HIGH"] }
    })
    .populate('userId', 'profile.firstName profile.lastName profile.displayName')
    .sort({ struggleScore: -1 })
    .limit(20);
    
    // Format for frontend (no shame language)
    const queue = profiles.map(p => ({
      studentId: p.userId._id,
      studentName: p.userId.profile?.displayName || `${p.userId.profile?.firstName} ${p.userId.profile?.lastName}`,
      topic: p.lastReasonSummary || "General support",
      trend: p.trend,
      trendArrow: p.trend === "UP" ? "↑" : p.trend === "DOWN" ? "↓" : "→",
      supportLevel: p.supportLevel,
      helpedBefore: true,
      updatedAt: p.lastEvaluatedAt
    }));
    
    sendSuccess(res, { queue }, "Support queue retrieved");
  })
);

// @route   GET /api/v1/struggle/admin/overview
// @desc    Get admin overview of all struggles
// @access  Private (ADMIN)
router.get("/admin/overview",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const [totalProfiles, highSupport, mediumSupport, trendingUp] = await Promise.all([
      StruggleProfile.countDocuments(),
      StruggleProfile.countDocuments({ supportLevel: "HIGH" }),
      StruggleProfile.countDocuments({ supportLevel: "MEDIUM" }),
      StruggleProfile.countDocuments({ trend: "UP" })
    ]);
    
    // Top struggling topics
    const topTopics = await StruggleSignal.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: "$topic", count: { $sum: 1 }, avgValue: { $avg: "$value" } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    sendSuccess(res, {
      overview: {
        totalProfiles,
        highSupport,
        mediumSupport,
        trendingUp,
        topTopics
      }
    }, "Admin overview retrieved");
  })
);

module.exports = router;
