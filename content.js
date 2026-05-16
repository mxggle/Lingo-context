// LingoContext - Content Script
// Handles text selection and popup display

// Inline config (content scripts can't use ES modules)
const CONFIG = {
  WORD_THRESHOLD: 3,
  CONTEXT_SENTENCE_MAX: 320
};

// State management
let popup = null;
let triggerIcon = null;
let shadowRoot = null;
let isLoading = false;
let definitionRequestId = 0;
let currentSelection = null;
let activeSelection = null;
let isDragging = false;
let isResizing = false;
let resizeStarted = false;
let dragStartX = 0;
let dragStartY = 0;
let initialPopupX = 0;
let initialPopupY = 0;
let isPinned = false;
let popupSize = { width: 380, height: null }; // null height = natural height
let lastKnownSize = { width: 0, height: 0 };

// i18n State
let currentLocaleData = {};
let interfaceLanguage = 'en';

// Initialize the extension
let isExtensionEnabled = true;
let autoPlayAudio = false;
const wordDefinitionCache = new Map(); // text → string[]

// Current speak state (updated immediately on selection, refined when AI finishes)
let currentSpeakText = '';
let currentSpeakLang = 'en';

async function init() {
  // Check for auth data from success page (for login flow)
  await checkForAuthData();
  setupAuthSuccessActions();

  // Load language preference and settings
  chrome.storage.local.get(['EXTENSION_ENABLED', 'interfaceLanguage', 'AUTO_PLAY_AUDIO'], async (result) => {
    isExtensionEnabled = result.EXTENSION_ENABLED !== false;
    interfaceLanguage = result.interfaceLanguage || 'en';
    autoPlayAudio = result.AUTO_PLAY_AUDIO === true;
    await loadLocaleData(interfaceLanguage);
  });

  // Listen for changes
  chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local') {
      if (changes.EXTENSION_ENABLED) {
        isExtensionEnabled = changes.EXTENSION_ENABLED.newValue;
        if (!isExtensionEnabled) {
          hidePopup();
        }
      }
      if (changes.AUTO_PLAY_AUDIO) {
        autoPlayAudio = changes.AUTO_PLAY_AUDIO.newValue === true;
      }
      if (changes.interfaceLanguage) {
        interfaceLanguage = changes.interfaceLanguage.newValue;
        await loadLocaleData(interfaceLanguage);
        // If popup is visible, re-render it
        if (popup && !popup.classList.contains('hidden') && activeSelection) {
          const wordCount = activeSelection.text.split(/\s+/).length;
          const mode = wordCount <= CONFIG.WORD_THRESHOLD ? 'word' : 'phrase';
          analyzeText(activeSelection.text, activeSelection.context, mode);
        }
      }
    }
  });

  createPopup();
  setupEventListeners();

  // Load user-saved popup size
  chrome.storage.local.get('POPUP_SIZE', (result) => {
    if (result.POPUP_SIZE) {
      popupSize = result.POPUP_SIZE;
    }
  });

  console.log('LingoContext content script loaded');
}

// Load external locale json directly because chrome.i18n is restricted to browser language
async function loadLocaleData(langCode) {
  try {
    const fileUrl = chrome.runtime.getURL(`_locales/${langCode}/messages.json`);
    const response = await fetch(fileUrl);
    if (response.ok) {
      currentLocaleData = await response.json();
    }
  } catch (e) {
    console.error("Content script failed to load locale data:", e);
  }
}

// Get translated string (returns '' if not loaded yet, so || fallbacks work)
function getTransl(key) {
  if (currentLocaleData[key] && currentLocaleData[key].message) {
    return currentLocaleData[key].message;
  }
  return '';
}

function getPageContextLabel(key, fallback) {
  return getTransl(key) || fallback;
}

// Replace placeholders in string ($1, $2, etc)
function processTranslPlaceholders(messageTemplate, ...args) {
  let result = messageTemplate;
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp(`\\$${i + 1}`, 'g'), args[i]);
  }
  return result;
}

async function getAllowedAuthOrigins() {
  const stored = await chrome.storage.local.get('BACKEND_URL');
  const backendUrl = stored.BACKEND_URL || 'https://lingo-context-api.vercel.app/api';
  const rootUrl = backendUrl.replace('/api', '');

  const allowedOrigins = new Set();
  try {
    allowedOrigins.add(new URL(rootUrl).origin);
  } catch (e) {
    // Ignore malformed URLs and fall back to known production origin.
  }
  allowedOrigins.add('https://lingo-context-api.vercel.app');
  return allowedOrigins;
}

// Check for auth data embedded in the page (from /auth/success)
async function checkForAuthData() {
  const authDataEl = document.getElementById('lingocontext-auth-data');
  if (authDataEl) {
    try {
      const allowedOrigins = await getAllowedAuthOrigins();
      if (!allowedOrigins.has(window.location.origin)) {
        return;
      }

      const userData = JSON.parse(authDataEl.getAttribute('data-user'));
      if (userData && userData.id) {
        // Store user data in chrome.storage.local for popup/dashboard to use
        chrome.storage.local.set({
          LINGOCONTEXT_USER: userData,
          LINGOCONTEXT_LOGGED_IN: true
        }, () => {
          console.log('LingoContext: Auth data saved from success page');
        });
      }
    } catch (e) {
      console.error('LingoContext: Failed to parse auth data', e);
    }
  }
}

