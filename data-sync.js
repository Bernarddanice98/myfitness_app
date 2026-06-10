// data-sync.js - Centralized data sync management

const DataSync = {
  // Save all user data to server
  async saveAllToServer() {
    if (!window.auth || !window.auth.isAuthenticated) {
      console.log('Not logged in, skipping server sync');
      return false;
    }
    
    try {
      const userId = window.auth.getCurrentUser().userId;
      const token = window.auth.getCurrentUser().token;
      
      const userData = {
        profile: JSON.parse(localStorage.getItem('fitBlueprintData') || '{}'),
        savedWorkouts: JSON.parse(localStorage.getItem('savedWorkouts') || '[]'),
        workoutHistory: this.getWorkoutHistory()
      };
      
      const API_URL = window.location.hostname === 'localhost' 
        ? 'http://localhost:3000/api'
        : 'https://your-production-api.com/api';
      
      const response = await fetch(`${API_URL}/user-data/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-User-Id': userId
        },
        body: JSON.stringify(userData)
      });
      
      if (response.ok) {
        console.log('✅ All data synced to server');
        return true;
      }
    } catch (error) {
      console.error('Sync error:', error);
    }
    return false;
  },
  
  // Get all workout history from localStorage
  getWorkoutHistory() {
    const history = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('workout_progress_')) {
        history[key] = JSON.parse(localStorage.getItem(key));
      }
    }
    return history;
  },
  
  // Load all data from server
  async loadAllFromServer() {
    if (!window.auth || !window.auth.isAuthenticated) {
      return false;
    }
    
    try {
      const userId = window.auth.getCurrentUser().userId;
      const token = window.auth.getCurrentUser().token;
      const API_URL = window.location.hostname === 'localhost' 
        ? 'http://localhost:3000/api'
        : 'https://your-production-api.com/api';
      
      const response = await fetch(`${API_URL}/user-data/${userId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-User-Id': userId
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.profile && Object.keys(data.profile).length > 0) {
          localStorage.setItem('fitBlueprintData', JSON.stringify(data.profile));
        }
        if (data.savedWorkouts && data.savedWorkouts.length > 0) {
          localStorage.setItem('savedWorkouts', JSON.stringify(data.savedWorkouts));
        }
        if (data.workoutHistory) {
          for (const [key, value] of Object.entries(data.workoutHistory)) {
            localStorage.setItem(key, JSON.stringify(value));
          }
        }
        
        console.log('✅ All data loaded from server');
        return true;
      }
    } catch (error) {
      console.error('Load error:', error);
    }
    return false;
  },
  
  // Start auto-sync every 30 seconds
  startAutoSync() {
    setInterval(() => {
      if (window.auth && window.auth.isAuthenticated) {
        this.saveAllToServer();
      }
    }, 30000);
  }
};

// Export for use in other files
window.DataSync = DataSync;