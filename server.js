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

// ⭐ AJOUTE CECI - Servir les fichiers statiques (HTML, CSS, JS)
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const JWT_SECRET = process.env.JWT_SECRET || 'fitblueprint_super_secret_key_2024';
const SALT_ROUNDS = 10;

// Track active sessions
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

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is running!', time: new Date().toISOString() });
});

// ============================================
// PUBLIC AI ROUTES (No authentication required)
// ============================================

// AI Chat endpoint
app.post('/api/ai/chat', async (req, res) => {
  const { messages, systemPrompt } = req.body;
  
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  
  if (!OPENROUTER_API_KEY) {
    console.error('❌ OPENROUTER_API_KEY not set');
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

// AI Workout Generation endpoint
app.post('/api/ai/generate-workout', async (req, res) => {
  const { goal, frequency, userProfile } = req.body;
  
  console.log('🎯 Generating AI workout for goal:', goal, 'frequency:', frequency);
  
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  
  if (!OPENROUTER_API_KEY) {
    console.error('❌ OPENROUTER_API_KEY not set');
    return res.json({ success: false, error: 'API key not configured' });
  }
  
  const systemPrompt = `You are an expert personal trainer. 

EXERCISE DATABASE (USE ONLY THESE):

CHEST: Barbell Bench Press, Dumbbell Bench Press, Smith Machine Bench Press, Pec Deck Fly, Low to High Cable Fly, High to Low Cable Fly, Incline Barbell Bench Press, Incline Dumbbell Press, Smith Machine Incline Press, Push-ups

BACK: Lat Pulldown, Cable Row, Barbell Row, Dumbbell Row, Cable Pulldown, Machine Row, Pull-ups, Close Grip Pulldown, Mid Grip Pulldown

LEGS: Barbell Squat, Leg Extension, Leg Press, Hack Squat, Romanian Deadlift, Split Squat, Hamstring Curls, Calf Raises

BICEPS: EZ Bar Curl, Dumbbell Curl, Preacher Curl, Incline Curl, Bayesian Cable Curl

TRICEPS: Tricep Pushdown, Overhead Cable Triceps, Skull Crusher, Cable Kickback

⚠️ CRITICAL RULES:
- EACH DAY MUST HAVE EXACTLY 7 EXERCISES
- ONLY use exercises from the list above
- For Push Day: Chest + Triceps exercises
- For Pull Day: Back + Biceps exercises
- For Leg Day: Leg exercises only

Create a ${frequency}x/week workout plan for ${goal} weight.
Each day needs EXACTLY 7 exercises.

Return ONLY valid JSON in this format:
{
  "days": [
    {
      "name": "Day name",
      "exercises": [
        { "name": "Exercise name", "sets": 3, "reps": "10-12" }
      ]
    }
  ]
}`;

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
          { role: 'user', content: `Create a ${frequency}x/week workout plan for ${goal} weight. Each day MUST have exactly 7 exercises.` }
        ]
      })
    });
    
    const data = await response.json();
    let aiResponse = data.choices[0]?.message?.content || '';
    console.log('AI Response received');
    
    aiResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const workoutPlan = JSON.parse(jsonMatch[0]);
      res.json({ success: true, workoutPlan });
    } else {
      res.json({ success: false, error: 'No JSON found' });
    }
  } catch (error) {
    console.error('AI error:', error);
    res.json({ success: false, error: error.message });
  }
});

