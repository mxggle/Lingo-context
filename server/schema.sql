CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  avatar_url TEXT,
  target_language VARCHAR(50) DEFAULT 'English',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Session table is managed by express-mysql-session automatically

CREATE TABLE IF NOT EXISTS words (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  text TEXT NOT NULL,
  meaning TEXT,
  grammar TEXT,
  language VARCHAR(100),
  lookup_count INT DEFAULT 1,
  saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Table to store multiple contexts per word
CREATE TABLE IF NOT EXISTS word_contexts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  word_id INT NOT NULL,
  context TEXT,
  url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  model TEXT,
  prompt_tokens INT,
  completion_tokens INT,
  total_tokens INT,
  cost_usd FLOAT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
