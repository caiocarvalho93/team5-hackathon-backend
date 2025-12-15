const StruggleSignal = require("../models/StruggleSignal");
const StruggleProfile = require("../models/StruggleProfile");

/**
 * StruggleScoringService
 * - Reads StruggleSignal
 * - Computes score 1–10
 * - Updates/creates StruggleProfile
 * - Tracks trend safely
 */
class StruggleScoringService {
  static WEIGHTS = {
    REPEATED_TOPIC: 0.25,
    FAILED_ATTEMPT: 0.20,
    NEGATIVE_SENTIMENT: 0.15,
    ENGAGEMENT_DROP: 0.15,
    LONG_RESPONSE_TIME: 0.15,
    HINT_DEPENDENCY: 0.10,
  };

  static async recomputeForUser(userId, options = {}) {
    const windowHours = options.windowHours ?? 24;
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const signals = await StruggleSignal.find({
      userId,
      createdAt: { $gte: since },
    }).lean();

    if (!signals.length) {
      return this._upsertProfile(userId, {
        struggleScore: 1,
        trend: "STABLE",
        supportLevel: "LOW",
        contributingSignals: [],
        lastReasonSummary: "",
      });
    }

    // aggregate max value per signalType
    const aggregated = {};
    for (const s of signals) {
      aggregated[s.signalType] = Math.max(aggregated[s.signalType] || 0, s.value);
    }

    let rawScore = 0;
    const contributingSignals = [];

    for (const [type, weight] of Object.entries(this.WEIGHTS)) {
      const value = aggregated[type] || 0;
      rawScore += weight * value;
      if (value > 0) {
        contributingSignals.push({ signalType: type, weight, value });
      }
    }

    // map 0..1 → 1..10
    const struggleScore = Math.min(10, Math.max(1, Math.round((1 + rawScore * 9) * 10) / 10));

    const prevProfile = await StruggleProfile.findOne({ userId }).lean();

    let trend = "STABLE";
    if (prevProfile) {
      if (struggleScore > prevProfile.struggleScore + 0.5) trend = "UP";
      else if (struggleScore < prevProfile.struggleScore - 0.5) trend = "DOWN";
    }

    let supportLevel = "LOW";
    if (struggleScore >= 7) supportLevel = "HIGH";
    else if (struggleScore >= 4) supportLevel = "MEDIUM";

    const reasonSummary = contributingSignals
      .slice(0, 2)
      .map((s) => s.signalType.replace(/_/g, " ").toLowerCase())
      .join(" & ");

    return this._upsertProfile(userId, {
      struggleScore,
      trend,
      supportLevel,
      contributingSignals,
      lastReasonSummary: reasonSummary,
    });
  }

  static async _upsertProfile(userId, data) {
    return StruggleProfile.findOneAndUpdate(
      { userId },
      { ...data, lastEvaluatedAt: new Date() },
      { upsert: true, new: true }
    );
  }

  /**
   * Detect breakthrough: score dropped >= 40% from previous
   */
  static async checkBreakthrough(userId) {
    const profile = await StruggleProfile.findOne({ userId }).lean();
    if (!profile) return null;

    // If trend is DOWN and score dropped significantly
    if (profile.trend === "DOWN" && profile.struggleScore <= 4) {
      return {
        isBreakthrough: true,
        currentScore: profile.struggleScore,
        topic: profile.lastReasonSummary
      };
    }

    return { isBreakthrough: false };
  }
}

module.exports = StruggleScoringService;