// AI Recipe Generation endpoint
app.post('/api/ai/recipe', async (req, res) => {
  const { goal } = req.body;
  
  console.log('🍽️ Generating AI recipe for goal:', goal);
  
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  
  if (!OPENROUTER_API_KEY) {
    console.error('❌ OPENROUTER_API_KEY not set');
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
          { role: 'system', content: `You are a nutritionist. Create a healthy recipe for ${goal === 'lose' ? 'weight loss' : (goal === 'gain' ? 'muscle gain' : 'maintenance')}. Return ONLY JSON with: name, calories, protein, carbs, fat, ingredients (array), instructions (array).` },
          { role: 'user', content: `Create a healthy recipe for ${goal === 'lose' ? 'weight loss' : (goal === 'gain' ? 'muscle gain' : 'maintenance')}.` }
        ]
      })
    });
    
    const data = await response.json();
    let aiResponse = data.choices[0]?.message?.content || '';
    aiResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const recipe = JSON.parse(jsonMatch[0]);
      res.json({ success: true, recipe });
    } else {
      throw new Error('No JSON found');
    }
  } catch (error) {
    console.error('AI recipe error:', error);
    // Fallback recipe
    res.json({ 
      success: true, 
      recipe: {
        name: "Healthy Protein Bowl",
        calories: 450,
        protein: 35,
        carbs: 40,
        fat: 15,
        ingredients: ["200g chicken breast", "100g quinoa", "100g vegetables", "2 tbsp olive oil"],
        instructions: ["Cook chicken", "Prepare quinoa", "Steam vegetables", "Mix everything"]
      }
    });
  }
});

// ============================================
// AUTHENTICATION ROUTES (Public)
// ============================================

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, hashedPassword]
    );
    
    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, username: user.username }, 
      JWT_SECRET, 
      { expiresIn: '2d' }
    );
    
    await pool.query(
      'INSERT INTO user_data (user_id, profile, saved_workouts, workout_history, completed_workouts) VALUES ($1, $2, $3, $4, $5)',
      [user.id, '{}', '[]', '{}', '{}']
    );
    
    const newSessionId = createSession(user.id, token);
    
    res.json({ 
      token, 
      userId: user.id, 
      username: user.username,
      sessionId: newSessionId,
      message: 'Account created successfully!'
    });
  } catch (error) {
    if (error.code === '23505') {
      res.status(400).json({ error: 'Username already exists' });
    } else {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    const token = jwt.sign(
      { userId: user.id, username: user.username }, 
      JWT_SECRET, 
      { expiresIn: '2d' }
    );
    
    const newSessionId = createSession(user.id, token);
    
    res.json({ 
      token, 
      userId: user.id, 
      username: user.username,
      sessionId: newSessionId,
      message: 'Login successful!'
    });
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
      const newUser = await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
        ['demo_user', hashedPassword]
      );
      demoUser = newUser;
      
      await pool.query(
        'INSERT INTO user_data (user_id, profile, saved_workouts, workout_history, completed_workouts) VALUES ($1, $2, $3, $4, $5)',
        [demoUser.rows[0].id, '{}', '[]', '{}', '{}']
      );
    }
    
    const user = demoUser.rows[0];
    const token = jwt.sign(
      { userId: user.id, username: user.username }, 
      JWT_SECRET, 
      { expiresIn: '2d' }
    );
    
    const newSessionId = createSession(user.id, token);
    
    res.json({ 
      token, 
      userId: user.id, 
      username: user.username,
      sessionId: newSessionId,
      message: 'Demo mode active!'
    });
  } catch (error) {
    console.error('Demo login error:', error);
    res.status(500).json({ error: 'Demo login failed' });
  }
});

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const userId = req.headers['x-user-id'];
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    
    if (userId && user.userId.toString() !== userId) {
      return res.status(403).json({ error: 'Access denied. Cannot access another user\'s data.' });
    }
    
    req.user = user;
    next();
  });
}

function checkTokenExpiration(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return next();
  }
  
  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.exp) {
      const expirationDate = new Date(decoded.exp * 1000);
      const now = new Date();
      
      if (now > expirationDate) {
        return res.status(401).json({ 
          error: 'Session expired', 
          expired: true,
          message: 'Your session has expired. Please login again.'
        });
      }
      
      const hoursUntilExpiry = (expirationDate - now) / (1000 * 60 * 60);
      if (hoursUntilExpiry < 1 && hoursUntilExpiry > 0) {
        res.setHeader('X-Session-Expiring', 'true');
        res.setHeader('X-Session-Expires-In', Math.floor(hoursUntilExpiry * 60));
      }
    }
  } catch (error) {
    console.error('Token decode error:', error);
  }
  
  next();
}

