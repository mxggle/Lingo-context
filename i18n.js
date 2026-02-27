/**
 * Shared Internationalization (i18n) Utility
 * Fetches the user's preferred interface language from chrome.storage
 * and loads the corresponding messages.json string maps.
 */

let currentLocaleData = {};

/**
 * Get a localized string by key
 * @param {string} key - The key from messages.json
 * @returns {string} The localized string or the key if not found
 */
export function getTransl(key) {
    if (currentLocaleData[key] && currentLocaleData[key].message) {
        return currentLocaleData[key].message;
    }
    return key;
}

/**
 * Replace placeholders ($1, $2, etc.) in a localized string
 * @param {string} messageTemplate - The string containing placeholders
 * @param  {...any} args - The values to replace placeholders with
 * @returns {string} The formatted string
 */
export function processTranslPlaceholders(messageTemplate, ...args) {
    let result = messageTemplate;
    for (let i = 0; i < args.length; i++) {
        result = result.replace(new RegExp(`\\$${i + 1}`, 'g'), args[i]);
    }
    return result;
}

/**
 * Returns the currently loaded raw locale data object
 * @returns {Object}
 */
export function getLocaleData() {
    return currentLocaleData;
}

/**
 * Updates DOM elements containing data-i18n or data-i18n-title attributes
 */
export function applyTranslationsToDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (currentLocaleData[key] && currentLocaleData[key].message) {
            el.textContent = currentLocaleData[key].message;
        }
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (currentLocaleData[key] && currentLocaleData[key].message) {
            el.title = currentLocaleData[key].message;
        }
    });
}

/**
 * Fetch and load the preferred language from storage, fallback to en
 * @param {Function} onComplete - Callback executed after translations are loaded and applied
 */
export async function initI18n(onComplete) {
    chrome.storage.local.get(['interfaceLanguage'], async (result) => {
        const langCode = result.interfaceLanguage || 'en';
        await loadInterfaceLanguage(langCode);
        if (onComplete) onComplete(langCode);
    });
}

/**
 * Force load a specific language code
 * @param {string} langCode - Language code ('en', 'zh_CN', 'ja', etc.)
 */
export async function loadInterfaceLanguage(langCode) {
    try {
        const fileUrl = chrome.runtime.getURL(`_locales/${langCode}/messages.json`);
        const response = await fetch(fileUrl);

        if (!response.ok) {
            throw new Error(`Locale file not found for ${langCode}`);
        }

        currentLocaleData = await response.json();
        applyTranslationsToDOM();

    } catch (e) {
        console.error("Failed to load interface language:", e);
        // Fallback to English if load fails and we aren't already trying to load English
        if (langCode !== 'en') {
            await loadInterfaceLanguage('en');
        }
    }
}
