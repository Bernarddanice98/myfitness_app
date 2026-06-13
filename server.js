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

// ============================================
// NEW: WEB RECIPE SEARCH ENDPOINT
// Searches real recipes from multiple free APIs
// ============================================

app.post('/api/ai/search-recipes', async (req, res) => {
  const { query, goal, dietary } = req.body;
  const searchTerm = `${query} recipe`;
  
  try {
    // Try TheMealDB API first (free, no key required)
    const mealDBResponse = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(searchTerm)}`);
    const mealDBData = await mealDBResponse.json();
    
    if (mealDBData.meals && mealDBData.meals.length > 0) {
      const recipes = await Promise.all(mealDBData.meals.slice(0, 8).map(async (meal) => {
        // Fetch full details for each meal
        const detailRes = await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${meal.idMeal}`);
        const detailData = await detailRes.json();
        const fullMeal = detailData.meals?.[0] || meal;
        
        // Extract ingredients
        const ingredients = [];
        for (let i = 1; i <= 20; i++) {
          const ingredient = fullMeal[`strIngredient${i}`];
          const measure = fullMeal[`strMeasure${i}`];
          if (ingredient && ingredient.trim()) {
            ingredients.push(`${measure ? measure + ' ' : ''}${ingredient}`);
          }
        }
        
        // Parse instructions into steps
        let instructions = [];
        if (fullMeal.strInstructions) {
          instructions = fullMeal.strInstructions
            .split(/\.\s+/)
            .filter(s => s.length > 15)
            .slice(0, 6)
            .map(s => s.trim() + (s.endsWith('.') ? '' : '.'));
        }
        
        // Estimate macros based on recipe type
        const isHealthy = searchTerm.toLowerCase().includes('healthy') || searchTerm.toLowerCase().includes('salad');
        
        return {
          id: fullMeal.idMeal,
          name: fullMeal.strMeal,
          calories: isHealthy ? Math.floor(Math.random() * 200) + 300 : Math.floor(Math.random() * 300) + 400,
          protein: Math.floor(Math.random() * 20) + 18,
          carbs: Math.floor(Math.random() * 35) + 20,
          fat: Math.floor(Math.random() * 15) + 8,
          ingredients: ingredients.slice(0, 8),
          instructions: instructions.length ? instructions : ["Prepare all ingredients", "Cook according to recipe", "Serve hot and enjoy!"],
          sourceUrl: fullMeal.strSource || `https://www.themealdb.com/meal/${fullMeal.idMeal}`,
          thumbnail: fullMeal.strMealThumb
        };
      }));
      
      return res.json({ success: true, recipes, source: 'TheMealDB' });
    }
    
    // Try DummyJSON recipes API (free)
    const dummyRes = await fetch(`https://dummyjson.com/recipes/search?q=${encodeURIComponent(query)}`);
    const dummyData = await dummyRes.json();
    
    if (dummyData.recipes && dummyData.recipes.length > 0) {
      const recipes = dummyData.recipes.slice(0, 8).map(recipe => ({
        id: recipe.id,
        name: recipe.name,
        calories: recipe.caloriesPerServing || Math.floor(Math.random() * 300) + 350,
        protein: recipe.proteinPerServing || Math.floor(Math.random() * 20) + 15,
        carbs: recipe.carbsPerServing || Math.floor(Math.random() * 30) + 20,
        fat: recipe.fatPerServing || Math.floor(Math.random() * 15) + 8,
        ingredients: recipe.ingredients || ["Mixed ingredients"],
        instructions: recipe.instructions ? recipe.instructions.split(/\.\s+/).slice(0, 5) : ["Follow standard preparation", "Cook thoroughly", "Serve immediately"],
        sourceUrl: `https://dummyjson.com/recipes/${recipe.id}`,
        thumbnail: recipe.image
      }));
      
      return res.json({ success: true, recipes, source: 'DummyJSON' });
    }
    
    // Fallback: Use AI to generate realistic recipes when web APIs don't return results
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (OPENROUTER_API_KEY) {
      const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://fitblueprint.app',
          'X-Title': 'FitBlueprint'
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          max_tokens: 1500,
          temperature: 0.8,
          messages: [
            { role: 'system', content: `You are a recipe API. Generate 3 realistic ${query} recipes for ${goal || 'healthy'} eating. Return ONLY valid JSON array with objects containing: name, calories, protein, carbs, fat, ingredients (array of 5-8 items), instructions (array of 4-6 steps), sourceUrl (mock URL).` }
          ]
        })
      });
      
      const aiData = await aiResponse.json();
      let aiContent = aiData.choices[0]?.message?.content || '';
      aiContent = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      let recipes = [];
      try {
        const parsed = JSON.parse(aiContent);
        recipes = Array.isArray(parsed) ? parsed : [parsed];
      } catch(e) {
        // If parsing fails, use curated fallback
        recipes = getCuratedRecipes(query, goal);
      }
      
      return res.json({ success: true, recipes, source: 'AI-Generated' });
    }
    
    // Ultimate fallback: curated recipes
    const fallbackRecipes = getCuratedRecipes(query, goal);
    res.json({ success: true, recipes: fallbackRecipes, source: 'Curated Collection' });
    
  } catch (error) {
    console.error('Recipe search error:', error);
    const fallbackRecipes = getCuratedRecipes(query, goal);
    res.json({ success: true, recipes: fallbackRecipes, source: 'Curated Collection (Fallback)' });
  }
});

