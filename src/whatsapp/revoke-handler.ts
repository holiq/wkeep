import { proto, WAMessage } from "@whiskeysockets/baileys";
import { MessageRepository } from "../database/message-repository.js";
import { logger } from "../logger.js";
import { MonitorNotifier } from "../notification/monitor-notifier.js";
import { NotificationQueueManager } from "../queue/notification-queue.js";

export class RevokeHandler {
  private repository: MessageRepository;
  private notifier: MonitorNotifier;
  private queueManager?: NotificationQueueManager;

  constructor(
    repository: MessageRepository,
    notifier: MonitorNotifier,
    queueManager?: NotificationQueueManager
  ) {
    this.repository = repository;
    this.notifier = notifier;
    this.queueManager = queueManager;
  }

  async handleRevokeEvent(targetMessageId: string): Promise<void> {
    if (!targetMessageId) {
      return;
    }

    const message = this.repository.findByMessageId(targetMessageId);

    if (!message) {
      logger.warn(
        { messageId: targetMessageId },
        "Original message not found in local cache for revoke event"
      );
      return;
    }

    // Duplicate protection
    if (message.status === "deleted") {
      logger.debug(
        { messageId: targetMessageId },
        "Message already marked as deleted; ignoring duplicate revoke event"
      );
      return;
    }

    const deletedAt = Date.now();
    const updated = this.repository.markAsDeleted(targetMessageId, deletedAt);

    if (!updated) {
      // In case another concurrent event marked it
      return;
    }

    const chatLabel = message.chat_id.endsWith("@g.us") ? "group" : "chat";
    logger.info(
      `MESSAGE_DELETED ${chatLabel}="${message.chat_name || message.chat_id}" sender="${
        message.sender_name || message.sender_id
      }" message="${targetMessageId}"`
    );

    // If BullMQ queue manager is available, enqueue with rate-limiting
    if (this.queueManager) {
      await this.queueManager.enqueueNotification(targetMessageId);
    } else {
      // Fallback direct send
      const updatedRecord = this.repository.findByMessageId(targetMessageId);
      if (updatedRecord) {
        await this.notifier.sendDeletedMessage(updatedRecord);
      }
    }
  }

  checkAndExtractRevoke(message: WAMessage): string | null {
    const msg = message.message;
    if (!msg) return null;

    const protocolMsg =
      msg.protocolMessage ||
      msg.ephemeralMessage?.message?.protocolMessage ||
      msg.viewOnceMessage?.message?.protocolMessage;

    if (
      protocolMsg &&
      protocolMsg.type === proto.Message.ProtocolMessage.Type.REVOKE &&
      protocolMsg.key?.id
    ) {
      return protocolMsg.key.id;
    }

    return null;
  }
}
