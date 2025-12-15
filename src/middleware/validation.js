const { z } = require('zod');
const { logger } = require('../config/database');

// Common validation schemas
const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format');

const paginationSchema = z.object({
  page: z.string().transform(Number).pipe(z.number().min(1)).default('1'),
  limit: z.string().transform(Number).pipe(z.number().min(1).max(100)).default('20'),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc')
});

// User validation schemas
const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  displayName: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  timezone: z.string().max(50).optional(),
  socialLinks: z.object({
    linkedin: z.string().url().optional().or(z.literal('')),
    github: z.string().url().optional().or(z.literal('')),
    portfolio: z.string().url().optional().or(z.literal('')),
    twitter: z.string().url().optional().or(z.literal(''))
  }).optional()
});

const availabilitySchema = z.object({
  availability: z.array(z.object({
    dayOfWeek: z.number().min(0).max(6),
    startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)'),
    endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)'),
    timezone: z.string().default('UTC')
  })).max(7)
});

// Post validation schemas
const createPostSchema = z.object({
  feedType: z.enum(['QNA', 'COMMUNITY', 'ALUMNI_PROFESSIONAL']),
  track: z.enum(['SOFTWARE_ENGINEERING', 'CYBER_SECURITY', 'IT', 'AI', 'OTHER']),
  subcategory: z.string().max(100).optional(),
  title: z.string().min(5).max(200),
  content: z.string().min(10).max(5000),
  tags: z.array(z.string().max(30)).max(10).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).default('INTERMEDIATE')
});

const updatePostSchema = createPostSchema.partial().omit({ feedType: true });

// Answer validation schemas
const createAnswerSchema = z.object({
  content: z.string().min(10).max(3000),
  codeSnippets: z.array(z.object({
    language: z.string().max(50),
    code: z.string().max(2000),
    description: z.string().max(200).optional()
  })).max(5).optional()
});

// Booking validation schemas
const createBookingSchema = z.object({
  tutorId: objectIdSchema,
  startDateTime: z.string().datetime(),
  track: z.enum(['SOFTWARE_ENGINEERING', 'CYBER_SECURITY', 'IT', 'AI', 'OTHER']),
  subcategory: z.string().max(100).optional(),
  sessionType: z.enum(['ONE_ON_ONE', 'GROUP', 'WORKSHOP', 'CODE_REVIEW', 'MOCK_INTERVIEW']).default('ONE_ON_ONE'),
  sessionNotes: z.object({
    studentPrep: z.string().max(1000).optional(),
    agenda: z.array(z.string().max(200)).max(10).optional(),
    objectives: z.array(z.string().max(200)).max(5).optional()
  }).optional()
});

const updateBookingSchema = z.object({
  status: z.enum(['CONFIRMED', 'CANCELLED', 'COMPLETED']).optional(),
  meetingDetails: z.object({
    platform: z.enum(['GOOGLE_MEET', 'ZOOM', 'TEAMS', 'DISCORD', 'IN_PERSON']).optional(),
    meetingUrl: z.string().url().optional(),
    meetingId: z.string().max(100).optional(),
    password: z.string().max(50).optional(),
    location: z.string().max(200).optional()
  }).optional(),
  sessionSummary: z.object({
    topicsCovered: z.array(z.string().max(100)).max(10).optional(),
    keyLearnings: z.array(z.string().max(200)).max(10).optional(),
    nextSteps: z.array(z.string().max(200)).max(5).optional(),
    resourcesShared: z.array(z.string().max(300)).max(10).optional(),
    homeworkAssigned: z.string().max(500).optional(),
    followUpNeeded: z.boolean().optional(),
    actualDuration: z.number().min(1).max(300).optional()
  }).optional()
});

const bookingFeedbackSchema = z.object({
  rating: z.number().min(1).max(5),
  comment: z.string().max(1000).optional(),
  sessionQuality: z.number().min(1).max(5).optional(),
  technicalIssues: z.boolean().optional(),
  wouldRecommend: z.boolean().optional()
});

// Endorsement validation schemas
const createEndorsementSchema = z.object({
  targetId: objectIdSchema,
  message: z.string().max(500).optional(),
  skills: z.array(z.string().max(50)).max(10).optional(),
  category: z.enum(['TECHNICAL_EXPERTISE', 'MENTORSHIP_QUALITY', 'COMMUNICATION', 'PROBLEM_SOLVING', 'LEADERSHIP', 'COLLABORATION']),
  rating: z.number().min(1).max(5),
  relationship: z.enum(['PEER', 'MENTEE', 'COLLEAGUE', 'PROJECT_PARTNER', 'OTHER']),
  context: z.object({
    sessionCount: z.number().min(0).optional(),
    projectsWorkedTogether: z.array(z.string().max(100)).max(5).optional(),
    timeWorkedTogether: z.string().max(50).optional(),
    specificExamples: z.array(z.string().max(200)).max(3).optional()
  }).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'CONNECTIONS_ONLY']).default('PUBLIC')
});

