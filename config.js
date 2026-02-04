// Configuration for LingoContext
// Update these values with your own API keys and endpoints

export const CONFIG = {
  // Backend Configuration (Required for AI and Saving)
  // Local development
  BACKEND_URL: 'http://localhost:3000/api',
  // Production
  // BACKEND_URL: 'https://lingo-context-api.vercel.app/api',

  // Legacy/Direct mode (Optional fallback if no backend)
  GEMINI_API_KEY: '',
  GEMINI_MODEL: 'gemini-2.0-flash-lite',
  GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models',

  // TTS Configuration
  TTS_RATE: 0.9, // Slightly slower for learners
  TTS_PITCH: 1.0,

  // Selection Configuration
  WORD_THRESHOLD: 3, // Words <= this are treated as "word mode"
  CONTEXT_LENGTH: 150, // Characters of surrounding context to include

  // Development
  DEV_MODE: false, // Set to false in production
};

// Get config value from storage or use default
export async function getConfig(key) {
  const stored = await chrome.storage.local.get(key);
  return stored[key] ?? CONFIG[key];
}

// Save config value to storage
export async function setConfig(key, value) {
  await chrome.storage.local.set({ [key]: value });
}
