const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const authService = require('../services/authService');
const { asyncHandler, sendSuccess, sendError } = require('../middleware/errorHandler');
const { logger } = require('../config/database');

const router = express.Router();

// Initialize Google OAuth client with your Client ID
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// @route   POST /api/v1/auth/google
// @desc    Google OAuth - verify ID token and login/register
// @access  Public
router.post('/',
  asyncHandler(async (req, res) => {
    const { credential, role } = req.body;
    
    // Must receive credential (Google ID token)
    if (!credential) {
      return sendError(res, 'Google credential (ID token) is required', 400, 'MISSING_CREDENTIAL');
    }
    
    logger.info(`Google auth attempt - credential length: ${credential.length}`);
    
    let payload;
    try {
      // Verify the Google ID token
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID
      });
      
      payload = ticket.getPayload();
      logger.info(`Google token verified for: ${payload.email}`);
    } catch (verifyError) {
      logger.error('Google token verification failed:', verifyError.message);
      return sendError(res, 'Invalid Google token', 401, 'INVALID_GOOGLE_TOKEN');
    }
    
    // Extract user info from verified payload
    const { sub: googleId, email, given_name: firstName, family_name: lastName, picture: avatar } = payload;
    
    if (!email) {
      return sendError(res, 'Email not provided by Google', 400, 'NO_EMAIL');
    }
    
    const User = require('../models/User');
    
    // Check if user exists by email or googleId
    let user = await User.findOne({ 
      $or: [{ email }, { googleId }] 
    });
    
    if (user) {
      // Existing user - login
      // Update googleId if not set (user registered with email first)
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
      
      const tokens = authService.generateTokens(user);
      const refreshExpiry = new Date();
      refreshExpiry.setDate(refreshExpiry.getDate() + 7);
      await user.addRefreshToken(tokens.refreshToken, refreshExpiry);
      
      // Update last login
      user.lastLoginAt = new Date();
      await user.updateLastActive();
      
      logger.info(`Google login successful: ${email}`);
      
      sendSuccess(res, {
        user: authService.sanitizeUser(user),
        tokens,
        requiresVerification: user.role === 'ALUMNI' && user.tutorStatus === 'PENDING'
      }, 'Google login successful');
    } else {
      // New user - register
      const userObj = {
        email,
        googleId,
        role: role || 'STUDENT',
        profile: {
          firstName: firstName || 'User',
          lastName: lastName || '',
          displayName: `${firstName || 'User'} ${lastName || ''}`.trim(),
          avatar: avatar || ''
        },
        emailVerified: true // Google accounts are pre-verified
      };
      
      // Add verification data for Alumni
      if (userObj.role === 'ALUMNI') {
        userObj.tutorStatus = 'PENDING';
        userObj.verification = {
          status: 'PENDING'
        };
      }
      
      user = new User(userObj);
      await user.save();
      
      const tokens = authService.generateTokens(user);
      const refreshExpiry = new Date();
      refreshExpiry.setDate(refreshExpiry.getDate() + 7);
      await user.addRefreshToken(tokens.refreshToken, refreshExpiry);
      
      logger.info(`Google registration successful: ${email}`);
      
      sendSuccess(res, {
        user: authService.sanitizeUser(user),
        tokens,
        requiresVerification: user.role === 'ALUMNI'
      }, 'Google registration successful', 201);
    }
  })
);

module.exports = router;
