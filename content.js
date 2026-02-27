// LingoContext - Content Script
// Handles text selection and popup display

// Inline config (content scripts can't use ES modules)
const CONFIG = {
  WORD_THRESHOLD: 3,
  CONTEXT_LENGTH: 150
};

// State management
let popup = null;
let triggerIcon = null;
let shadowRoot = null;
let isLoading = false;
let currentSelection = null;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let initialPopupX = 0;
let initialPopupY = 0;

// i18n State
let currentLocaleData = {};
let interfaceLanguage = 'en';

// Initialize the extension
let isExtensionEnabled = true;

function init() {
  // Check for auth data from success page (for login flow)
  checkForAuthData();

  // Load language preference and settings
  chrome.storage.local.get(['EXTENSION_ENABLED', 'interfaceLanguage'], async (result) => {
    isExtensionEnabled = result.EXTENSION_ENABLED !== false;
    interfaceLanguage = result.interfaceLanguage || 'en';
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
      if (changes.interfaceLanguage) {
        interfaceLanguage = changes.interfaceLanguage.newValue;
        await loadLocaleData(interfaceLanguage);
        // If popup is visible, re-render it
        if (popup && !popup.classList.contains('hidden') && currentSelection) {
          const wordCount = currentSelection.text.split(/\s+/).length;
          const mode = wordCount <= CONFIG.WORD_THRESHOLD ? 'word' : 'phrase';
          analyzeText(currentSelection.text, currentSelection.context, mode);
        }
      }
    }
  });

  createPopup();
  setupEventListeners();
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

// Get translated string
function getTransl(key) {
  if (currentLocaleData[key] && currentLocaleData[key].message) {
    return currentLocaleData[key].message;
  }
  return key;
}

// Replace placeholders in string ($1, $2, etc)
function processTranslPlaceholders(messageTemplate, ...args) {
  let result = messageTemplate;
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp(`\\$${i + 1}`, 'g'), args[i]);
  }
  return result;
}

// Check for auth data embedded in the page (from /auth/success)
function checkForAuthData() {
  const authDataEl = document.getElementById('lingocontext-auth-data');
  if (authDataEl) {
    try {
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
      max-width: 380px;
      min-width: 280px;
      background: linear-gradient(135deg, #1c1917 0%, #292524 100%);
      border: 1px solid rgba(120, 113, 108, 0.2);
      border-radius: 16px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5),
                  0 0 0 1px rgba(255, 255, 255, 0.05);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      color: #e7e5e4;
      animation: slideUp 0.25s ease-out;
      overflow: hidden;
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

    .close-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #e7e5e4;
    }

    .popup-content {
      padding: 16px;
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
    }

    .actions {
      display: flex;
      gap: 8px;
      margin-top: 16px;
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
    // Check if clicking header or inside header
    const header = e.target.closest('.popup-header');

    if (header) {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;

      const rect = popup.getBoundingClientRect();
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
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.userSelect = '';
      if (popup) {
        popup.style.transition = ''; // Re-enable transitions
      }
    }
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

    if (parent) {
      const fullText = parent.textContent || '';
      const selectedText = selection.toString();
      const index = fullText.indexOf(selectedText);

      if (index !== -1) {
        const start = Math.max(0, index - CONFIG.CONTEXT_LENGTH);
        const end = Math.min(fullText.length, index + selectedText.length + CONFIG.CONTEXT_LENGTH);
        return fullText.substring(start, end);
      }
    }

    return selection.toString();
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
  const POPUP_WIDTH = 380;
  // const POPUP_HEIGHT_ESTIMATE = 300; // Removed as we calculate real height
  const MARGIN = 12; // Margin from edges
  const GAP = 8; // Gap between selection and popup

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Show popup with scroll support for long content
  // First, set temporary position and display to calculate dimensions
  popup.style.opacity = '0';
  popup.classList.remove('hidden');
  popup.innerHTML = renderLoading(); // Start with loading state

  // Set max dimensions before positioning
  const MAX_HEIGHT = Math.min(600, viewportHeight - MARGIN * 2);
  popup.style.maxHeight = `${MAX_HEIGHT}px`;
  popup.style.overflowY = 'auto'; // Enable scrolling within popup

  requestAnimationFrame(() => {
    const popupRect = popup.getBoundingClientRect();
    const popupHeight = popupRect.height;

    // Start with position below selection, centered on selection
    let left = rect.left + (rect.width / 2) - (POPUP_WIDTH / 2);
    let top = rect.bottom + GAP;

    // Check right edge
    if (left + POPUP_WIDTH > viewportWidth - MARGIN) {
      left = viewportWidth - POPUP_WIDTH - MARGIN;
    }

    // Check left edge
    if (left < MARGIN) {
      left = MARGIN;
    }

    // Check bottom edge - if not enough space below, try above
    if (top + popupHeight > viewportHeight - MARGIN) {
      const topSpace = rect.top - MARGIN - GAP;
      const bottomSpace = viewportHeight - (rect.bottom + GAP + MARGIN);

      // If more space above, or if simply not enough space below
      if (topSpace > bottomSpace || topSpace >= popupHeight) {
        // Position above
        top = rect.top - popupHeight - GAP;

        // If it still doesn't fit (even above), cap the height
        if (top < MARGIN) {
          top = MARGIN;
          // Recalculate max-height to fit between margin and selection
          const availableHeight = rect.top - MARGIN - GAP;
          popup.style.maxHeight = `${availableHeight}px`;
        }
      } else {
        // Position below but cap height
        const availableHeight = viewportHeight - (rect.bottom + GAP) - MARGIN;
        popup.style.maxHeight = `${availableHeight}px`;
      }
    }

    // Final position application
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.opacity = '1';

    // Analyze text after positioning
    analyzeText(text, currentSelection.context, mode);
  });
}

// Analyze text with Gemini
async function analyzeText(text, context, mode) {
  isLoading = true;

  // The backend will use the user's preferred target language from their profile
  // If not set, it defaults to English
  // We don't pass targetLanguage here so the backend can use the user's preference

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_TEXT',
      text,
      context,
      mode
      // targetLanguage is not passed - backend will use user's preference
    });

    if (response.error) {
      popup.innerHTML = renderError(response.message);
      setupErrorActions();
    } else {
      popup.innerHTML = renderResult(text, response, mode);
      setupPopupActions(response);
    }
  } catch (error) {
    popup.innerHTML = renderError(error.message);
    setupErrorActions();
  } finally {
    isLoading = false;
  }
}

