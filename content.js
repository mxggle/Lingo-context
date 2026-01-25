// Linguist Pro - Content Script
// Handles text selection and popup display

// Inline config (content scripts can't use ES modules)
const CONFIG = {
  WORD_THRESHOLD: 3,
  CONTEXT_LENGTH: 150
};

// State management
let popup = null;
let shadowRoot = null;
let isLoading = false;
let currentSelection = null;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let initialPopupX = 0;
let initialPopupY = 0;

// Initialize the extension
function init() {
  createPopup();
  setupEventListeners();
  console.log('Linguist Pro content script loaded');
}

// Create Shadow DOM popup
function createPopup() {
  const host = document.createElement('div');
  host.id = 'linguist-pro-host';
  shadowRoot = host.attachShadow({ mode: 'closed' });

  // Inject styles into shadow DOM
  const styles = document.createElement('style');
  styles.textContent = getPopupStyles();
  shadowRoot.appendChild(styles);

  // Create popup container
  popup = document.createElement('div');
  popup.id = 'linguist-pro-popup';
  popup.className = 'popup hidden';
  shadowRoot.appendChild(popup);

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
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 16px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5),
                  0 0 0 1px rgba(255, 255, 255, 0.05);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      color: #e2e8f0;
      animation: slideUp 0.25s ease-out;
      overflow: hidden;
    }

    .popup.hidden {
      display: none;
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .popup-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
      cursor: move;
      user-select: none;
    }

    .popup-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #94a3b8;
    }

    .close-btn {
      background: none;
      border: none;
      color: #64748b;
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
      color: #e2e8f0;
    }

    .popup-content {
      padding: 16px;
    }

    .selected-text {
      font-size: 20px;
      font-weight: 600;
      color: #f8fafc;
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
      color: #a78bfa;
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
      color: #64748b;
      margin-bottom: 4px;
    }

    .section-content {
      font-size: 14px;
      line-height: 1.6;
      color: #cbd5e1;
    }

    .meaning-content {
      color: #38bdf8;
    }

    .grammar-content {
      color: #a78bfa;
      font-size: 13px;
    }

    .actions {
      display: flex;
      gap: 8px;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid rgba(148, 163, 184, 0.1);
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
      background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
      color: white;
    }

    .action-btn.primary:hover {
      background: linear-gradient(135deg, #38bdf8 0%, #0ea5e9 100%);
      transform: translateY(-1px);
    }

    .action-btn.secondary {
      background: rgba(255, 255, 255, 0.05);
      color: #94a3b8;
      border: 1px solid rgba(148, 163, 184, 0.1);
    }

    .action-btn.secondary:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #e2e8f0;
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
      border: 3px solid rgba(14, 165, 233, 0.2);
      border-top-color: #0ea5e9;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .loading-text {
      margin-top: 12px;
      font-size: 13px;
      color: #64748b;
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
  `;
}

// Setup event listeners
function setupEventListeners() {
  // Text selection on mouseup
  document.addEventListener('mouseup', handleSelection);

  // Close popup on click outside (but allow interaction inside popup)
  document.addEventListener('mousedown', (e) => {
    // Check if click is inside the shadow host
    const host = document.getElementById('linguist-pro-host');
    if (host && host.contains(e.target)) {
      return; // Don't close if clicking inside our extension
    }

    // Check if popup exists and is visible
    if (popup && !popup.classList.contains('hidden')) {
      // Small delay to allow text selection inside popup
      setTimeout(() => {
        const selection = window.getSelection();
        // Don't close if there's a selection starting from our popup
        if (selection && selection.toString().trim()) {
          return;
        }
        // If no selection and click was outside, hide popup
        if (!popup.contains(e.target)) {
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
  // Don't trigger on popup clicks
  if (e.target.closest('#linguist-pro-host')) {
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
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  showPopup(rect, text, mode);
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

  // Determine target language based on source text
  const sourceLang = detectLanguage(text);
  // If source is Japanese, target is English. Otherwise (English/Other), target is Japanese.
  // This can be made configurable later.
  const targetLanguage = sourceLang === 'ja' ? 'English' : 'Japanese';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_TEXT',
      text,
      context,
      mode,
      targetLanguage
    });

    if (response.error) {
      popup.innerHTML = renderError(response.message);
    } else {
      popup.innerHTML = renderResult(text, response, mode);
      setupPopupActions(response);
    }
  } catch (error) {
    popup.innerHTML = renderError(error.message);
  } finally {
    isLoading = false;
  }
}

// Render loading state
function renderLoading() {
  return `
    <div class="popup-header">
      <span class="popup-title">Analyzing...</span>
      <button class="close-btn" onclick="this.closest('.popup').classList.add('hidden')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <div class="loading">
      <div class="loading-spinner"></div>
      <div class="loading-text">Getting insights...</div>
    </div>
  `;
}

// Render error state
function renderError(message) {
  return `
    <div class="popup-header">
      <span class="popup-title">Error</span>
      <button class="close-btn" data-action="close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <div class="error">
      <div class="error-icon">⚠️</div>
      <div class="error-message">${escapeHtml(message)}</div>
      <button class="error-retry" data-action="retry">Try Again</button>
    </div>
  `;
}

// Render analysis result
function renderResult(originalText, data, mode) {
  const displayText = data.furigana || escapeHtml(originalText);
  const modeLabel = mode === 'word' ? 'Word Analysis' : 'Phrase Analysis';

  return `
    <div class="popup-header">
      <span class="popup-title">${modeLabel}</span>
      <button class="close-btn" data-action="close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <div class="popup-content">
      <div class="selected-text">${displayText}</div>
      
      <div class="section">
        <div class="section-label">Meaning</div>
        <div class="section-content meaning-content">${escapeHtml(data.meaning)}</div>
      </div>
      
      ${data.grammar ? `
        <div class="section">
          <div class="section-label">Grammar</div>
          <div class="section-content grammar-content">${escapeHtml(data.grammar)}</div>
        </div>
      ` : ''}
      <div class="actions">
        <button class="action-btn primary" data-action="speak">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
          Listen
        </button>
        <button class="action-btn secondary" data-action="save">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          Save
        </button>
      </div>
    </div>
  `;
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
      // If error (likely backend missing), show specific toast
      if (response.message.includes('backend URL')) {
        showToast('Backend not configured');
      } else {
        showToast('Failed to save: ' + response.message);
      }
    } else {
      showToast('Word saved to Dashboard!');
    }
  } catch (error) {
    showToast('Error saving word');
    console.error(error);
  }
}

// Show toast notification
function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    background: #1e293b;
    color: #e2e8f0;
    border-radius: 10px;
    font-family: -apple-system, sans-serif;
    font-size: 14px;
    z-index: 2147483647;
    box-shadow: 0 10px 25px rgba(0,0,0,0.3);
    animation: slideUp 0.3s ease-out;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Hide popup
function hidePopup() {
  if (popup) {
    popup.classList.add('hidden');
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
