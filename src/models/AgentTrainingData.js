const mongoose = require('mongoose');

/**
 * AgentTrainingData Model
 * 
 * THE CROWN JEWEL - This is where Per Scholas builds their AI future.
 * 
 * Every interaction, every pattern, every breakthrough moment gets
 * processed and stored in a format ready for:
 * 1. Fine-tuning custom GPT models
 * 2. Training specialized agents (Deployment Helper, Code Reviewer, etc.)
 * 3. Building RAG (Retrieval Augmented Generation) systems
 * 4. Creating Per Scholas-specific AI assistants
 * 
 * This is how thousands of student questions become a competitive advantage.
 */
const agentTrainingDataSchema = new mongoose.Schema({
  // Dataset identification
  datasetId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  datasetName: {
    type: String,
    required: true
  },
  datasetVersion: {
    type: String,
    required: true,
    default: '1.0.0'
  },
  
  // Agent type this data trains
  targetAgent: {
    type: String,
    enum: [
      'MAMBA_COACH',           // Student learning assistant
      'TUTOR_INTELLIGENCE',    // Alumni tutor helper
      'DEPLOYMENT_HELPER',     // Direct answers for deployment/config
      'CODE_REVIEWER',         // Code review and best practices
      'INTERVIEW_PREP',        // Mock interview assistant
      'CURRICULUM_ADVISOR',    // Course recommendation
      'DEBUGGING_ASSISTANT',   // Step-by-step debugging
      'GENERAL_ASSISTANT'      // Catch-all
    ],
    required: true,
    index: true
  },
  
  // Training data format
  format: {
    type: String,
    enum: ['OPENAI_FINETUNE', 'ANTHROPIC', 'LLAMA', 'RAG_CHUNKS', 'CONVERSATION'],
    required: true
  },
  
  // The actual training examples
  examples: [{
    exampleId: String,
    
    // For fine-tuning format
    messages: [{
      role: { type: String, enum: ['system', 'user', 'assistant'] },
      content: String
    }],
    
    // For RAG format
    chunk: {
      content: String,
      embedding: [Number],  // Vector embedding for similarity search
      metadata: mongoose.Schema.Types.Mixed
    },
    
    // Quality metrics
    quality: {
      score: { type: Number, min: 0, max: 100 },
      humanVerified: { type: Boolean, default: false },
      verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      verifiedAt: Date
    },
    
    // Source tracking
    source: {
      type: { type: String, enum: ['AI_INTERACTION', 'KNOWLEDGE_PATTERN', 'LEARNING_SESSION', 'MANUAL'] },
      sourceId: mongoose.Schema.Types.ObjectId,
      track: String,
      difficulty: String
    },
    
    // Usage tracking
    usedInTraining: { type: Boolean, default: false },
    trainingRunId: String,
    performance: {
      accuracy: Number,
      relevance: Number
    }
  }],
  
  // Dataset statistics
  stats: {
    totalExamples: { type: Number, default: 0 },
    verifiedExamples: { type: Number, default: 0 },
    avgQualityScore: { type: Number, default: 0 },
    trackDistribution: {
      SOFTWARE_ENGINEERING: { type: Number, default: 0 },
      CYBER_SECURITY: { type: Number, default: 0 },
      IT: { type: Number, default: 0 },
      AI: { type: Number, default: 0 },
      OTHER: { type: Number, default: 0 }
    },
    difficultyDistribution: {
      BEGINNER: { type: Number, default: 0 },
      INTERMEDIATE: { type: Number, default: 0 },
      ADVANCED: { type: Number, default: 0 },
      EXPERT: { type: Number, default: 0 }
    }
  },
  
  // Training configuration
  trainingConfig: {
    baseModel: String,           // e.g., 'gpt-4', 'gpt-3.5-turbo'
    epochs: Number,
    batchSize: Number,
    learningRate: Number,
    systemPrompt: String,        // Default system prompt for this agent
    temperature: Number,
    maxTokens: Number,
    
    // Special behaviors
    behaviors: {
      hintsOnly: { type: Boolean, default: true },      // For Mamba
      directAnswers: { type: Boolean, default: false }, // For Deployment Helper
      codeExamples: { type: Boolean, default: true },
      stepByStep: { type: Boolean, default: true }
    }
  },
  
  // Training runs history
  trainingRuns: [{
    runId: String,
    startedAt: Date,
    completedAt: Date,
    status: { type: String, enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'] },
    examplesUsed: Number,
    metrics: {
      loss: Number,
      accuracy: Number,
      validationLoss: Number
    },
    modelId: String,  // Resulting fine-tuned model ID
    notes: String
  }],
  
  // Export history
  exports: [{
    exportedAt: Date,
    format: String,
    destination: String,  // 'openai', 's3', 'local'
    fileSize: Number,
    examplesExported: Number
  }],
  
  // Status
  status: {
    type: String,
    enum: ['COLLECTING', 'READY', 'TRAINING', 'DEPLOYED', 'ARCHIVED'],
    default: 'COLLECTING'
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

// Indexes
agentTrainingDataSchema.index({ targetAgent: 1, status: 1 });
agentTrainingDataSchema.index({ 'examples.source.track': 1 });

// Virtual for readiness percentage
agentTrainingDataSchema.virtual('readinessPercentage').get(function() {
  if (this.stats.totalExamples === 0) return 0;
  return (this.stats.verifiedExamples / this.stats.totalExamples * 100).toFixed(1);
});

// Method to add example from AI interaction
agentTrainingDataSchema.methods.addFromInteraction = async function(interaction) {
  const example = {
    exampleId: `ex_${interaction._id}`,
    messages: [
      {
        role: 'system',
        content: this.trainingConfig.systemPrompt || 'You are a helpful coding assistant.'
      },
      {
        role: 'user',
        content: interaction.inputText
      },
      {
        role: 'assistant',
        content: interaction.output?.userResponse || ''
      }
    ],
    quality: {
      score: interaction.feedback?.userRating ? interaction.feedback.userRating * 20 : 60,
      humanVerified: false
    },
    source: {
      type: 'AI_INTERACTION',
      sourceId: interaction._id,
      track: interaction.track,
      difficulty: interaction.analytics?.difficultyEstimate
    }
  };
  
  this.examples.push(example);
  this.updateStats();
  
  return this.save();
};

// Method to add example from knowledge pattern
agentTrainingDataSchema.methods.addFromPattern = async function(pattern) {
  const example = {
    exampleId: `ex_${pattern._id}`,
    messages: [
      {
        role: 'system',
        content: this.trainingConfig.systemPrompt || 'You are a helpful coding assistant.'
      },
      {
        role: 'user',
        content: pattern.triggerPatterns[0]?.examples[0] || pattern.description
      },
      {
        role: 'assistant',
        content: pattern.solution.directAnswer || pattern.solution.guidedHints?.join('\n\n') || ''
      }
    ],
    quality: {
      score: pattern.quality.accuracy,
      humanVerified: pattern.quality.lastVerified ? true : false,
      verifiedBy: pattern.quality.verifiedBy,
      verifiedAt: pattern.quality.lastVerified
    },
    source: {
      type: 'KNOWLEDGE_PATTERN',
      sourceId: pattern._id,
      track: pattern.track,
      difficulty: pattern.difficulty
    }
  };
  
  this.examples.push(example);
  this.updateStats();
  
  return this.save();
};

// Update statistics
agentTrainingDataSchema.methods.updateStats = function() {
  this.stats.totalExamples = this.examples.length;
  this.stats.verifiedExamples = this.examples.filter(e => e.quality.humanVerified).length;
  this.stats.avgQualityScore = this.examples.reduce((sum, e) => sum + (e.quality.score || 0), 0) / this.examples.length || 0;
  
  // Reset distributions
  this.stats.trackDistribution = { SOFTWARE_ENGINEERING: 0, CYBER_SECURITY: 0, IT: 0, AI: 0, OTHER: 0 };
  this.stats.difficultyDistribution = { BEGINNER: 0, INTERMEDIATE: 0, ADVANCED: 0, EXPERT: 0 };
  
  for (const example of this.examples) {
    if (example.source.track && this.stats.trackDistribution[example.source.track] !== undefined) {
      this.stats.trackDistribution[example.source.track]++;
    }
    if (example.source.difficulty && this.stats.difficultyDistribution[example.source.difficulty] !== undefined) {
      this.stats.difficultyDistribution[example.source.difficulty]++;
    }
  }
};

// Method to export for OpenAI fine-tuning
agentTrainingDataSchema.methods.exportForOpenAI = function(minQuality = 70) {
  const validExamples = this.examples.filter(e => 
    e.quality.score >= minQuality && 
    e.messages.length >= 2
  );
  
  return validExamples.map(e => ({
    messages: e.messages.map(m => ({
      role: m.role,
      content: m.content
    }))
  }));
};

// Method to export for RAG
agentTrainingDataSchema.methods.exportForRAG = function() {
  return this.examples.map(e => ({
    id: e.exampleId,
    content: e.messages.find(m => m.role === 'assistant')?.content || '',
    metadata: {
      track: e.source.track,
      difficulty: e.source.difficulty,
      quality: e.quality.score,
      question: e.messages.find(m => m.role === 'user')?.content || ''
    }
  }));
};

// Static method to get or create dataset for agent
agentTrainingDataSchema.statics.getOrCreateDataset = async function(targetAgent, name = null) {
  let dataset = await this.findOne({ targetAgent, status: { $ne: 'ARCHIVED' } });
  
  if (!dataset) {
    const configs = {
      MAMBA_COACH: {
        systemPrompt: `You are "Mamba Helper 🐍24", a professional coach inspired by Kobe Bryant's dedication. You help with coding, math, and science. You NEVER provide final answers - only hints, guiding questions, and teach the METHOD. Champions are made through practice!`,
        behaviors: { hintsOnly: true, directAnswers: false, codeExamples: true, stepByStep: true }
      },
      DEPLOYMENT_HELPER: {
        systemPrompt: `You are a deployment and configuration expert. You provide DIRECT, CLEAR answers for IDE errors, deployment issues, environment setup, and configuration problems. Be specific and actionable.`,
        behaviors: { hintsOnly: false, directAnswers: true, codeExamples: true, stepByStep: true }
      },
      TUTOR_INTELLIGENCE: {
        systemPrompt: `You are "PeerTrack+ Tutor Intelligence Console". You help alumni tutors provide better assistance to students. Give accurate, educational help with clear explanations.`,
        behaviors: { hintsOnly: false, directAnswers: true, codeExamples: true, stepByStep: true }
      },
      CODE_REVIEWER: {
        systemPrompt: `You are a senior code reviewer. Analyze code for bugs, best practices, performance issues, and security vulnerabilities. Be constructive and educational.`,
        behaviors: { hintsOnly: false, directAnswers: true, codeExamples: true, stepByStep: false }
      }
    };
    
    const config = configs[targetAgent] || configs.MAMBA_COACH;
    
    dataset = new this({
      datasetId: `dataset_${targetAgent.toLowerCase()}_${Date.now()}`,
      datasetName: name || `${targetAgent} Training Dataset`,
      targetAgent,
      format: 'OPENAI_FINETUNE',
      trainingConfig: {
        baseModel: 'gpt-4-turbo',
        epochs: 3,
        batchSize: 4,
        learningRate: 0.0001,
        temperature: 0.3,
        maxTokens: 1500,
        ...config
      },
      status: 'COLLECTING'
    });
    
    await dataset.save();
  }
  
  return dataset;
};

// Static method to auto-populate from high-quality interactions
agentTrainingDataSchema.statics.autoPopulateFromInteractions = async function(targetAgent, minRating = 4, limit = 100) {
  const AIInteraction = mongoose.model('AIInteraction');
  const dataset = await this.getOrCreateDataset(targetAgent);
  
  // Determine which tool type maps to this agent
  const toolTypeMap = {
    MAMBA_COACH: 'STUDENT_MAMBA_HELP',
    TUTOR_INTELLIGENCE: 'ALUMNI_TUTOR_HELP'
  };
  
  const toolType = toolTypeMap[targetAgent];
  if (!toolType) return dataset;
  
  const interactions = await AIInteraction.find({
    toolType,
    status: 'SUCCESS',
    'feedback.userRating': { $gte: minRating }
  }).limit(limit).sort({ createdAt: -1 });
  
  for (const interaction of interactions) {
    // Check if already added
    const exists = dataset.examples.some(e => 
      e.source.sourceId?.toString() === interaction._id.toString()
    );
    
    if (!exists) {
      await dataset.addFromInteraction(interaction);
    }
  }
  
  return dataset;
};

module.exports = mongoose.model('AgentTrainingData', agentTrainingDataSchema);
