const mongoose = require('mongoose');

/**
 * KnowledgePattern Model
 * 
 * This is the GENIUS part - every AI interaction becomes training data.
 * Patterns are clustered, weighted, and ready for future agent fine-tuning.
 * 
 * Think of it as building a "Per Scholas Brain" that learns from every
 * student struggle and every tutor solution.
 */
const knowledgePatternSchema = new mongoose.Schema({
  // Pattern identification
  patternId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  patternType: {
    type: String,
    enum: [
      'ERROR_SOLUTION',      // IDE errors, deployment issues (DIRECT ANSWERS)
      'CONCEPT_EXPLANATION', // Learning concepts (GUIDED HINTS)
      'CODE_PATTERN',        // Common code patterns
      'DEBUGGING_FLOW',      // Step-by-step debugging
      'BEST_PRACTICE',       // Industry best practices
      'COMMON_MISTAKE',      // Frequent student mistakes
      'INTERVIEW_PREP',      // Interview questions/answers
      'PROJECT_SETUP'        // Project configuration (DIRECT ANSWERS)
    ],
    required: true,
    index: true
  },
  
  // Classification
  track: {
    type: String,
    enum: ['SOFTWARE_ENGINEERING', 'CYBER_SECURITY', 'IT', 'AI', 'OTHER'],
    required: true,
    index: true
  },
  subcategories: [{
    type: String,
    trim: true
  }],
  difficulty: {
    type: String,
    enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'],
    required: true
  },
  
  // The actual knowledge
  title: {
    type: String,
    required: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    maxlength: 1000
  },
  
  // Input patterns (what triggers this knowledge)
  triggerPatterns: [{
    pattern: String,        // Regex or keyword pattern
    weight: Number,         // How strongly this pattern matches
    examples: [String]      // Example inputs that match
  }],
  
  // Keywords for semantic search
  keywords: [{
    word: String,
    weight: { type: Number, default: 1.0 },
    synonyms: [String]
  }],
  
  // The solution/explanation
  solution: {
    // For ERROR_SOLUTION and PROJECT_SETUP - direct answers
    directAnswer: String,
    
    // For learning concepts - guided approach
    guidedHints: [String],
    
    // Step-by-step breakdown
    steps: [{
      order: Number,
      instruction: String,
      codeExample: String,
      explanation: String
    }],
    
    // Code examples
    codeExamples: [{
      language: String,
      code: String,
      explanation: String,
      isCorrect: Boolean  // true = solution, false = common mistake
    }],
    
    // Related resources
    resources: [{
      type: { type: String, enum: ['DOC', 'VIDEO', 'ARTICLE', 'TOOL'] },
      title: String,
      url: String
    }]
  },
  
  // Bypass rules - CRITICAL for deployment/IDE help
  responseConfig: {
    bypassHintsOnly: {
      type: Boolean,
      default: false  // true for ERROR_SOLUTION and PROJECT_SETUP
    },
    maxResponseLength: {
      type: Number,
      default: 1200
    },
    includeCodeExamples: {
      type: Boolean,
      default: true
    },
    urgencyLevel: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'MEDIUM'
    }
  },
  
  // Learning from interactions
  learningData: {
    sourceInteractions: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AIInteraction'
    }],
    totalMatches: { type: Number, default: 0 },
    successfulResolutions: { type: Number, default: 0 },
    avgUserRating: { type: Number, default: 0 },
    lastMatchedAt: Date
  },
  
  // Quality metrics
  quality: {
    accuracy: { type: Number, min: 0, max: 100, default: 80 },
    completeness: { type: Number, min: 0, max: 100, default: 80 },
    clarity: { type: Number, min: 0, max: 100, default: 80 },
    upToDate: { type: Boolean, default: true },
    lastVerified: Date,
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  
  // Versioning for continuous improvement
  version: {
    current: { type: Number, default: 1 },
    history: [{
      version: Number,
      changes: String,
      updatedAt: Date,
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }]
  },
  
  // Agent training metadata
  trainingMeta: {
    isTrainingReady: { type: Boolean, default: false },
    trainingWeight: { type: Number, default: 1.0 },
    includedInDataset: { type: Boolean, default: false },
    datasetVersion: String,
    exportedAt: Date,
    
    // For fine-tuning format
    promptTemplate: String,
    completionTemplate: String,
    
    // Clustering for similar patterns
    clusterId: String,
    clusterSimilarity: Number,
    relatedPatterns: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'KnowledgePattern'
    }]
  },
  
  // Status
  status: {
    type: String,
    enum: ['DRAFT', 'ACTIVE', 'DEPRECATED', 'ARCHIVED'],
    default: 'ACTIVE',
    index: true
  },
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for fast pattern matching
knowledgePatternSchema.index({ 'keywords.word': 1, track: 1 });
knowledgePatternSchema.index({ patternType: 1, track: 1, difficulty: 1 });
knowledgePatternSchema.index({ 'triggerPatterns.pattern': 'text', title: 'text', description: 'text' });
knowledgePatternSchema.index({ 'trainingMeta.clusterId': 1 });

