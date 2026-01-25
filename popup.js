import { CONFIG } from './config.js';

document.addEventListener('DOMContentLoaded', async () => {
    const enabledToggle = document.getElementById('enabled');
    const dashboardBtn = document.getElementById('dashboardBtn');
    const status = document.getElementById('status');

    // Load saved settings
    const settings = await chrome.storage.local.get([
        'EXTENSION_ENABLED'
    ]);

    enabledToggle.checked = settings.EXTENSION_ENABLED !== false;

    // Dashboard Button
    if (dashboardBtn) {
        dashboardBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: 'dashboard.html' });
        });
    }

    // Auto-save settings
    enabledToggle.addEventListener('change', async () => {
        const enabled = enabledToggle.checked;

        try {
            await chrome.storage.local.set({
                EXTENSION_ENABLED: enabled
            });

            // Optional: show subtle status or just rely on the toggle state
            // showStatus('Settings saved'); 
        } catch (error) {
            showStatus('Failed to save settings', true);
            // Revert toggle if save failed
            enabledToggle.checked = !enabled;
        }
    });

    updateAuthUI();

    function showStatus(message, isError = false) {
        status.textContent = message;
        status.className = 'status visible' + (isError ? ' error' : '');

        setTimeout(() => {
            status.classList.remove('visible');
        }, 3000);
    }

    // Auth Logic
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const authSection = document.getElementById('authSection');
    const userInfo = document.getElementById('userInfo');
    const userName = document.getElementById('userName');
    const userEmail = document.getElementById('userEmail');
    const userAvatar = document.getElementById('userAvatar');

    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: `${CONFIG.BACKEND_URL.replace('/api', '')}/auth/google` });
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                const res = await fetch(`${CONFIG.BACKEND_URL.replace('/api', '')}/auth/logout`);
                updateAuthUI();
            } catch (e) {
                console.error('Logout failed', e);
            }
        });
    }

    async function updateAuthUI() {
        try {
            const res = await fetch(`${CONFIG.BACKEND_URL}/user`);
            const data = await res.json();

            if (data.authenticated) {
                authSection.style.display = 'none';
                userInfo.style.display = 'block';
                userName.textContent = data.user.display_name || 'User';
                userEmail.textContent = data.user.email;
                if (data.user.avatar_url) {
                    userAvatar.src = data.user.avatar_url;
                    userAvatar.style.display = 'block';
                }
            } else {
                authSection.style.display = 'block';
                userInfo.style.display = 'none';
            }
        } catch (error) {
            console.error('Failed to check auth status:', error);
            // Assume not logged in or backend down
            authSection.style.display = 'block';
            userInfo.style.display = 'none';
        }
    }
});
