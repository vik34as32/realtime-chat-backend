-- Local database for the real-time chat backend.
-- Run this file with a MySQL admin account:
--   mysql -u root -p < database/schema.sql
--
-- Re-running this file deletes local chats and accounts, then creates the tables again.
-- Create accounts with POST /user/register. There are no sample users.

CREATE DATABASE IF NOT EXISTS realtime_chat
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE realtime_chat;

DROP TABLE IF EXISTS chat_members;
DROP TABLE IF EXISTS chats;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  profile_url VARCHAR(500) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_phone (phone)
) ENGINE=InnoDB;

-- pair_key stores the two user IDs in ascending order, for example "1:2".
-- The unique key blocks a second one-to-one chat for the same people,
-- including when the caller sends the IDs in reverse order.
CREATE TABLE chats (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pair_key VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chats_pair_key (pair_key),
  KEY idx_chats_updated_at (updated_at)
) ENGINE=InnoDB;

-- The primary key stops the same user from joining the same chat twice.
CREATE TABLE chat_members (
  chat_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, user_id),
  KEY idx_chat_members_user_id (user_id),
  CONSTRAINT fk_chat_members_chat
    FOREIGN KEY (chat_id) REFERENCES chats (id),
  CONSTRAINT fk_chat_members_user
    FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB;
