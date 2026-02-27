import { getConfig } from './config.js';

document.addEventListener('DOMContentLoaded', init);

let allWords = []; // Store words for export
let currentFilterDate = null;

async function init() {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadData);

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportVocabulary);

    const clearFilterBtn = document.getElementById('clearFilterBtn');
    if (clearFilterBtn) {
        clearFilterBtn.addEventListener('click', () => {
            currentFilterDate = null;
            document.querySelectorAll('.graph-cell').forEach(c => c.classList.remove('selected'));
            renderWordsList(allWords.slice(0, 100));

            const title = document.getElementById('wordsSectionTitle');
            if (title) title.textContent = 'Recent Vocabulary';

            clearFilterBtn.style.display = 'none';
        });
    }

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

    // Load saved interface language first
    chrome.storage.local.get(['interfaceLanguage'], (result) => {
        const savedInterfaceLang = result.interfaceLanguage || 'en';
        const interfaceLangSelect = document.getElementById('interfaceLanguage');
        if (interfaceLangSelect) {
            interfaceLangSelect.value = savedInterfaceLang;
        }
        loadInterfaceLanguage(savedInterfaceLang);
    });

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

    // Modal Elements
    const settingsModal = document.getElementById('settingsModal');
    const settingsBtn = document.getElementById('settingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            if (settingsModal) settingsModal.classList.add('show');
        });
    }

    const closeModal = () => {
        if (settingsModal) settingsModal.classList.remove('show');
    };

    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', closeModal);
    }

    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) closeModal();
        });
    }

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

            // Setup Interface Language Preference
            const interfaceLangSelect = document.getElementById('interfaceLanguage');
            if (interfaceLangSelect) {
                interfaceLangSelect.addEventListener('change', () => {
                    const selected = interfaceLangSelect.value;
                    chrome.storage.local.set({ interfaceLanguage: selected });
                    loadInterfaceLanguage(selected);
                });
            }

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

    if (!languageSelect) return;

    // Set current language
    languageSelect.value = currentLanguage;
    let originalLanguage = currentLanguage;

    // Save language preference when changed
    languageSelect.addEventListener('change', async () => {
        const newLanguage = languageSelect.value;
        if (newLanguage === originalLanguage) return;

        try {
            const response = await fetch(`${backendUrl}/user/preferences`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetLanguage: newLanguage }),
                credentials: 'include'
            });

            if (!response.ok) throw new Error('Failed to save preference');

            // Update original value
            originalLanguage = newLanguage;

            // Show success message using toast
            showToast(getTransl('toastTranslationLanguageSaved') || 'Translation language saved!');
        } catch (error) {
            console.error('Failed to save language preference:', error);
            showToast(getTransl('toastTranslationLanguageError') || 'Failed to save language preference. Please try again.');
            languageSelect.value = originalLanguage; // Revert on failure
        }
    });
}

// ----------------------------------------------------
// i18n Interface Logic
// ----------------------------------------------------
let currentLocaleData = {};

function getTransl(key) {
    if (currentLocaleData[key] && currentLocaleData[key].message) {
        return currentLocaleData[key].message;
    }
    // Fallback logic could be implemented here if needed
    return key;
}

function processTranslPlaceholders(messageTemplate, ...args) {
    let result = messageTemplate;
    for (let i = 0; i < args.length; i++) {
        result = result.replace(new RegExp(`\\$${i + 1}`, 'g'), args[i]);
    }
    return result;
}

