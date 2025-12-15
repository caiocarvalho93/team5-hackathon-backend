const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const User = require('../models/User');
const { logger } = require('../config/database');

// Validation schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  role: z.enum(['STUDENT', 'ALUMNI'], 'Role must be STUDENT or ALUMNI'),
  track: z.enum(['SOFTWARE_ENGINEERING', 'CYBER_SECURITY', 'IT', 'AI', 'OTHER']).optional(),
  subcategory: z.string().optional()
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required')
});

const googleAuthSchema = z.object({
  googleId: z.string().min(1, 'Google ID is required'),
  email: z.string().email('Invalid email format'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  avatar: z.string().url().optional(),
  role: z.enum(['STUDENT', 'ALUMNI']).optional()
});

class AuthService {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET;
    this.jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
    this.jwtExpire = process.env.JWT_EXPIRE || '15m';
    this.jwtRefreshExpire = process.env.JWT_REFRESH_EXPIRE || '7d';
  }

  // Generate JWT tokens
  generateTokens(user) {
    const payload = {
      userId: user._id,
      email: user.email,
      role: user.role,
      tutorStatus: user.tutorStatus
    };

    const accessToken = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpire,
      issuer: 'peertrack-plus',
      audience: 'peertrack-users'
    });

    const refreshToken = jwt.sign(
      { userId: user._id, tokenType: 'refresh' },
      this.jwtRefreshSecret,
      {
        expiresIn: this.jwtRefreshExpire,
        issuer: 'peertrack-plus',
        audience: 'peertrack-users'
      }
    );

    return { accessToken, refreshToken };
  }

  // Verify JWT token
  verifyToken(token, isRefresh = false) {
    try {
      const secret = isRefresh ? this.jwtRefreshSecret : this.jwtSecret;
      return jwt.verify(token, secret, {
        issuer: 'peertrack-plus',
        audience: 'peertrack-users'
      });
    } catch (error) {
      logger.error('Token verification failed:', error);
      throw new Error('Invalid token');
    }
  }

  // Register new user
  async register(userData) {
    try {
      // Validate input
      const validatedData = registerSchema.parse(userData);
      
      // Check if user already exists
      const existingUser = await User.findOne({ email: validatedData.email });
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Create user object
      const userObj = {
        email: validatedData.email,
        password: validatedData.password,
        role: validatedData.role,
        profile: {
          firstName: validatedData.firstName,
          lastName: validatedData.lastName,
          displayName: `${validatedData.firstName} ${validatedData.lastName}`
        }
      };

      // Add verification data for Alumni
      if (validatedData.role === 'ALUMNI') {
        userObj.verification = {
          track: validatedData.track,
          subcategory: validatedData.subcategory,
          status: 'PENDING'
        };
      }

      // Create user
      const user = new User(userObj);
      await user.save();

      // Generate tokens
      const tokens = this.generateTokens(user);
      
      // Store refresh token
      const refreshExpiry = new Date();
      refreshExpiry.setDate(refreshExpiry.getDate() + 7);
      await user.addRefreshToken(tokens.refreshToken, refreshExpiry);

      logger.info(`User registered successfully: ${user.email}`);

      return {
        success: true,
        user: this.sanitizeUser(user),
        tokens,
        requiresVerification: user.role === 'ALUMNI' && user.tutorStatus === 'PENDING'
      };
    } catch (error) {
      logger.error('Registration failed:', error);
      throw error;
    }
  }

  // Login user
  async login(credentials) {
    try {
      // Validate input
      const validatedData = loginSchema.parse(credentials);
      
      // Find user
      const user = await User.findOne({ email: validatedData.email });
      if (!user) {
        throw new Error('Invalid email or password');
      }

      // Check password
      const isValidPassword = await user.comparePassword(validatedData.password);
      if (!isValidPassword) {
        throw new Error('Invalid email or password');
      }

      // Check if account is active
      if (!user.isActive) {
        throw new Error('Account is deactivated');
      }

      // Generate tokens
      const tokens = this.generateTokens(user);
      
      // Store refresh token
      const refreshExpiry = new Date();
      refreshExpiry.setDate(refreshExpiry.getDate() + 7);
      await user.addRefreshToken(tokens.refreshToken, refreshExpiry);

      // Update last login
      user.lastLoginAt = new Date();
      await user.updateLastActive();

      logger.info(`User logged in successfully: ${user.email}`);

      return {
        success: true,
        user: this.sanitizeUser(user),
        tokens,
        requiresVerification: user.role === 'ALUMNI' && user.tutorStatus === 'PENDING'
      };
    } catch (error) {
      logger.error('Login failed:', error);
      throw error;
    }
  }

  // Google OAuth registration
  async googleRegister(googleData) {
    try {
      // Validate input
      const validatedData = googleAuthSchema.parse(googleData);
      
      // Check if user already exists
      const existingUser = await User.findOne({ 
        $or: [
          { email: validatedData.email },
          { googleId: validatedData.googleId }
        ]
      });
      
      if (existingUser) {
        throw new Error('User with this email or Google account already exists');
      }

      // Create user object
      const userObj = {
        email: validatedData.email,
        googleId: validatedData.googleId,
        role: validatedData.role || 'STUDENT',
        profile: {
          firstName: validatedData.firstName,
          lastName: validatedData.lastName,
          displayName: `${validatedData.firstName} ${validatedData.lastName}`,
          avatar: validatedData.avatar || ''
        },
        emailVerified: true // Google accounts are pre-verified
      };

      // Create user
      const user = new User(userObj);
      await user.save();

      // Generate tokens
      const tokens = this.generateTokens(user);
      
      // Store refresh token
      const refreshExpiry = new Date();
      refreshExpiry.setDate(refreshExpiry.getDate() + 7);
      await user.addRefreshToken(tokens.refreshToken, refreshExpiry);

      logger.info(`User registered via Google: ${user.email}`);

      return {
        success: true,
        user: this.sanitizeUser(user),
        tokens,
        requiresVerification: user.role === 'ALUMNI' && user.tutorStatus === 'PENDING'
      };
    } catch (error) {
      logger.error('Google registration failed:', error);
      throw error;
    }
  }

  // Google OAuth login
  async googleLogin(googleData) {
    try {
      // Validate input
      const validatedData = googleAuthSchema.parse(googleData);
      
      // Find user by email or Google ID
      const user = await User.findOne({
        $or: [
          { email: validatedData.email },
          { googleId: validatedData.googleId }
        ]
      });

      if (!user) {
        throw new Error('You must register first');
      }

      // Check if account is active
      if (!user.isActive) {
        throw new Error('Account is deactivated');
      }

      // Update Google ID if not set
      if (!user.googleId) {
        user.googleId = validatedData.googleId;
        await user.save();
      }

      // Generate tokens
      const tokens = this.generateTokens(user);
      
      // Store refresh token
      const refreshExpiry = new Date();
      refreshExpiry.setDate(refreshExpiry.getDate() + 7);
      await user.addRefreshToken(tokens.refreshToken, refreshExpiry);

      // Update last login
      user.lastLoginAt = new Date();
      await user.updateLastActive();

      logger.info(`User logged in via Google: ${user.email}`);

      return {
        success: true,
        user: this.sanitizeUser(user),
        tokens,
        requiresVerification: user.role === 'ALUMNI' && user.tutorStatus === 'PENDING'
      };
    } catch (error) {
      logger.error('Google login failed:', error);
      throw error;
    }
  }

  // Refresh access token
  async refreshToken(refreshToken) {
    try {
      // Verify refresh token
      const decoded = this.verifyToken(refreshToken, true);
      
      // Find user and validate refresh token
      const user = await User.findById(decoded.userId);
      if (!user) {
        throw new Error('User not found');
      }

      const tokenExists = user.refreshTokens.some(rt => rt.token === refreshToken);
      if (!tokenExists) {
        throw new Error('Invalid refresh token');
      }

      // Check if account is active
      if (!user.isActive) {
        throw new Error('Account is deactivated');
      }

      // Generate new tokens
      const tokens = this.generateTokens(user);
      
      // Replace old refresh token with new one
      await user.removeRefreshToken(refreshToken);
      const refreshExpiry = new Date();
      refreshExpiry.setDate(refreshExpiry.getDate() + 7);
      await user.addRefreshToken(tokens.refreshToken, refreshExpiry);

      // Update last active
      await user.updateLastActive();

      logger.info(`Token refreshed for user: ${user.email}`);

      return {
        success: true,
        user: this.sanitizeUser(user),
        tokens
      };
    } catch (error) {
      logger.error('Token refresh failed:', error);
      throw error;
    }
  }

  // Logout user
  async logout(userId, refreshToken = null) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      if (refreshToken) {
        // Remove specific refresh token
        await user.removeRefreshToken(refreshToken);
      } else {
        // Remove all refresh tokens (logout from all devices)
        await user.clearRefreshTokens();
      }

      logger.info(`User logged out: ${user.email}`);

      return { success: true };
    } catch (error) {
      logger.error('Logout failed:', error);
      throw error;
    }
  }

  // Change password
  async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password
      const isValidPassword = await user.comparePassword(currentPassword);
      if (!isValidPassword) {
        throw new Error('Current password is incorrect');
      }

      // Validate new password
      if (newPassword.length < 8) {
        throw new Error('New password must be at least 8 characters');
      }

      // Update password
      user.password = newPassword;
      await user.save();

      // Clear all refresh tokens to force re-login
      await user.clearRefreshTokens();

      logger.info(`Password changed for user: ${user.email}`);

      return { success: true };
    } catch (error) {
      logger.error('Password change failed:', error);
      throw error;
    }
  }

  // Request password reset
  async requestPasswordReset(email) {
    try {
      const user = await User.findOne({ email });
      if (!user) {
        // Don't reveal if email exists
        return { success: true, message: 'If the email exists, a reset link has been sent' };
      }

      // Generate reset token (implement email sending in production)
      const resetToken = jwt.sign(
        { userId: user._id, type: 'password_reset' },
        this.jwtSecret,
        { expiresIn: '1h' }
      );

      logger.info(`Password reset requested for: ${email}`);

      // In production, send email with reset link
      return { 
        success: true, 
        message: 'If the email exists, a reset link has been sent',
        resetToken // Remove this in production
      };
    } catch (error) {
      logger.error('Password reset request failed:', error);
      throw error;
    }
  }

  // Reset password with token
  async resetPassword(resetToken, newPassword) {
    try {
      // Verify reset token
      const decoded = this.verifyToken(resetToken);
      if (decoded.type !== 'password_reset') {
        throw new Error('Invalid reset token');
      }

      // Find user
      const user = await User.findById(decoded.userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Validate new password
      if (newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      // Update password
      user.password = newPassword;
      await user.save();

      // Clear all refresh tokens
      await user.clearRefreshTokens();

      logger.info(`Password reset completed for user: ${user.email}`);

      return { success: true };
    } catch (error) {
      logger.error('Password reset failed:', error);
      throw error;
    }
  }

  // Sanitize user data for response
  sanitizeUser(user) {
    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshTokens;
    return userObj;
  }

  // Validate user permissions
  validatePermissions(user, requiredRole = null, requiredStatus = null) {
    if (!user.isActive) {
      throw new Error('Account is deactivated');
    }

    if (requiredRole && user.role !== requiredRole && user.role !== 'ADMIN') {
      throw new Error('Insufficient permissions');
    }

    if (requiredStatus && user.tutorStatus !== requiredStatus) {
      throw new Error('Account verification required');
    }

    return true;
  }

  // Get user by ID with permissions check
  async getUserById(userId, requestingUserId = null) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if requesting user can view this profile
      if (requestingUserId && requestingUserId !== userId) {
        const requestingUser = await User.findById(requestingUserId);
        if (requestingUser?.role !== 'ADMIN') {
          // Return limited public profile
          return {
            _id: user._id,
            profile: user.profile,
            role: user.role,
            gamification: user.gamification,
            createdAt: user.createdAt
          };
        }
      }

      return this.sanitizeUser(user);
    } catch (error) {
      logger.error('Get user by ID failed:', error);
      throw error;
    }
  }
}

module.exports = new AuthService();