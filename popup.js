import { CONFIG, getConfig } from './config.js';
import { initI18n, getTransl } from './i18n.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize i18n first
    await new Promise(resolve => initI18n(resolve));
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
        loginBtn.addEventListener('click', async () => {
            const backendUrl = await getConfig('BACKEND_URL');
            chrome.tabs.create({ url: `${backendUrl.replace('/api', '')}/auth/google` });
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            // Clear local storage auth
            await chrome.storage.local.remove(['LINGOCONTEXT_USER', 'LINGOCONTEXT_LOGGED_IN']);

            const backendUrl = await getConfig('BACKEND_URL');
            try {
                await fetch(`${backendUrl.replace('/api', '')}/auth/logout`, {
                    credentials: 'include'
                });
            } catch (e) {
                console.error('Logout request failed', e);
            }
            updateAuthUI();
        });
    }

    async function updateAuthUI() {
        // First check local storage (set by content script on success page)
        const stored = await chrome.storage.local.get(['LINGOCONTEXT_USER', 'LINGOCONTEXT_LOGGED_IN']);

        if (stored.LINGOCONTEXT_LOGGED_IN && stored.LINGOCONTEXT_USER) {
            const user = stored.LINGOCONTEXT_USER;
            authSection.style.display = 'none';
            userInfo.style.display = 'block';
            userName.textContent = user.display_name || 'User';
            userEmail.textContent = user.email;
            if (user.avatar_url) {
                userAvatar.src = user.avatar_url;
                userAvatar.style.display = 'block';
            }
            return;
        }

        // Fallback: try to check via backend (may not work due to cookie issues)
        const backendUrl = await getConfig('BACKEND_URL');
        try {
            const res = await fetch(`${backendUrl}/user`, {
                credentials: 'include'
            });
            const data = await res.json();

            if (data.authenticated) {
                // Store for future use
                chrome.storage.local.set({
                    LINGOCONTEXT_USER: data.user,
                    LINGOCONTEXT_LOGGED_IN: true
                });

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