async function loadInterfaceLanguage(langCode) {
    try {
        const fileUrl = chrome.runtime.getURL(`_locales/${langCode}/messages.json`);
        const response = await fetch(fileUrl);

        if (!response.ok) {
            throw new Error(`Locale file not found for ${langCode}`);
        }

        currentLocaleData = await response.json();

        // Update DOM elements with data-i18n
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (currentLocaleData[key] && currentLocaleData[key].message) {
                el.textContent = currentLocaleData[key].message;
            }
        });

        // Update elements with data-i18n-title
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (currentLocaleData[key] && currentLocaleData[key].message) {
                el.title = currentLocaleData[key].message;
                // Also update title tags inside specifically for tooltips if they exist
            }
        });

        // Re-render dynamic content nicely to apply translations
        if (allWords && allWords.length > 0) {
            const currentFilterDateLocal = currentFilterDate; // backup
            if (document.getElementById('dashboardView').style.display === 'block') {
                if (currentFilterDateLocal) {
                    filterByDate(currentFilterDateLocal);
                } else {
                    renderWordsList(allWords.slice(0, 100));
                }
            }
        }

    } catch (e) {
        // Fallback to English if load fails
        if (langCode !== 'en') {
            loadInterfaceLanguage('en');
        }
    }
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
        const response = await fetch(`${backendUrl}/words`, { credentials: 'include' });
        if (!response.ok) throw new Error('Words API Failed');
        const words = await response.json();

        // Store words for export
        allWords = words;

        renderContributionGraph(words);
        renderWordsList(words.slice(0, 100)); // Render latest 100 by default
    } catch (e) {
        console.error(e);
        list.innerHTML = `<div class="error">Failed to load words. Is the backend running?</div>`;
    }
}

function renderWordsList(wordsToRender) {
    const list = document.getElementById('wordsList');

    if (!wordsToRender || wordsToRender.length === 0) {
        list.innerHTML = `<div class="loading">${getTransl('noWordsMsg') || 'No words found.'}</div>`;
        return;
    }

    const listenText = getTransl('listenBtn') || 'Listen';
    const deleteText = getTransl('deleteBtn') || 'Delete';

    list.innerHTML = wordsToRender.map((word, index) => `
        <div class="word-card" data-word-id="${word.id}">
            <div class="word-header">
                <span class="word-text">${escapeHtml(word.text)}</span>
                <div style="display: flex; gap: 8px; align-items: center;">
                    ${word.lookup_count > 1 ? `<span class="lookup-count">${word.lookup_count}x</span>` : ''}
                    <button class="play-audio-btn" data-word-index="${index}" data-word-text="${escapeHtml(word.text)}" data-word-lang="${escapeHtml(word.language)}">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                        </svg>
                        ${listenText}
                    </button>
                    <button class="delete-btn" data-word-id="${word.id}" data-word-text="${escapeHtml(word.text)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/>
                        </svg>
                        ${deleteText}
                    </button>
                    <span class="word-lang">${escapeHtml(word.language)}</span>
                </div>
            </div>
            <div class="word-meaning">${escapeHtml(word.meaning)}</div>
            ${word.grammar ? `<div class="word-sub">${escapeHtml(word.grammar)}</div>` : ''}
            ${renderContexts(word.contexts, word.id)}
            <div class="word-meta">
                <span>${new Date(word.saved_at).toLocaleDateString()}</span>
            </div>
        </div>
    `).join('');

    // Add event listeners for buttons
    setupEventListeners();
}

