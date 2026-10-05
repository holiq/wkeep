import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import fs from "node:fs";
import qrcode from "qrcode-terminal";
import { config } from "../config.js";
import { MessageRepository } from "../database/message-repository.js";
import { logger } from "../logger.js";
import { MonitorNotifier } from "../notification/monitor-notifier.js";
import { NotificationQueueManager } from "../queue/notification-queue.js";
import { MessageHandler } from "./message-handler.js";
import { RevokeHandler } from "./revoke-handler.js";

export class WhatsAppClient {
  private sock: WASocket | null = null;
  private repository: MessageRepository;
  private messageHandler: MessageHandler;
  private queueManager: NotificationQueueManager | null = null;
  private isExplicitStop = false;

  constructor(repository: MessageRepository) {
    this.repository = repository;
    this.messageHandler = new MessageHandler(repository);
  }

  async start(): Promise<WASocket> {
    this.isExplicitStop = false;

    if (!fs.existsSync(config.AUTH_DIR)) {
      fs.mkdirSync(config.AUTH_DIR, { recursive: true, mode: 0o700 });
    }

    const { state, saveCreds } = await useMultiFileAuthState(config.AUTH_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    logger.info(`Starting Baileys client (version: ${version.join(".")}, isLatest: ${isLatest})`);

    const sock = makeWASocket({
      version,
      auth: state,
      logger: logger.child({ module: "baileys" }, { level: "fatal" }) as any,
      printQRInTerminal: false, // We handle it explicitly with qrcode-terminal
      browser: ["WKeep Monitor", "Chrome", "1.0.0"],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 30_000,
      retryRequestDelayMs: 500,
    });

    this.sock = sock;

    // Initialize BullMQ Notification Queue & Worker
    this.queueManager = new NotificationQueueManager(this.repository);
    const notifier = new MonitorNotifier(sock);
    this.queueManager.startWorker(notifier);

    const revokeHandler = new RevokeHandler(
      this.repository,
      notifier,
      this.queueManager
    );

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info("QR Code generated. Scan with WhatsApp mobile:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "close") {
        const error = lastDisconnect?.error as Boom | undefined;
        const statusCode = error?.output?.statusCode;
        const shouldReconnect =
          !this.isExplicitStop && statusCode !== DisconnectReason.loggedOut;

        logger.warn(
          { statusCode, shouldReconnect, reason: error?.message },
          "WhatsApp connection closed"
        );

        if (statusCode === DisconnectReason.loggedOut) {
          logger.error("AUTH_REQUIRED: WhatsApp session logged out. Please re-authenticate.");
        } else if (shouldReconnect) {
          logger.info("RECONNECTING to WhatsApp...");
          setTimeout(() => {
            this.start().catch((err) => {
              logger.error({ err }, "Failed to restart WhatsApp connection");
            });
          }, 3000);
        }
      } else if (connection === "open") {
        logger.info("CONNECTED to WhatsApp successfully");

        // Helper: list participating groups to log for configuration reference
        try {
          const participatingGroups = await sock.groupFetchAllParticipating();
          const groups = Object.values(participatingGroups);
          logger.info(`Bot is participating in ${groups.length} group(s):`);
          for (const g of groups) {
            const isMonitored = config.isMonitoredGroup(g.id);
            const isMonitorDst = config.MONITOR_CHAT_ID === g.id;
            const flag = isMonitorDst
              ? "[MONITOR DESTINATION]"
              : isMonitored
              ? "[MONITORED]"
              : "[IGNORED]";
            logger.info(` -> ${flag} ${g.subject} (${g.id})`);
          }
        } catch (fetchErr) {
          logger.debug({ fetchErr }, "Could not fetch participating groups at startup");
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      for (const msg of messages) {
        try {
          const revokeId = revokeHandler.checkAndExtractRevoke(msg);
          if (revokeId) {
            await revokeHandler.handleRevokeEvent(revokeId);
          } else {
            await this.messageHandler.handleIncomingMessage(sock, msg);
          }
        } catch (err) {
          logger.error({ err, id: msg.key?.id }, "Unhandled error in message upsert");
        }
      }
    });

    sock.ev.on("messages.update", async (updates) => {
      for (const update of updates) {
        const key = update.key;
        if (!key?.id) continue;

        // Check if update indicates revoke
        const updateData = update.update as any;
        if (
          updateData?.messageStubType === 1 /* REVOKE */ ||
          updateData?.protocolMessage?.type === 0
        ) {
          await revokeHandler.handleRevokeEvent(key.id);
        }
      }
    });

    return sock;
  }

  async stop(): Promise<void> {
    this.isExplicitStop = true;

    if (this.queueManager) {
      try {
        await this.queueManager.close();
      } catch (err) {
        logger.error({ err }, "Error while closing BullMQ queue manager");
      } finally {
        this.queueManager = null;
      }
    }

    if (this.sock) {
      try {
        this.sock.end(undefined);
        logger.info("WhatsApp client stopped");
      } finally {
        this.sock = null;
      }
    }
  }

  getSocket(): WASocket | null {
    return this.sock;
  }
}