// Apply authentication to all routes below
app.use('/api/', authenticateToken, checkTokenExpiration);

// ============================================
// PROTECTED ROUTES (Require authentication)
// ============================================

app.get('/api/verify', (req, res) => {
  res.json({ valid: true, user: req.user });
});

app.post('/api/logout', (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (sessionId) {
    activeSessions.delete(sessionId);
  }
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/user-data/:userId', async (req, res) => {
  const userId = req.params.userId;
  
  if (req.user.userId.toString() !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    const result = await pool.query(
      'SELECT profile, saved_workouts, workout_history FROM user_data WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.json({ profile: {}, savedWorkouts: [], workoutHistory: {} });
    }
    
    res.json({
      profile: result.rows[0].profile || {},
      savedWorkouts: result.rows[0].saved_workouts || [],
      workoutHistory: result.rows[0].workout_history || {}
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

app.post('/api/user-data/:userId', async (req, res) => {
  const userId = req.params.userId;
  const { profile, savedWorkouts, workoutHistory } = req.body;
  
  if (req.user.userId.toString() !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    await pool.query(
      `INSERT INTO user_data (user_id, profile, saved_workouts, workout_history, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) 
       DO UPDATE SET 
         profile = EXCLUDED.profile,
         saved_workouts = EXCLUDED.saved_workouts,
         workout_history = EXCLUDED.workout_history,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, profile, savedWorkouts || [], workoutHistory || {}]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/workout-progress/:userId', async (req, res) => {
  const userId = req.params.userId;
  const { workoutData, setsStatus, weightsData, repsData } = req.body;
  
  if (req.user.userId.toString() !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    const result = await pool.query(
      'SELECT workout_history FROM user_data WHERE user_id = $1',
      [userId]
    );
    
    let workoutHistory = result.rows[0]?.workout_history || {};
    if (typeof workoutHistory === 'string') {
      workoutHistory = JSON.parse(workoutHistory);
    }
    
    const today = new Date().toISOString().split('T')[0];
    if (!workoutHistory[today]) {
      workoutHistory[today] = [];
    }
    
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
       ON CONFLICT (user_id) 
       DO UPDATE SET 
         workout_history = EXCLUDED.workout_history,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, workoutHistory]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/completed-workouts/:userId', async (req, res) => {
  const userId = req.params.userId;
  
  console.log('📥 GET completed-workouts for user:', userId);
  
  if (req.user.userId.toString() !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    let userDataResult = await pool.query(
      'SELECT id FROM user_data WHERE user_id = $1',
      [userId]
    );
    
    if (userDataResult.rows.length === 0) {
      console.log('📝 Creating user_data for user:', userId);
      await pool.query(
        `INSERT INTO user_data (user_id, profile, saved_workouts, workout_history, completed_workouts) 
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, '{}', '[]', '{}', '{}']
      );
    }
    
    const result = await pool.query(
      'SELECT completed_workouts FROM user_data WHERE user_id = $1',
      [userId]
    );
    
    let completedWorkouts = result.rows[0]?.completed_workouts || {};
    
    if (typeof completedWorkouts === 'string') {
      try {
        completedWorkouts = JSON.parse(completedWorkouts);
      } catch(e) {
        completedWorkouts = {};
      }
    }
    
    const weekKey = getWeekKey(new Date());
    const currentWeekWorkouts = completedWorkouts[weekKey] || [];
    
    console.log(`✅ Returning ${currentWeekWorkouts.length} completed workouts`);
    
    res.json({ 
      success: true, 
      completedWorkouts: currentWeekWorkouts,
      weekKey: weekKey
    });
  } catch (error) {
    console.error('❌ Error fetching completed workouts:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/workout-complete/:userId', async (req, res) => {
  const userId = req.params.userId;
  const { workoutName, dayIndex, date } = req.body;
  
  console.log('📥 POST workout-complete for user:', userId);
  console.log('   Workout:', workoutName, 'Day:', dayIndex);
  
  if (req.user.userId.toString() !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    const userCheck = await pool.query(
      'SELECT id FROM user_data WHERE user_id = $1',
      [userId]
    );
    
    if (userCheck.rows.length === 0) {
      await pool.query(
        `INSERT INTO user_data (user_id, profile, saved_workouts, workout_history, completed_workouts) 
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, '{}', '[]', '{}', '{}']
      );
    }
    
    const result = await pool.query(
      'SELECT completed_workouts FROM user_data WHERE user_id = $1',
      [userId]
    );
    
    let completedWorkouts = result.rows[0]?.completed_workouts || {};
    
    if (typeof completedWorkouts === 'string') {
      completedWorkouts = JSON.parse(completedWorkouts);
    }
    
    const weekKey = getWeekKey(date || new Date());
    
    if (!completedWorkouts[weekKey]) {
      completedWorkouts[weekKey] = [];
    }
    
    const alreadyCompleted = completedWorkouts[weekKey].some(
      w => w.workoutName === workoutName && w.dayIndex === dayIndex
    );
    
    if (!alreadyCompleted) {
      completedWorkouts[weekKey].push({
        workoutName: workoutName,
        dayIndex: dayIndex,
        completedAt: new Date().toISOString()
      });
      console.log('   ✅ Added to completed workouts');
    } else {
      console.log('   ⚠️ Already completed, skipping');
    }
    
    await pool.query(
      `UPDATE user_data 
       SET completed_workouts = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $2`,
      [completedWorkouts, userId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error marking workout complete:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
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

// Weekly reset
function scheduleWeeklyReset() {
  const now = new Date();
  const nextMonday = new Date();
  nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7));
  nextMonday.setHours(0, 0, 0, 0);
  
  const msUntilMonday = nextMonday - now;
  
  setTimeout(() => {
    console.log('🔄 Running weekly reset...');
    resetWeeklyWorkouts();
    scheduleWeeklyReset();
  }, msUntilMonday);
}

async function resetWeeklyWorkouts() {
  try {
    const users = await pool.query('SELECT id FROM users');
    
    for (const user of users.rows) {
      const result = await pool.query(
        'SELECT completed_workouts FROM user_data WHERE user_id = $1',
        [user.id]
      );
      
      let completedWorkouts = result.rows[0]?.completed_workouts || {};
      if (typeof completedWorkouts === 'string') {
        completedWorkouts = JSON.parse(completedWorkouts);
      }
      
      const weekKey = getWeekKey(new Date());
      completedWorkouts[weekKey] = [];
      
      await pool.query(
        'UPDATE user_data SET completed_workouts = $1 WHERE user_id = $2',
        [completedWorkouts, user.id]
      );
    }
    
    console.log('✅ Weekly reset complete');
  } catch (error) {
    console.error('Weekly reset error:', error);
  }
}

scheduleWeeklyReset();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('========================================');
  console.log('Public endpoints (no auth):');
  console.log('  GET  /api/test');
  console.log('  POST /api/ai/chat');
  console.log('  POST /api/ai/generate-workout');
  console.log('  POST /api/ai/recipe');
  console.log('  POST /api/register');
  console.log('  POST /api/login');
  console.log('  POST /api/demo-login');
  console.log('========================================');
  console.log('Protected endpoints (require token):');
  console.log('  GET  /api/verify');
  console.log('  POST /api/logout');
  console.log('  GET  /api/user-data/:userId');
  console.log('  POST /api/user-data/:userId');
  console.log('  POST /api/workout-progress/:userId');
  console.log('  POST /api/workout-complete/:userId');
  console.log('  GET  /api/completed-workouts/:userId');
  console.log('========================================');
});