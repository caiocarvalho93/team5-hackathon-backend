const { logger } = require('../config/database');

// Custom error classes
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message, details = null) {
    super(message, 409, 'CONFLICT', details);
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded', retryAfter = null) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', { retryAfter });
  }
}

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  
  // Generate request ID for tracking
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Log error with context
  const errorContext = {
    requestId,
    method: req.method,
    url: req.originalUrl,
    userId: req.userId,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    body: req.method !== 'GET' ? req.body : undefined,
    query: req.query,
    params: req.params
  };
  
  // Handle specific error types
  if (err.name === 'CastError') {
    const message = 'Invalid resource ID format';
    error = new ValidationError(message);
  }
  
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    const message = `${field} '${value}' already exists`;
    error = new ConflictError(message, { field, value });
  }
  
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(val => ({
      field: val.path,
      message: val.message
    }));
    error = new ValidationError('Validation failed', errors);
  }
  
  if (err.name === 'JsonWebTokenError') {
    error = new AuthenticationError('Invalid token');
  }
  
  if (err.name === 'TokenExpiredError') {
    error = new AuthenticationError('Token expired');
  }
  
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      error = new ValidationError('File too large');
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      error = new ValidationError('Too many files');
    } else {
      error = new ValidationError('File upload error');
    }
  }
  
  // MongoDB connection errors
  if (err.name === 'MongoNetworkError' || err.name === 'MongoTimeoutError') {
    error = new AppError('Database connection error', 503, 'DATABASE_ERROR');
  }
  
  // OpenAI API errors
  if (err.message && err.message.includes('OpenAI')) {
    error = new AppError('AI service temporarily unavailable', 502, 'AI_SERVICE_ERROR');
  }
  
  // Set default values for unknown errors
  if (!error.statusCode) {
    error.statusCode = 500;
  }
  
  if (!error.code) {
    error.code = 'INTERNAL_ERROR';
  }
  
  // Log error based on severity
  if (error.statusCode >= 500) {
    logger.error('Server Error:', {
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code,
        statusCode: error.statusCode
      },
      context: errorContext
    });
  } else if (error.statusCode >= 400) {
    logger.warn('Client Error:', {
      error: {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode
      },
      context: errorContext
    });
  }
  
  // Prepare error response
  const errorResponse = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      requestId
    }
  };
  
  // Add details for client errors (4xx)
  if (error.statusCode < 500 && error.details) {
    errorResponse.error.details = error.details;
  }
  
  // Add stack trace in development
  if (process.env.NODE_ENV === 'development' && error.statusCode >= 500) {
    errorResponse.error.stack = error.stack;
  }
  
  // Add retry information for rate limits
  if (error.statusCode === 429 && error.details?.retryAfter) {
    res.set('Retry-After', error.details.retryAfter);
  }
  
  res.status(error.statusCode).json(errorResponse);
};

// 404 handler for undefined routes
const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Route ${req.originalUrl} not found`);
  next(error);
};

// Async error wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Success response helper
const sendSuccess = (res, data = null, message = 'Success', statusCode = 200) => {
  const response = {
    success: true,
    message
  };
  
  if (data !== null) {
    response.data = data;
  }
  
  res.status(statusCode).json(response);
};

// Paginated response helper
const sendPaginatedResponse = (res, data, pagination, message = 'Success') => {
  res.json({
    success: true,
    message,
    data,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: pagination.total,
      pages: Math.ceil(pagination.total / pagination.limit),
      hasNext: pagination.page < Math.ceil(pagination.total / pagination.limit),
      hasPrev: pagination.page > 1
    }
  });
};

// Error response helper
const sendError = (res, message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) => {
  const error = new AppError(message, statusCode, code, details);
  
  res.status(statusCode).json({
    success: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.details
    }
  });
};

// Validation error helper
const sendValidationError = (res, errors) => {
  res.status(400).json({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: errors
    }
  });
};

module.exports = {
  // Error classes
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  
  // Middleware
  errorHandler,
  notFoundHandler,
  asyncHandler,
  
  // Response helpers
  sendSuccess,
  sendPaginatedResponse,
  sendError,
  sendValidationError
};