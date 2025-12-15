require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const rateLimit = require('express-rate-limit');

// Import configurations and middleware
const { validateEnv } = require('./src/config/env');
const { connectDB, logger } = require('./src/config/database');
const { errorHandler, notFoundHandler } = require('./src/middleware/errorHandler');

// Import routes
const authRoutes = require('./src/routes/auth');
const aiRoutes = require('./src/routes/ai');
const userRoutes = require('./src/routes/users');
const postRoutes = require('./src/routes/posts');
const bookingRoutes = require('./src/routes/bookings');
const adminRoutes = require('./src/routes/admin');
const gamificationRoutes = require('./src/routes/gamification');

// Validate environment variables
const env = validateEnv();

// Create Express app
const app = express();

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration - PERMISSIVE for hackathon demo
app.use(cors({
  origin: true, // Allow all origins for hackathon demo
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key']
}));

// Global rate limiting
const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/api/health';
  }
});

app.use(globalRateLimit);

// Body parsing middleware
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security middleware
app.use(mongoSanitize()); // Prevent NoSQL injection
app.use(xss()); // Clean user input from malicious HTML

// Logging middleware
if (env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim())
    }
  }));
}

// Request ID middleware for tracking
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  res.set('X-Request-ID', req.id);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'PeerTrack+ API is running',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    version: '1.0.0'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'PeerTrack+ API is healthy',
    services: {
      database: 'connected',
      ai: 'available'
    },
    timestamp: new Date().toISOString()
  });
});

// AI Debug route (no auth required)
app.use('/api/v1/ai-debug', require('./src/routes/aiDebug'));

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/auth/google', require('./src/routes/google'));
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/posts', postRoutes);
app.use('/api/v1/bookings', bookingRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/gamification', gamificationRoutes);

// Struggle Detection & Tutor Alert Routes (Hackathon Feature)
app.use('/api/v1/struggle', require('./src/routes/struggle'));
app.use('/api/v1/tutor', require('./src/routes/tutorAlerts'));

// Placeholder routes for endpoints not yet implemented
app.get('/api/v1/endorsements', (req, res) => {
  res.json({ success: true, message: 'Endorsements endpoint - Coming soon' });
});

// API documentation endpoint
app.get('/api/v1', (req, res) => {
  res.json({
    success: true,
    message: 'PeerTrack+ API v1',
    description: 'Intelligence-Driven Mentorship Platform',
    version: '1.0.0',
    endpoints: {
      auth: '/api/v1/auth',
      ai: '/api/v1/ai',
      users: '/api/v1/users',
      posts: '/api/v1/posts',
      bookings: '/api/v1/bookings',
      endorsements: '/api/v1/endorsements (coming soon)',
      admin: '/api/v1/admin'
    },
    documentation: 'https://docs.peertrack-plus.com'
  });
});

// Catch 404 and forward to error handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  server.close(() => {
    logger.info('HTTP server closed');
    
    // Close database connection
    require('mongoose').connection.close(() => {
      logger.info('Database connection closed');
      process.exit(0);
    });
  });
  
  // Force close after 30 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

// Handle process termination
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', err);
  process.exit(1);
});

// Start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDB();
    
    // Seed knowledge patterns for AI (non-blocking)
    const { seedKnowledgePatterns } = require('./src/seed/seedKnowledgePatterns');
    seedKnowledgePatterns().catch(err => logger.error('Knowledge pattern seeding failed:', err));
    
    // Start HTTP server
    const PORT = env.PORT;
    
    // Log env values at startup (ONCE)
    logger.info(`ENV CHECK - PORT: ${PORT}, MONGO: ${env.MONGODB_URI ? 'SET' : 'MISSING'}, OPENAI: ${env.OPENAI_API_KEY ? 'SET' : 'MISSING'}, GOOGLE_ID: ${env.GOOGLE_CLIENT_ID ? 'SET' : 'MISSING'}`);
    
    const server = app.listen(PORT, () => {
      logger.info(`🚀 PeerTrack+ API server running on port ${PORT} in ${env.NODE_ENV} mode`);
      logger.info(`📚 API Documentation: http://localhost:${PORT}/api/v1`);
      logger.info(`🏥 Health Check: http://localhost:${PORT}/health`);
    });
    
    // Store server reference for graceful shutdown
    global.server = server;
    
    return server;
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
if (require.main === module) {
  startServer();
}

module.exports = app;