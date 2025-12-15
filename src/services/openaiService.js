const OpenAI = require('openai');

class OpenAIService {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.model = 'gpt-3.5-turbo';
  }

  // Alumni AI Tutoring Help
  async alumniTutorHelp(userId, questionData) {
    const requestId = `alumni_${userId || 'anon'}_${Date.now()}`;
    
    try {
      const { questionText, track = 'SOFTWARE_ENGINEERING' } = questionData;
      
      if (!questionText || questionText.length < 5) {
        throw new Error('Question too short');
      }

      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY not configured');
      }

      console.log(`[OPENAI] Alumni request: "${questionText.substring(0, 50)}..."`);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are PeerTrack+ Tutor AI helping tutors prepare to teach students in ${track}.
Give helpful, educational responses. Return JSON:
{"topicOneLine":"brief topic","keywords":["k1","k2","k3","k4","k5"],"superShortAnswer":"quick summary","fullAnswer":"detailed helpful response"}`
          },
          { role: 'user', content: questionText }
        ],
        temperature: 0.7
      });

      const content = response.choices[0]?.message?.content || '';
      console.log(`[OPENAI] Response received: ${content.substring(0, 100)}...`);

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = {
          topicOneLine: questionText.substring(0, 60),
          keywords: ['learning', 'education', 'skills', 'practice', 'growth'],
          superShortAnswer: 'See detailed answer',
          fullAnswer: content
        };
      }

      return {
        success: true,
        analytics: {
          topicOneLine: parsed.topicOneLine || 'Topic',
          keywords: parsed.keywords || [],
          superShortAnswer: parsed.superShortAnswer || ''
        },
        fullAnswer: parsed.fullAnswer || content,
        requestId
      };

    } catch (error) {
      console.error(`[OPENAI ERROR] ${error.message}`);
      return {
        success: false,
        analytics: { topicOneLine: 'Error', keywords: [], superShortAnswer: 'Error' },
        fullAnswer: `OpenAI Error: ${error.message}`,
        error: error.message,
        requestId
      };
    }
  }

  // Student AI Mamba Helper
  async studentMambaHelper(userId, questionData) {
    const requestId = `student_${userId || 'anon'}_${Date.now()}`;
    
    try {
      const { questionText, track = 'SOFTWARE_ENGINEERING' } = questionData;
      
      if (!questionText || questionText.length < 5) {
        throw new Error('Question too short');
      }

      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY not configured');
      }

      console.log(`[OPENAI] Student request: "${questionText.substring(0, 50)}..."`);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are Mamba Helper 🐍24, a coding coach. Help students learn ${track}.
Provide hints and guidance, not direct answers. Return JSON:
{"coachMessage":"helpful coaching message","skillsMap":["skill1","skill2","skill3"],"nextSteps":["step1","step2","step3"],"difficultyEstimate":"easy|medium|hard","refusal":false}`
          },
          { role: 'user', content: questionText }
        ],
        temperature: 0.7
      });

      const content = response.choices[0]?.message?.content || '';
      console.log(`[OPENAI] Response received: ${content.substring(0, 100)}...`);

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = {
          coachMessage: content,
          skillsMap: ['learning', 'practice', 'growth'],
          nextSteps: ['Keep practicing', 'Ask questions', 'Never give up'],
          difficultyEstimate: 'medium',
          refusal: false
        };
      }

      return {
        success: true,
        coachMessage: parsed.coachMessage || content,
        skillsMap: parsed.skillsMap || [],
        nextSteps: parsed.nextSteps || [],
        difficultyEstimate: parsed.difficultyEstimate || 'medium',
        refusal: false,
        requestId
      };

    } catch (error) {
      console.error(`[OPENAI ERROR] ${error.message}`);
      return {
        success: false,
        coachMessage: `OpenAI Error: ${error.message}`,
        skillsMap: [],
        nextSteps: ['Try again'],
        difficultyEstimate: 'medium',
        refusal: false,
        error: error.message,
        requestId
      };
    }
  }
}

module.exports = new OpenAIService();
