/**
 * Seed Test Users Script
 * Creates test users for demo/testing purposes
 * Run with: node seed-test-users.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI;

// User schema (simplified for seeding)
const userSchema = new mongoose.Schema({
  email: String,
  password: String,
  role: String,
  profile: {
    firstName: String,
    lastName: String,
    displayName: String,
    avatar: String,
    bio: String
  },
  tutorStatus: String,
  verification: {
    track: String,
    subcategory: String,
    status: String
  },
  gamification: {
    currentXP: Number,
    level: Number,
    badges: [String],
    totalSessions: Number,
    totalAnswers: Number,
    totalPosts: Number
  },
  isActive: Boolean,
  emailVerified: Boolean
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

async function seedTestUsers() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Hash password "1234" 
    const hashedPassword = await bcrypt.hash('1234', 12);
    console.log('🔐 Password hashed');

    const testUsers = [
      {
        email: 'student@test.com',
        password: hashedPassword,
        role: 'STUDENT',
        profile: {
          firstName: 'Test',
          lastName: 'Student',
          displayName: 'Test Student',
          avatar: '',
          bio: 'I am a test student account'
        },
        gamification: {
          currentXP: 150,
          level: 2,
          badges: ['First Login', 'Level 2'],
          totalSessions: 3,
          totalAnswers: 0,
          totalPosts: 5
        },
        isActive: true,
        emailVerified: true
      },
      {
        email: 'alumni@test.com',
        password: hashedPassword,
        role: 'ALUMNI',
        profile: {
          firstName: 'Test',
          lastName: 'Alumni',
          displayName: 'Test Alumni',
          avatar: '',
          bio: 'I am a test alumni/tutor account'
        },
        tutorStatus: 'APPROVED',
        verification: {
          track: 'SOFTWARE_ENGINEERING',
          subcategory: 'Full Stack Development',
          status: 'APPROVED'
        },
        gamification: {
          currentXP: 500,
          level: 3,
          badges: ['First Login', 'Level 3', 'Verified Alumni', 'Helpful Tutor'],
          totalSessions: 10,
          totalAnswers: 25,
          totalPosts: 15
        },
        isActive: true,
        emailVerified: true
      },
      {
        email: 'admin@test.com',
        password: hashedPassword,
        role: 'ADMIN',
        profile: {
          firstName: 'Test',
          lastName: 'Admin',
          displayName: 'Test Admin',
          avatar: '',
          bio: 'I am a test admin account'
        },
        gamification: {
          currentXP: 1000,
          level: 4,
          badges: ['First Login', 'Level 4', 'Administrator'],
          totalSessions: 0,
          totalAnswers: 0,
          totalPosts: 0
        },
        isActive: true,
        emailVerified: true
      }
    ];

    for (const userData of testUsers) {
      // Check if user already exists
      const existing = await User.findOne({ email: userData.email });
      
      if (existing) {
        // Update existing user with new password
        await User.updateOne(
          { email: userData.email },
          { $set: { password: hashedPassword } }
        );
        console.log(`🔄 Updated: ${userData.email}`);
      } else {
        // Create new user
        await User.create(userData);
        console.log(`✨ Created: ${userData.email}`);
      }
    }

    console.log('\n========================================');
    console.log('🎉 Test users ready!');
    console.log('========================================');
    console.log('Login credentials (password: 1234):');
    console.log('  📚 Student: student@test.com');
    console.log('  🎓 Alumni:  alumni@test.com');
    console.log('  👑 Admin:   admin@test.com');
    console.log('========================================\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('📤 Disconnected from MongoDB');
    process.exit(0);
  }
}

seedTestUsers();
