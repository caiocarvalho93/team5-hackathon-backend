/**
 * Seed script for Struggle Detection Demo
 * Run: node seed-struggle-demo.js
 * 
 * This creates test data to demonstrate the AI Struggle Detector feature:
 * 1. Links the test tutor to the test student in care network
 * 2. Creates struggle signals for the student
 * 3. Creates a struggle profile with HIGH support level
 * 4. Creates a tutor alert
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function seedStruggleDemo() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Import models
    const User = require('./src/models/User');
    const TutorCareNetwork = require('./src/models/TutorCareNetwork');
    const StruggleSignal = require('./src/models/StruggleSignal');
    const StruggleProfile = require('./src/models/StruggleProfile');
    const TutorAlert = require('./src/models/TutorAlert');
    const AIInteraction = require('./src/models/AIInteraction');

    // Find test users
    const student = await User.findOne({ email: 'student@test.com' });
    const tutor = await User.findOne({ email: 'alumni@test.com' });

    if (!student || !tutor) {
      console.log('❌ Test users not found. Run seed-test-users.js first.');
      process.exit(1);
    }

    console.log(`📚 Student: ${student.profile.firstName} (${student._id})`);
    console.log(`🎓 Tutor: ${tutor.profile.firstName} (${tutor._id})`);

    // 1. Link tutor to student in care network
    await TutorCareNetwork.findOneAndUpdate(
      { studentId: student._id },
      { 
        $addToSet: { tutorIds: tutor._id },
        $set: { lastInteractionAt: new Date() }
      },
      { upsert: true, new: true }
    );
    console.log('✅ Care network link created');

    // 2. Create a fake AI interaction for the student
    const interaction = await AIInteraction.create({
      userId: student._id,
      role: 'STUDENT',
      toolType: 'STUDENT_MAMBA_HELP',
      track: 'SOFTWARE_ENGINEERING',
      inputText: 'I am so confused about recursion, I keep getting stuck and frustrated',
      output: {
        structured: { coachMessage: 'Test response' },
        userResponse: 'Test response',
        rawResponse: '{}'
      },
      analytics: {
        topicOneLine: 'recursion & loops',
        keywords: ['recursion', 'loops', 'functions'],
        confidenceScore: 0.8
      },
      costMeta: {
        processingTime: 5000,
        model: 'gpt-4'
      },
      status: 'SUCCESS',
      requestId: `demo_${Date.now()}`
    });
    console.log('✅ AI Interaction created');

    // 3. Create struggle signals
    const signalTypes = [
      { type: 'REPEATED_TOPIC', value: 0.8 },
      { type: 'NEGATIVE_SENTIMENT', value: 0.7 },
      { type: 'LONG_RESPONSE_TIME', value: 0.6 }
    ];

    for (const signal of signalTypes) {
      try {
        await StruggleSignal.create({
          userId: student._id,
          interactionId: interaction._id,
          track: 'SOFTWARE_ENGINEERING',
          topic: 'recursion & loops',
          signalType: signal.type,
          value: signal.value,
          meta: { windowHours: 24, raw: { demo: true } }
        });
        console.log(`✅ Signal created: ${signal.type}`);
      } catch (err) {
        if (err.code === 11000) {
          console.log(`⏭️ Signal exists: ${signal.type}`);
        } else {
          throw err;
        }
      }
    }

    // 4. Create/update struggle profile
    await StruggleProfile.findOneAndUpdate(
      { userId: student._id },
      {
        track: 'SOFTWARE_ENGINEERING',
        cohortId: 'default',
        struggleScore: 8.5,
        trend: 'UP',
        supportLevel: 'HIGH',
        lastEvaluatedAt: new Date(),
        contributingSignals: [
          { signalType: 'REPEATED_TOPIC', weight: 0.25, value: 0.8 },
          { signalType: 'NEGATIVE_SENTIMENT', weight: 0.15, value: 0.7 }
        ],
        lastReasonSummary: 'repeated topic & negative sentiment'
      },
      { upsert: true, new: true }
    );
    console.log('✅ Struggle profile created (score: 8.5, level: HIGH)');

    // 5. Create tutor alert
    await TutorAlert.create({
      tutorId: tutor._id,
      studentId: student._id,
      urgency: 'URGENT',
      topic: 'recursion & loops',
      struggleScore: 8.5,
      reasonSummary: 'A learner you helped before may benefit from support with recursion.',
      isRead: false
    });
    console.log('✅ Tutor alert created');

    console.log('\n🎉 Demo data seeded successfully!');
    console.log('\n📋 To test:');
    console.log('   1. Login as tutor (alumni@test.com / 1234)');
    console.log('   2. Check the Support Queue panel on Tutor Dashboard');
    console.log('   3. Login as admin (admin@test.com / 1234)');
    console.log('   4. Check the Learner Support Heatmap on Admin Dashboard');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

seedStruggleDemo();
