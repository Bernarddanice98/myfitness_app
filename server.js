const path = require('path');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'fitblueprint_super_secret_key_2024';
const SALT_ROUNDS = 10;

// =========================
// HEALTH CHECK
// =========================
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is running!', time: new Date().toISOString() });
});

// =========================
// AI ROUTES (PUBLIC)
// =========================
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
        messages: [{ role: 'system', content: systemPrompt }, ...messages]
      })
    });

    const data = await response.json();
    res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// AUTH HELPERS
// =========================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// =========================
// AUTH ROUTES (PUBLIC)
// =========================
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const hashed = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id, username',
      [username, hashed]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '2d' }
    );

    res.json({ token, userId: user.id, username: user.username });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
    const user = result.rows[0];

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '2d' }
    );

    res.json({ token, userId: user.id, username: user.username });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/demo-login', async (req, res) => {
  try {
    let result = await pool.query('SELECT * FROM users WHERE username=$1', ['demo_user']);

    if (result.rows.length === 0) {
      const hashed = await bcrypt.hash('demo123', SALT_ROUNDS);

      result = await pool.query(
        'INSERT INTO users (username,password_hash) VALUES ($1,$2) RETURNING id,username',
        ['demo_user', hashed]
      );
    }

    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '2d' }
    );

    res.json({ token, userId: user.id, username: user.username });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =========================
// VERIFY (PROTECTED)
// =========================
app.get('/api/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// =========================
// USER DATA (PROTECTED)
// =========================
app.get('/api/user-data/:userId', authenticateToken, async (req, res) => {
  const userId = req.params.userId;

  if (req.user.userId.toString() !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const result = await pool.query(
      'SELECT profile, saved_workouts, workout_history FROM user_data WHERE user_id=$1',
      [userId]
    );

    res.json(result.rows[0] || {
      profile: {},
      savedWorkouts: [],
      workoutHistory: {}
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/user-data/:userId', authenticateToken, async (req, res) => {
  const userId = req.params.userId;
  const { profile, savedWorkouts, workoutHistory } = req.body;

  if (req.user.userId.toString() !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    await pool.query(
      `INSERT INTO user_data (user_id, profile, saved_workouts, workout_history)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id)
       DO UPDATE SET profile=$2, saved_workouts=$3, workout_history=$4`,
      [userId, profile || {}, savedWorkouts || [], workoutHistory || {}]
    );

    res.json({ success: true });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});