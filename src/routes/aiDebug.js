const express = require('express');
const OpenAI = require('openai');
const router = express.Router();

// Public endpoint to test OpenAI - NO AUTH REQUIRED for debugging
router.get('/ping', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: { code: 'MISSING_KEY', message: 'OPENAI_API_KEY not set in environment' }
      });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const response = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Say exactly: OPENAI_OK' }],
      max_tokens: 20
    });

    const text = response.choices[0]?.message?.content || '';
    
    return res.json({
      success: true,
      data: { 
        message: text,
        model: 'gpt-3.5-turbo',
        keyPrefix: process.env.OPENAI_API_KEY?.substring(0, 10) + '...'
      }
    });

  } catch (err) {
    console.error('[AI DEBUG] OpenAI ping failed:', err.message);
    
    return res.status(500).json({
      success: false,
      error: {
        code: err.code || 'OPENAI_ERROR',
        message: err.message,
        status: err.status || 500,
        type: err.type || 'unknown'
      }
    });
  }
});

module.exports = router;
