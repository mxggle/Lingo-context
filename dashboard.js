import { getConfig } from './config.js';

document.addEventListener('DOMContentLoaded', init);

let allWords = []; // Store words for export

async function init() {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadData);

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportVocabulary);

    // Auth UI Elements
    const loginView = document.getElementById('loginView');
    const dashboardView = document.getElementById('dashboardView');
    const logoutBtn = document.getElementById('logoutBtn');
    const heroLoginBtn = document.getElementById('heroLoginBtn');

    // User Profile Elements
    const userProfile = document.getElementById('userProfile');
    const userName = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');

    const backendUrl = await getConfig('BACKEND_URL');
    const rootUrl = backendUrl ? backendUrl.replace('/api', '') : '';

    // Login handler
    const loginHandler = () => {
        if (rootUrl) location.href = `${rootUrl}/auth/google`;
    };

    if (heroLoginBtn) heroLoginBtn.addEventListener('click', loginHandler);
    // Old login button if it exists/legacy
    const oldLoginBtn = document.getElementById('loginBtn');
    if (oldLoginBtn) oldLoginBtn.addEventListener('click', loginHandler);

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (rootUrl) {
                await fetch(`${rootUrl}/auth/logout`, { credentials: 'include' });
                location.reload();
            }
        });
    }

    // Check Auth and Toggle Views
    try {
        const res = await fetch(`${backendUrl}/user`, { credentials: 'include' });
        const data = await res.json();

        if (data.authenticated) {
            // Show Dashboard
            loginView.style.display = 'none';
            dashboardView.style.display = 'block';

            // Setup Profile
            if (userName) userName.textContent = data.user.display_name || data.user.email;
            if (userAvatar && data.user.avatar_url) {
                userAvatar.src = data.user.avatar_url;
                userAvatar.style.display = 'block';
            }

            // Setup Language Preference
            setupLanguagePreference(data.user.target_language || 'English', backendUrl);

            // Load Data
            loadData();
        } else {
            // Show Login Hero
            loginView.style.display = 'block';
            dashboardView.style.display = 'none';
        }
    } catch (e) {
        console.error('Auth check failed', e);
        // Default to login view on error? Or show error?
        // For now, show login view
        loginView.style.display = 'block';
        dashboardView.style.display = 'none';
    }
}

function setupLanguagePreference(currentLanguage, backendUrl) {
    const languageSelect = document.getElementById('targetLanguage');
    const saveBtn = document.getElementById('saveLanguageBtn');
    const saveStatus = document.getElementById('languageSaveStatus');

    if (!languageSelect) return;

    // Set current language
    languageSelect.value = currentLanguage;
    let originalLanguage = currentLanguage;

    // Show save button when language changes
    languageSelect.addEventListener('change', () => {
        if (languageSelect.value !== originalLanguage) {
            saveBtn.style.display = 'inline-block';
            saveStatus.style.display = 'none';
        } else {
            saveBtn.style.display = 'none';
        }
    });

    // Save language preference
    saveBtn.addEventListener('click', async () => {
        const newLanguage = languageSelect.value;

        try {
            const response = await fetch(`${backendUrl}/user/preferences`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetLanguage: newLanguage }),
                credentials: 'include'
            });

            if (!response.ok) throw new Error('Failed to save preference');

            // Update original value and hide save button
            originalLanguage = newLanguage;
            saveBtn.style.display = 'none';

            // Show success message
            saveStatus.style.display = 'inline';
            setTimeout(() => {
                saveStatus.style.display = 'none';
            }, 3000);
        } catch (error) {
            console.error('Failed to save language preference:', error);
            alert('Failed to save language preference. Please try again.');
        }
    });
}

async function loadData() {
    const backendUrl = await getConfig('BACKEND_URL');

    if (!backendUrl) {
        showError('Backend URL not configured. Please check extension settings.');
        return;
    }

    try {
        await Promise.all([
            fetchStats(backendUrl),
            fetchWords(backendUrl)
        ]);
    } catch (error) {
        showError('Failed to connect to backend: ' + error.message);
    }
}

async function fetchStats(backendUrl) {
    try {
        const response = await fetch(`${backendUrl}/stats`, { credentials: 'include' });
        if (!response.ok) throw new Error('Stats API Failed');
        const data = await response.json();

        document.getElementById('totalWords').textContent = data.storage?.saved_words || 0;
        document.getElementById('totalRequests').textContent = data.usage?.total_requests || 0;

        const cost = data.usage?.total_cost || 0;
        document.getElementById('totalCost').textContent = '$' + cost.toFixed(4);
    } catch (e) {
        console.error(e);
        document.getElementById('totalRequests').textContent = 'Error';
    }
}

