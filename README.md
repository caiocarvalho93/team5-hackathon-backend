# PeerTrack+ Backend

Intelligence-Driven Mentorship Platform - Backend API

## Overview

PeerTrack+ is a comprehensive mentorship platform that converts human mentorship into measurable signal, trusted reputation, and curriculum intelligence. The backend provides a robust API with role-based authentication, AI integration, and sophisticated gamification systems.

## Features

### Core Functionality
- **Role-Based Authentication**: Students, Alumni, and Administrators with distinct permissions
- **AI Integration**: Dual AI systems for Alumni tutoring help and Student coaching
- **Gamification Engine**: XP-based progression with anti-spam protection
- **Booking System**: Calendar integration for tutoring sessions
- **Endorsement System**: Peer-to-peer recognition for Alumni
- **Feed Management**: Three distinct feeds (Q&A, Community, Alumni Professional)

### Technical Features
- **Production-Ready**: Comprehensive error handling, logging, and security
- **Scalable Architecture**: Clean separation of concerns with services pattern
- **Rate Limiting**: Dual-layer throttling (API + behavioral locks)
- **Data Integrity**: Ledger-based point transactions with idempotency
- **AI Safety**: Pre-filtering and structured outputs for AI interactions

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT with refresh tokens
- **AI Integration**: OpenAI GPT-4 with structured outputs
- **Security**: Helmet, CORS, XSS protection, rate limiting
- **Validation**: Zod for input validation
- **Logging**: Winston with Morgan
- **Testing**: Jest with Supertest and fast-check for property-based testing

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB 6+
- OpenAI API key

### Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Environment Setup**
   Copy `.env.example` to `.env` and configure:
   ```env
   PORT=5001
   NODE_ENV=development
   MONGODB_URI=mongodb://localhost:27017/peertrack-plus
   JWT_SECRET=your-super-secret-jwt-key-at-least-32-characters-long
   JWT_REFRESH_SECRET=your-super-secret-refresh-jwt-key-at-least-32-characters-long
   OPENAI_API_KEY=your-openai-api-key-here
   GOOGLE_CLIENT_ID=your-google-oauth-client-id
   GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
   SESSION_SECRET=your-session-secret-at-least-32-characters-long
   ```

3. **Start MongoDB**
   ```bash
   # Using MongoDB service
   brew services start mongodb/brew/mongodb-community
   # Or using Docker
   docker run -d -p 27017:27017 --name mongodb mongo:latest
   ```

4. **Seed Database**
   ```bash
   npm run seed
   ```

5. **Start Development Server**
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:5001`

## API Documentation

### Base URL
```
http://localhost:5001/api/v1
```

### Authentication Endpoints

#### Register
```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe",
  "role": "STUDENT|ALUMNI",
  "track": "SOFTWARE_ENGINEERING", // Required for Alumni
  "subcategory": "React" // Optional for SOFTWARE_ENGINEERING
}
```

#### Login
```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

#### Refresh Token
```http
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "your-refresh-token"
}
```

### AI Endpoints

#### Alumni AI Tutoring Help
```http
POST /ai/alumni-tutor-help
Authorization: Bearer <token>
Content-Type: application/json

{
  "questionText": "How do I implement authentication in React?",
  "track": "SOFTWARE_ENGINEERING",
  "subcategory": "React"
}
```

#### Student AI Mamba Helper
```http
POST /ai/student-mamba-help
Authorization: Bearer <token>
Content-Type: application/json

{
  "questionText": "I'm stuck on this JavaScript problem...",
  "track": "SOFTWARE_ENGINEERING"
}
```

## Database Schema

### User Model
```javascript
{
  email: String (unique),
  password: String (hashed),
  role: Enum ['ADMIN', 'ALUMNI', 'STUDENT'],
  profile: {
    firstName: String,
    lastName: String,
    displayName: String,
    avatar: String,
    bio: String
  },
  tutorStatus: Enum ['PENDING', 'APPROVED', 'REJECTED'], // Alumni only
  gamification: {
    currentXP: Number,
    level: Number,
    badges: [String]
  },
  // ... additional fields
}
```

