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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'fitblueprint_super_secret_key_2024';
const SALT_ROUNDS = 10;
const activeSessions = new Map();

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of activeSessions.entries()) {
    if (session.expiresAt < now) {
      activeSessions.delete(sessionId);
      console.log(`🗑️ Session expired and cleaned: ${sessionId}`);
    }
  }
}
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

function createSession(userId, token) {
  const sessionId = generateSessionId();
  activeSessions.set(sessionId, {
    userId: userId,
    token: token,
    createdAt: Date.now(),
    expiresAt: Date.now() + (2 * 24 * 60 * 60 * 1000)
  });
  return sessionId;
}

function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
}

// ============================================
// PUBLIC ROUTES (no auth required)
// ============================================

app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is running!', time: new Date().toISOString() });
});

// AI Chat endpoint
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
  } catch (error) {
    console.error('AI error:', error);
    res.status(500).json({ error: error.message });
  }
});

// AI Workout Generation endpoint
app.post('/api/ai/generate-workout', async (req, res) => {
  const { goal, frequency } = req.body;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_API_KEY) {
    return res.json({ success: false, error: 'API key not configured' });
  }

  const systemPrompt = `You are an expert personal trainer. 

EXERCISE DATABASE (USE ONLY THESE):
CHEST: Barbell Bench Press, Dumbbell Bench Press, Smith Machine Bench Press, Pec Deck Fly, Low to High Cable Fly, High to Low Cable Fly, Incline Barbell Bench Press, Incline Dumbbell Press, Smith Machine Incline Press, Push-ups
BACK: Lat Pulldown, Cable Row, Barbell Row, Dumbbell Row, Cable Pulldown, Machine Row, Pull-ups, Close Grip Pulldown, Mid Grip Pulldown
LEGS: Barbell Squat, Leg Extension, Leg Press, Hack Squat, Romanian Deadlift, Split Squat, Hamstring Curls, Calf Raises
BICEPS: EZ Bar Curl, Dumbbell Curl, Preacher Curl, Incline Curl, Bayesian Cable Curl
TRICEPS: Tricep Pushdown, Overhead Cable Triceps, Skull Crusher, Cable Kickback

CRITICAL: EACH DAY MUST HAVE EXACTLY 7 EXERCISES. ONLY use exercises from the list above.

Create a ${frequency}x/week workout plan for ${goal} weight.
Return ONLY valid JSON: {"days":[{"name":"Day name","exercises":[{"name":"Exercise","sets":3,"reps":"10-12"}]}]}`;

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
        max_tokens: 2000,
        temperature: 0.7,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Create a ${frequency}x/week workout plan for ${goal} weight.` }]
      })
    });
    const data = await response.json();
    let aiResponse = data.choices[0]?.message?.content || '';
    aiResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      res.json({ success: true, workoutPlan: JSON.parse(jsonMatch[0]) });
    } else {
      res.json({ success: false, error: 'No JSON found' });
    }
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// AI Recipe Generation endpoint
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
          { role: 'system', content: `Create a healthy recipe for ${goal}. Return ONLY JSON with: name, calories, protein, carbs, fat, ingredients (array), instructions (array).` },
          { role: 'user', content: `Create a recipe for ${goal}.` }
        ]
      })
    });
    const data = await response.json();
    let aiResponse = data.choices[0]?.message?.content || '';
    aiResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      res.json({ success: true, recipe: JSON.parse(jsonMatch[0]) });
    } else {
      throw new Error('No JSON found');
    }
  } catch (error) {
    res.json({ success: true, recipe: { name: "Healthy Protein Bowl", calories: 450, protein: 35, carbs: 40, fat: 15, ingredients: ["200g chicken breast", "100g quinoa", "100g vegetables"], instructions: ["Cook chicken", "Prepare quinoa", "Mix"] } });
  }
});

// ============================================
// AUTHENTICATION ROUTES (public)
// ============================================

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username', [username, hashedPassword]);
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '2d' });
    await pool.query(
      'INSERT INTO user_data (user_id, profile, saved_workouts, workout_history, completed_workouts) VALUES ($1, $2, $3, $4, $5)',
      [user.id, {}, [], {}, {}]
    );
    const newSessionId = createSession(user.id, token);
    res.json({ token, userId: user.id, username: user.username, sessionId: newSessionId, message: 'Account created successfully!' });
  } catch (error) {
    if (error.code === '23505') res.status(400).json({ error: 'Username already exists' });
    else { console.error('Registration error:', error); res.status(500).json({ error: 'Internal server error' }); }
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(401).json({ error: 'Invalid username or password' });
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '2d' });
    const newSessionId = createSession(user.id, token);
    res.json({ token, userId: user.id, username: user.username, sessionId: newSessionId, message: 'Login successful!' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/demo-login', async (req, res) => {
  try {
    let demoUser = await pool.query('SELECT * FROM users WHERE username = $1', ['demo_user']);
    if (demoUser.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('demo123', SALT_ROUNDS);
      const newUser = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username', ['demo_user', hashedPassword]);
      demoUser = newUser;
      await pool.query(
        'INSERT INTO user_data (user_id, profile, saved_workouts, workout_history, completed_workouts) VALUES ($1, $2, $3, $4, $5)',
        [demoUser.rows[0].id, {}, [], {}, {}]
      );
    }
    const user = demoUser.rows[0];
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '2d' });
    const newSessionId = createSession(user.id, token);
    res.json({ token, userId: user.id, username: user.username, sessionId: newSessionId, message: 'Demo mode active!' });
  } catch (error) {
    console.error('Demo login error:', error);
    res.status(500).json({ error: 'Demo login failed' });
  }
});

// ============================================
// PROTECTED ROUTES (auth required)
// ============================================


app.post('/api/logout', authenticateToken, (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (sessionId) activeSessions.delete(sessionId);
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/user-data/:userId', authenticateToken, async (req, res) => {
  const userId = req.params.userId;
  if (req.user.userId.toString() !== userId) return res.status(403).json({ error: 'Access denied' });
  try {
    const result = await pool.query('SELECT profile, saved_workouts, workout_history FROM user_data WHERE user_id = $1', [userId]);
    if (result.rows.length === 0) return res.json({ profile: {}, savedWorkouts: [], workoutHistory: {} });
    res.json({
      profile: result.rows[0].profile || {},
      savedWorkouts: result.rows[0].saved_workouts || [],
      workoutHistory: result.rows[0].workout_history || {}
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

app.post('/api/user-data/:userId', authenticateToken, async (req, res) => {
  const userId = req.params.userId;
  const { profile, savedWorkouts, workoutHistory } = req.body;
  if (req.user.userId.toString() !== userId) return res.status(403).json({ error: 'Access denied' });
  try {
    await pool.query(
      `INSERT INTO user_data (user_id, profile, saved_workouts, workout_history, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE
       SET profile = EXCLUDED.profile,
           saved_workouts = EXCLUDED.saved_workouts,
           workout_history = EXCLUDED.workout_history,
           updated_at = CURRENT_TIMESTAMP`,
      [userId, profile || {}, savedWorkouts || [], workoutHistory || {}]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/workout-progress/:userId', authenticateToken, async (req, res) => {
  const userId = req.params.userId;
  const { workoutData, setsStatus, weightsData, repsData } = req.body;
  if (req.user.userId.toString() !== userId) return res.status(403).json({ error: 'Access denied' });
  try {
    const result = await pool.query('SELECT workout_history FROM user_data WHERE user_id = $1', [userId]);
    let workoutHistory = result.rows[0]?.workout_history || {};
    if (typeof workoutHistory === 'string') workoutHistory = JSON.parse(workoutHistory);
    const today = new Date().toISOString().split('T')[0];
    if (!workoutHistory[today]) workoutHistory[today] = [];
    workoutHistory[today].push({
      id: Date.now(),
      workoutName: workoutData?.day?.name || 'Workout',
      timestamp: new Date().toISOString(),
      sets: setsStatus || {},
      weights: weightsData || {},
      reps: repsData || {}
    });
    await pool.query(
      `INSERT INTO user_data (user_id, workout_history, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE
       SET workout_history = EXCLUDED.workout_history,
           updated_at = CURRENT_TIMESTAMP`,
      [userId, workoutHistory]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/completed-workouts/:userId', authenticateToken, async (req, res) => {
  const userId = req.params.userId;
  if (req.user.userId.toString() !== userId) return res.status(403).json({ error: 'Access denied' });
  try {
    let userDataResult = await pool.query('SELECT id FROM user_data WHERE user_id = $1', [userId]);
    if (userDataResult.rows.length === 0) {
      await pool.query(
        'INSERT INTO user_data (user_id, profile, saved_workouts, workout_history, completed_workouts) VALUES ($1, $2, $3, $4, $5)',
        [userId, {}, [], {}, {}]
      );
    }
    const result = await pool.query('SELECT completed_workouts FROM user_data WHERE user_id = $1', [userId]);
    let completedWorkouts = result.rows[0]?.completed_workouts || {};
    if (typeof completedWorkouts === 'string') {
      try { completedWorkouts = JSON.parse(completedWorkouts); } catch(e) { completedWorkouts = {}; }
    }
    const weekKey = getWeekKey(new Date());
    const currentWeekWorkouts = completedWorkouts[weekKey] || [];
    res.json({ success: true, completedWorkouts: currentWeekWorkouts, weekKey: weekKey });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/workout-complete/:userId', authenticateToken, async (req, res) => {
  const userId = req.params.userId;
  const { workoutName, dayIndex, date } = req.body;
  if (req.user.userId.toString() !== userId) return res.status(403).json({ error: 'Access denied' });
  try {
    const userCheck = await pool.query('SELECT id FROM user_data WHERE user_id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      await pool.query(
        'INSERT INTO user_data (user_id, profile, saved_workouts, workout_history, completed_workouts) VALUES ($1, $2, $3, $4, $5)',
        [userId, {}, [], {}, {}]
      );
    }
    const result = await pool.query('SELECT completed_workouts FROM user_data WHERE user_id = $1', [userId]);
    let completedWorkouts = result.rows[0]?.completed_workouts || {};
    if (typeof completedWorkouts === 'string') completedWorkouts = JSON.parse(completedWorkouts);
    const weekKey = getWeekKey(date || new Date());
    if (!completedWorkouts[weekKey]) completedWorkouts[weekKey] = [];
    const alreadyCompleted = completedWorkouts[weekKey].some(w => w.workoutName === workoutName && w.dayIndex === dayIndex);
    if (!alreadyCompleted) {
      completedWorkouts[weekKey].push({ workoutName, dayIndex, completedAt: new Date().toISOString() });
    }
    await pool.query('UPDATE user_data SET completed_workouts = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [completedWorkouts, userId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function getWeekKey(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const weekNumber = getWeekNumber(d);
  return `${year}-W${weekNumber}`;
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function scheduleWeeklyReset() {
  const now = new Date();
  const nextMonday = new Date();
  nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7));
  nextMonday.setHours(0, 0, 0, 0);
  const msUntilMonday = nextMonday - now;
  setTimeout(() => { resetWeeklyWorkouts(); scheduleWeeklyReset(); }, msUntilMonday);
}

async function resetWeeklyWorkouts() {
  try {
    const users = await pool.query('SELECT id FROM users');
    for (const user of users.rows) {
      const result = await pool.query('SELECT completed_workouts FROM user_data WHERE user_id = $1', [user.id]);
      let completedWorkouts = result.rows[0]?.completed_workouts || {};
      if (typeof completedWorkouts === 'string') completedWorkouts = JSON.parse(completedWorkouts);
      const weekKey = getWeekKey(new Date());
      completedWorkouts[weekKey] = [];
      await pool.query('UPDATE user_data SET completed_workouts = $1 WHERE user_id = $2', [completedWorkouts, user.id]);
    }
  } catch (error) {
    console.error('Weekly reset error:', error);
  }
}

scheduleWeeklyReset();

module.exports = app;