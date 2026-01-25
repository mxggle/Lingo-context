-- Migration: Add target_language column to users table
-- Date: 2026-01-25

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS target_language VARCHAR(50) DEFAULT 'English';

-- Update existing users to have English as default if NULL
UPDATE users 
SET target_language = 'English' 
WHERE target_language IS NULL;
