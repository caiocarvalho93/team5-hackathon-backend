const mongoose = require("mongoose");

const StruggleSignalSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    interactionId: { type: mongoose.Schema.Types.ObjectId, ref: "AIInteraction", required: true, index: true },

    track: { type: String, default: "general", index: true },
    topic: { type: String, default: "unknown", index: true },

    signalType: {
      type: String,
      required: true,
      enum: [
        "REPEATED_TOPIC",
        "FAILED_ATTEMPT",
        "LONG_RESPONSE_TIME",
        "NEGATIVE_SENTIMENT",
        "ENGAGEMENT_DROP",
        "HINT_DEPENDENCY",
      ],
      index: true,
    },

    // normalized 0..1
    value: { type: Number, required: true, min: 0, max: 1 },

    // optional metadata for explainability (safe)
    meta: {
      windowHours: { type: Number, default: 24 },
      raw: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
  },
  { timestamps: true }
);

// prevent duplicate signals for same interaction & type
StruggleSignalSchema.index({ interactionId: 1, signalType: 1 }, { unique: true });

// common query patterns
StruggleSignalSchema.index({ userId: 1, createdAt: -1 });
StruggleSignalSchema.index({ topic: 1, createdAt: -1 });

module.exports = mongoose.model("StruggleSignal", StruggleSignalSchema);
