const StruggleSignal = require("../models/StruggleSignal");
const AIInteraction = require("../models/AIInteraction");

/**
 * StruggleSignalService
 * - Extracts normalized struggle signals (0..1) from AIInteraction events.
 * - Designed for hackathon MVP: simple, explainable heuristics.
 *
 * IMPORTANT ETHICS:
 * - Do NOT store raw emotion labels permanently.
 * - Only store aggregate sentiment score as a normalized signal.
 */
class StruggleSignalService {
  /**
   * Main entry: call this after saving an AIInteraction.
   * @param {Object} interaction - AIInteraction doc
   * @param {Object} options
   * @returns {Promise<{created:number, skipped:number, signals:Array}>}
   */
  static async extractSignalsFromInteraction(interaction, options = {}) {
    const windowHours = options.windowHours ?? 24;

    // Only student mamba interactions should drive struggle detection
    if (interaction.role && interaction.role !== "STUDENT") {
      return { created: 0, skipped: 0, signals: [] };
    }

    const userId = interaction.userId;
    const interactionId = interaction._id;

    const track = interaction.track || "general";
    const topic = interaction?.analytics?.topicOneLine || "unknown";

    // Get recent interactions for the same user (last 24h)
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const recent = await AIInteraction.find({
      userId,
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    // Compute signals
    const signalPayloads = [];

    // 1) FAILED_ATTEMPT
    if (interaction.status === "FAILED") {
      signalPayloads.push(
        this._signal(interaction, {
          track,
          topic,
          signalType: "FAILED_ATTEMPT",
          value: 1,
          windowHours,
          meta: { raw: { status: interaction.status } },
        })
      );
    }

    // 2) REPEATED_TOPIC
    const sameTopicCount = recent.filter((x) => (x?.analytics?.topicOneLine || "unknown") === topic).length;
    const repeatedTopicValue = this._normalizeLinear(sameTopicCount, 1, 5);
    if (sameTopicCount >= 3) {
      signalPayloads.push(
        this._signal(interaction, {
          track,
          topic,
          signalType: "REPEATED_TOPIC",
          value: repeatedTopicValue,
          windowHours,
          meta: { raw: { sameTopicCount } },
        })
      );
    }

    // 3) LONG_RESPONSE_TIME
    const latencyMs = interaction?.costMeta?.processingTime;
    if (typeof latencyMs === "number") {
      const latencies = recent
        .map((x) => x?.costMeta?.processingTime)
        .filter((n) => typeof n === "number")
        .slice(0, 30)
        .sort((a, b) => a - b);

      const baseline = latencies.length ? latencies[Math.floor(latencies.length / 2)] : 4000;
      const ratio = baseline > 0 ? latencyMs / baseline : 1;
      const longRespValue = this._normalizeLinear(ratio, 1.1, 2.5);

      if (ratio >= 1.5) {
        signalPayloads.push(
          this._signal(interaction, {
            track,
            topic,
            signalType: "LONG_RESPONSE_TIME",
            value: longRespValue,
            windowHours,
            meta: { raw: { latencyMs, baselineMs: baseline, ratio } },
          })
        );
      }
    }

    // 4) NEGATIVE_SENTIMENT
    const inputText = interaction.inputText || "";
    const sentimentScore = this._sentimentLexiconScore(inputText);
    const negativeSentimentValue = this._clamp01((-sentimentScore + 0.1) / 1.1);
    if (negativeSentimentValue >= 0.45) {
      signalPayloads.push(
        this._signal(interaction, {
          track,
          topic,
          signalType: "NEGATIVE_SENTIMENT",
          value: negativeSentimentValue,
          windowHours,
          meta: { raw: { sentimentScore } },
        })
      );
    }

    // 5) HINT_DEPENDENCY
    const hintMarkers = ["hint", "clue", "nudge", "dont give answer", "no answer", "just help", "guide me"];
    const isHintRequest = hintMarkers.some((m) => inputText.toLowerCase().includes(m));
    if (isHintRequest) {
      const hintCount = recent.filter((x) => {
        const t = (x.inputText || "").toLowerCase();
        return hintMarkers.some((m) => t.includes(m));
      }).length;
      const hintDepValue = this._normalizeLinear(hintCount, 1, 8);

      signalPayloads.push(
        this._signal(interaction, {
          track,
          topic,
          signalType: "HINT_DEPENDENCY",
          value: hintDepValue,
          windowHours,
          meta: { raw: { hintCount } },
        })
      );
    }

    // 6) ENGAGEMENT_DROP
    const engagementDrop = this._computeEngagementDrop(recent);
    if (engagementDrop !== null && engagementDrop >= 0.6) {
      signalPayloads.push(
        this._signal(interaction, {
          track,
          topic,
          signalType: "ENGAGEMENT_DROP",
          value: engagementDrop,
          windowHours,
          meta: { raw: { method: "6h-vs-prev-6h" } },
        })
      );
    }

    // Write signals (idempotent via unique index)
    let created = 0;
    let skipped = 0;
    const results = [];

    for (const payload of signalPayloads) {
      try {
        const doc = await StruggleSignal.create(payload);
        created++;
        results.push(doc);
      } catch (err) {
        if (err && err.code === 11000) {
          skipped++;
          continue;
        }
        throw err;
      }
    }

    return { created, skipped, signals: results };
  }

  // -------------------------
  // Helpers
  // -------------------------

  static _signal(interaction, { track, topic, signalType, value, windowHours, meta }) {
    return {
      userId: interaction.userId,
      interactionId: interaction._id,
      track: track || "general",
      topic: topic || "unknown",
      signalType,
      value: this._clamp01(value),
      meta: {
        windowHours: windowHours ?? 24,
        raw: meta?.raw || {},
      },
    };
  }

  static _clamp01(n) {
    if (Number.isNaN(n) || n === null || n === undefined) return 0;
    return Math.max(0, Math.min(1, n));
  }

  static _normalizeLinear(x, min, max) {
    if (max <= min) return 0;
    if (x <= min) return 0;
    if (x >= max) return 1;
    return (x - min) / (max - min);
  }

  static _sentimentLexiconScore(text) {
    const t = (text || "").toLowerCase();

    const negative = [
      "stuck", "confused", "frustrated", "annoying", "hate", "cant", "can't",
      "won't", "doesnt make sense", "doesn't make sense", "im lost", "i'm lost",
      "give up", "hard", "im done", "i'm done", "this sucks",
    ];

    const positive = [
      "got it", "thanks", "thank you", "understand", "makes sense", "nice",
      "awesome", "great", "cool", "worked", "solved", "lets go", "let's go",
    ];

    let score = 0;
    for (const w of negative) if (t.includes(w)) score -= 1;
    for (const w of positive) if (t.includes(w)) score += 1;

    if (score <= -3) return -1;
    if (score >= 3) return 1;
    return score / 3;
  }

  static _computeEngagementDrop(recent) {
    if (!recent || recent.length < 10) return null;

    const now = Date.now();
    const h6 = 6 * 60 * 60 * 1000;

    const last6h = recent.filter((x) => now - new Date(x.createdAt).getTime() <= h6).length;
    const prev6h = recent.filter((x) => {
      const dt = now - new Date(x.createdAt).getTime();
      return dt > h6 && dt <= 2 * h6;
    }).length;

    if (prev6h < 3) return null;

    const ratio = last6h / prev6h;
    return this._normalizeLinear(1 - ratio, 0.1, 0.8);
  }
}

module.exports = StruggleSignalService;
