import { CleanupService } from "../src/cleanup/cleanup-service.js";
import { closeDatabase, getDatabase } from "../src/database/database.js";
import { MessageRepository } from "../src/database/message-repository.js";
import { logger } from "../src/logger.js";

async function main() {
  try {
    const db = getDatabase();
    const repository = new MessageRepository(db);
    const cleanupService = new CleanupService(repository);

    cleanupService.runCleanup();
  } catch (error) {
    logger.error({ error }, "Error occurred during cleanup execution");
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

main();
