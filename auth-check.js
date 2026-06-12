// auth-check.js - Complete authentication and session management
(function() {
    const API_URL = 'http://localhost:3000/api';
    
    // Get current session user
    function getCurrentUser() {
        return {
            userId: localStorage.getItem('userId'),
            username: localStorage.getItem('username'),
            token: localStorage.getItem('authToken'),
            sessionId: localStorage.getItem('sessionId'),
            sessionExpiresAt: localStorage.getItem('sessionExpiresAt')
        };
    }
    //just adding this 
    // Check if session is still valid (2 hours)
    function isSessionValid() {
        const expiresAt = localStorage.getItem('sessionExpiresAt');
        if (!expiresAt) return false;
        
        const now = Date.now();
        const expiryTime = parseInt(expiresAt);
        
        return now < expiryTime;
    }
    
    // Check if user is authenticated (token exists and session is valid)
    async function checkAuth() {
        const token = localStorage.getItem('authToken');
        const userId = localStorage.getItem('userId');
        
        if (!token || !userId) {
            redirectToLogin();
            return false;
        }
        
        // Check session expiration locally first
        if (!isSessionValid()) {
            console.log('Session expired');
            redirectToLogin();
            return false;
        }
        
        // Verify token with server
        try {
            const response = await fetch(`${API_URL}/verify`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-User-Id': userId
                }
            });
            
            if (!response.ok) {
                redirectToLogin();
                return false;
            }
            
            return true;
        } catch (error) {
            // If server unreachable but token exists and session not expired, allow access
            console.warn('Server unreachable, using cached auth');
            return isSessionValid();
        }
    }
    
    function redirectToLogin() {
        // Clear all user data on logout
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        localStorage.removeItem('userId');
        localStorage.removeItem('sessionId');
        localStorage.removeItem('sessionExpiresAt');
        window.location.href = 'login.html';
    }
    
    function logout() {
        const token = localStorage.getItem('authToken');
        const sessionId = localStorage.getItem('sessionId');
        
        if (token) {
            fetch(`${API_URL}/logout`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Session-Id': sessionId
                }
            }).catch(console.error);
        }
        
        redirectToLogin();
    }
    
    // Load user data from server
    async function loadUserData() {
        const token = localStorage.getItem('authToken');
        const userId = localStorage.getItem('userId');
        
        if (!token || !userId) return null;
        
        try {
            const response = await fetch(`${API_URL}/user-data/${userId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-User-Id': userId
                }
            });
            
            if (response.ok) {
                const userData = await response.json();
                if (userData.profile && Object.keys(userData.profile).length > 0) {
                    localStorage.setItem('fitBlueprintData', JSON.stringify(userData.profile));
                }
                if (userData.savedWorkouts && userData.savedWorkouts.length > 0) {
                    localStorage.setItem('savedWorkouts', JSON.stringify(userData.savedWorkouts));
                }
                if (userData.workoutHistory) {
                    localStorage.setItem('workoutHistory', JSON.stringify(userData.workoutHistory));
                }
                return userData;
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        }
        return null;
    }
    
    // Save user data to server
    async function saveUserData() {
        const token = localStorage.getItem('authToken');
        const userId = localStorage.getItem('userId');
        
        if (!token || !userId) return false;
        
        // Check session before saving
        if (!isSessionValid()) {
            redirectToLogin();
            return false;
        }
        
        const userData = {
            profile: JSON.parse(localStorage.getItem('fitBlueprintData') || '{}'),
            savedWorkouts: JSON.parse(localStorage.getItem('savedWorkouts') || '[]'),
            workoutHistory: JSON.parse(localStorage.getItem('workoutHistory') || '{}')
        };
        
        try {
            const response = await fetch(`${API_URL}/user-data/${userId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-User-Id': userId
                },
                body: JSON.stringify(userData)
            });
            
            return response.ok;
        } catch (error) {
            console.error('Error saving user data:', error);
            return false;
        }
    }
    
    // Auto-save periodically (every 30 seconds)
    let autoSaveInterval = null;
    
    function startAutoSave() {
        if (autoSaveInterval) clearInterval(autoSaveInterval);
        
        autoSaveInterval = setInterval(() => {
            if (getCurrentUser().token && isSessionValid()) {
                saveUserData();
                console.log('Auto-saved user data');
            }
        }, 30000);
    }
    
    function stopAutoSave() {
        if (autoSaveInterval) {
            clearInterval(autoSaveInterval);
            autoSaveInterval = null;
        }
    }
    
    // Add logout button to pages
    function addLogoutButton() {
        const existingBtn = document.getElementById('logoutBtn');
        if (existingBtn) return;
        
        const logoutBtn = document.createElement('button');
        logoutBtn.id = 'logoutBtn';
        logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
        logoutBtn.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f44336;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 20px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            z-index: 1000;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            transition: all 0.2s ease;
        `;
        logoutBtn.onmouseenter = () => logoutBtn.style.transform = 'scale(1.05)';
        logoutBtn.onmouseleave = () => logoutBtn.style.transform = 'scale(1)';
        logoutBtn.onclick = logout;
        document.body.appendChild(logoutBtn);
    }
    
    // Display username and session timer
    function displayUsername() {
        const username = localStorage.getItem('username');
        const expiresAt = localStorage.getItem('sessionExpiresAt');
        
        if (username) {
            const existing = document.getElementById('usernameDisplay');
            if (existing) existing.remove();
            
            const usernameDisplay = document.createElement('div');
            usernameDisplay.id = 'usernameDisplay';
            
            // Calculate time remaining
            if (expiresAt) {
                const remaining = Math.floor((parseInt(expiresAt) - Date.now()) / 1000 / 60);
                usernameDisplay.innerHTML = `<i class="fas fa-user-circle"></i> ${username} · ${remaining}m left`;
            } else {
                usernameDisplay.innerHTML = `<i class="fas fa-user-circle"></i> ${username}`;
            }
            
            usernameDisplay.style.cssText = `
                position: fixed;
                top: 20px;
                right: 130px;
                background: rgba(255,255,255,0.95);
                color: #667eea;
                padding: 8px 15px;
                border-radius: 20px;
                font-size: 14px;
                font-weight: bold;
                z-index: 1000;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            `;
            document.body.appendChild(usernameDisplay);
            
            // Update timer every minute
            setInterval(() => {
                const newExpiresAt = localStorage.getItem('sessionExpiresAt');
                if (newExpiresAt) {
                    const newRemaining = Math.floor((parseInt(newExpiresAt) - Date.now()) / 1000 / 60);
                    if (newRemaining > 0) {
                        usernameDisplay.innerHTML = `<i class="fas fa-user-circle"></i> ${username} · ${newRemaining}m left`;
                    } else {
                        usernameDisplay.innerHTML = `<i class="fas fa-user-circle"></i> ${username} · Expiring soon`;
                    }
                }
            }, 60000);
        }
    }
    
    // Initialize session
    async function initSession() {
        const isAuth = await checkAuth();
        if (isAuth) {
            await loadUserData();
            addLogoutButton();
            displayUsername();
            startAutoSave();
        }
        return isAuth;
    }
    
    // Session warning (show when 15 minutes left)
    function checkSessionWarning() {
        const expiresAt = localStorage.getItem('sessionExpiresAt');
        if (expiresAt) {
            const remaining = parseInt(expiresAt) - Date.now();
            const minutesLeft = Math.floor(remaining / 1000 / 60);
            
            if (minutesLeft === 15) {
                showSessionWarning('Your session will expire in 15 minutes. Please save your work.');
            } else if (minutesLeft === 5) {
                showSessionWarning('Your session will expire in 5 minutes! You will be logged out soon.');
            } else if (minutesLeft === 1) {
                showSessionWarning('Your session will expire in 1 minute!');
            }
        }
    }
    
    function showSessionWarning(message) {
        const warning = document.createElement('div');
        warning.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: #ff9800;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 1001;
            font-size: 14px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            animation: slideIn 0.3s ease;
        `;
        warning.innerHTML = `<i class="fas fa-clock"></i> ${message}`;
        document.body.appendChild(warning);
        setTimeout(() => warning.remove(), 5000);
    }
    
    // Check session warning every minute
    setInterval(checkSessionWarning, 60000);
    
    // Export functions
    window.auth = {
        logout,
        getCurrentUser,
        addLogoutButton,
        displayUsername,
        saveUserData,
        loadUserData,
        initSession,
        stopAutoSave,
        isSessionValid,
        isAuthenticated: !!localStorage.getItem('authToken') && isSessionValid()
    };
    
    // Auto-initialize if on a protected page (not login or signup)
    const isProtectedPage = !window.location.pathname.includes('login.html') && 
                            !window.location.pathname.includes('signup.html');
    
    if (isProtectedPage) {
        initSession();
    }
})();