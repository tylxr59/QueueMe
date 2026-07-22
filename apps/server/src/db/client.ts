import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { AppConfig } from "../config.js";

export function createDatabase(config: AppConfig) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const sqlite = new Database(path.join(config.dataDir, "queueme.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec("CREATE TABLE IF NOT EXISTS _queueme_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const migrationName = "0000_initial.sql";
  const applied = sqlite.prepare("SELECT 1 FROM _queueme_migrations WHERE name = ?").get(migrationName);
  if (!applied) {
    const migration = fs.readFileSync(new URL(`../../drizzle/${migrationName}`, import.meta.url), "utf8");
    sqlite.transaction(() => {
      sqlite.exec(migration);
      sqlite.prepare("INSERT INTO _queueme_migrations (name, applied_at) VALUES (?, ?)").run(migrationName, Date.now());
    })();
  }
  const now = Date.now();
  sqlite.prepare("INSERT OR IGNORE INTO app_settings (id, created_at, updated_at) VALUES (1, ?, ?)").run(now, now);
  sqlite.prepare("INSERT OR IGNORE INTO player_checkpoint (id, observed_at, updated_at) VALUES (1, ?, ?)").run(now, now);
  return { sqlite, db: drizzle(sqlite) };
}

export type DatabaseContext = ReturnType<typeof createDatabase>;
