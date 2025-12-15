const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { logger } = require('../config/database');

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Access token is required'
        }
      });
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'peertrack-plus',
      audience: 'peertrack-users'
    });
    
    // Get user from database
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }
    
    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'ACCOUNT_DEACTIVATED',
          message: 'Account is deactivated'
        }
      });
    }
    
    // Update last active time
    await user.updateLastActive();
    
    // Attach user to request
    req.user = user;
    req.userId = user._id;
    
    next();
  } catch (error) {
    logger.error('Authentication failed:', error);
    
    if (error.name === 'JsonWebTokenError') {
      // Log first 20 chars of token for debugging (never full token)
      const authHeader = req.headers.authorization;
      const tokenPreview = authHeader ? authHeader.substring(7, 27) + '...' : 'NO_TOKEN';
      logger.error(`JWT malformed - token preview: ${tokenPreview}`);
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid access token'
        }
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Access token has expired',
          details: {
            expiredAt: error.expiredAt
          }
        }
      });
    }
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed'
      }
    });
  }
};

// Role-based authorization middleware
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Authentication required'
        }
      });
    }
    
    // Admin can access everything
    if (req.user.role === 'ADMIN') {
      return next();
    }
    
    // Check if user's role is in allowed roles
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'Insufficient permissions for this action',
          details: {
            required: allowedRoles,
            current: req.user.role
          }
        }
      });
    }
    
    next();
  };
};

// Alumni approval status check
const requireApprovedTutor = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'NOT_AUTHENTICATED',
        message: 'Authentication required'
      }
    });
  }
  
  // Admin can bypass approval requirement
  if (req.user.role === 'ADMIN') {
    return next();
  }
  
  // Check if user is Alumni
  if (req.user.role !== 'ALUMNI') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'ALUMNI_REQUIRED',
        message: 'Only Alumni can perform this action'
      }
    });
  }
  
  // Check if Alumni is approved
  if (req.user.tutorStatus !== 'APPROVED') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'APPROVAL_REQUIRED',
        message: 'Tutor approval required for this action',
        details: {
          currentStatus: req.user.tutorStatus,
          message: req.user.tutorStatus === 'PENDING' 
            ? 'Your tutor application is pending review'
            : 'Your tutor application was not approved'
        }
      }
    });
  }
  
  next();
};

// Optional authentication (for public endpoints that benefit from user context)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // Continue without authentication
    }
    
    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: 'peertrack-plus',
        audience: 'peertrack-users'
      });
      
      const user = await User.findById(decoded.userId);
      if (user && user.isActive) {
        req.user = user;
        req.userId = user._id;
        await user.updateLastActive();
      }
    } catch (tokenError) {
      // Ignore token errors for optional auth
      logger.debug('Optional auth token invalid:', tokenError.message);
    }
    
    next();
  } catch (error) {
    logger.error('Optional auth error:', error);
    next(); // Continue even if optional auth fails
  }
};

// Rate limiting middleware (basic implementation)
const createRateLimit = (windowMs, maxRequests, message) => {
  const requests = new Map();
  
  return (req, res, next) => {
    const key = req.userId || req.ip;
    const now = Date.now();
    
    // Clean old entries
    for (const [k, v] of requests.entries()) {
      if (now - v.resetTime > windowMs) {
        requests.delete(k);
      }
    }
    
    // Get or create user entry
    if (!requests.has(key)) {
      requests.set(key, { count: 0, resetTime: now });
    }
    
    const userRequests = requests.get(key);
    
    // Reset if window expired
    if (now - userRequests.resetTime > windowMs) {
      userRequests.count = 0;
      userRequests.resetTime = now;
    }
    
    // Check limit
    if (userRequests.count >= maxRequests) {
      const resetIn = Math.ceil((windowMs - (now - userRequests.resetTime)) / 1000);
      
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: message || 'Too many requests',
          details: {
            limit: maxRequests,
            windowMs,
            retryAfter: resetIn
          }
        }
      });
    }
    
    // Increment counter
    userRequests.count++;
    
    // Add headers
    res.set({
      'X-RateLimit-Limit': maxRequests,
      'X-RateLimit-Remaining': Math.max(0, maxRequests - userRequests.count),
      'X-RateLimit-Reset': new Date(userRequests.resetTime + windowMs).toISOString()
    });
    
    next();
  };
};

// Specific rate limits for different endpoints
// Post rate limit DISABLED for hackathon demo
const postRateLimit = (req, res, next) => next();

// AI rate limit DISABLED for hackathon demo
const aiRateLimit = (req, res, next) => next();

// Booking rate limit DISABLED for hackathon demo
const bookingRateLimit = (req, res, next) => next();

// User ownership check
const checkOwnership = (resourceField = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Authentication required'
        }
      });
    }
    
    // Admin can access any resource
    if (req.user.role === 'ADMIN') {
      return next();
    }
    
    // Check if user owns the resource
    const resourceUserId = req.params.userId || req.body[resourceField] || req.query[resourceField];
    
    if (resourceUserId && resourceUserId !== req.userId.toString()) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You can only access your own resources'
        }
      });
    }
    
    next();
  };
};

// Validation middleware for user activity controls
const checkActivityLimits = async (req, res, next) => {
  try {
    if (!req.user) {
      return next();
    }
    
    const feedType = req.body.feedType || req.params.feedType;
    
    if (feedType) {
      const canPost = req.user.canPost(feedType);
      
      if (!canPost.canPost) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'ACTIVITY_LIMIT_EXCEEDED',
            message: canPost.reason,
            details: {
              nextAllowedAt: canPost.nextAllowedAt,
              unlockAt: canPost.unlockAt
            }
          }
        });
      }
    }
    
    next();
  } catch (error) {
    logger.error('Activity limit check failed:', error);
    next(); // Continue on error to avoid blocking
  }
};

// Admin only middleware
const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'NOT_AUTHENTICATED',
        message: 'Authentication required'
      }
    });
  }
  
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'ADMIN_REQUIRED',
        message: 'Administrator access required'
      }
    });
  }
  
  next();
};

// Middleware to validate request ID for idempotency
const validateIdempotencyKey = (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];
  
  if (!idempotencyKey) {
    // Generate one if not provided for critical operations
    if (req.method === 'POST' && (req.path.includes('/xp') || req.path.includes('/points'))) {
      req.idempotencyKey = `${req.userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
  } else {
    req.idempotencyKey = idempotencyKey;
  }
  
  next();
};

module.exports = {
  authenticate,
  authorize,
  requireApprovedTutor,
  optionalAuth,
  createRateLimit,
  postRateLimit,
  aiRateLimit,
  bookingRateLimit,
  checkOwnership,
  checkActivityLimits,
  adminOnly,
  validateIdempotencyKey
};