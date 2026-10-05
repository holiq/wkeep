import { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { config } from "../config.js";
import { MessageRepository } from "../database/message-repository.js";
import { logger } from "../logger.js";
import { processAndSaveMedia } from "./media-handler.js";

export function getMessageTypeAndText(message: WAMessage): {
  messageType: string;
  textContent: string | null;
  hasMedia: boolean;
} {
  const msg = message.message;
  if (!msg) {
    return { messageType: "unknown", textContent: null, hasMedia: false };
  }

  if (msg.conversation) {
    return { messageType: "text", textContent: msg.conversation, hasMedia: false };
  }

  if (msg.extendedTextMessage?.text) {
    return {
      messageType: "text",
      textContent: msg.extendedTextMessage.text,
      hasMedia: false,
    };
  }

  if (msg.imageMessage) {
    return {
      messageType: "image",
      textContent: msg.imageMessage.caption || null,
      hasMedia: true,
    };
  }

  if (msg.videoMessage) {
    return {
      messageType: "video",
      textContent: msg.videoMessage.caption || null,
      hasMedia: true,
    };
  }

  if (msg.documentMessage) {
    return {
      messageType: "document",
      textContent: msg.documentMessage.caption || null,
      hasMedia: true,
    };
  }

  if (msg.audioMessage) {
    return { messageType: "audio", textContent: null, hasMedia: true };
  }

  if (msg.stickerMessage) {
    return { messageType: "sticker", textContent: null, hasMedia: true };
  }

  // Handle ephemeralMessage or viewOnceMessage wrappers
  if (msg.ephemeralMessage?.message) {
    return getMessageTypeAndText({
      ...message,
      message: msg.ephemeralMessage.message,
    });
  }

  if (msg.viewOnceMessage?.message) {
    return getMessageTypeAndText({
      ...message,
      message: msg.viewOnceMessage.message,
    });
  }

  if (msg.viewOnceMessageV2?.message) {
    return getMessageTypeAndText({
      ...message,
      message: msg.viewOnceMessageV2.message,
    });
  }

  const primaryKey = Object.keys(msg)[0] || "unsupported";
  return { messageType: primaryKey, textContent: null, hasMedia: false };
}

export class MessageHandler {
  private repository: MessageRepository;

  constructor(repository: MessageRepository) {
    this.repository = repository;
  }

  async handleIncomingMessage(sock: WASocket, message: WAMessage): Promise<void> {
    const key = message.key;
    const remoteJid = key.remoteJid;

    if (!remoteJid) {
      return;
    }

    if (!config.isMonitoredChat(remoteJid)) {
      return;
    }

    // Abaikan pesan sinkronisasi internal antar-perangkat ke akun sendiri
    const ownLid = sock.user?.lid ? sock.user.lid.split(":")[0] + "@lid" : null;
    const ownJid = sock.user?.id ? sock.user.id.split(":")[0] + "@s.whatsapp.net" : null;
    if ((ownLid && remoteJid === ownLid) || (ownJid && remoteJid === ownJid)) {
      return;
    }

    const messageId = key.id;
    if (!messageId) {
      return;
    }

    try {
      const isGroup = remoteJid.endsWith("@g.us");
      const senderId = isGroup
        ? key.participant || message.participant || remoteJid
        : key.fromMe
        ? sock.user?.id || "me"
        : remoteJid;

      const senderName = key.fromMe
        ? "You"
        : message.pushName || senderId.split("@")[0];

      const chatName = isGroup
        ? null
        : message.pushName || "Personal Chat";

      const sentAt =
        typeof message.messageTimestamp === "number"
          ? message.messageTimestamp * 1000
          : typeof message.messageTimestamp === "object" && message.messageTimestamp !== null
          ? Number(message.messageTimestamp) * 1000
          : Date.now();

      const { messageType, textContent, hasMedia } = getMessageTypeAndText(message);

      // Abaikan pesan yang gagal didekripsi atau tidak memiliki teks/media
      if ((messageType === "unknown" || !messageType) && !hasMedia && !textContent) {
        return;
      }

      // Abaikan pesan sinkronisasi internal WhatsApp (app state, sync, receipts)
      const IGNORED_SYSTEM_TYPES = new Set([
        "protocolMessage",
        "senderKeyDistributionMessage",
        "fastRatchetKeySenderKeyDistributionMessage",
        "historySyncNotification",
        "appStateSyncKeyShare",
        "appStateSyncKeyRequest",
        "reactionMessage",
      ]);

      if (IGNORED_SYSTEM_TYPES.has(messageType)) {
        return;
      }

      let mediaPath: string | null = null;
      let mediaFilename: string | null = null;
      let mediaMimeType: string | null = null;
      let mediaSize: number | null = null;

      if (hasMedia) {
        const mediaDetails = await processAndSaveMedia(message, messageId);
        mediaPath = mediaDetails.mediaPath;
        mediaFilename = mediaDetails.mediaFilename;
        mediaMimeType = mediaDetails.mediaMimeType;
        mediaSize = mediaDetails.mediaSize;
      }

      this.repository.saveMessage({
        message_id: messageId,
        chat_id: remoteJid,
        chat_name: chatName,
        sender_id: senderId,
        sender_name: senderName,
        message_type: messageType,
        text_content: textContent,
        media_path: mediaPath,
        media_filename: mediaFilename,
        media_mime_type: mediaMimeType,
        media_size: mediaSize,
        status: "active",
        sent_at: sentAt,
        deleted_at: null,
      });

      if (isGroup) {
        logger.info(
          `MESSAGE [GROUP] group="${remoteJid}" sender="${senderName}" type="${messageType}" id="${messageId}"`
        );
      } else {
        logger.info(
          `MESSAGE [PERSONAL] sender="${senderName}" (${remoteJid}) type="${messageType}" id="${messageId}"`
        );
      }
    } catch (error) {
      logger.error({ error, messageId }, "Failed to process incoming message");
    }
  }
}