// Render loading state
function renderLoading() {
  const analyzingStr = getTransl('analyzingTitle') || 'Analyzing...';
  const insightsStr = getTransl('gettingInsights') || 'Getting insights...';

  return `
    <div class="popup-header">
      <span class="popup-title">${escapeHtml(analyzingStr)}</span>
      <button class="close-btn" onclick="this.closest('.popup').classList.add('hidden')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <div class="loading">
      <div class="loading-spinner"></div>
      <div class="loading-text">${escapeHtml(insightsStr)}</div>
    </div>
  `;
}

// Render error state
function renderError(message) {
  const errorTitleStr = getTransl('errorTitle') || 'Error';
  const tryAgainStr = getTransl('tryAgainBtn') || 'Try Again';

  return `
    <div class="popup-header">
      <span class="popup-title">${escapeHtml(errorTitleStr)}</span>
      <button class="close-btn" data-action="close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <div class="error">
      <div class="error-icon">⚠️</div>
      <div class="error-message">${escapeHtml(message)}</div>
      <button class="error-retry" data-action="retry">${escapeHtml(tryAgainStr)}</button>
    </div>
  `;
}

// Render analysis result
function renderResult(originalText, data, mode) {
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

  return `
    <div class="popup-header">
      <span class="popup-title">${escapeHtml(modeLabel)}</span>
      <button class="close-btn" data-action="close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <div class="popup-content">
      <div class="selected-text">${displayText}</div>
      
      <div class="section">
        <div class="section-label">${escapeHtml(meaningLabel)}</div>
        <div class="section-content meaning-content">${escapeHtml(data.meaning)}</div>
      </div>
      
      ${data.grammar ? `
        <div class="section">
          <div class="section-label">${escapeHtml(grammarLabel)}</div>
          <div class="section-content grammar-content">${escapeHtml(data.grammar)}</div>
        </div>
      ` : ''}
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
    </div>
  `;
}

// Setup error popup actions (retry + close)
function setupErrorActions() {
  popup.querySelector('[data-action="close"]')?.addEventListener('click', hidePopup);

  popup.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
    if (currentSelection) {
      const wordCount = currentSelection.text.split(/\s+/).length;
      const mode = wordCount <= CONFIG.WORD_THRESHOLD ? 'word' : 'phrase';
      popup.innerHTML = renderLoading();
      analyzeText(currentSelection.text, currentSelection.context, mode);
    }
  });
}

// Setup popup button actions
function setupPopupActions(data) {
  popup.querySelector('[data-action="close"]')?.addEventListener('click', hidePopup);

  popup.querySelector('[data-action="speak"]')?.addEventListener('click', () => {
    const textToSpeak = data.audio_text || currentSelection?.text;
    const lang = data.language || detectLanguage(textToSpeak);

    chrome.runtime.sendMessage({
      type: 'PLAY_TTS',
      text: textToSpeak,
      lang
    });
  });

  popup.querySelector('[data-action="save"]')?.addEventListener('click', () => {
    saveWord(currentSelection?.text, data);
  });

  popup.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
    if (currentSelection) {
      const wordCount = currentSelection.text.split(/\s+/).length;
      const mode = wordCount <= CONFIG.WORD_THRESHOLD ? 'word' : 'phrase';
      popup.innerHTML = renderLoading();
      analyzeText(currentSelection.text, currentSelection.context, mode);
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

// Save word to backend
async function saveWord(text, data) {
  try {
    const payload = {
      text,
      meaning: data.meaning,
      grammar: data.grammar,
      context: currentSelection?.context,
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
  }
  if (triggerIcon) {
    triggerIcon.classList.remove('visible');
    triggerIcon.classList.add('hidden');
  }
  currentSelection = null;
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
