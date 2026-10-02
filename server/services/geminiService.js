const Groq = require('groq-sdk');
const { chunkText } = require('../utils/tokenize');

let groqClient = null;

function getGroqClient() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is missing. Please set your GROQ_API_KEY in server/.env');
  }
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

// Model to use — openai/gpt-oss-120b is fast, high quality and active on your Groq key
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

/**
 * Helper: call Groq with automatic retry on rate limit errors.
 */
async function callWithRetry(prompt, maxRetries = 3) {
  const client = getGroqClient();
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: MODEL,
        temperature: 0.7,
        max_tokens: 4096,
      });
      return completion.choices[0]?.message?.content || '';
    } catch (err) {
      const is429 = err.status === 429 || (err.message && err.message.includes('429'));

      if (is429 && attempt < maxRetries) {
        const waitSec = attempt * 10;
        console.log(`  Rate limited (attempt ${attempt}/${maxRetries}). Waiting ${waitSec}s...`);
        await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Small delay between sequential API calls.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a structured summary from study material text.
 */
async function generateSummary(text) {
  const chunks = chunkText(text, 2500);
  const summaries = [];

  for (const chunk of chunks) {
    const prompt = `You are an expert study coach. Summarize the following study material into clear, concise bullet points suitable for exam revision. Use markdown formatting with headers and bullet points. Group related concepts together.

Study Material:
${chunk}

Provide a well-structured summary:`;

    const result = await callWithRetry(prompt);
    summaries.push(result);

    if (chunks.length > 1) await delay(1000);
  }

  return summaries.join('\n\n---\n\n');
}

/**
 * Generate multiple-choice quiz questions from study material.
 */
async function generateQuiz(text) {
  const chunks = chunkText(text, 2500);
  let allQuestions = [];

  for (const chunk of chunks) {
    const prompt = `You are an expert educator. Generate 5 multiple choice questions based on this study material. Each question should test understanding, not just memorization.

Return the result as a valid JSON array with this exact format:
[
  {
    "question": "What is...?",
    "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
    "correct_answer": "A) ..."
  }
]

Study Material:
${chunk}

Return ONLY the JSON array, no other text:`;

    const responseText = await callWithRetry(prompt);

    try {
      const jsonMatch = responseText.trim().match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        allQuestions = allQuestions.concat(parsed);
      }
    } catch (e) {
      console.error('Failed to parse quiz JSON:', e.message);
    }

    if (chunks.length > 1) await delay(1000);
  }

  return allQuestions.slice(0, 10);
}

/**
 * Generate flashcards from study material.
 */
async function generateFlashcards(text) {
  const chunks = chunkText(text, 2500);
  let allCards = [];

  for (const chunk of chunks) {
    const prompt = `You are an expert educator. Create flashcards for the key concepts in the following study material. Each flashcard should have a clear question on the front and a concise answer on the back.

Return the result as a valid JSON array with this exact format:
[
  {
    "question": "What is...?",
    "answer": "..."
  }
]

Study Material:
${chunk}

Return ONLY the JSON array, no other text:`;

    const responseText = await callWithRetry(prompt);

    try {
      const jsonMatch = responseText.trim().match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        allCards = allCards.concat(parsed);
      }
    } catch (e) {
      console.error('Failed to parse flashcard JSON:', e.message);
    }

    if (chunks.length > 1) await delay(1000);
  }

  return allCards.slice(0, 20);
}

/**
 * Answer a user's question based on the study material context.
 */
async function askQuestion(text, question) {
  const contextText = text.split(/\s+/).slice(0, 5000).join(' ');

  const prompt = `You are a helpful AI study assistant. Answer the student's question using ONLY the information from the provided study material. If the answer is not found in the material, say so clearly.

Study Material:
${contextText}

Student's Question: ${question}

Provide a clear, helpful answer:`;

  return await callWithRetry(prompt);
}

module.exports = {
  generateSummary,
  generateQuiz,
  generateFlashcards,
  askQuestion,
};
