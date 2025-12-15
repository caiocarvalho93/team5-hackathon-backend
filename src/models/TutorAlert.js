const mongoose = require("mongoose");

const TutorAlertSchema = new mongoose.Schema(
  {
    tutorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    urgency: { type: String, enum: ["SOFT", "URGENT"], default: "SOFT", index: true },

    topic: { type: String, default: "unknown", index: true },

    // INTERNAL score can be shown to tutors/admins
    struggleScore: { type: Number, min: 1, max: 10, required: true },

    // short, supportive explanation for tutors
    reasonSummary: { type: String, required: true },

    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// cooldown helper index
TutorAlertSchema.index({ tutorId: 1, studentId: 1, createdAt: -1 });

module.exports = mongoose.model("TutorAlert", TutorAlertSchema);