// AI interaction validation schemas
const aiTutorHelpSchema = z.object({
  questionText: z.string().min(10).max(2000),
  track: z.enum(['SOFTWARE_ENGINEERING', 'CYBER_SECURITY', 'IT', 'AI', 'OTHER']),
  subcategory: z.string().max(100).optional()
});

const aiMambaHelpSchema = z.object({
  questionText: z.string().min(8).max(1500),
  track: z.enum(['SOFTWARE_ENGINEERING', 'CYBER_SECURITY', 'IT', 'AI', 'OTHER'])
});

const aiFeedbackSchema = z.object({
  interactionId: objectIdSchema,
  userRating: z.number().min(1).max(5),
  userFeedback: z.string().max(500).optional(),
  wasHelpful: z.boolean(),
  followUpNeeded: z.boolean().optional(),
  reportedIssue: z.boolean().optional(),
  issueDescription: z.string().max(300).optional()
});

// Admin validation schemas
const adminUserUpdateSchema = z.object({
  role: z.enum(['ADMIN', 'ALUMNI', 'STUDENT']).optional(),
  tutorStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  isActive: z.boolean().optional(),
  gamification: z.object({
    currentXP: z.number().min(0).optional(),
    level: z.number().min(1).optional(),
    badges: z.array(z.string()).optional()
  }).optional()
});

const verificationReviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().max(500).optional()
});

// Validation middleware factory
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      let data;
      
      switch (source) {
        case 'body':
          data = req.body;
          break;
        case 'params':
          data = req.params;
          break;
        case 'query':
          data = req.query;
          break;
        case 'headers':
          data = req.headers;
          break;
        default:
          data = req.body;
      }
      
      const result = schema.parse(data);
      
      // Replace the original data with validated data
      if (source === 'body') {
        req.body = result;
      } else if (source === 'params') {
        req.params = result;
      } else if (source === 'query') {
        req.query = result;
      }
      
      next();
    } catch (error) {
      logger.error('Validation failed:', error);
      
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code
        }));
        
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: errors
          }
        });
      }
      
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed'
        }
      });
    }
  };
};

// File upload validation
const validateFileUpload = (options = {}) => {
  const {
    maxSize = 5 * 1024 * 1024, // 5MB default
    allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
    required = false
  } = options;
  
  return (req, res, next) => {
    if (!req.file && required) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'FILE_REQUIRED',
          message: 'File upload is required'
        }
      });
    }
    
    if (req.file) {
      // Check file size
      if (req.file.size > maxSize) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File size exceeds ${maxSize / 1024 / 1024}MB limit`,
            details: {
              maxSize,
              actualSize: req.file.size
            }
          }
        });
      }
      
      // Check file type
      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_FILE_TYPE',
            message: 'File type not allowed',
            details: {
              allowedTypes,
              actualType: req.file.mimetype
            }
          }
        });
      }
    }
    
    next();
  };
};

// Sanitization middleware
const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      // Basic XSS prevention
      return obj
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    }
    
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    
    if (obj && typeof obj === 'object') {
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitize(value);
      }
      return sanitized;
    }
    
    return obj;
  };
  
  req.body = sanitize(req.body);
  req.query = sanitize(req.query);
  
  next();
};

// Custom validation helpers
const validateObjectId = (id, fieldName = 'id') => {
  if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
    throw new Error(`Invalid ${fieldName} format`);
  }
  return id;
};

const validatePagination = (query) => {
  const result = paginationSchema.parse(query);
  return {
    page: result.page,
    limit: result.limit,
    skip: (result.page - 1) * result.limit,
    sort: result.sort,
    order: result.order
  };
};

module.exports = {
  // Validation middleware
  validate,
  validateFileUpload,
  sanitizeInput,
  
  // Validation schemas
  objectIdSchema,
  paginationSchema,
  updateProfileSchema,
  availabilitySchema,
  createPostSchema,
  updatePostSchema,
  createAnswerSchema,
  createBookingSchema,
  updateBookingSchema,
  bookingFeedbackSchema,
  createEndorsementSchema,
  aiTutorHelpSchema,
  aiMambaHelpSchema,
  aiFeedbackSchema,
  adminUserUpdateSchema,
  verificationReviewSchema,
  
  // Helper functions
  validateObjectId,
  validatePagination
};