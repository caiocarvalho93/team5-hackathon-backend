const User = require('../models/User');
const PointTransaction = require('../models/PointTransaction');
const Endorsement = require('../models/Endorsement');
const { logger } = require('../config/database');

class GamificationService {
  constructor() {
    this.XP_REWARDS = {
      QA_ANSWER: 10,
      TUTORING_SESSION: 100,
      ENDORSEMENT_RECEIVED: 50,
      POST_QUESTION: 5,
      FIRST_LOGIN: 25,
      PROFILE_COMPLETE: 15
    };

    this.LEVEL_THRESHOLDS = [
      { level: 1, minXP: 0 },
      { level: 2, minXP: 100 },
      { level: 3, minXP: 300 },
      { level: 4, minXP: 600 },
      { level: 5, minXP: 1000 },
      { level: 6, minXP: 1500 },
      { level: 7, minXP: 2200 },
      { level: 8, minXP: 3000 },
      { level: 9, minXP: 4000 },
      { level: 10, minXP: 5500 }
    ];

    this.BADGES = {
      FIRST_ANSWER: { name: 'First Answer', description: 'Answered your first question' },
      HELPFUL_TUTOR: { name: 'Helpful Tutor', description: 'Answered 10 questions' },
      EXPERT_TUTOR: { name: 'Expert Tutor', description: 'Answered 50 questions' },
      MASTER_TUTOR: { name: 'Master Tutor', description: 'Answered 100 questions' },
      SESSION_STARTER: { name: 'Session Starter', description: 'Completed your first tutoring session' },
      DEDICATED_MENTOR: { name: 'Dedicated Mentor', description: 'Completed 10 tutoring sessions' },
      ELITE_MENTOR: { name: 'Elite Mentor', description: 'Completed 25 tutoring sessions' },
      COMMUNITY_FAVORITE: { name: 'Community Favorite', description: 'Received 5 endorsements' },
      RISING_STAR: { name: 'Rising Star', description: 'Reached level 5' },
      CHAMPION: { name: 'Champion', description: 'Reached level 10' }
    };
  }

  // Award XP with transaction logging
  async awardXP(userId, actionType, amount = null, metadata = {}) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const xpAmount = amount || this.XP_REWARDS[actionType] || 0;
      if (xpAmount <= 0) {
        return { success: false, error: 'Invalid XP amount' };
      }

      // Create idempotency key to prevent duplicate awards
      const idempotencyKey = metadata.idempotencyKey || `${userId}_${actionType}_${Date.now()}`;
      
      // Check for duplicate transaction
      const existingTransaction = await PointTransaction.findOne({ idempotencyKey });
      if (existingTransaction) {
        return { 
          success: true, 
          duplicate: true, 
          transaction: existingTransaction 
        };
      }

      // Calculate old level
      const oldLevel = this.calculateLevel(user.gamification.currentXP);
      const newXP = user.gamification.currentXP + xpAmount;
      const newLevel = this.calculateLevel(newXP);

      // Create transaction record
      const transaction = new PointTransaction({
        userId,
        actionType,
        pointsAwarded: xpAmount,
        previousXP: user.gamification.currentXP,
        newXP,
        previousLevel: oldLevel,
        newLevel,
        metadata,
        idempotencyKey
      });

      await transaction.save();

      // Update user XP and level
      user.gamification.currentXP = newXP;
      user.gamification.level = newLevel;

      // Award level-up badges
      const newBadges = [];
      if (newLevel > oldLevel) {
        const levelBadge = `Level ${newLevel}`;
        if (!user.gamification.badges.includes(levelBadge)) {
          user.gamification.badges.push(levelBadge);
          newBadges.push(levelBadge);
        }

        // Special level badges
        if (newLevel === 5 && !user.gamification.badges.includes('Rising Star')) {
          user.gamification.badges.push('Rising Star');
          newBadges.push('Rising Star');
        }
        if (newLevel === 10 && !user.gamification.badges.includes('Champion')) {
          user.gamification.badges.push('Champion');
          newBadges.push('Champion');
        }
      }

      // Award action-specific badges
      const actionBadges = await this.checkActionBadges(user, actionType);
      newBadges.push(...actionBadges);

      await user.save();

      logger.info(`XP awarded: ${xpAmount} to user ${userId} for ${actionType}`);

