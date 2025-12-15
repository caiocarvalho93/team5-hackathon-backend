const mongoose = require("mongoose");

const ContributingSignalSchema = new mongoose.Schema(
  {
    signalType: { type: String, required: true },
    weight: { type: Number, required: true },
    value: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false }
);

const StruggleProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },

    track: { type: String, default: "general", index: true },
    cohortId: { type: String, default: "default", index: true },

    // INTERNAL only (do not expose to students by default)
    struggleScore: { type: Number, default: 1, min: 1, max: 10, index: true },

    trend: { type: String, enum: ["UP", "DOWN", "STABLE"], default: "STABLE", index: true },
    supportLevel: { type: String, enum: ["LOW", "MEDIUM", "HIGH"], default: "LOW", index: true },

    lastEvaluatedAt: { type: Date, default: null },

    contributingSignals: { type: [ContributingSignalSchema], default: [] },

    // "safe" explainability strings (no raw emotions)
    lastReasonSummary: { type: String, default: "" },
  },
  { timestamps: true }
);

StruggleProfileSchema.index({ cohortId: 1, supportLevel: 1, struggleScore: -1 });

module.exports = mongoose.model("StruggleProfile", StruggleProfileSchema);
