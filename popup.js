import { CONFIG, getConfig } from './config.js';
import { initI18n, getTransl } from './i18n.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize i18n first
    await new Promise(resolve => initI18n(resolve));
    const enabledToggle = document.getElementById('enabled');
    const autoPlayAudioToggle = document.getElementById('autoPlayAudio');
    const dashboardBtn = document.getElementById('dashboardBtn');
    const status = document.getElementById('status');

    // Display version number
    const versionDisplay = document.getElementById('versionDisplay');
    if (versionDisplay) {
        versionDisplay.textContent = `v${chrome.runtime.getManifest().version}`;
    }

    // Load saved settings
    const settings = await chrome.storage.local.get([
        'EXTENSION_ENABLED',
        'AUTO_PLAY_AUDIO'
    ]);

    enabledToggle.checked = settings.EXTENSION_ENABLED !== false;
    autoPlayAudioToggle.checked = settings.AUTO_PLAY_AUDIO === true;

    // Dashboard Button
    if (dashboardBtn) {
        dashboardBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: 'dashboard.html' });
        });
    }

    // Status pill
    const statusPill = document.getElementById('statusPill');
    const statusPillLabel = document.getElementById('statusPillLabel');

    function updateStatusPill(enabled) {
        if (!statusPill) return;
        statusPill.classList.toggle('inactive', !enabled);
        statusPillLabel.textContent = enabled ? 'On' : 'Off';
    }

    updateStatusPill(enabledToggle.checked);

    // Auto-save settings
    const toggleCard = document.getElementById('toggleCard');
    enabledToggle.addEventListener('change', async () => {
        const enabled = enabledToggle.checked;
        updateStatusPill(enabled);

        try {
            await chrome.storage.local.set({ EXTENSION_ENABLED: enabled });

            if (toggleCard) {
                toggleCard.classList.remove('saved');
                void toggleCard.offsetWidth;
                toggleCard.classList.add('saved');
                toggleCard.addEventListener('animationend', () => {
                    toggleCard.classList.remove('saved');
                }, { once: true });
            }
        } catch (error) {
            showStatus('Failed to save settings', true);
            enabledToggle.checked = !enabled;
            updateStatusPill(!enabled);
        }
    });

    autoPlayAudioToggle.addEventListener('change', async () => {
        const enabled = autoPlayAudioToggle.checked;
        try {
            await chrome.storage.local.set({ AUTO_PLAY_AUDIO: enabled });

            if (toggleCard) {
                toggleCard.classList.remove('saved');
                void toggleCard.offsetWidth;
                toggleCard.classList.add('saved');
                toggleCard.addEventListener('animationend', () => {
                    toggleCard.classList.remove('saved');
                }, { once: true });
            }
        } catch (error) {
            showStatus('Failed to save settings', true);
            autoPlayAudioToggle.checked = !enabled;
        }
    });

    function showStatus(message, isError = false) {
        status.textContent = message;
        status.className = 'toast visible' + (isError ? ' error' : '');

        setTimeout(() => {
            status.classList.remove('visible');
        }, 3000);
    }

    // ── Auth Logic ──────────────────────────────────────────────
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const authArea = document.getElementById('authArea');
    const authSection = document.getElementById('authSection');
    const userInfo = document.getElementById('userInfo');
    const userName = document.getElementById('userName');
    const userEmail = document.getElementById('userEmail');
    const userAvatar = document.getElementById('userAvatar');
    const avatarPlaceholder = document.getElementById('avatarPlaceholder');

    function setAvatar(url, name) {
        if (url) {
            userAvatar.src = url;
            userAvatar.style.display = 'block';
            if (avatarPlaceholder) avatarPlaceholder.style.display = 'none';
        } else {
            if (avatarPlaceholder) avatarPlaceholder.textContent = (name || '?')[0].toUpperCase();
        }
    }

    // Apply auth view without transition (instant = true) or with fade.
    // Call this before revealing authArea to avoid any flash.
    function applyAuthState(user, instant = false) {
        if (instant) {
            // Skip CSS transitions for this change
            authSection.style.transition = 'none';
            userInfo.style.transition = 'none';
        }

        if (user) {
            authSection.classList.add('hidden-auth');
            authSection.style.display = 'none';
            userInfo.style.display = 'block';
            userInfo.classList.remove('hidden-auth');
            userName.textContent = user.display_name || 'User';
            userEmail.textContent = user.email;
            setAvatar(user.avatar_url, user.display_name || 'U');
        } else {
            userInfo.classList.add('hidden-auth');
            userInfo.style.display = 'none';
            authSection.style.display = 'block';
            authSection.classList.remove('hidden-auth');
        }

        if (instant) {
            // Re-enable transitions after paint so future changes animate
            requestAnimationFrame(() => {
                authSection.style.transition = '';
                userInfo.style.transition = '';
            });
        }
    }

    // Step 1: Read local storage synchronously-as-possible, apply state,
    // then reveal authArea — user never sees the wrong view.
    const stored = await chrome.storage.local.get(['LINGOCONTEXT_USER', 'LINGOCONTEXT_LOGGED_IN']);

    if (stored.LINGOCONTEXT_LOGGED_IN && stored.LINGOCONTEXT_USER) {
        applyAuthState(stored.LINGOCONTEXT_USER, true);
        authArea.classList.add('auth-ready');
    } else {
        // No local cache — check backend before revealing
        const backendUrl = await getConfig('BACKEND_URL');
        try {
            const res = await fetch(`${backendUrl}/user`, { credentials: 'include' });
            const data = await res.json();
            if (data.authenticated) {
                chrome.storage.local.set({ LINGOCONTEXT_USER: data.user, LINGOCONTEXT_LOGGED_IN: true });
                applyAuthState(data.user, true);
            } else {
                applyAuthState(null, true);
            }
        } catch {
            applyAuthState(null, true);
        }
        authArea.classList.add('auth-ready');
    }

    // Step 2: Wire up buttons
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const backendUrl = await getConfig('BACKEND_URL');
            chrome.tabs.create({ url: `${backendUrl.replace('/api', '')}/auth/google` });
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            // Instantly switch to login view — no waiting for network
            applyAuthState(null, false);

            // Clear storage and hit backend in background
            chrome.storage.local.remove(['LINGOCONTEXT_USER', 'LINGOCONTEXT_LOGGED_IN']);
            getConfig('BACKEND_URL').then(backendUrl =>
                fetch(`${backendUrl.replace('/api', '')}/auth/logout`, { credentials: 'include' })
                    .catch(e => console.error('Logout request failed', e))
            );
        });
    }
});