function renderContributionGraph(words) {
    const graphContainer = document.getElementById('contributionGraph');
    if (!graphContainer) return;

    // Ensure global tooltip exists
    let globalTooltip = document.getElementById('globalTooltip');
    if (!globalTooltip) {
        globalTooltip = document.createElement('div');
        globalTooltip.id = 'globalTooltip';
        document.body.appendChild(globalTooltip);
    }

    const wordsByDate = {};
    words.forEach(word => {
        const d = new Date(word.saved_at);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        wordsByDate[dateStr] = (wordsByDate[dateStr] || 0) + 1;
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 364);

    const startDay = startDate.getDay();
    startDate.setDate(startDate.getDate() - startDay);

    const days = [];
    let current = new Date(startDate);

    // We only go up to the end of the current week (Saturday)
    const endOfGraph = new Date(today);
    const endDay = endOfGraph.getDay();
    endOfGraph.setDate(endOfGraph.getDate() + (6 - endDay));
    endOfGraph.setHours(0, 0, 0, 0);

    while (current <= endOfGraph) {
        const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
        days.push({
            date: dateStr,
            count: wordsByDate[dateStr] || 0,
            dateObj: new Date(current),
            isFuture: current > today
        });
        current.setDate(current.getDate() + 1);
    }

    const weeks = [];
    let currentWeek = [];
    days.forEach(day => {
        currentWeek.push(day);
        if (currentWeek.length === 7) {
            weeks.push(currentWeek);
            currentWeek = [];
        }
    });
    if (currentWeek.length > 0) weeks.push(currentWeek);

    graphContainer.innerHTML = '';

    weeks.forEach(week => {
        const weekCol = document.createElement('div');
        weekCol.className = 'graph-week';

        week.forEach(day => {
            const cell = document.createElement('div');

            if (day.isFuture) {
                cell.className = 'graph-cell level-0';
                cell.style.opacity = '0.2';
                cell.style.pointerEvents = 'none';
            } else {
                let level = 0;
                if (day.count > 0) level = 1;
                if (day.count >= 3) level = 2;
                if (day.count >= 6) level = 3;
                if (day.count >= 10) level = 4;

                cell.className = `graph-cell level-${level}`;
                if (day.date === currentFilterDate) {
                    cell.classList.add('selected');
                }
                cell.dataset.date = day.date;

                cell.addEventListener('mouseenter', () => {
                    const rect = cell.getBoundingClientRect();
                    const dateDisplay = day.dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

                    const templateMsg = getTransl('nWordsOnDate') || '$1 words on $3';
                    const s = day.count !== 1 ? 's' : '';
                    globalTooltip.textContent = processTranslPlaceholders(templateMsg, day.count, s, dateDisplay);

                    globalTooltip.style.left = `${rect.left + rect.width / 2}px`;
                    globalTooltip.style.top = `${rect.top - 8}px`; // 8px above the cell
                    globalTooltip.style.opacity = '1';
                });

                cell.addEventListener('mouseleave', () => {
                    globalTooltip.style.opacity = '0';
                });

                cell.addEventListener('click', () => {
                    filterByDate(day.date);
                    document.querySelectorAll('.graph-cell').forEach(c => c.classList.remove('selected'));
                    cell.classList.add('selected');
                });
            }

            weekCol.appendChild(cell);
        });

        graphContainer.appendChild(weekCol);
    });
}

function filterByDate(dateStr) {
    currentFilterDate = dateStr;
    const filteredWords = allWords.filter(word => {
        const d = new Date(word.saved_at);
        const wordDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return wordDateStr === dateStr;
    });

    renderWordsList(filteredWords);

    const title = document.getElementById('wordsSectionTitle');
    const clearBtn = document.getElementById('clearFilterBtn');

    if (title) {
        // Just use simple parsing to avoid time zone issues
        const [y, m, d] = dateStr.split('-');
        const displayDate = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

        const templateMsg = getTransl('wordsOnDate') || `Words on $1`;
        title.textContent = processTranslPlaceholders(templateMsg, displayDate);
    }

    if (clearBtn) {
        clearBtn.style.display = 'block';
    }
}

// Render contexts with fold/expand functionality
function renderContexts(contexts, wordId) {
    if (!contexts || contexts.length === 0) return '';

    const firstContext = contexts[0];
    const remainingCount = contexts.length - 1;

    let html = `<div class="contexts-wrapper">`;

    const sourceText = getTransl('sourceLabel') || 'Source';

    // Show first (most recent) context
    if (firstContext.context) {
        html += `<div class="word-context">"${escapeHtml(firstContext.context)}"</div>`;
    }
    if (firstContext.url) {
        html += `<a href="${escapeHtml(firstContext.url)}" target="_blank" class="context-source">${sourceText}</a>`;
    }

    // Show "and X more" if there are additional contexts
    if (remainingCount > 0) {
        const templateMsg = getTransl('andMoreContext') || `...and $1 more context$2`;
        const s = remainingCount > 1 ? 's' : '';
        const moreText = processTranslPlaceholders(templateMsg, remainingCount, s);

        html += `<div class="context-more" data-word-id="${wordId}" data-original-text="${escapeHtml(moreText)}">${escapeHtml(moreText)}</div>`;
        html += `<div class="contexts-hidden" id="contexts-${wordId}">`;
        contexts.slice(1).forEach(ctx => {
            if (ctx.context) {
                html += `<div class="context-item">`;
                html += `<div class="word-context">"${escapeHtml(ctx.context)}"</div>`;
                if (ctx.url) {
                    html += `<a href="${escapeHtml(ctx.url)}" target="_blank" class="context-source">${sourceText}</a>`;
                }
                html += `</div>`;
            }
        });
        html += `</div>`;
    }

    html += `</div>`;
    return html;
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

function setupDeleteModal() {
    const modal = document.getElementById('deleteConfirmModal');
    const closeBtn = document.getElementById('closeDeleteModalBtn');
    const cancelBtn = document.getElementById('cancelDeleteBtn');
    const confirmBtn = document.getElementById('confirmDeleteBtn');

    const closeModal = () => {
        modal.classList.remove('show');
        pendingDeleteWordId = null;
    };

    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeModal);
    }

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }

    if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
            if (pendingDeleteWordId && typeof pendingDeleteWordId === 'function') {
                pendingDeleteWordId();
            }
            closeModal();
        });
    }
}

