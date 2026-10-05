import { Queue, Worker } from "bullmq";
import { config } from "../config.js";
import { MessageRepository } from "../database/message-repository.js";
import { logger } from "../logger.js";
import { MonitorNotifier } from "../notification/monitor-notifier.js";

export interface NotificationJobData {
  messageId: string;
}

export class NotificationQueueManager {
  private queue: Queue<NotificationJobData>;
  private worker: Worker<NotificationJobData> | null = null;
  private repository: MessageRepository;
  private notifier: MonitorNotifier | null = null;

  constructor(repository: MessageRepository) {
    this.repository = repository;

    this.queue = new Queue<NotificationJobData>("whatsapp-notifications", {
      connection: config.redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    });

    this.queue.on("error", (err) => {
      logger.error({ err }, "Notification queue error");
    });
  }

  startWorker(notifier: MonitorNotifier): void {
    if (this.worker) {
      return;
    }

    this.notifier = notifier;

    // Rate Limiter: max 1 notification per 1.5s to prevent WhatsApp spam bans
    this.worker = new Worker<NotificationJobData>(
      "whatsapp-notifications",
      async (job) => {
        const { messageId } = job.data;
        const record = this.repository.findByMessageId(messageId);

        if (!record) {
          logger.warn(
            { messageId },
            "Message record not found during notification job processing"
          );
          return;
        }

        if (record.status !== "deleted") {
          logger.debug(
            { messageId },
            "Message is no longer in deleted status; skipping notification"
          );
          return;
        }

        if (this.notifier) {
          await this.notifier.sendDeletedMessage(record);
        }
      },
      {
        connection: config.redisConnection,
        concurrency: 1,
        limiter: {
          max: 1,
          duration: 1500,
        },
      }
    );

    this.worker.on("failed", (job, err) => {
      logger.error(
        { jobId: job?.id, messageId: job?.data?.messageId, err },
        "Notification job failed"
      );
    });

    this.worker.on("error", (err) => {
      logger.error({ err }, "Notification worker error");
    });

    logger.info("BullMQ notification worker started (Rate limit: 1 msg / 1.5s)");
  }

  async enqueueNotification(messageId: string): Promise<void> {
    try {
      await this.queue.add(
        "send-deleted-notification",
        { messageId },
        {
          jobId: `notify-${messageId}`, // Idempotent by messageId
        }
      );
      logger.debug({ messageId }, "Notification job added to BullMQ queue");
    } catch (error) {
      logger.error(
        { error, messageId },
        "Failed to enqueue notification job into BullMQ, falling back to direct send"
      );
      // Fallback direct send if Redis has an issue
      const record = this.repository.findByMessageId(messageId);
      if (record && this.notifier) {
        await this.notifier.sendDeletedMessage(record);
      }
    }
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
    logger.info("BullMQ notification queue and worker closed");
  }
}