async function fetchWords(backendUrl) {
    const list = document.getElementById('wordsList');
    list.innerHTML = '<div class="loading">Loading...</div>';

    try {
        const response = await fetch(`${backendUrl}/words?limit=50`, { credentials: 'include' });
        if (!response.ok) throw new Error('Words API Failed');
        const words = await response.json();

        // Store words for export
        allWords = words;

        if (words.length === 0) {
            list.innerHTML = '<div class="loading">No words saved yet.</div>';
            return;
        }

        list.innerHTML = words.map((word, index) => `
            <div class="word-card">
                <div class="word-header">
                    <span class="word-text">${escapeHtml(word.text)}</span>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button class="play-audio-btn" data-word-index="${index}" data-word-text="${escapeHtml(word.text)}" data-word-lang="${escapeHtml(word.language)}">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                            </svg>
                            Listen
                        </button>
                        <button class="delete-btn" data-word-id="${word.id}" data-word-text="${escapeHtml(word.text)}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/>
                            </svg>
                            Delete
                        </button>
                        <span class="word-lang">${escapeHtml(word.language)}</span>
                    </div>
                </div>
                <div class="word-meaning">${escapeHtml(word.meaning)}</div>
                ${word.grammar ? `<div class="word-sub">${escapeHtml(word.grammar)}</div>` : ''}
                ${word.context ? `<div class="word-context">"${escapeHtml(word.context)}"</div>` : ''}
                <div class="word-meta">
                    <span>${new Date(word.saved_at).toLocaleDateString()}</span>
                    ${word.url ? `<a href="${word.url}" target="_blank" style="color: inherit;">Source</a>` : ''}
                </div>
            </div>
        `).join('');

        // Add event listeners for buttons
        setupEventListeners();
    } catch (e) {
        console.error(e);
        list.innerHTML = `<div class="error">Failed to load words. Is the backend running?</div>`;
    }
}

function showError(msg) {
    const list = document.getElementById('wordsList');
    list.innerHTML = `<div class="error">${escapeHtml(msg)}</div>`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setupEventListeners() {
    // Setup audio buttons
    const audioButtons = document.querySelectorAll('.play-audio-btn');
    audioButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const text = btn.getAttribute('data-word-text');
            const lang = btn.getAttribute('data-word-lang');
            playAudio(text, lang);
        });
    });

    // Setup delete buttons
    const deleteButtons = document.querySelectorAll('.delete-btn');
    deleteButtons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const wordId = btn.getAttribute('data-word-id');
            const wordText = btn.getAttribute('data-word-text');

            // Confirm deletion
            if (confirm(`Are you sure you want to delete "${wordText}"?`)) {
                await deleteWord(wordId);
            }
        });
    });
}

async function deleteWord(wordId) {
    const backendUrl = await getConfig('BACKEND_URL');

    if (!backendUrl) {
        alert('Backend URL not configured.');
        return;
    }

    try {
        const response = await fetch(`${backendUrl}/words/${wordId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Failed to delete word');
        }

        // Refresh the word list after successful deletion
        await loadData();
    } catch (error) {
        console.error('Delete error:', error);
        alert('Failed to delete word. Please try again.');
    }
}

function playAudio(text, language) {
    // Use Chrome extension's TTS API via background script
    // Map language codes to browser TTS format
    const langMap = {
        'ja': 'ja',
        'japanese': 'ja',
        'en': 'en',
        'english': 'en'
    };

    const lang = langMap[language?.toLowerCase()] || 'en';

    // Send message to background script to play TTS
    chrome.runtime.sendMessage({
        type: 'PLAY_TTS',
        text: text,
        lang: lang
    }, (response) => {
        if (response?.error) {
            console.error('TTS error:', response.message);
            // Fallback to browser TTS if extension TTS fails
            fallbackToSpeechSynthesis(text, language);
        }
    });
}

function fallbackToSpeechSynthesis(text, language) {
    // Fallback to browser's built-in TTS
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);

        const langMap = {
            'ja': 'ja-JP',
            'japanese': 'ja-JP',
            'en': 'en-US',
            'english': 'en-US'
        };

        utterance.lang = langMap[language?.toLowerCase()] || 'en-US';
        utterance.rate = 0.9;


        window.speechSynthesis.speak(utterance);
    }
}

function exportVocabulary() {
    if (!allWords || allWords.length === 0) {
        alert('No vocabulary to export. Please refresh the data first.');
        return;
    }

    // Create CSV content
    const headers = ['Text', 'Language', 'Meaning', 'Grammar', 'Context', 'URL', 'Saved Date'];
    const csvRows = [headers.join(',')];

    allWords.forEach(word => {
        const row = [
            escapeCSV(word.text),
            escapeCSV(word.language),
            escapeCSV(word.meaning),
            escapeCSV(word.grammar || ''),
            escapeCSV(word.context || ''),
            escapeCSV(word.url || ''),
            escapeCSV(new Date(word.saved_at).toLocaleString())
        ];
        csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');

    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vocabulary_${new Date().toISOString().split('T')[0]}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function escapeCSV(str) {
    if (!str) return '""';
    const text = String(str);
    // Escape quotes and wrap in quotes if contains comma, quote, or newline
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return `"${text}"`;
}
