// auth-check.js - Authentication management (simplifié)
(function() {
    // Détection automatique de l'environnement
    const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000/api'
        : 'https://myfitness-app-1-a77k.onrender.com/api';
    
    console.log('🔧 Auth initialized, API_URL:', API_URL);
    
    // Vérifier si l'utilisateur est authentifié
    function isAuthenticated() {
        const token = localStorage.getItem('authToken');
        const expiresAt = localStorage.getItem('sessionExpiresAt');
        
        if (!token) return false;
        if (expiresAt && Date.now() > parseInt(expiresAt)) return false;
        
        return true;
    }
    
    // Rediriger vers login
    function redirectToLogin() {
        localStorage.clear();
        window.location.href = 'login.html';
    }
    
    // Déconnexion
    function logout() {
        const token = localStorage.getItem('authToken');
        if (token) {
            fetch(`${API_URL}/logout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(console.error);
        }
        redirectToLogin();
    }
    
    // Sauvegarder les données utilisateur sur le serveur
    async function saveUserData() {
        const token = localStorage.getItem('authToken');
        const userId = localStorage.getItem('userId');
        
        if (!token || !userId) return false;
        
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
    
    // Auto-save
    let autoSaveInterval = null;
    
    function startAutoSave() {
        if (autoSaveInterval) clearInterval(autoSaveInterval);
        autoSaveInterval = setInterval(() => {
            if (isAuthenticated()) {
                saveUserData();
            }
        }, 30000);
    }
    
    function stopAutoSave() {
        if (autoSaveInterval) {
            clearInterval(autoSaveInterval);
            autoSaveInterval = null;
        }
    }
    
    // Ajouter bouton logout
    function addLogoutButton() {
        if (document.getElementById('logoutBtn')) return;
        
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
        `;
        logoutBtn.onclick = logout;
        document.body.appendChild(logoutBtn);
    }
    
    // Afficher nom d'utilisateur
    function displayUsername() {
        const username = localStorage.getItem('username');
        const expiresAt = localStorage.getItem('sessionExpiresAt');
        
        if (!username) return;
        
        if (document.getElementById('usernameDisplay')) return;
        
        const usernameDisplay = document.createElement('div');
        usernameDisplay.id = 'usernameDisplay';
        
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
        
        // Mettre à jour le timer chaque minute
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
    
    // Exporter
    window.auth = {
        logout,
        saveUserData,
        startAutoSave,
        stopAutoSave,
        addLogoutButton,
        displayUsername,
        isAuthenticated: isAuthenticated(),
        redirectToLogin
    };
})();