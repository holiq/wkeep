import fs from "node:fs";
import { config } from "../config.js";
import { MessageRepository } from "../database/message-repository.js";
import { logger } from "../logger.js";

export interface CleanupResult {
  deletedMessages: number;
  deletedMedia: number;
}

export class CleanupService {
  private repository: MessageRepository;

  constructor(repository: MessageRepository) {
    this.repository = repository;
  }

  runCleanup(retentionDays: number = config.MESSAGE_RETENTION_DAYS): CleanupResult {
    logger.info("CLEANUP started");

    const expiredMessages = this.repository.findExpiredActiveMessages(retentionDays);
    let deletedMessagesCount = 0;
    let deletedMediaCount = 0;

    for (const msg of expiredMessages) {
      // Extra safety check in application layer
      if (msg.status !== "active") {
        continue;
      }

      if (msg.media_path) {
        try {
          if (fs.existsSync(msg.media_path)) {
            fs.unlinkSync(msg.media_path);
            deletedMediaCount++;
          }
        } catch (err) {
          logger.warn(
            { err, path: msg.media_path },
            "Failed to delete expired media file"
          );
        }
      }

      const deleted = this.repository.deleteMessage(msg.message_id);
      if (deleted) {
        deletedMessagesCount++;
      }
    }

    logger.info(
      `CLEANUP deleted_messages=${deletedMessagesCount} deleted_media=${deletedMediaCount}`
    );
    logger.info("CLEANUP finished");

    return {
      deletedMessages: deletedMessagesCount,
      deletedMedia: deletedMediaCount,
    };
  }
}
