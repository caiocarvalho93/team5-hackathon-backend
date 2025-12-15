const mongoose = require('mongoose');
const KnowledgePattern = require('../models/KnowledgePattern');

/**
 * Seed Knowledge Patterns
 * 
 * These are pre-built solutions for common issues students face.
 * The system will learn and add more patterns automatically from interactions.
 */

const knowledgePatterns = [
  // ============================================================================
  // DEPLOYMENT / CONFIG ISSUES (DIRECT ANSWERS - bypassHintsOnly: true)
  // ============================================================================
  {
    patternId: 'deploy_heroku_h10',
    patternType: 'ERROR_SOLUTION',
    track: 'SOFTWARE_ENGINEERING',
    subcategories: ['deployment', 'heroku'],
    difficulty: 'INTERMEDIATE',
    title: 'Heroku H10 App Crashed Error',
    description: 'Application crashes on Heroku with H10 error code',
    triggerPatterns: [
      { pattern: 'h10|heroku.*crash|app crashed', weight: 1.0, examples: ['My Heroku app shows H10 error', 'App crashed on Heroku'] }
    ],
    keywords: [
      { word: 'heroku', weight: 1.0, synonyms: [] },
      { word: 'h10', weight: 1.0, synonyms: ['crash', 'crashed'] },
      { word: 'deployment', weight: 0.8, synonyms: ['deploy'] }
    ],
    solution: {
      directAnswer: `H10 errors on Heroku usually mean your app crashed during startup. Here's how to fix it:

1. **Check your logs**: Run \`heroku logs --tail\` to see the actual error
2. **Verify PORT**: Your app MUST use \`process.env.PORT\` - Heroku assigns this dynamically
3. **Check Procfile**: Make sure you have a Procfile with \`web: node server.js\` (or your entry file)
4. **Verify start script**: Your package.json needs \`"start": "node server.js"\`
5. **Check dependencies**: Run \`heroku run npm install\` to ensure all deps are installed

Most common fix:
\`\`\`javascript
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));
\`\`\``,
      steps: [
        { order: 1, instruction: 'Run heroku logs --tail to see the actual error', codeExample: 'heroku logs --tail' },
        { order: 2, instruction: 'Check that your app uses process.env.PORT', codeExample: 'const PORT = process.env.PORT || 3000;' },
        { order: 3, instruction: 'Verify your Procfile exists and is correct', codeExample: 'web: node server.js' },
        { order: 4, instruction: 'Restart the app', codeExample: 'heroku restart' }
      ],
      codeExamples: [
        { language: 'javascript', code: 'const PORT = process.env.PORT || 3000;\napp.listen(PORT);', explanation: 'Correct PORT configuration', isCorrect: true },
        { language: 'javascript', code: 'app.listen(3000);', explanation: 'WRONG - hardcoded port will fail on Heroku', isCorrect: false }
      ]
    },
    responseConfig: { bypassHintsOnly: true, urgencyLevel: 'HIGH' },
    quality: { accuracy: 95, completeness: 90, clarity: 90 },
    status: 'ACTIVE'
  },
  
  {
    patternId: 'error_cors_blocked',
    patternType: 'ERROR_SOLUTION',
    track: 'SOFTWARE_ENGINEERING',
    subcategories: ['cors', 'api', 'security'],
    difficulty: 'INTERMEDIATE',
    title: 'CORS Error - Blocked by CORS Policy',
    description: 'Request blocked by CORS policy when calling API',
    triggerPatterns: [
      { pattern: 'cors|blocked by cors|access-control-allow-origin', weight: 1.0, examples: ['CORS error in browser', 'blocked by CORS policy'] }
    ],
    keywords: [
      { word: 'cors', weight: 1.0, synonyms: ['cross-origin'] },
      { word: 'blocked', weight: 0.8, synonyms: ['error', 'failed'] },
      { word: 'api', weight: 0.7, synonyms: ['fetch', 'axios'] }
    ],
    solution: {
      directAnswer: `CORS errors happen when your frontend tries to call a backend on a different origin. Here's the fix:

**Backend (Express):**
\`\`\`javascript
const cors = require('cors');

// Option 1: Allow all origins (development only!)
app.use(cors());

// Option 2: Allow specific origins (production)
app.use(cors({
  origin: ['http://localhost:3000', 'https://yourapp.com'],
  credentials: true
}));
\`\`\`

**Install cors:** \`npm install cors\`

**If you don't control the backend:** Use a proxy in your frontend's package.json:
\`\`\`json
"proxy": "http://localhost:5000"
\`\`\``,
      steps: [
        { order: 1, instruction: 'Install cors package', codeExample: 'npm install cors' },
        { order: 2, instruction: 'Import and use cors middleware', codeExample: "const cors = require('cors');\napp.use(cors());" },
        { order: 3, instruction: 'Configure allowed origins for production', codeExample: "app.use(cors({ origin: 'https://yourapp.com' }));" }
      ]
    },
    responseConfig: { bypassHintsOnly: true, urgencyLevel: 'HIGH' },
    quality: { accuracy: 95, completeness: 95, clarity: 90 },
    status: 'ACTIVE'
  },

  {
    patternId: 'error_module_not_found',
    patternType: 'ERROR_SOLUTION',
    track: 'SOFTWARE_ENGINEERING',
    subcategories: ['npm', 'node', 'modules'],
    difficulty: 'BEGINNER',
    title: 'Cannot Find Module / Module Not Found',
    description: 'Node.js cannot find a required module',
    triggerPatterns: [
      { pattern: 'cannot find module|module not found|error: cannot find', weight: 1.0, examples: ['Cannot find module express', 'Module not found'] }
    ],
    keywords: [
      { word: 'module', weight: 1.0, synonyms: ['package'] },
      { word: 'cannot find', weight: 1.0, synonyms: ['not found'] },
      { word: 'npm', weight: 0.8, synonyms: ['yarn', 'install'] }
    ],
    solution: {
      directAnswer: `"Cannot find module" means Node can't locate a package. Here's how to fix it:

1. **Install the missing package:**
   \`\`\`bash
   npm install <package-name>
   \`\`\`

2. **If it's already in package.json but not installed:**
   \`\`\`bash
   rm -rf node_modules package-lock.json
   npm install
   \`\`\`

3. **Check your import path:**
   - Local file: \`require('./myFile')\` (note the ./)
   - npm package: \`require('express')\` (no ./)

4. **Check for typos** in the module name

5. **If using ES modules**, make sure you have \`"type": "module"\` in package.json`,
      steps: [
        { order: 1, instruction: 'Try installing the package', codeExample: 'npm install <package-name>' },
        { order: 2, instruction: 'If that fails, clean install', codeExample: 'rm -rf node_modules && npm install' },
        { order: 3, instruction: 'Check your require/import path for typos' }
      ]
    },
    responseConfig: { bypassHintsOnly: true, urgencyLevel: 'MEDIUM' },
    quality: { accuracy: 90, completeness: 85, clarity: 95 },
    status: 'ACTIVE'
  },

  {
    patternId: 'error_port_in_use',
    patternType: 'ERROR_SOLUTION',
    track: 'SOFTWARE_ENGINEERING',
    subcategories: ['node', 'server', 'port'],
    difficulty: 'BEGINNER',
    title: 'EADDRINUSE - Port Already in Use',
    description: 'Server cannot start because port is already in use',
    triggerPatterns: [
      { pattern: 'eaddrinuse|port.*in use|address already in use', weight: 1.0, examples: ['EADDRINUSE error', 'Port 3000 already in use'] }
    ],
    keywords: [
      { word: 'port', weight: 1.0, synonyms: ['eaddrinuse'] },
      { word: 'in use', weight: 1.0, synonyms: ['already', 'busy'] }
    ],
    solution: {
      directAnswer: `Port is already being used by another process. Here's how to fix it:

**Option 1: Kill the process using the port**
\`\`\`bash
# Mac/Linux - find and kill process on port 3000
lsof -i :3000
kill -9 <PID>

# Or one-liner:
kill -9 $(lsof -t -i:3000)

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
\`\`\`

**Option 2: Use a different port**
\`\`\`javascript
const PORT = process.env.PORT || 3001; // Try 3001 instead
\`\`\`

**Option 3: Find what's using the port**
\`\`\`bash
# Mac/Linux
lsof -i :3000

# Windows  
netstat -ano | findstr :3000
\`\`\``,
      steps: [
        { order: 1, instruction: 'Find the process using the port', codeExample: 'lsof -i :3000' },
        { order: 2, instruction: 'Kill the process', codeExample: 'kill -9 <PID>' },
        { order: 3, instruction: 'Or use a different port in your app' }
      ]
    },
    responseConfig: { bypassHintsOnly: true, urgencyLevel: 'MEDIUM' },
    quality: { accuracy: 95, completeness: 90, clarity: 90 },
    status: 'ACTIVE'
  },

  {
    patternId: 'error_env_undefined',
    patternType: 'ERROR_SOLUTION',
    track: 'SOFTWARE_ENGINEERING',
    subcategories: ['env', 'dotenv', 'config'],
    difficulty: 'BEGINNER',
    title: 'Environment Variables Undefined',
    description: 'process.env variables are undefined',
    triggerPatterns: [
      { pattern: 'env.*undefined|process\\.env|dotenv|environment variable', weight: 1.0, examples: ['process.env.API_KEY is undefined', 'env variables not working'] }
    ],
    keywords: [
      { word: 'env', weight: 1.0, synonyms: ['environment', 'dotenv'] },
      { word: 'undefined', weight: 1.0, synonyms: ['not working', 'empty'] }
    ],
    solution: {
      directAnswer: `Environment variables showing as undefined? Here's the fix:

1. **Install dotenv:**
   \`\`\`bash
   npm install dotenv
   \`\`\`

2. **Load it at the TOP of your entry file (server.js):**
   \`\`\`javascript
   require('dotenv').config(); // MUST be first line!
   
   // Now you can use process.env
   console.log(process.env.MY_VAR);
   \`\`\`

3. **Create a .env file** in your project root:
   \`\`\`
   DATABASE_URL=mongodb://localhost/mydb
   API_KEY=your-secret-key
   PORT=3000
   \`\`\`

4. **Common mistakes:**
   - .env file not in root directory
   - Spaces around = (wrong: \`KEY = value\`)
   - Quotes not needed (wrong: \`KEY="value"\`)
   - dotenv.config() called AFTER using env vars
   - .env added to .gitignore (good!) but not created locally`,
      steps: [
        { order: 1, instruction: 'Install dotenv', codeExample: 'npm install dotenv' },
        { order: 2, instruction: 'Add to top of entry file', codeExample: "require('dotenv').config();" },
        { order: 3, instruction: 'Create .env file in project root' },
        { order: 4, instruction: 'Add your variables without spaces around =' }
      ]
    },
    responseConfig: { bypassHintsOnly: true, urgencyLevel: 'MEDIUM' },
    quality: { accuracy: 95, completeness: 95, clarity: 95 },
    status: 'ACTIVE'
  },

  // ============================================================================
  // LEARNING CONCEPTS (GUIDED HINTS - bypassHintsOnly: false)
  // ============================================================================
  {
    patternId: 'concept_async_await',
    patternType: 'CONCEPT_EXPLANATION',
    track: 'SOFTWARE_ENGINEERING',
    subcategories: ['javascript', 'async', 'promises'],
    difficulty: 'INTERMEDIATE',
    title: 'Understanding Async/Await',
    description: 'How async/await works in JavaScript',
    triggerPatterns: [
      { pattern: 'async.*await|how.*async|understand.*promise', weight: 1.0, examples: ['How does async await work?', 'Explain async/await'] }
    ],
    keywords: [
      { word: 'async', weight: 1.0, synonyms: ['asynchronous'] },
      { word: 'await', weight: 1.0, synonyms: [] },
      { word: 'promise', weight: 0.8, synonyms: ['then', 'catch'] }
    ],
    solution: {
      guidedHints: [
        'Think of async/await as a way to write asynchronous code that LOOKS synchronous',
        'async functions always return a Promise - what does that mean for the caller?',
        'await pauses execution until the Promise resolves - but only inside an async function',
        'Try writing a simple function that fetches data - first with .then(), then convert it to async/await'
      ],
      steps: [
        { order: 1, instruction: 'Start by understanding what a Promise is', explanation: 'A Promise is a placeholder for a future value' },
        { order: 2, instruction: 'Write a function using .then() chains', explanation: 'This is the "old" way of handling async' },
        { order: 3, instruction: 'Convert it to async/await', explanation: 'Replace .then() with await, wrap in async function' },
        { order: 4, instruction: 'Add error handling with try/catch', explanation: 'This replaces .catch()' }
      ]
    },
    responseConfig: { bypassHintsOnly: false, urgencyLevel: 'LOW' },
    quality: { accuracy: 90, completeness: 85, clarity: 90 },
    status: 'ACTIVE'
  },

  {
    patternId: 'concept_react_usestate',
    patternType: 'CONCEPT_EXPLANATION',
    track: 'SOFTWARE_ENGINEERING',
    subcategories: ['react', 'hooks', 'state'],
    difficulty: 'BEGINNER',
    title: 'React useState Hook',
    description: 'Understanding state management with useState',
    triggerPatterns: [
      { pattern: 'usestate|react.*state|how.*state.*work', weight: 1.0, examples: ['How does useState work?', 'Explain React state'] }
    ],
    keywords: [
      { word: 'useState', weight: 1.0, synonyms: ['state'] },
      { word: 'react', weight: 0.9, synonyms: [] },
      { word: 'hook', weight: 0.8, synonyms: ['hooks'] }
    ],
    solution: {
      guidedHints: [
        'State is like a component\'s memory - what happens when you want to remember something between renders?',
        'useState returns an array with two items - what are they and why?',
        'Why can\'t you just use a regular variable instead of state?',
        'What happens to the component when you call the setter function?'
      ],
      steps: [
        { order: 1, instruction: 'Create a simple counter component', explanation: 'Start with the most basic state example' },
        { order: 2, instruction: 'Try using a regular variable instead of useState', explanation: 'Notice what happens when you click - why doesn\'t it update?' },
        { order: 3, instruction: 'Now use useState and compare', explanation: 'The component re-renders when state changes' },
        { order: 4, instruction: 'Experiment with different initial values', explanation: 'useState can hold any type: number, string, array, object' }
      ]
    },
    responseConfig: { bypassHintsOnly: false, urgencyLevel: 'LOW' },
    quality: { accuracy: 90, completeness: 85, clarity: 95 },
    status: 'ACTIVE'
  }
];

async function seedKnowledgePatterns() {
  try {
    console.log('🧠 Seeding knowledge patterns...');
    
    for (const pattern of knowledgePatterns) {
      const exists = await KnowledgePattern.findOne({ patternId: pattern.patternId });
      
      if (!exists) {
        await KnowledgePattern.create(pattern);
        console.log(`  ✅ Created pattern: ${pattern.patternId}`);
      } else {
        console.log(`  ⏭️  Pattern exists: ${pattern.patternId}`);
      }
    }
    
    console.log('✨ Knowledge patterns seeded successfully!');
    
  } catch (error) {
    console.error('❌ Error seeding knowledge patterns:', error);
    throw error;
  }
}

module.exports = { seedKnowledgePatterns, knowledgePatterns };
