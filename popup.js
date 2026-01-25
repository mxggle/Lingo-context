import { CONFIG } from './config.js';

document.addEventListener('DOMContentLoaded', async () => {
    const enabledToggle = document.getElementById('enabled');
    const saveBtn = document.getElementById('saveBtn');
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

    // Save settings
    saveBtn.addEventListener('click', async () => {
        const enabled = enabledToggle.checked;

        try {
            await chrome.storage.local.set({
                EXTENSION_ENABLED: enabled
            });

            showStatus('Settings saved successfully!');
        } catch (error) {
            showStatus('Failed to save settings', true);
        }
    });

    function showStatus(message, isError = false) {
        status.textContent = message;
        status.className = 'status visible' + (isError ? ' error' : '');

        setTimeout(() => {
            status.classList.remove('visible');
        }, 3000);
    }
});
