const express = require('express');
const passport = require('passport');
const authService = require('../services/authService');
const { validate, sanitizeInput } = require('../middleware/validation');
const { authenticate, createRateLimit } = require('../middleware/auth');
const { asyncHandler, sendSuccess, sendError } = require('../middleware/errorHandler');
const { z } = require('zod');

const router = express.Router();

// Rate limiting DISABLED for hackathon demo
// const authRateLimit = createRateLimit(
//   15 * 60 * 1000, // 15 minutes
//   5, // 5 attempts per window
//   'Too many authentication attempts'
// );

// const passwordResetRateLimit = createRateLimit(
//   60 * 60 * 1000, // 1 hour
//   3, // 3 attempts per hour
//   'Too many password reset attempts'
// );

// Validation schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  role: z.enum(['STUDENT', 'ALUMNI'], 'Role must be STUDENT or ALUMNI'),
  track: z.enum(['SOFTWARE_ENGINEERING', 'CYBER_SECURITY', 'IT', 'AI', 'OTHER']).optional(),
  subcategory: z.string().max(100).optional()
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required')
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required')
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters')
});

const resetPasswordSchema = z.object({
  resetToken: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters')
});

// @route   POST /api/v1/auth/register
// @desc    Register new user
// @access  Public
router.post('/register', 
  sanitizeInput,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    
    sendSuccess(res, {
      user: result.user,
      tokens: result.tokens,
      requiresVerification: result.requiresVerification
    }, 'Registration successful', 201);
  })
);

// @route   POST /api/v1/auth/login
// @desc    Login user
// @access  Public
router.post('/login',
  sanitizeInput,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    
    sendSuccess(res, {
      user: result.user,
      tokens: result.tokens,
      requiresVerification: result.requiresVerification
    }, 'Login successful');
  })
);



// @route   POST /api/v1/auth/refresh
// @desc    Refresh access token
// @access  Public
router.post('/refresh',
  validate(refreshTokenSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.refreshToken(req.body.refreshToken);
    
    sendSuccess(res, {
      user: result.user,
      tokens: result.tokens
    }, 'Token refreshed successfully');
  })
);

// @route   POST /api/v1/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    const refreshToken = req.body.refreshToken;
    await authService.logout(req.userId, refreshToken);
    
    sendSuccess(res, null, 'Logout successful');
  })
);

// @route   POST /api/v1/auth/logout-all
// @desc    Logout from all devices
// @access  Private
router.post('/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    await authService.logout(req.userId);
    
    sendSuccess(res, null, 'Logged out from all devices');
  })
);

// @route   POST /api/v1/auth/change-password
// @desc    Change user password
// @access  Private
router.post('/change-password',
  authenticate,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    await authService.changePassword(
      req.userId,
      req.body.currentPassword,
      req.body.newPassword
    );
    
    sendSuccess(res, null, 'Password changed successfully');
  })
);

// @route   POST /api/v1/auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post('/forgot-password',
  sanitizeInput,
  validate(z.object({ email: z.string().email() })),
  asyncHandler(async (req, res) => {
    const result = await authService.requestPasswordReset(req.body.email);
    
    sendSuccess(res, {
      resetToken: result.resetToken // Remove in production
    }, result.message);
  })
);

// @route   POST /api/v1/auth/reset-password
// @desc    Reset password with token
// @access  Public
router.post('/reset-password',
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    await authService.resetPassword(req.body.resetToken, req.body.newPassword);
    
    sendSuccess(res, null, 'Password reset successful');
  })
);

// @route   GET /api/v1/auth/me
// @desc    Get current user
// @access  Private
router.get('/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = authService.sanitizeUser(req.user);
    
    sendSuccess(res, { user }, 'User retrieved successfully');
  })
);

// @route   GET /api/v1/auth/verify-token
// @desc    Verify if token is valid
// @access  Private
router.get('/verify-token',
  authenticate,
  asyncHandler(async (req, res) => {
    sendSuccess(res, {
      valid: true,
      user: authService.sanitizeUser(req.user)
    }, 'Token is valid');
  })
);

module.exports = router;