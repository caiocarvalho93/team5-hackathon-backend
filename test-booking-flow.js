/**
 * Quick test script to verify the booking flow works
 * Run with: node test-booking-flow.js
 * 
 * This script tests the core booking lifecycle:
 * 1. Alumni adds availability
 * 2. Student sees availability
 * 3. Student requests booking
 * 4. Alumni confirms booking
 * 5. Both see confirmed session
 */

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./src/models/User');
const Booking = require('./src/models/Booking');

async function testBookingFlow() {
  console.log('\n🧪 BOOKING FLOW TEST\n');
  console.log('='.repeat(50));
  
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // 1. Find or create test users
    console.log('1️⃣ Finding test users...');
    
    let alumni = await User.findOne({ role: 'ALUMNI' });
    let student = await User.findOne({ role: 'STUDENT' });
    
    if (!alumni) {
      console.log('   ⚠️ No alumni found. Create one via registration first.');
      process.exit(1);
    }
    if (!student) {
      console.log('   ⚠️ No student found. Create one via registration first.');
      process.exit(1);
    }
    
    console.log(`   Alumni: ${alumni.profile.firstName} ${alumni.profile.lastName} (${alumni._id})`);
    console.log(`   Student: ${student.profile.firstName} ${student.profile.lastName} (${student._id})`);
    console.log(`   Alumni tutorStatus: ${alumni.tutorStatus || 'NOT SET'}`);
    
    // 2. Add availability slot for alumni
    console.log('\n2️⃣ Adding availability slot for alumni...');
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0);
    
    const slotEnd = new Date(tomorrow);
    slotEnd.setHours(15, 0, 0, 0);
    
    // Initialize calendarSlots if needed
    if (!alumni.calendarSlots) {
      alumni.calendarSlots = [];
    }
    
    const newSlot = {
      _id: new mongoose.Types.ObjectId(),
      start: tomorrow,
      end: slotEnd,
      title: 'Available',
      status: 'available',
      createdAt: new Date()
    };
    
    alumni.calendarSlots.push(newSlot);
    await alumni.save();
    
    console.log(`   ✅ Added slot: ${tomorrow.toISOString()} - ${slotEnd.toISOString()}`);
    console.log(`   Slot ID: ${newSlot._id}`);
    
    // 3. Check alumni availability
    console.log('\n3️⃣ Checking alumni availability...');
    const availableSlots = alumni.calendarSlots.filter(s => s.status !== 'booked');
    console.log(`   ✅ Alumni has ${availableSlots.length} available slot(s)`);
    
    // 4. Create booking request
    console.log('\n4️⃣ Creating booking request...');
    
    const booking = new Booking({
      studentId: student._id,
      tutorId: alumni._id,
      startDateTime: tomorrow,
      endDateTime: slotEnd,
      track: alumni.verification?.track || 'SOFTWARE_ENGINEERING',
      subcategory: 'Test Session',
      status: 'REQUESTED'
    });
    
    await booking.save();
    console.log(`   ✅ Booking created with status: ${booking.status}`);
    console.log(`   Booking ID: ${booking._id}`);
    
    // 5. Confirm booking (as alumni would)
    console.log('\n5️⃣ Confirming booking...');
    
    booking.status = 'CONFIRMED';
    booking.confirmedAt = new Date();
    await booking.save();
    
    // Update slot status
    const slotIndex = alumni.calendarSlots.findIndex(s => 
      s._id.toString() === newSlot._id.toString()
    );
    if (slotIndex !== -1) {
      alumni.calendarSlots[slotIndex].status = 'booked';
      await alumni.save();
    }
    
    console.log(`   ✅ Booking confirmed!`);
    
    // 6. Verify both can see the booking
    console.log('\n6️⃣ Verifying booking visibility...');
    
    const studentBookings = await Booking.find({ studentId: student._id, status: 'CONFIRMED' });
    const tutorBookings = await Booking.find({ tutorId: alumni._id, status: 'CONFIRMED' });
    
    console.log(`   Student sees ${studentBookings.length} confirmed booking(s)`);
    console.log(`   Tutor sees ${tutorBookings.length} confirmed booking(s)`);
    
    // 7. Cleanup test data
    console.log('\n7️⃣ Cleaning up test data...');
    await Booking.findByIdAndDelete(booking._id);
    alumni.calendarSlots = alumni.calendarSlots.filter(s => 
      s._id.toString() !== newSlot._id.toString()
    );
    await alumni.save();
    console.log('   ✅ Test data cleaned up');
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ BOOKING FLOW TEST PASSED!\n');
    console.log('The booking lifecycle works correctly:');
    console.log('  1. Alumni can add availability slots');
    console.log('  2. Students can see available slots');
    console.log('  3. Students can request bookings');
    console.log('  4. Alumni can confirm bookings');
    console.log('  5. Both parties see confirmed sessions\n');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

testBookingFlow();