// Virtual for resolution rate
knowledgePatternSchema.virtual('resolutionRate').get(function() {
  if (this.learningData.totalMatches === 0) return 0;
  return (this.learningData.successfulResolutions / this.learningData.totalMatches * 100).toFixed(1);
});

// Method to check if pattern matches input
knowledgePatternSchema.methods.matchScore = function(inputText, inputTrack) {
  let score = 0;
  const text = inputText.toLowerCase();
  
  // Track match bonus
  if (this.track === inputTrack) score += 20;
  
  // Keyword matching
  for (const kw of this.keywords) {
    if (text.includes(kw.word.toLowerCase())) {
      score += 10 * kw.weight;
    }
    // Check synonyms
    for (const syn of kw.synonyms || []) {
      if (text.includes(syn.toLowerCase())) {
        score += 5 * kw.weight;
      }
    }
  }
  
  // Trigger pattern matching
  for (const trigger of this.triggerPatterns) {
    try {
      const regex = new RegExp(trigger.pattern, 'i');
      if (regex.test(text)) {
        score += 25 * trigger.weight;
      }
    } catch (e) {
      // Invalid regex, skip
    }
  }
  
  return score;
};

// Method to record a match
knowledgePatternSchema.methods.recordMatch = async function(interactionId, wasSuccessful, userRating) {
  this.learningData.totalMatches += 1;
  if (wasSuccessful) this.learningData.successfulResolutions += 1;
  this.learningData.lastMatchedAt = new Date();
  
  if (!this.learningData.sourceInteractions.includes(interactionId)) {
    this.learningData.sourceInteractions.push(interactionId);
  }
  
  // Update average rating
  if (userRating) {
    const totalRatings = this.learningData.sourceInteractions.length;
    this.learningData.avgUserRating = 
      ((this.learningData.avgUserRating * (totalRatings - 1)) + userRating) / totalRatings;
  }
  
  // Auto-mark as training ready if high quality
  if (this.learningData.totalMatches >= 5 && 
      this.learningData.avgUserRating >= 4 &&
      this.resolutionRate >= 70) {
    this.trainingMeta.isTrainingReady = true;
  }
  
  return this.save();
};

// Static method to find best matching patterns
knowledgePatternSchema.statics.findBestMatches = async function(inputText, track, patternType = null, limit = 5) {
  const query = { status: 'ACTIVE', track };
  if (patternType) query.patternType = patternType;
  
  const patterns = await this.find(query);
  
  // Score and sort
  const scored = patterns.map(p => ({
    pattern: p,
    score: p.matchScore(inputText, track)
  })).filter(s => s.score > 10);
  
  scored.sort((a, b) => b.score - a.score);
  
  return scored.slice(0, limit);
};

// Static method to check if input is deployment/IDE related (bypass hints)
knowledgePatternSchema.statics.shouldBypassHints = async function(inputText) {
  const bypassKeywords = [
    // Deployment
    'deploy', 'deployment', 'heroku', 'vercel', 'netlify', 'aws', 'azure', 'docker',
    'kubernetes', 'ci/cd', 'pipeline', 'build failed', 'build error',
    // IDE/Config
    'vscode', 'visual studio', 'intellij', 'eslint', 'prettier', 'tsconfig',
    'package.json', 'webpack', 'babel', 'npm install', 'yarn', 'node_modules',
    // Errors
    'error:', 'exception', 'stack trace', 'cannot find module', 'module not found',
    'syntax error', 'type error', 'reference error', 'undefined is not',
    'enoent', 'permission denied', 'port already in use', 'cors error',
    // Git
    'git', 'merge conflict', 'push rejected', 'pull request', 'branch',
    // Environment
    '.env', 'environment variable', 'config', 'configuration'
  ];
  
  const text = inputText.toLowerCase();
  return bypassKeywords.some(kw => text.includes(kw));
};

// Static method to export training data
knowledgePatternSchema.statics.exportTrainingData = async function(track = null) {
  const query = { 
    'trainingMeta.isTrainingReady': true,
    status: 'ACTIVE'
  };
  if (track) query.track = track;
  
  const patterns = await this.find(query);
  
  return patterns.map(p => ({
    // OpenAI fine-tuning format
    messages: [
      {
        role: 'system',
        content: p.trainingMeta.promptTemplate || `You are a ${p.track} expert helping students.`
      },
      {
        role: 'user', 
        content: p.triggerPatterns[0]?.examples[0] || p.description
      },
      {
        role: 'assistant',
        content: p.solution.directAnswer || p.solution.guidedHints?.join('\n') || ''
      }
    ],
    metadata: {
      patternId: p.patternId,
      track: p.track,
      difficulty: p.difficulty,
      patternType: p.patternType,
      quality: p.quality,
      resolutionRate: p.resolutionRate
    }
  }));
};

module.exports = mongoose.model('KnowledgePattern', knowledgePatternSchema);
