import { CleanupService } from "./cleanup/cleanup-service.js";
import { config } from "./config.js";
import { closeDatabase, getDatabase } from "./database/database.js";
import { MessageRepository } from "./database/message-repository.js";
import { logger } from "./logger.js";
import { WhatsAppClient } from "./whatsapp/client.js";

async function bootstrap() {
  logger.info("Starting WhatsApp Deleted Message Monitor (WKeep)");
  logger.info(`Database: ${config.DATABASE_PATH}`);
  logger.info(`Media directory: ${config.MEDIA_DIR}`);
  logger.info(`Retention: ${config.MESSAGE_RETENTION_DAYS} days`);
  logger.info(`Max media size: ${config.MAX_MEDIA_SIZE_MB} MB`);

  if (config.monitoredGroupIds.size === 0) {
    logger.warn(
      "No groups configured in MONITORED_GROUP_IDS. Please configure them in .env"
    );
  } else {
    logger.info(
      `Monitoring ${config.monitoredGroupIds.size} group(s): ${Array.from(
        config.monitoredGroupIds
      ).join(", ")}`
    );
  }

  if (!config.MONITOR_CHAT_ID) {
    logger.warn("MONITOR_CHAT_ID is not configured in .env. Deleted message forwarding will be disabled.");
  } else {
    logger.info(`Monitor destination: ${config.MONITOR_CHAT_ID}`);
  }

  // Initialize SQLite database & migrations
  const db = getDatabase();
  const repository = new MessageRepository(db);

  // Initial stats
  const stats = repository.getStats();
  logger.info(
    `Initial cache stats: total=${stats.total}, active=${stats.active}, deleted=${stats.deleted}`
  );

  // Initialize and run in-app periodic cleanup once every 24 hours
  const cleanupService = new CleanupService(repository);
  const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const cleanupInterval = setInterval(() => {
    try {
      cleanupService.runCleanup();
    } catch (err) {
      logger.error({ err }, "Periodic cleanup run encountered an error");
    }
  }, CLEANUP_INTERVAL_MS);

  // Start WhatsApp Client
  const client = new WhatsAppClient(repository);
  await client.start();

  // Graceful shutdown handling
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    clearInterval(cleanupInterval);

    try {
      await client.stop();
    } catch (err) {
      logger.error({ err }, "Error while stopping WhatsApp client");
    }

    try {
      closeDatabase();
    } catch (err) {
      logger.error({ err }, "Error while closing database");
    }

    logger.info("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((error) => {
  logger.fatal({ error }, "Fatal error during startup");
  process.exit(1);
});
