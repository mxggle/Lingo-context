import { getConfig } from './config.js';

document.addEventListener('DOMContentLoaded', init);

async function init() {
    const refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.addEventListener('click', loadData);
    loadData();
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
        const response = await fetch(`${backendUrl}/stats`);
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
        const response = await fetch(`${backendUrl}/words?limit=50`);
        if (!response.ok) throw new Error('Words API Failed');
        const words = await response.json();

        if (words.length === 0) {
            list.innerHTML = '<div class="loading">No words saved yet.</div>';
            return;
        }

        list.innerHTML = words.map(word => `
            <div class="word-card">
                <div class="word-header">
                    <span class="word-text">${escapeHtml(word.text)}</span>
                    <span class="word-lang">${escapeHtml(word.language)}</span>
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
