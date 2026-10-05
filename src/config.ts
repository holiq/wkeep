import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_PATH: z.string().default("./data/whatsapp-monitor.sqlite"),
  MEDIA_DIR: z.string().default("./data/media"),
  AUTH_DIR: z.string().default("./auth"),
  MONITORED_GROUP_IDS: z.string().default(""),
  MONITOR_CHAT_ID: z.string().default(""),
  MESSAGE_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  MAX_MEDIA_SIZE_MB: z.coerce.number().positive().default(50),
  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(""),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:", parsed.error.format());
  process.exit(1);
}

const rawConfig = parsed.data;

export const config = {
  ...rawConfig,
  DATABASE_PATH: path.resolve(process.cwd(), rawConfig.DATABASE_PATH),
  MEDIA_DIR: path.resolve(process.cwd(), rawConfig.MEDIA_DIR),
  AUTH_DIR: path.resolve(process.cwd(), rawConfig.AUTH_DIR),
  monitoredGroupIds: new Set(
    rawConfig.MONITORED_GROUP_IDS.split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  ),
  isMonitoredGroup(groupId: string): boolean {
    return this.monitoredGroupIds.has(groupId);
  },
  isMonitoredChat(chatId: string): boolean {
    if (!chatId || chatId === "status@broadcast" || chatId.endsWith("@newsletter")) {
      return false;
    }

    // Jangan pernah memantau grup/chat tujuan notifikasi
    if (this.MONITOR_CHAT_ID && chatId === this.MONITOR_CHAT_ID) {
      return false;
    }

    // Jika grup (@g.us), hanya pantau yang ada di allowlist MONITORED_GROUP_IDS
    if (chatId.endsWith("@g.us")) {
      return this.monitoredGroupIds.has(chatId);
    }

    // Jika personal chat (@s.whatsapp.net atau @lid), pantau semua
    if (chatId.endsWith("@s.whatsapp.net") || chatId.endsWith("@lid")) {
      return true;
    }

    return false;
  },
  maxMediaSizeBytes(): number {
    return this.MAX_MEDIA_SIZE_MB * 1024 * 1024;
  },
  redisConnection: {
    host: rawConfig.REDIS_HOST,
    port: rawConfig.REDIS_PORT,
    password: rawConfig.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null as null,
  },
};

export type Config = typeof config;
