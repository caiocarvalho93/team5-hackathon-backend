const mongoose = require('mongoose');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/app.log' })
  ]
});

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    logger.info(`MongoDB Connected: ${conn.connection.host}`);
    
    // Create indexes for performance and uniqueness
    await createIndexes();
    
    return conn;
  } catch (error) {
    logger.error('Database connection failed:', error);
    process.exit(1);
  }
};

const createIndexes = async () => {
  try {
    const db = mongoose.connection.db;
    
    // User indexes
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ googleId: 1 }, { sparse: true });
    await db.collection('users').createIndex({ role: 1 });
    
    // Booking indexes for conflict prevention
    await db.collection('bookings').createIndex(
      { tutorId: 1, startDateTime: 1 }, 
      { unique: true }
    );
    
    // Point transaction indexes for idempotency
    await db.collection('pointtransactions').createIndex(
      { idempotencyKey: 1 }, 
      { unique: true }
    );
    
    // Endorsement indexes for uniqueness
    await db.collection('endorsements').createIndex(
      { endorserId: 1, targetId: 1 }, 
      { unique: true }
    );
    
    // Post indexes for performance
    await db.collection('posts').createIndex({ feedType: 1, track: 1 });
    await db.collection('posts').createIndex({ authorId: 1 });
    await db.collection('posts').createIndex({ createdAt: -1 });
    
    logger.info('Database indexes created successfully');
  } catch (error) {
    logger.error('Index creation failed:', error);
  }
};

module.exports = { connectDB, logger };