      return {
        success: true,
        transaction,
        xpAwarded: xpAmount,
        newXP,
        oldLevel,
        newLevel,
        levelUp: newLevel > oldLevel,
        newBadges
      };

    } catch (error) {
      logger.error('Failed to award XP:', error);
      throw error;
    }
  }

  // Calculate level from XP
  calculateLevel(xp) {
    for (let i = this.LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (xp >= this.LEVEL_THRESHOLDS[i].minXP) {
        return this.LEVEL_THRESHOLDS[i].level;
      }
    }
    return 1;
  }

  // Get XP needed for next level
  getXPForNextLevel(currentXP) {
    const currentLevel = this.calculateLevel(currentXP);
    const nextLevelThreshold = this.LEVEL_THRESHOLDS.find(t => t.level === currentLevel + 1);
    
    if (!nextLevelThreshold) {
      return null; // Max level reached
    }

    return {
      currentLevel,
      nextLevel: currentLevel + 1,
      currentXP,
      nextLevelXP: nextLevelThreshold.minXP,
      xpNeeded: nextLevelThreshold.minXP - currentXP,
      progress: currentXP / nextLevelThreshold.minXP
    };
  }

  // Check and award action-specific badges
  async checkActionBadges(user, actionType) {
    const newBadges = [];

    try {
      switch (actionType) {
        case 'QA_ANSWER':
          user.gamification.totalAnswers = (user.gamification.totalAnswers || 0) + 1;
          
          if (user.gamification.totalAnswers === 1 && !user.gamification.badges.includes('First Answer')) {
            user.gamification.badges.push('First Answer');
            newBadges.push('First Answer');
          }
          if (user.gamification.totalAnswers === 10 && !user.gamification.badges.includes('Helpful Tutor')) {
            user.gamification.badges.push('Helpful Tutor');
            newBadges.push('Helpful Tutor');
          }
          if (user.gamification.totalAnswers === 50 && !user.gamification.badges.includes('Expert Tutor')) {
            user.gamification.badges.push('Expert Tutor');
            newBadges.push('Expert Tutor');
          }
          if (user.gamification.totalAnswers === 100 && !user.gamification.badges.includes('Master Tutor')) {
            user.gamification.badges.push('Master Tutor');
            newBadges.push('Master Tutor');
          }
          break;

        case 'TUTORING_SESSION':
          user.gamification.totalSessions = (user.gamification.totalSessions || 0) + 1;
          
          if (user.gamification.totalSessions === 1 && !user.gamification.badges.includes('Session Starter')) {
            user.gamification.badges.push('Session Starter');
            newBadges.push('Session Starter');
          }
          if (user.gamification.totalSessions === 10 && !user.gamification.badges.includes('Dedicated Mentor')) {
            user.gamification.badges.push('Dedicated Mentor');
            newBadges.push('Dedicated Mentor');
          }
          if (user.gamification.totalSessions === 25 && !user.gamification.badges.includes('Elite Mentor')) {
            user.gamification.badges.push('Elite Mentor');
            newBadges.push('Elite Mentor');
          }
          break;

        case 'ENDORSEMENT_RECEIVED':
          user.gamification.endorsementsReceived = (user.gamification.endorsementsReceived || 0) + 1;
          
          if (user.gamification.endorsementsReceived === 5 && !user.gamification.badges.includes('Community Favorite')) {
            user.gamification.badges.push('Community Favorite');
            newBadges.push('Community Favorite');
          }
          break;

        case 'POST_QUESTION':
          user.gamification.totalPosts = (user.gamification.totalPosts || 0) + 1;
          break;
      }

      return newBadges;
    } catch (error) {
      logger.error('Error checking action badges:', error);
      return [];
    }
  }

  // Create endorsement between alumni
  async createEndorsement(endorserId, endorseeId, message = '') {
    try {
      // Validate users
      const [endorser, endorsee] = await Promise.all([
        User.findById(endorserId),
        User.findById(endorseeId)
      ]);

      if (!endorser || !endorsee) {
        throw new Error('User not found');
      }

      if (endorser.role !== 'ALUMNI' || endorsee.role !== 'ALUMNI') {
        throw new Error('Only alumni can endorse other alumni');
      }

      if (endorserId === endorseeId) {
        throw new Error('Cannot endorse yourself');
      }

      // Check for existing endorsement
      const existingEndorsement = await Endorsement.findOne({
        endorserId,
        endorseeId
      });

      if (existingEndorsement) {
        throw new Error('You have already endorsed this alumni');
      }

      // Create endorsement
      const endorsement = new Endorsement({
        endorserId,
        endorseeId,
        message: message.trim()
      });

      await endorsement.save();

      // Award XP to endorsee
      const xpResult = await this.awardXP(
        endorseeId, 
        'ENDORSEMENT_RECEIVED', 
        null, 
        { 
          endorserId,
          endorsementId: endorsement._id,
          idempotencyKey: `endorsement_${endorserId}_${endorseeId}`
        }
      );

      logger.info(`Endorsement created: ${endorserId} -> ${endorseeId}`);

      return {
        success: true,
        endorsement,
        xpAwarded: xpResult.xpAwarded,
        levelUp: xpResult.levelUp,
        newBadges: xpResult.newBadges
      };

    } catch (error) {
      logger.error('Failed to create endorsement:', error);
      throw error;
    }
  }

  // Get user's gamification stats
  async getUserStats(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const nextLevelInfo = this.getXPForNextLevel(user.gamification.currentXP);
      
      // Get recent transactions
      const recentTransactions = await PointTransaction.find({ userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('actionType pointsAwarded createdAt metadata');

      // Get endorsements received
      const endorsements = await Endorsement.find({ endorseeId: userId })
        .populate('endorserId', 'profile.firstName profile.lastName profile.displayName')
        .sort({ createdAt: -1 })
        .limit(5);

      return {
        currentXP: user.gamification.currentXP,
        level: user.gamification.level,
        badges: user.gamification.badges,
        totalAnswers: user.gamification.totalAnswers || 0,
        totalSessions: user.gamification.totalSessions || 0,
        totalPosts: user.gamification.totalPosts || 0,
        endorsementsReceived: user.gamification.endorsementsReceived || 0,
        endorsementsGiven: user.gamification.endorsementsGiven || 0,
        nextLevel: nextLevelInfo,
        recentTransactions,
        recentEndorsements: endorsements
      };

    } catch (error) {
      logger.error('Failed to get user stats:', error);
      throw error;
    }
  }

  // Get leaderboard
  async getLeaderboard(role = null, timeframe = 'all', limit = 50) {
    try {
      const matchQuery = { isActive: true };
      if (role) {
        matchQuery.role = role;
      }

      let dateFilter = {};
      if (timeframe === 'week') {
        dateFilter = { createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } };
      } else if (timeframe === 'month') {
        dateFilter = { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } };
      }

      const leaderboard = await User.aggregate([
        { $match: matchQuery },
        {
          $project: {
            profile: 1,
            role: 1,
            currentXP: '$gamification.currentXP',
            level: '$gamification.level',
            badges: '$gamification.badges',
            totalAnswers: '$gamification.totalAnswers',
            totalSessions: '$gamification.totalSessions',
            endorsementsReceived: '$gamification.endorsementsReceived'
          }
        },
        { $sort: { currentXP: -1, level: -1 } },
        { $limit: limit }
      ]);

      return leaderboard;

    } catch (error) {
      logger.error('Failed to get leaderboard:', error);
      throw error;
    }
  }

  // Get platform gamification analytics
  async getAnalytics(timeframe = 'month') {
    try {
      let dateFilter = {};
      if (timeframe === 'week') {
        dateFilter = { createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } };
      } else if (timeframe === 'month') {
        dateFilter = { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } };
      }

      const [transactionStats, userStats, endorsementStats] = await Promise.all([
        PointTransaction.aggregate([
          { $match: dateFilter },
          {
            $group: {
              _id: '$actionType',
              count: { $sum: 1 },
              totalXP: { $sum: '$pointsAwarded' }
            }
          }
        ]),
        User.aggregate([
          { $match: { isActive: true } },
          {
            $group: {
              _id: '$role',
              count: { $sum: 1 },
              avgXP: { $avg: '$gamification.currentXP' },
              avgLevel: { $avg: '$gamification.level' }
            }
          }
        ]),
        Endorsement.aggregate([
          { $match: dateFilter },
          {
            $group: {
              _id: null,
              totalEndorsements: { $sum: 1 }
            }
          }
        ])
      ]);

      return {
        transactionStats,
        userStats,
        endorsementStats: endorsementStats[0] || { totalEndorsements: 0 },
        timeframe
      };

    } catch (error) {
      logger.error('Failed to get gamification analytics:', error);
      throw error;
    }
  }
}

module.exports = new GamificationService();