function showDeleteConfirmModal(wordText, onConfirm) {
    const modal = document.getElementById('deleteConfirmModal');
    const message = document.getElementById('deleteConfirmMessage');

    if (!modal) return;

    const confirmTemplate = getTransl('deleteConfirm') || `Are you sure you want to delete "$1"?`;
    message.textContent = processTranslPlaceholders(confirmTemplate, wordText);

    pendingDeleteWordId = onConfirm;

    modal.classList.add('show');
}

let pendingDeleteWordId = null;

function setupEventListeners() {
    setupDeleteModal();
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

            showDeleteConfirmModal(wordText, async () => {
                await deleteWord(wordId);
            });
        });
    });

    // Setup context expand/collapse buttons
    const contextMoreButtons = document.querySelectorAll('.context-more');
    contextMoreButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wordId = btn.getAttribute('data-word-id');
            const hiddenContexts = document.getElementById(`contexts-${wordId}`);
            const originalText = btn.getAttribute('data-original-text');

            if (hiddenContexts) {
                const isExpanded = hiddenContexts.classList.toggle('expanded');
                const lessText = getTransl('showLess') || 'Show less';
                btn.textContent = isExpanded ? lessText : originalText;
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

        // Remove the word card from DOM directly without refreshing the list
        const wordCard = document.querySelector(`.word-card[data-word-id="${wordId}"]`);
        if (wordCard) {
            wordCard.style.transition = 'opacity 0.3s, transform 0.3s';
            wordCard.style.opacity = '0';
            wordCard.style.transform = 'translateX(-20px)';
            wordCard.addEventListener('transitionend', () => {
                wordCard.remove();
                
                // Check if list is now empty and show message
                const remainingCards = document.querySelectorAll('.word-card');
                if (remainingCards.length === 0) {
                    const list = document.getElementById('wordsList');
                    list.innerHTML = `<div class="loading">${getTransl('noWordsMsg') || 'No words found.'}</div>`;
                }
            }, { once: true });
        }

        // Update total words count in stats
        const totalWordsEl = document.getElementById('totalWords');
        if (totalWordsEl) {
            const currentCount = parseInt(totalWordsEl.textContent) || 0;
            if (currentCount > 0) {
                totalWordsEl.textContent = currentCount - 1;
            }
        }

        showToast(getTransl('deleteSuccess') || 'Word deleted');
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

    // Create CSV content with updated headers
    const headers = ['Text', 'Language', 'Meaning', 'Grammar', 'Lookup Count', 'Contexts', 'Saved Date'];
    const csvRows = [headers.join(',')];

    allWords.forEach(word => {
        // Combine all contexts into a single string
        const contextsStr = (word.contexts || [])
            .map(ctx => {
                let str = ctx.context || '';
                if (ctx.url) str += ` (${ctx.url})`;
                return str;
            })
            .filter(s => s)
            .join(' | ');

        const row = [
            escapeCSV(word.text),
            escapeCSV(word.language),
            escapeCSV(word.meaning),
            escapeCSV(word.grammar || ''),
            escapeCSV(String(word.lookup_count || 1)),
            escapeCSV(contextsStr),
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

// Show toast notification
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';

    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);

    document.body.appendChild(toast);

    // Auto-remove after 3 seconds with fade out
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300); // Wait for fade-out animation
    }, 3000);
}
