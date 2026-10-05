import Database, { Database as DatabaseType } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { runMigrations } from "./migrations.js";

let dbInstance: DatabaseType | null = null;

export function getDatabase(dbPath: string = config.DATABASE_PATH): DatabaseType {
  if (dbInstance) {
    return dbInstance;
  }

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  }

  // Ensure media directory exists as well
  if (!fs.existsSync(config.MEDIA_DIR)) {
    fs.mkdirSync(config.MEDIA_DIR, { recursive: true, mode: 0o700 });
  }

  // Ensure auth directory exists
  if (!fs.existsSync(config.AUTH_DIR)) {
    fs.mkdirSync(config.AUTH_DIR, { recursive: true, mode: 0o700 });
  }

  dbInstance = new Database(dbPath);

  // Performance and safety pragmas
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("synchronous = NORMAL");
  dbInstance.pragma("busy_timeout = 5000");

  runMigrations(dbInstance);

  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
      logger.info("Database connection closed");
    } finally {
      dbInstance = null;
    }
  }
}
