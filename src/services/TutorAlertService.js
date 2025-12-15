const TutorAlert = require("../models/TutorAlert");
const TutorCareNetwork = require("../models/TutorCareNetwork");
const StruggleProfile = require("../models/StruggleProfile");

/**
 * TutorAlertService
 * - Enforces 24h cooldown
 * - Uses care network
 * - Never spams
 * - Never exposes to students
 */
class TutorAlertService {
  static COOLDOWN_HOURS = 24;

  static async createAlertsIfNeeded(studentId) {
    const profile = await StruggleProfile.findOne({ userId: studentId }).lean();
    if (!profile) return [];

    // Only alert when supportLevel is HIGH and trend is UP (or score >= 9)
    if (profile.supportLevel !== "HIGH" || profile.trend !== "UP") {
      // Also check if score is critical (>= 9)
      if (profile.struggleScore < 9) {
        return [];
      }
    }

    const network = await TutorCareNetwork.findOne({ studentId }).lean();
    if (!network || !network.tutorIds?.length) return [];

    const alerts = [];
    for (const tutorId of network.tutorIds) {
      // Check cooldown
      const since = new Date(Date.now() - this.COOLDOWN_HOURS * 60 * 60 * 1000);
      const recent = await TutorAlert.findOne({
        tutorId,
        studentId,
        createdAt: { $gte: since },
      });

      if (recent) continue; // Skip - already alerted within cooldown

      const alert = await TutorAlert.create({
        tutorId,
        studentId,
        urgency: profile.struggleScore >= 9 ? "URGENT" : "SOFT",
        topic: profile.lastReasonSummary || "current topic",
        struggleScore: profile.struggleScore,
        reasonSummary: "A learner you helped before may benefit from support.",
      });

      alerts.push(alert);
    }

    return alerts;
  }

  /**
   * Get unread alerts for a tutor
   */
  static async getAlertsForTutor(tutorId, limit = 20) {
    return TutorAlert.find({ tutorId, isRead: false })
      .populate('studentId', 'profile.firstName profile.lastName profile.displayName')
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  /**
   * Mark alert as read
   */
  static async markAsRead(alertId, tutorId) {
    return TutorAlert.findOneAndUpdate(
      { _id: alertId, tutorId },
      { isRead: true },
      { new: true }
    );
  }

  /**
   * Get alert count for tutor
   */
  static async getUnreadCount(tutorId) {
    return TutorAlert.countDocuments({ tutorId, isRead: false });
  }
}

module.exports = TutorAlertService;