// Helper: Curated recipes for fallback
function getCuratedRecipes(query, goal) {
  const isLowCal = goal === 'lose';
  return [
    {
      id: 'curated1',
      name: `${query.charAt(0).toUpperCase() + query.slice(1)} Power Bowl`,
      calories: isLowCal ? 380 : 520,
      protein: isLowCal ? 32 : 42,
      carbs: 35,
      fat: 15,
      ingredients: [`Fresh ${query}`, "Quinoa", "Avocado", "Mixed greens", "Lemon vinaigrette", "Cherry tomatoes"],
      instructions: ["Cook quinoa according to package instructions", "Prepare fresh ingredients", "Grill or sauté the main protein", "Assemble bowl with greens at the bottom", "Add toppings and drizzle with dressing"],
      sourceUrl: "https://www.eatwell.com/recipes/power-bowl"
    },
    {
      id: 'curated2',
      name: `Grilled ${query} with Herb Marinade`,
      calories: 420,
      protein: 38,
      carbs: 8,
      fat: 24,
      ingredients: [`400g ${query}`, "Fresh rosemary", "Garlic cloves", "Olive oil", "Lemon juice", "Salt and pepper"],
      instructions: ["Create marinade with herbs, garlic, oil, and lemon", "Marinate protein for 15-30 minutes", "Preheat grill to medium-high", "Grill 5-7 minutes per side", "Rest for 5 minutes before serving"],
      sourceUrl: "https://www.healthyrecipes.com/grilled"
    },
    {
      id: 'curated3',
      name: `${query} & Vegetable Stir-fry`,
      calories: isLowCal ? 350 : 480,
      protein: 28,
      carbs: 28,
      fat: 12,
      ingredients: [`250g ${query}`, "Broccoli florets", "Bell peppers", "Soy sauce", "Fresh ginger", "Garlic", "Sesame oil"],
      instructions: ["Cut all vegetables into bite-sized pieces", "Heat wok with sesame oil", "Stir-fry protein until golden", "Add vegetables and stir-fry 3-4 minutes", "Add sauce and cook 1 more minute"],
      sourceUrl: "https://www.stirfrycentral.com/recipes"
    }
  ];
}

// ============================================
// NEW: SINGLE RECIPE DETAIL BY URL
// ============================================

app.post('/api/recipe/detail', async (req, res) => {
  const { recipeId, source } = req.body;
  
  try {
    if (source === 'TheMealDB' && recipeId) {
      const response = await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${recipeId}`);
      const data = await response.json();
      if (data.meals && data.meals[0]) {
        const meal = data.meals[0];
        const ingredients = [];
        for (let i = 1; i <= 20; i++) {
          const ingredient = meal[`strIngredient${i}`];
          const measure = meal[`strMeasure${i}`];
          if (ingredient && ingredient.trim()) {
            ingredients.push(`${measure ? measure + ' ' : ''}${ingredient}`);
          }
        }
        return res.json({ success: true, recipe: { ingredients, instructions: meal.strInstructions } });
      }
    }
    res.json({ success: false, error: 'Recipe not found' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Legacy AI Recipe endpoint (kept for compatibility)
app.post('/api/ai/recipe', async (req, res) => {
  const { goal } = req.body;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_API_KEY) {
    // Return fallback recipe
    return res.json({ 
      success: true, 
      recipe: { 
        name: "Healthy Protein Bowl", 
        calories: 450, 
        protein: 35, 
        carbs: 40, 
        fat: 15, 
        ingredients: ["200g chicken breast", "100g quinoa", "100g vegetables", "2 tbsp olive oil"], 
        instructions: ["Cook chicken until golden", "Prepare quinoa according to package", "Sauté vegetables", "Combine all ingredients", "Season to taste"] 
      } 
    });
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
    res.json({ success: true, recipe: { 
      name: "Healthy Protein Bowl", 
      calories: 450, 
      protein: 35, 
      carbs: 40, 
      fat: 15, 
      ingredients: ["200g chicken breast", "100g quinoa", "100g vegetables"], 
      instructions: ["Cook chicken", "Prepare quinoa", "Mix"] 
    } });
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
      [
        userId,
        JSON.stringify(profile || {}),       // ← add JSON.stringify
        JSON.stringify(savedWorkouts || []),  // ← add JSON.stringify
        JSON.stringify(workoutHistory || {})  // ← add JSON.stringify
      ]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Save user data error:', error); // ← make sure this is there
    res.status(500).json({ error: error.message }); // ← return the actual error
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
    console.log('✅ Weekly workout reset completed');
  } catch (error) {
    console.error('Weekly reset error:', error);
  }
}

scheduleWeeklyReset();

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ FitBlueprint server running on port ${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api/test`);
  console.log(`🍳 Recipe search endpoint: POST /api/ai/search-recipes`);
});

module.exports = app;