function setupAuthSuccessActions() {
  const dashboardButton = document.getElementById('lingocontext-open-dashboard');
  const dashboardStatus = document.getElementById('lingocontext-dashboard-status');
  if (!dashboardButton) {
    return;
  }

  const openDashboard = (shouldUpdateStatus = false) => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD_IN_CURRENT_TAB' }, () => {
      if (shouldUpdateStatus && dashboardStatus) {
        dashboardStatus.textContent = getTransl('authSuccessDashboardOpened') || 'Dashboard opened. You can close this window.';
      }
    });
  };

  dashboardButton.addEventListener('click', (event) => {
    event.preventDefault();
    openDashboard(true);
  });

  if (!sessionStorage.getItem('lingocontext-dashboard-opened')) {
    sessionStorage.setItem('lingocontext-dashboard-opened', 'true');
    openDashboard(true);
  }
}

// Create Shadow DOM popup
function createPopup() {
  const host = document.createElement('div');
  host.id = 'lingo-context-host';
  shadowRoot = host.attachShadow({ mode: 'closed' });

  // Inject styles into shadow DOM
  const styles = document.createElement('style');
  styles.textContent = getPopupStyles();
  shadowRoot.appendChild(styles);

  // Create popup container
  popup = document.createElement('div');
  popup.id = 'lingo-context-popup';
  popup.className = 'popup hidden';
  shadowRoot.appendChild(popup);

  // Create trigger icon
  triggerIcon = document.createElement('div');
  triggerIcon.id = 'lingo-context-trigger';
  triggerIcon.className = 'trigger-icon hidden';
  // Simple sparkle/AI icon
  triggerIcon.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px;">
      <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" stroke-opacity="0.5" stroke-width="1.5"></path>
      <circle cx="12" cy="12" r="4" fill="#fbbf24" stroke="none"></circle>
    </svg>
  `;
  shadowRoot.appendChild(triggerIcon);

  document.body.appendChild(host);
}

// Get popup inline styles (compiled from Tailwind concepts)
function getPopupStyles() {
  return `
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    .popup {
      position: fixed;
      z-index: 2147483647;
      width: 380px;
      min-width: 260px;
      min-height: 200px;
      max-width: 90vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      background: linear-gradient(135deg, #1c1917 0%, #292524 100%);
      border: 1px solid rgba(120, 113, 108, 0.2);
      border-radius: 16px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5),
                  0 0 0 1px rgba(255, 255, 255, 0.05);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      color: #e7e5e4;
      animation: slideUp 0.25s ease-out;
      overflow: auto;
      resize: both;
    }

    .popup::-webkit-resizer {
      background: transparent;
    }

    .resize-hint {
      position: absolute;
      bottom: 4px;
      right: 4px;
      width: 10px;
      height: 10px;
      pointer-events: none;
      opacity: 0.3;
    }

    .resize-hint::before,
    .resize-hint::after {
      content: '';
      position: absolute;
      background: #a8a29e;
      border-radius: 1px;
    }

    .resize-hint::before {
      width: 10px;
      height: 1.5px;
      bottom: 4px;
      right: 0;
      box-shadow: 0 -3px 0 #a8a29e;
    }

    .resize-hint::after {
      width: 1.5px;
      height: 10px;
      bottom: 0;
      right: 4px;
      box-shadow: -3px 0 0 #a8a29e;
    }

    .popup.hidden {
      display: none;
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes fadeOut {
      from {
        opacity: 1;
        transform: translateY(0);
      }
      to {
        opacity: 0;
        transform: translateY(-10px);
      }
    }

    .popup-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid rgba(120, 113, 108, 0.2);
      cursor: move;
      user-select: none;
    }

    .popup-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #a8a29e;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .pin-btn,
    .close-btn {
      background: none;
      border: none;
      color: #78716c;
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .pin-btn:hover,
    .close-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #e7e5e4;
    }

    .pin-btn.active {
      color: #fbbf24;
    }

    .pin-btn.active:hover {
      color: #fcd34d;
      background: rgba(251, 191, 36, 0.1);
    }

    .popup.pinned .popup-header {
      border-bottom-color: rgba(251, 191, 36, 0.25);
    }

    .popup-content {
      padding: 16px;
      flex: 1;
      overflow-y: auto;
      min-height: 0; /* required for flex overflow to work */
    }

    .selected-text {
      font-size: 20px;
      font-weight: 600;
      color: #fafaf9;
      margin-bottom: 12px;
      line-height: 1.4;
    }

    .selected-text ruby {
      display: ruby;
      ruby-position: over;
      ruby-align: center;
    }

    .selected-text rt {
      display: ruby-text;
      font-size: 0.5em;
      text-align: center;
      color: #fbbf24;
    }

    .section {
      margin-bottom: 12px;
    }

    .section:last-child {
      margin-bottom: 0;
    }

    .section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #a8a29e;
      margin-bottom: 4px;
    }

    .section-content {
      font-size: 14px;
      line-height: 1.6;
      color: #d6d3d1;
    }

    .meaning-content {
      color: #fbbf24;
    }

    .grammar-content {
      color: #fcd34d;
      font-size: 13px;
      white-space: pre-line;
    }

    .dictionary-content {
      font-size: 13px;
      line-height: 1.5;
      color: #6ee7b7;
    }

    .dict-entry + .dict-entry {
      margin-top: 3px;
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
      padding: 12px 16px;
      border-top: 1px solid rgba(120, 113, 108, 0.2);
      padding-top: 12px;
      border-top: 1px solid rgba(120, 113, 108, 0.2);
    }

    .action-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 12px;
      border: none;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }

    .action-btn.primary {
      background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
      color: #1c1917;
    }

    .action-btn.primary:hover {
      background: linear-gradient(135deg, #fcd34d 0%, #fbbf24 100%);
      transform: translateY(-1px);
    }

    .action-btn.secondary {
      background: rgba(255, 255, 255, 0.05);
      color: #a8a29e;
      border: 1px solid rgba(120, 113, 108, 0.2);
    }

    .action-btn.secondary:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #e7e5e4;
    }

    .action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .action-btn svg {
      width: 16px;
      height: 16px;
    }

    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 16px;
    }

    .loading-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(251, 191, 36, 0.2);
      border-top-color: #fbbf24;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .loading-text {
      margin-top: 12px;
      font-size: 13px;
      color: #a8a29e;
    }

    /* Skeleton Loading Animation */
    @keyframes shimmer {
      0% {
        background-position: -200% 0;
      }
      100% {
        background-position: 200% 0;
      }
    }

    .skeleton {
      background: linear-gradient(90deg, 
        rgba(255, 255, 255, 0.03) 25%, 
        rgba(255, 255, 255, 0.08) 50%, 
        rgba(255, 255, 255, 0.03) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite linear;
      border-radius: 4px;
    }

    .skeleton-line {
      height: 14px;
      margin-bottom: 8px;
    }

    .skeleton-line:last-child {
      margin-bottom: 0;
      width: 80%;
    }

    .error {
      padding: 16px;
      text-align: center;
    }

    .error-icon {
      font-size: 32px;
      margin-bottom: 8px;
    }

    .error-message {
      font-size: 14px;
      color: #f87171;
    }

    .error-retry {
      margin-top: 12px;
      padding: 8px 16px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid rgba(248, 113, 113, 0.2);
      border-radius: 8px;
      color: #f87171;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .error-retry:hover {
      background: rgba(248, 113, 113, 0.2);
    }

    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 12px 20px;
      background: #1c1917;
      color: #e7e5e4;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
      border: 1px solid rgba(120, 113, 108, 0.3);
      display: flex;
      align-items: center;
      gap: 12px;
      animation: slideUp 0.3s ease-out forwards;
      transition: opacity 0.3s ease-out;
    }

    .toast.fade-out {
      animation: fadeOut 0.3s ease-in forwards;
    }

    .toast-login-btn {
      background: #fbbf24;
      color: #1c1917;
      border: none;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: all 0.15s;
    }

    .toast-login-btn:hover {
      background: #fcd34d;
      transform: translateY(-1px);
    }

    .trigger-icon {
      position: fixed;
      z-index: 2147483647;
      width: 36px;
      height: 36px;
      background: #1c1917;
      border: 1px solid rgba(251, 191, 36, 0.4);
      border-radius: 50%;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -1px rgba(0, 0, 0, 0.1);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fbbf24;
      transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      transform: scale(0);
      opacity: 0;
    }

    .trigger-icon.visible {
      transform: scale(1);
      opacity: 1;
    }

    .trigger-icon:hover {
      transform: scale(1.1);
      background: #292524;
      box-shadow: 0 0 15px rgba(251, 191, 36, 0.3);
      border-color: #fbbf24;
    }
    
    .trigger-icon.hidden {
      display: none;
    }
  `;
}

// Setup event listeners
function setupEventListeners() {
  // Text selection on mouseup
  document.addEventListener('mouseup', handleSelection);

  // Hide trigger icon when the selection is cleared.
  // Delay slightly so onclick on the trigger icon fires before we hide it.
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || !sel.toString().trim()) {
      setTimeout(() => {
        const current = window.getSelection();
        if (!current || !current.toString().trim()) {
          if (triggerIcon && triggerIcon.classList.contains('visible')) {
            triggerIcon.classList.remove('visible');
            triggerIcon.classList.add('hidden');
          }
        }
      }, 120);
    }
  });

  // Close popup on click outside (but allow interaction inside popup)
  document.addEventListener('mousedown', (e) => {
    // Check if click is inside the shadow host
    const host = document.getElementById('lingo-context-host');
    if (host && host.contains(e.target)) {
      return; // Don't close if clicking inside our extension
    }

    // Check if popup or trigger icon exists and is visible
    const isPopupVisible = popup && !popup.classList.contains('hidden');
    const isTriggerVisible = triggerIcon && !triggerIcon.classList.contains('hidden');

    if (isPopupVisible || isTriggerVisible) {
      // When pinned, keep the popup open so the user can select new text
      // and load it into the fixed popup position
      if (isPinned && isPopupVisible) {
        return;
      }

      // Small delay to allow text selection inside popup
      setTimeout(() => {
        const selection = window.getSelection();
        // Don't close if there's a selection starting from our popup
        if (selection && selection.toString().trim()) {
          return;
        }
        // If no selection and click was outside, hide popup
        // Note: we check both popup and triggerIcon containment
        const hitPopup = popup && popup.contains(e.target);
        const hitTrigger = triggerIcon && triggerIcon.contains(e.target);

        if (!hitPopup && !hitTrigger) {
          hidePopup();
        }
      }, 10);
    }
  });

  // Close on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hidePopup();
    }
  });

  // Drag functionality
  setupDragListeners();
}

function setupDragListeners() {
  // Use popup element for mousedown since it's inside the closed shadow root
  popup.addEventListener('mousedown', (e) => {
    const rect = popup.getBoundingClientRect();
    const resizeHandleSize = 18;
    const clickedResizeHandle = (
      rect.right - e.clientX <= resizeHandleSize &&
      rect.bottom - e.clientY <= resizeHandleSize
    );

    if (clickedResizeHandle) {
      isResizing = true;
      resizeStarted = false;
      lastKnownSize = { width: popup.offsetWidth, height: popup.offsetHeight };
      return;
    }

    // Check if clicking header or inside header
    const header = e.target.closest('.popup-header');

    if (header) {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      initialPopupX = rect.left;
      initialPopupY = rect.top;

      // Prevent text selection while dragging
      document.body.style.userSelect = 'none';
      popup.style.transition = 'none'; // Disable transition for smooth dragging
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging && popup) {
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;

      popup.style.left = `${initialPopupX + deltaX}px`;
      popup.style.top = `${initialPopupY + deltaY}px`;
    }

    if (isResizing && popup) {
      const w = popup.offsetWidth;
      const h = popup.offsetHeight;
      if (w !== lastKnownSize.width || h !== lastKnownSize.height) {
        resizeStarted = true;
      }
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.userSelect = '';
      if (popup) {
        popup.style.transition = '';
      }
    }

    if (isResizing && popup && !popup.classList.contains('hidden') && resizeStarted) {
      const w = popup.offsetWidth;
      const h = popup.offsetHeight;
      lastKnownSize = { width: w, height: h };
      popupSize = { width: w, height: h };
      chrome.storage.local.set({ POPUP_SIZE: popupSize });
    }

    isResizing = false;
    resizeStarted = false;
  });
}

// Handle text selection
function handleSelection(e) {
  if (e.target.closest('#lingo-context-host')) {
    return;
  }

  if (!isExtensionEnabled) {
    return;
  }

  const selection = window.getSelection();
  const text = selection.toString().trim();

  if (!text || text.length < 1) {
    return;
  }

  currentSelection = {
    text,
    range: selection.getRangeAt(0),
    context: getSurroundingContext(selection)
  };

  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  const mode = wordCount <= CONFIG.WORD_THRESHOLD ? 'word' : 'phrase';

  // Check language coverage
  const detectedLang = detectLanguage(text);
  if (detectedLang === 'other') {
    return;
  }

  // Position and show popup
  // Position and show trigger icon instead of popup immediately
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  showTriggerIcon(rect, text, mode);
}

function normalizeContextText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function splitIntoSentences(text) {
  const sentences = [];
  let start = 0;
  const sentenceEndPattern = /[。.!?！？]/;
  const closingPunctuationPattern = /["'”’」』）)\]｝】》]/;

  for (let i = 0; i < text.length; i++) {
    if (!sentenceEndPattern.test(text[i])) continue;

    let end = i + 1;
    while (end < text.length && closingPunctuationPattern.test(text[end])) {
      end++;
    }

    const sentenceText = text.slice(start, end);
    if (normalizeContextText(sentenceText)) {
      sentences.push({ start, end, text: sentenceText });
    }

    start = end;
    while (start < text.length && /\s/.test(text[start])) {
      start++;
    }
    i = start - 1;
  }

  if (start < text.length) {
    const sentenceText = text.slice(start);
    if (normalizeContextText(sentenceText)) {
      sentences.push({ start, end: text.length, text: sentenceText });
    }
  }

  return sentences;
}

function isSentenceSelection(selectedText) {
  const text = normalizeContextText(selectedText);
  if (!text) return false;
  if (/[。.!?！？]["'”’」』）)\]｝】》]*$/.test(text)) return true;
  return text.split(/\s+/).filter(Boolean).length > CONFIG.WORD_THRESHOLD;
}

function trimSentenceAroundSelection(sentenceText, selectedText) {
  const normalizedSentence = normalizeContextText(sentenceText);
  if (normalizedSentence.length <= CONFIG.CONTEXT_SENTENCE_MAX) {
    return normalizedSentence;
  }

  const selectedIndex = normalizedSentence.indexOf(normalizeContextText(selectedText));
  if (selectedIndex === -1) {
    return normalizedSentence.slice(0, CONFIG.CONTEXT_SENTENCE_MAX).trim();
  }

  const selectedLength = normalizeContextText(selectedText).length;
  const spareChars = Math.max(CONFIG.CONTEXT_SENTENCE_MAX - selectedLength, 0);
  const beforeChars = Math.floor(spareChars / 2);
  const start = Math.max(0, selectedIndex - beforeChars);
  const end = Math.min(normalizedSentence.length, start + CONFIG.CONTEXT_SENTENCE_MAX);
  const trimmed = normalizedSentence.slice(start, end).trim();

  return `${start > 0 ? '...' : ''}${trimmed}${end < normalizedSentence.length ? '...' : ''}`;
}

function getSelectedTextContext(fullText, selectedText) {
  const index = fullText.indexOf(selectedText);
  if (index === -1) {
    return normalizeContextText(selectedText);
  }

  const selectionEnd = index + selectedText.length;
  const sentences = splitIntoSentences(fullText);
  const selectedSentenceIndex = sentences.findIndex(sentence =>
    sentence.start <= index && sentence.end >= selectionEnd
  );

  if (selectedSentenceIndex === -1) {
    return normalizeContextText(selectedText);
  }

  if (!isSentenceSelection(selectedText)) {
    return trimSentenceAroundSelection(sentences[selectedSentenceIndex].text, selectedText);
  }

  const start = Math.max(0, selectedSentenceIndex - 1);
  const end = Math.min(sentences.length, selectedSentenceIndex + 2);
  return normalizeContextText(sentences.slice(start, end).map(sentence => sentence.text).join(' '));
}

// Get surrounding context for better analysis
function getSurroundingContext(selection) {
  try {
    const range = selection.getRangeAt(0);
    const node = range.startContainer;

    // Get parent text content
    let parent = node.parentElement;
    while (parent && !['P', 'DIV', 'ARTICLE', 'SECTION', 'LI'].includes(parent.tagName)) {
      parent = parent.parentElement;
    }

    let contextParts = [];

    // Add only the page title as page-level context.
    const pageTitle = document.title?.trim();

    if (pageTitle) {
      contextParts.push(`[${getPageContextLabel('pageTitleLabel', 'Page Title')}: ${pageTitle}]`);
    }

    // Add a short selection-level context: word/term = current sentence,
    // sentence/passage = previous + selected + next sentence.
    if (parent) {
      const fullText = parent.textContent || '';
      const selectedText = selection.toString();
      const selectedTextContext = getSelectedTextContext(fullText, selectedText);
      if (selectedTextContext) {
        contextParts.push(selectedTextContext);
      }
    }

    return contextParts.join('\n');
  } catch (e) {
    return selection.toString();
  }
}

// Show trigger icon near selection
function showTriggerIcon(rect, text, mode) {
  if (!triggerIcon) return;

  triggerIcon.classList.remove('hidden');
  // Force reflow for animation
  void triggerIcon.offsetWidth;
  triggerIcon.classList.add('visible');

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const ICON_SIZE = 36;
  const GAP = 10;

  // Position to the right of the end of selection
  let left = rect.right + GAP;
  let top = rect.top + (rect.height / 2) - (ICON_SIZE / 2); // Center vertically relative to line

  // Create a new clone to handle clean event listeners
  const newIcon = triggerIcon.cloneNode(true);
  triggerIcon.parentNode.replaceChild(newIcon, triggerIcon);
  triggerIcon = newIcon;

  // Adjust if off screen
  if (left + ICON_SIZE > viewportWidth) {
    // Attempt to put it below
    left = rect.right - ICON_SIZE;
    top = rect.bottom + GAP;
  }

  // Ensure it's not off-screen top/bottom
  if (top < GAP) top = GAP;
  if (top + ICON_SIZE > viewportHeight - GAP) top = viewportHeight - ICON_SIZE - GAP;

  triggerIcon.style.left = `${left}px`;
  triggerIcon.style.top = `${top}px`;

  triggerIcon.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    triggerIcon.classList.remove('visible');
    triggerIcon.classList.add('hidden');
    showPopup(rect, text, mode);
  };
}

// Show popup at selection position with smart edge detection
function showPopup(rect, text, mode) {
  const selectionContext = currentSelection?.context || getSurroundingContext(window.getSelection());
  activeSelection = {
    text,
    context: selectionContext
  };

  // If pinned, skip repositioning — just update content at current position
  if (isPinned) {
    popup.classList.remove('hidden');
    popup.style.opacity = '1';
    analyzeText(text, activeSelection.context, mode);
    return;
  }

  const MARGIN = 12;
  const GAP = 8;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Apply saved (or default) size before measuring
  popup.style.width = `${popupSize.width}px`;
  if (popupSize.height) {
    popup.style.height = `${popupSize.height}px`;
  } else {
    popup.style.height = '';
  }

  popup.style.opacity = '0';
  popup.classList.remove('hidden');
  popup.innerHTML = renderLoading();
  syncPinButton();
  popup.querySelector('[data-action="close"]')?.addEventListener('click', hidePopup);
  popup.querySelector('[data-action="pin"]')?.addEventListener('click', handlePinAction);

  requestAnimationFrame(() => {
    const popupW = popup.offsetWidth;
    const popupH = popup.offsetHeight;

    // Center horizontally on selection
    let left = rect.left + (rect.width / 2) - (popupW / 2);
    let top = rect.bottom + GAP;

    // Clamp to viewport edges
    left = Math.max(MARGIN, Math.min(left, viewportWidth - popupW - MARGIN));

    // Prefer below; flip above if not enough room
    if (top + popupH > viewportHeight - MARGIN) {
      const topAbove = rect.top - popupH - GAP;
      if (topAbove >= MARGIN) {
        top = topAbove;
      } else {
        top = MARGIN;
      }
    }

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.opacity = '1';

    lastKnownSize = { width: popup.offsetWidth, height: popup.offsetHeight };

    analyzeText(text, activeSelection.context, mode);
  });
}

// Detect if text contains Japanese characters
function isJapaneseText(text) {
  return /[　-鿿豈-﫿]/.test(text);
}

// Update the selected-text element with furigana HTML
function updateFuriganaDisplay(html) {
  const el = popup?.querySelector('.selected-text');
  if (el) el.innerHTML = html;
}

// Render quick definition meanings as HTML string
function renderDictHtml(meanings) {
  if (!meanings?.length) return '';
  return meanings.map((m, i) =>
    `<div class="dict-entry">${i + 1}. ${escapeHtml(m)}</div>`
  ).join('');
}

// Update the quick definition section content in the popup
function updateDictionarySection(meanings) {
  const el = popup?.querySelector('.dictionary-content');
  if (el) el.innerHTML = renderDictHtml(meanings);
}

// Streaming helper: Extract partial string values from streaming JSON
const STREAMING_KEYS = ['meaning', 'grammar', 'furigana', 'audio_text', 'language'];
const STREAMING_REGEXES = {};
for (const key of STREAMING_KEYS) {
  STREAMING_REGEXES[key] = new RegExp('"' + key + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)');
}

function extractStreamingJson(str) {
  const data = {};

  for (const key of STREAMING_KEYS) {
    const match = str.match(STREAMING_REGEXES[key]);
    if (match) {
      let val = match[1];
      val = val.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      data[key] = val;
    }
  }
  return data;
}

// Streaming helper: Update DOM with partial data
function updateStreamingResult(data) {
  const meaningEl = popup.querySelector('.meaning-content');
  if (meaningEl && data.meaning) {
    meaningEl.innerHTML = escapeHtml(data.meaning);
  }

  const grammarEl = popup.querySelector('.grammar-content');
  if (grammarEl && data.grammar) {
    grammarEl.innerHTML = escapeHtml(data.grammar);
  }
}

// Analyze text with Gemini (streaming)
function analyzeText(text, context, mode) {
  isLoading = true;
  let streamingText = '';
  let fastDictDefinitions = null;

  // Render initial skeleton popup
  popup.innerHTML = renderResult(text, {}, mode, true);
  syncPinButton();
  popup.querySelector('[data-action="close"]')?.addEventListener('click', hidePopup);
  popup.querySelector('[data-action="pin"]')?.addEventListener('click', handlePinAction);

  // Setup initial actions (save disabled until AI finishes; speak enabled immediately)
  const speakBtn = popup.querySelector('[data-action="speak"]');
  const saveBtn = popup.querySelector('[data-action="save"]');
  if (saveBtn) saveBtn.disabled = true;

  // Enable speak immediately with original selected text — not blocked by AI
  currentSpeakText = text;
  currentSpeakLang = detectLanguage(text);
  if (speakBtn) {
    speakBtn.addEventListener('click', () => speakText(currentSpeakText, currentSpeakLang));
  }

  // Fast furigana via kuromoji (Japanese text only)
  if (isJapaneseText(text)) {
    chrome.runtime.sendMessage({ type: 'FAST_FURIGANA', text }, (res) => {
      if (res?.furigana && res.furigana.includes('<ruby>')) {
        updateFuriganaDisplay(res.furigana);
      }
    });
  }

  // Quick definition via AI (word mode only, no context)
  if (mode === 'word') {
    const myRequestId = ++definitionRequestId;
    const cached = wordDefinitionCache.get(text);
    if (cached) {
      fastDictDefinitions = cached;
      updateDictionarySection(cached);
    } else {
      chrome.runtime.sendMessage({ type: 'WORD_DEFINITION', text, nativeLanguage: interfaceLanguage }, (res) => {
        if (myRequestId !== definitionRequestId) return; // stale — user moved to a new word
        if (res?.meanings?.length) {
          wordDefinitionCache.set(text, res.meanings);
          fastDictDefinitions = res.meanings;
          updateDictionarySection(res.meanings);
        }
      });
    }
  }

  try {
    const port = chrome.runtime.connect({ name: 'analyze-stream' });
    let streamFinished = false;

    port.postMessage({
      type: 'START_ANALYZE_STREAM',
      text,
      context,
      mode
    });

    const handleMessage = (msg) => {
      if (msg.error) {
        popup.innerHTML = renderError(msg.message);
        syncPinButton();
        setupErrorActions();
        isLoading = false;
        streamFinished = true;
        port.disconnect();
        return;
      }

      if (msg.type === 'CHUNK') {
        streamingText += msg.text;
        const partialData = extractStreamingJson(streamingText);
        updateStreamingResult(partialData);
      } else if (msg.type === 'DONE') {
        streamFinished = true;
        finishStream();
      }
    };

    port.onMessage.addListener(handleMessage);

    port.onDisconnect.addListener(() => {
      port.onMessage.removeListener(handleMessage);
      if (isLoading && !streamFinished) {
        finishStream();
      }
    });

    function finishStream() {
      isLoading = false;
      try {
        const fullData = JSON.parse(streamingText);

        // Targeted updates — preserve .dictionary-content (Quick Definition) in place
        // to avoid a visual jump when finishStream fires after WORD_DEFINITION has filled it
        const meaningEl = popup.querySelector('.meaning-content');
        if (meaningEl && fullData.meaning) meaningEl.innerHTML = escapeHtml(fullData.meaning);

        const grammarEl = popup.querySelector('.grammar-content');
        if (grammarEl && fullData.grammar) grammarEl.innerHTML = escapeHtml(fullData.grammar);

        if (saveBtn) saveBtn.disabled = false;

        // Refine speak target with AI-cleaned text
        currentSpeakText = fullData.audio_text || text;
        currentSpeakLang = fullData.language || detectLanguage(currentSpeakText);

        syncPinButton();
        setupPopupActions(fullData);

        // AI furigana is context-aware — apply it over the kuromoji preliminary version
        if (fullData.furigana?.includes('<ruby>')) {
          updateFuriganaDisplay(fullData.furigana);
        }
        if (autoPlayAudio) {
          speakText(currentSpeakText, currentSpeakLang);
        }
      } catch (e) {
        // Fallback if final JSON is malformed or empty
        if (!streamingText.trim()) {
          popup.innerHTML = renderError(getTransl('streamEmptyError') || 'No response from AI service. Please try again.');
          syncPinButton();
          setupErrorActions();
          return;
        }

        const partialData = extractStreamingJson(streamingText);

        if (saveBtn) saveBtn.disabled = false;

        currentSpeakText = partialData.audio_text || text;
        currentSpeakLang = partialData.language || detectLanguage(currentSpeakText);

        syncPinButton();
        setupPopupActions(partialData);
        if (autoPlayAudio) {
          speakText(currentSpeakText, currentSpeakLang);
        }
      }
    }
  } catch (error) {
    popup.innerHTML = renderError(error.message);
    syncPinButton();
    setupErrorActions();
    isLoading = false;
  }
}

// Pin button HTML (reused across all header renders)
function pinBtnHtml() {
  return `
    <button class="pin-btn${isPinned ? ' active' : ''}" data-action="pin" title="${isPinned ? (getTransl('unpinPopupTitle') || 'Unpin popup') : (getTransl('pinPopupTitle') || 'Pin popup position')}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
      </svg>
    </button>`;
}

// Sync pin button visual state after any innerHTML update
function syncPinButton() {
  const pinBtn = popup.querySelector('[data-action="pin"]');
  if (!pinBtn) return;
  pinBtn.classList.toggle('active', isPinned);
  pinBtn.title = isPinned
    ? (getTransl('unpinPopupTitle') || 'Unpin popup')
    : (getTransl('pinPopupTitle') || 'Pin popup position');
  popup.classList.toggle('pinned', isPinned);
}

// Render loading state
function renderLoading() {
  const analyzingStr = getTransl('analyzingTitle') || 'Analyzing...';
  const insightsStr = getTransl('gettingInsights') || 'Getting insights...';

  return `
    <div class="popup-header">
      <span class="popup-title">${escapeHtml(analyzingStr)}</span>
      <div class="header-actions">
        ${pinBtnHtml()}
        <button class="close-btn" data-action="close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="loading">
      <div class="loading-spinner"></div>
      <div class="loading-text">${escapeHtml(insightsStr)}</div>
    </div>
    <div class="resize-hint"></div>
  `;
}

// Render error state
function renderError(message) {
  const errorTitleStr = getTransl('errorTitle') || 'Error';
  const tryAgainStr = getTransl('tryAgainBtn') || 'Try Again';

  return `
    <div class="popup-header">
      <span class="popup-title">${escapeHtml(errorTitleStr)}</span>
      <div class="header-actions">
        ${pinBtnHtml()}
        <button class="close-btn" data-action="close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="error">
      <div class="error-icon">⚠️</div>
      <div class="error-message">${escapeHtml(message)}</div>
      <button class="error-retry" data-action="retry">${escapeHtml(tryAgainStr)}</button>
    </div>
    <div class="resize-hint"></div>
  `;
}

// Render analysis result
function renderResult(originalText, data, mode, isStreamingInit = false, dictDefinitions = null) {
  // Use original text by default to preserve spacing/formatting
  let displayText = escapeHtml(originalText);

  // Only use furigana version if it's Japanese or clearly contains Ruby tags
  // This prevents issues where the AI might strip spaces from English text
  if (data.furigana && (
    data.language === 'ja' ||
    data.source_language === 'ja' ||
    data.furigana.includes('<ruby>')
  )) {
    displayText = data.furigana;
  }

  const modeLabel = mode === 'word'
    ? (getTransl('wordAnalysisLabel') || 'Word Analysis')
    : (getTransl('phraseAnalysisLabel') || 'Phrase Analysis');

  const meaningLabel = getTransl('meaningLabel') || 'Meaning';
  const grammarLabel = getTransl('grammarLabel') || 'Grammar';
  const listenLabel = getTransl('listenBtn') || 'Listen';
  const saveLabel = getTransl('saveBtn') || 'Save';

  const skeletonHtml = `
    <div class="skeleton skeleton-line"></div>
    <div class="skeleton skeleton-line"></div>
    <div class="skeleton skeleton-line" style="width: 60%"></div>
  `;

  const showDictSection = mode === 'word';
  const dictHtml = showDictSection ? `
      <div class="section">
        <div class="section-label">${getTransl('quickDefinitionLabel') || 'Quick Definition'}</div>
        <div class="section-content dictionary-content">${
          isStreamingInit
            ? (dictDefinitions ? renderDictHtml(dictDefinitions) : skeletonHtml)
            : (dictDefinitions ? renderDictHtml(dictDefinitions) : '')
        }</div>
      </div>
  ` : '';

  return `
    <div class="popup-header">
      <span class="popup-title">${escapeHtml(modeLabel)}</span>
      <div class="header-actions">
        ${pinBtnHtml()}
        <button class="close-btn" data-action="close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="popup-content">
      <div class="selected-text">${displayText}</div>

      ${dictHtml}

      <div class="section">
        <div class="section-label">${escapeHtml(meaningLabel)}</div>
        <div class="section-content meaning-content">${isStreamingInit ? skeletonHtml : escapeHtml(data.meaning)}</div>
      </div>

      ${(data.grammar || isStreamingInit) ? `
        <div class="section">
          <div class="section-label">${escapeHtml(grammarLabel)}</div>
          <div class="section-content grammar-content">${isStreamingInit ? skeletonHtml : escapeHtml(data.grammar)}</div>
        </div>
      ` : ''}
    </div>
    <div class="actions">
      <button class="action-btn primary" data-action="speak">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
        </svg>
        ${escapeHtml(listenLabel)}
      </button>
      <button class="action-btn secondary" data-action="save">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        ${escapeHtml(saveLabel)}
      </button>
    </div>
    <div class="resize-hint"></div>
  `;
}

// Toggle pin state
function handlePinAction() {
  isPinned = !isPinned;
  syncPinButton();
}

// Setup error popup actions (retry + close)
function setupErrorActions() {
  popup.querySelector('[data-action="close"]')?.addEventListener('click', hidePopup);
  popup.querySelector('[data-action="pin"]')?.addEventListener('click', handlePinAction);

  popup.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
    if (activeSelection) {
      const wordCount = activeSelection.text.split(/\s+/).length;
      const mode = wordCount <= CONFIG.WORD_THRESHOLD ? 'word' : 'phrase';
      popup.innerHTML = renderLoading();
      analyzeText(activeSelection.text, activeSelection.context, mode);
    }
  });
}

// Setup popup button actions
function setupPopupActions(data) {
  popup.querySelector('[data-action="close"]')?.addEventListener('click', hidePopup);
  popup.querySelector('[data-action="pin"]')?.addEventListener('click', handlePinAction);

  popup.querySelector('[data-action="save"]')?.addEventListener('click', () => {
    saveWord(activeSelection?.text, data);
  });

  popup.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
    if (activeSelection) {
      const wordCount = activeSelection.text.split(/\s+/).length;
      const mode = wordCount <= CONFIG.WORD_THRESHOLD ? 'word' : 'phrase';
      popup.innerHTML = renderLoading();
      analyzeText(activeSelection.text, activeSelection.context, mode);
    }
  });
}

// Simple language detection
function detectLanguage(text) {
  // Check for Japanese characters (Kanji, Hiragana, Katakana)
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  if (japaneseRegex.test(text)) {
    return 'ja';
  }

  // Check for English (Latin characters)
  // We want to ensure there is at least some Latin text
  const englishRegex = /[a-zA-Z]/;
  if (englishRegex.test(text)) {
    return 'en';
  }

  return 'other';
}

// Speak via Edge TTS (routed through background.js), fall back to Web Speech API
function speakText(text, lang) {
  if (!text) return;
  if (window.speechSynthesis) window.speechSynthesis.cancel();

  chrome.runtime.sendMessage({ type: 'EDGE_TTS', text, lang }, (response) => {
    if (chrome.runtime.lastError || !response?.audio) {
      speakWithWebSpeech(text, lang);
      return;
    }
    try {
      const binary = atob(response.audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => { URL.revokeObjectURL(url); speakWithWebSpeech(text, lang); };
      audio.play().catch(() => { URL.revokeObjectURL(url); speakWithWebSpeech(text, lang); });
    } catch (_) {
      speakWithWebSpeech(text, lang);
    }
  });
}

function speakWithWebSpeech(text, lang) {
  if (!window.speechSynthesis) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const langMap = {
    'ja': 'ja-JP', 'en': 'en-US', 'zh': 'zh-CN', 'ko': 'ko-KR',
    'fr': 'fr-FR', 'de': 'de-DE', 'es': 'es-ES', 'pt': 'pt-BR',
    'ru': 'ru-RU', 'ar': 'ar-SA', 'it': 'it-IT', 'nl': 'nl-NL',
    'tr': 'tr-TR', 'pl': 'pl-PL', 'vi': 'vi-VN', 'th': 'th-TH'
  };
  const bcp47 = langMap[lang] || 'en-US';
  const langPrefix = bcp47.split('-')[0];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = bcp47;
  utterance.rate = 0.9;
  utterance.pitch = 1.0;
  const go = () => {
    const voices = synth.getVoices();
    const voice = voices.find(v => v.lang.startsWith(langPrefix) && v.name.includes('Google') && !v.localService)
      || voices.find(v => v.lang.startsWith(langPrefix) && !v.localService)
      || voices.find(v => v.lang.startsWith(langPrefix));
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  };
  if (synth.getVoices().length > 0) go();
  else synth.addEventListener('voiceschanged', go, { once: true });
}

// Save word to backend
async function saveWord(text, data) {
  try {
    const payload = {
      text,
      meaning: data.meaning,
      grammar: data.grammar,
      context: activeSelection?.context,
      language: data.language || 'en',
      url: window.location.href
    };

    const response = await chrome.runtime.sendMessage({
      type: 'SAVE_WORD',
      data: payload
    });

    if (response.error) {
      const msg = response.message;
      if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('HTTP 401')) {
        showToast(getTransl('toastLoginToSave') || 'Please Login to Save', 'login');
      } else if (msg.includes('backend URL')) {
        showToast(getTransl('toastBackendNotConfigured') || 'Backend not configured');
      } else {
        const errorTemplate = getTransl('toastFailedToSave') || 'Failed to save: $1';
        showToast(processTranslPlaceholders(errorTemplate, response.message));
      }
    } else {
      // Show context-aware message based on action
      if (response.action === 'lifted') {
        showToast(getTransl('toastWordUpdated') || 'Word updated!');
      } else if (response.action === 'context_added') {
        showToast(getTransl('toastContextAdded') || 'New context added!');
      } else {
        showToast(getTransl('toastWordSavedToDashboard') || 'Word saved to Dashboard!');
      }
    }
  } catch (error) {
    showToast(getTransl('toastErrorSaving') || 'Error saving word');
    console.error(error);
  }
}

// Show toast notification
function showToast(message, action = null) {
  if (!shadowRoot) return;

  const toast = document.createElement('div');
  toast.className = 'toast';

  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);

  if (action === 'login') {
    const btn = document.createElement('button');
    btn.textContent = getTransl('loginBtn') || 'Login';
    btn.className = 'toast-login-btn';
    btn.onclick = () => {
      chrome.runtime.sendMessage({ type: 'OPEN_LOGIN' });
      toast.remove();
    };
    toast.appendChild(btn);
  }

  shadowRoot.appendChild(toast);

  // Auto-remove after 4 seconds with fade out
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300); // Wait for fade-out animation
  }, 4000);
}

// Hide popup
// Hide popup
function hidePopup() {
  if (popup) {
    popup.classList.add('hidden');
    if (!isPinned) {
      popup.classList.remove('pinned');
    }
  }
  if (triggerIcon) {
    triggerIcon.classList.remove('visible');
    triggerIcon.classList.add('hidden');
  }
  // Do NOT reset isPinned here — pin persists until user explicitly unpins
  currentSelection = null;
  activeSelection = null;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
