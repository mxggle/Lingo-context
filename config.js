// Configuration for LingoContext
// Update these values with your own backend endpoint

export const CONFIG = {
  // Backend Configuration (Required for AI and Saving)
  // Local development
  // BACKEND_URL: 'http://localhost:3000/api',
  // Production
  BACKEND_URL: 'https://lingo-context-api.vercel.app/api',

  // TTS Configuration
  TTS_RATE: 0.9,
  TTS_PITCH: 1.0,

  // Selection Configuration
  WORD_THRESHOLD: 3,
  CONTEXT_LENGTH: 150,

  // Development - set to false for production
  DEV_MODE: false,
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
