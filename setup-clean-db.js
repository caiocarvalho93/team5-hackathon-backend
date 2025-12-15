require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./src/models/User');

async function setupCleanDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Delete ALL data
    await mongoose.connection.db.dropDatabase();
    console.log('🧹 Database completely wiped clean');
    
    // Reconnect after drop
    await mongoose.disconnect();
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Create only 4 admin accounts
    const adminPassword = await bcrypt.hash('admin123!', 12);
    
    const admins = [
      {
        email: 'caitrippie@admin.com',
        password: adminPassword,
        role: 'ADMIN',
        profile: {
          firstName: 'Cai',
          lastName: 'Trippie',
          displayName: 'Cai Trippie'
        },
        isActive: true,
        emailVerified: true
      },
      {
        email: 'chahinez@admin.com', 
        password: adminPassword,
        role: 'ADMIN',
        profile: {
          firstName: 'Chahinez',
          lastName: 'Admin',
          displayName: 'Chahinez'
        },
        isActive: true,
        emailVerified: true
      },
      {
        email: 'uliana@admin.com',
        password: adminPassword,
        role: 'ADMIN', 
        profile: {
          firstName: 'Uliana',
          lastName: 'Admin',
          displayName: 'Uliana'
        },
        isActive: true,
        emailVerified: true
      },
      {
        email: 'addy@admin.com',
        password: adminPassword,
        role: 'ADMIN',
        profile: {
          firstName: 'Addy', 
          lastName: 'Admin',
          displayName: 'Addy'
        },
        isActive: true,
        emailVerified: true
      }
    ];
    
    for (const adminData of admins) {
      const admin = new User(adminData);
      await admin.save();
      console.log(`✅ Created: ${adminData.email}`);
    }
    
    console.log('\n🎯 CLEAN DATABASE READY!');
    console.log('📊 Total users: 4 (all admins)');
    console.log('🔑 Password for all: admin123!');
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

setupCleanDB();