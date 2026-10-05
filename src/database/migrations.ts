import { Database as DatabaseType } from "better-sqlite3";
import { logger } from "../logger.js";

export function runMigrations(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      message_id TEXT NOT NULL UNIQUE,

      chat_id TEXT NOT NULL,
      chat_name TEXT,

      sender_id TEXT,
      sender_name TEXT,

      message_type TEXT NOT NULL,

      text_content TEXT,

      media_path TEXT,
      media_filename TEXT,
      media_mime_type TEXT,
      media_size INTEGER,

      status TEXT NOT NULL DEFAULT 'active',

      sent_at INTEGER NOT NULL,
      deleted_at INTEGER,

      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_status
    ON messages(status);

    CREATE INDEX IF NOT EXISTS idx_messages_sent_at
    ON messages(sent_at);

    CREATE INDEX IF NOT EXISTS idx_messages_deleted_at
    ON messages(deleted_at);

    CREATE INDEX IF NOT EXISTS idx_messages_chat_id
    ON messages(chat_id);
  `);

  logger.debug("Database migrations verified");
}