### Post Model
```javascript
{
  authorId: ObjectId,
  feedType: Enum ['QNA', 'COMMUNITY', 'ALUMNI_PROFESSIONAL'],
  track: Enum ['SOFTWARE_ENGINEERING', 'CYBER_SECURITY', 'IT', 'AI', 'OTHER'],
  title: String,
  content: String,
  analytics: {
    views: Number,
    upvotes: Number,
    answers: Number
  }
  // ... additional fields
}
```

## Gamification System

### XP Rewards
- **Q&A Answer**: +10 XP (Alumni only, when approved)
- **Completed Session**: +100 XP (Alumni only)
- **Endorsement Received**: +50 XP (Alumni only)
- **Post Creation**: +5 XP (Students)

### Anti-Spam Protection
- Rate limiting: 1 post per hour for students
- Behavioral locks in MongoDB
- Quality scoring for answers
- Progressive penalties for violations

## AI Integration

### Alumni AI System
- Full educational assistance for tutors
- Dual-channel output: analytics + full answer
- Structured data extraction for curriculum intelligence
- Rate limit: 10 requests/hour per user

### Student AI System (Mamba Helper 🐍24)
- Coaching-only approach (no direct answers)
- 10-layer pre-filtering system
- Hint-based learning guidance
- Rate limit: 6 requests/hour per user

## Security Features

- **Authentication**: JWT with refresh token rotation
- **Authorization**: Role-based access control
- **Rate Limiting**: Global and endpoint-specific limits
- **Input Validation**: Zod schemas for all inputs
- **XSS Protection**: Input sanitization
- **CORS**: Configured for frontend domains
- **Helmet**: Security headers
- **MongoDB Sanitization**: NoSQL injection prevention

## Development

### Scripts
```bash
npm run dev      # Start development server with nodemon
npm start        # Start production server
npm run seed     # Seed database with demo data
npm test         # Run test suite
```

### Project Structure
```
src/
├── config/         # Database and environment configuration
├── models/         # Mongoose schemas
├── routes/         # Express route definitions
├── controllers/    # Route handlers (to be implemented)
├── services/       # Business logic services
├── middleware/     # Custom middleware (auth, validation, etc.)
├── utils/          # Utility functions
├── seed/           # Database seeding scripts
└── jobs/           # Background jobs (to be implemented)
```

### Testing
The project uses Jest for unit testing and fast-check for property-based testing:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run property-based tests
npm run test:properties
```

## Demo Accounts

After seeding, you can use these accounts:

### Admin Accounts
- **Email**: cai@peertrack.com | **Password**: admin123!
- **Email**: chahinez@peertrack.com | **Password**: admin123!
- **Email**: uliana@peertrack.com | **Password**: admin123!
- **Email**: addy@peertrack.com | **Password**: admin123!

### Demo Accounts
- **Alumni/Students**: Use any seeded account with password `demo123!`

## Production Deployment

### Environment Variables
Ensure all required environment variables are set:
- `MONGODB_URI`: Production MongoDB connection string
- `JWT_SECRET`: Strong secret for JWT signing
- `OPENAI_API_KEY`: OpenAI API key for AI features
- `NODE_ENV=production`

### Security Checklist
- [ ] Use strong, unique secrets for JWT
- [ ] Enable MongoDB authentication
- [ ] Configure CORS for production domains
- [ ] Set up proper logging and monitoring
- [ ] Enable rate limiting
- [ ] Use HTTPS in production

## API Rate Limits

- **Global**: 1000 requests per 15 minutes per IP
- **Authentication**: 5 attempts per 15 minutes per IP
- **AI Endpoints**: 10 requests per hour per user (Alumni), 6 per hour (Students)
- **Posts**: 1 post per hour per user
- **Bookings**: 1 booking per week per student

## Contributing

1. Follow the existing code style and patterns
2. Add tests for new features
3. Update documentation for API changes
4. Ensure all tests pass before submitting

## License

MIT License - Built for Per Scholas by Team 5

## Support

For issues and questions:
1. Check the API documentation above
2. Review the error messages in the response
3. Check the server logs for detailed error information
4. Ensure all environment variables are properly configured