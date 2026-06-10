const path = require('path');
require('dotenv').config();

console.log("API key loaded:", !!process.env.OPENROUTER_API_KEY);

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ===================== DB =====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'fitblueprint_super_secret_key_2024';
const SALT_ROUNDS = 10;

// ===================== HEALTH =====================
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is running!', time: new Date().toISOString() });
});

// ===================== AI CHAT =====================
app.post('/api/ai/chat', async (req, res) => {
  const { messages, systemPrompt } = req.body;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://fitblueprint.app',
        'X-Title': 'FitBlueprint'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        max_tokens: 600,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ]
      })
    });

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('AI error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===================== WORKOUT GENERATION =====================
app.post('/api/ai/generate-workout', async (req, res) => {
  const { goal, frequency } = req.body;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_API_KEY) {
    return res.json({ success: false, error: 'API key not configured' });
  }

  const systemPrompt = `
You are a personal trainer.

ONLY use allowed exercises.

Return STRICT JSON:
{"days":[{"name":"Day","exercises":[{"name":"Exercise","sets":3,"reps":"10-12"}]}]}

RULE: exactly 7 exercises per day.
`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://fitblueprint.app',
        'X-Title': 'FitBlueprint'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo:online',
        max_tokens: 2000,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Create ${frequency}x/week plan for ${goal}` }
        ]
      })
    });

    const data = await response.json();
    let text = data.choices[0]?.message?.content || '';

    text = text.replace(/```json/g, '').replace(/```/g, '');

    const match = text.match(/\{[\s\S]*\}/);

    if (!match) {
      return res.json({ success: false, error: 'No JSON found' });
    }

    res.json({ success: true, workoutPlan: JSON.parse(match[0]) });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ===================== AI RECIPE =====================
app.post('/api/ai/recipe', async (req, res) => {
  const { goal } = req.body;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://fitblueprint.app',
        'X-Title': 'FitBlueprint'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        max_tokens: 1000,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content: `Return JSON recipe for ${goal}`
          },
          { role: 'user', content: `Create recipe for ${goal}` }
        ]
      })
    });

    const data = await response.json();
    let text = data.choices[0]?.message?.content || '';

    text = text.replace(/```json/g, '').replace(/```/g, '');

    const match = text.match(/\{[\s\S]*\}/);

    if (match) {
      return res.json({ success: true, recipe: JSON.parse(match[0]) });
    }

    throw new Error('No JSON found');

  } catch (error) {
    return res.json({
      success: true,
      recipe: {
        name: "Healthy Bowl",
        calories: 450,
        protein: 35,
        carbs: 40,
        fat: 15
      }
    });
  }
});

// ===================== AUTH (LIGHT MODE) =====================

// REGISTER
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const hashed = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, hashed]
    );

    const user = result.rows[0];

    await pool.query(
      'INSERT INTO user_data (user_id, profile, saved_workouts, workout_history, completed_workouts) VALUES ($1,$2,$3,$4,$5)',
      [user.id, {}, [], {}, {}]
    );

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '2d' }
    );

    res.json({
      token,
      userId: user.id,
      username: user.username
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Register failed' });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username=$1',
      [username]
    );

    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid login' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid login' });

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '2d' }
    );

    res.json({
      token,
      userId: user.id,
      username: user.username
    });

  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// ===================== AUTH MIDDLEWARE =====================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'No token' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// protect everything below
app.use('/api/', authenticateToken);

// ===================== USER DATA =====================
app.get('/api/verify', (req, res) => {
  res.json({ valid: true, user: req.user });
});

app.get('/api/user-data/:userId', async (req, res) => {
  if (req.user.userId.toString() !== req.params.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const result = await pool.query(
    'SELECT profile, saved_workouts, workout_history FROM user_data WHERE user_id=$1',
    [req.params.userId]
  );

  res.json(result.rows[0] || {});
});

app.post('/api/user-data/:userId', async (req, res) => {
  if (req.user.userId.toString() !== req.params.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { profile, savedWorkouts, workoutHistory } = req.body;

  await pool.query(
    `INSERT INTO user_data (user_id, profile, saved_workouts, workout_history, updated_at)
     VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)
     ON CONFLICT (user_id)
     DO UPDATE SET profile=$2, saved_workouts=$3, workout_history=$4, updated_at=CURRENT_TIMESTAMP`,
    [req.params.userId, profile, savedWorkouts, workoutHistory]
  );

  res.json({ success: true });
});

// ===================== SERVER =====================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});