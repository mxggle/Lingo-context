// Linguist Pro - Database Hook
// Placeholder for custom SQL backend integration

import { getConfig } from './config.js';

/**
 * Save a word/phrase to the backend database
 * @param {Object} data - The data to save
 * @param {string} data.text - The selected text
 * @param {string} data.meaning - The meaning/translation
 * @param {string} data.grammar - Grammar notes
 * @param {string} data.context - Surrounding context
 * @param {string} data.language - Detected language (ja/en)
 * @param {string} data.url - Source URL
 * @returns {Promise<Object>} Response from backend
 */
export async function saveWord(data) {
    const backendUrl = await getConfig('BACKEND_URL');

    if (!backendUrl) {
        throw new Error('Backend URL not configured. Please set it in extension settings.');
    }

    const payload = {
        text: data.text,
        meaning: data.meaning,
        grammar: data.grammar || null,
        context: data.context || null,
        language: data.language || 'en',
        url: data.url || window.location.href,
        savedAt: new Date().toISOString()
    };

    try {
        const response = await fetch(`${backendUrl}/words`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || `HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Failed to save word:', error);
        throw error;
    }
}

/**
 * Get saved words from backend
 * @param {Object} options - Query options
 * @param {string} options.language - Filter by language
 * @param {number} options.limit - Maximum results
 * @returns {Promise<Array>} List of saved words
 */
export async function getWords(options = {}) {
    const backendUrl = await getConfig('BACKEND_URL');

    if (!backendUrl) {
        throw new Error('Backend URL not configured');
    }

    const params = new URLSearchParams();
    if (options.language) params.set('language', options.language);
    if (options.limit) params.set('limit', options.limit.toString());

    const url = `${backendUrl}/words?${params.toString()}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Failed to get words:', error);
        throw error;
    }
}

/**
 * Delete a saved word
 * @param {string} id - Word ID
 * @returns {Promise<void>}
 * */
export async function deleteWord(id) {
    const backendUrl = await getConfig('BACKEND_URL');

    if (!backendUrl) {
        throw new Error('Backend URL not configured');
    }

    try {
        const response = await fetch(`${backendUrl}/words/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        console.error('Failed to delete word:', error);
        throw error;
    }
}
