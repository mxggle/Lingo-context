-- Migration V2: Word Deduplication & Multi-Context Support
-- Run this migration to add support for:
-- 1. Tracking lookup count per word
-- 2. Storing multiple contexts per word
-- 3. Case-insensitive deduplication

-- Step 1: Add lookup_count column to words table
ALTER TABLE words ADD COLUMN lookup_count INT DEFAULT 1;

-- Step 2: Add text_lower as a generated column for case-insensitive matching
-- Note: MySQL 5.7+ supports generated columns
ALTER TABLE words ADD COLUMN text_lower VARCHAR(500) AS (LOWER(text)) STORED;

-- Step 3: Create word_contexts table for multiple contexts per word
CREATE TABLE IF NOT EXISTS word_contexts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  word_id INT NOT NULL,
  context TEXT,
  url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
);

-- Step 4: Migrate existing contexts to word_contexts table
-- This preserves all existing context/url data
INSERT INTO word_contexts (word_id, context, url, created_at)
SELECT id, context, url, saved_at 
FROM words 
WHERE context IS NOT NULL OR url IS NOT NULL;

-- Step 5: Create unique index for deduplication (per user, lowercase text, language)
-- This prevents duplicate words for the same user+language combination
-- Note: language(100) limits index to first 100 chars of language column
CREATE UNIQUE INDEX idx_words_user_text_lang ON words(user_id, text_lower, language(100));

-- Step 6: Optionally remove context/url from words table (keeping for backward compatibility)
-- If you want to remove them later, uncomment these lines:
-- ALTER TABLE words DROP COLUMN context;
-- ALTER TABLE words DROP COLUMN url;
