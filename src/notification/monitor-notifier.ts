import { WASocket } from "@whiskeysockets/baileys";
import fs from "node:fs";
import { config } from "../config.js";
import { MessageRecord } from "../database/message-repository.js";
import { logger } from "../logger.js";

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export class MonitorNotifier {
  private sock: WASocket;

  constructor(sock: WASocket) {
    this.sock = sock;
  }

  async sendDeletedMessage(record: MessageRecord): Promise<void> {
    const destination = config.MONITOR_CHAT_ID;
    if (!destination) {
      logger.warn(
        { messageId: record.message_id },
        "MONITOR_CHAT_ID not configured, notification skipped"
      );
      return;
    }

    const isGroup = record.chat_id.endsWith("@g.us");
    const chatLabel = isGroup ? "Group   " : "Chat    ";
    const chatDisplayName = isGroup
      ? record.chat_name || record.chat_id
      : record.chat_name
      ? `${record.chat_name} (${record.chat_id.split("@")[0]})`
      : record.chat_id.split("@")[0];

    const sender = record.sender_name || record.sender_id || "Unknown";
    const sentTime = formatTimestamp(record.sent_at);
    const deletedTime = record.deleted_at ? formatTimestamp(record.deleted_at) : formatTimestamp(Date.now());

    const hasMedia = record.media_path && fs.existsSync(record.media_path);

    try {
      if (record.message_type === "image" && hasMedia) {
        let caption = `🚨 PESAN GAMBAR DIHAPUS\n\n${chatLabel}: ${chatDisplayName}\nSender  : ${sender}\nSent    : ${sentTime}\nDeleted : ${deletedTime}`;
        if (record.text_content) {
          caption += `\n\n💬 ${record.text_content}`;
        }
        await this.sock.sendMessage(destination, {
          image: fs.readFileSync(record.media_path!),
          caption,
        });
      } else if (record.message_type === "video" && hasMedia) {
        let caption = `🚨 PESAN VIDEO DIHAPUS\n\n${chatLabel}: ${chatDisplayName}\nSender  : ${sender}\nSent    : ${sentTime}\nDeleted : ${deletedTime}`;
        if (record.text_content) {
          caption += `\n\n💬 ${record.text_content}`;
        }
        await this.sock.sendMessage(destination, {
          video: fs.readFileSync(record.media_path!),
          caption,
        });
      } else if (record.message_type === "document" && hasMedia) {
        let caption = `🚨 DOKUMEN DIHAPUS\n\n${chatLabel}: ${chatDisplayName}\nSender  : ${sender}\nFile    : ${record.media_filename || "Dokumen"}\nSent    : ${sentTime}\nDeleted : ${deletedTime}`;
        if (record.text_content) {
          caption += `\n\n💬 ${record.text_content}`;
        }
        await this.sock.sendMessage(destination, {
          document: fs.readFileSync(record.media_path!),
          mimetype: record.media_mime_type || "application/octet-stream",
          fileName: record.media_filename || "document",
          caption,
        });
      } else if (record.message_type === "audio" && hasMedia) {
        const textNotice = `🚨 PESAN AUDIO DIHAPUS\n\n${chatLabel}: ${chatDisplayName}\nSender  : ${sender}\nSent    : ${sentTime}\nDeleted : ${deletedTime}`;
        await this.sock.sendMessage(destination, { text: textNotice });
        await this.sock.sendMessage(destination, {
          audio: fs.readFileSync(record.media_path!),
          mimetype: record.media_mime_type || "audio/ogg; codecs=opus",
        });
      } else if (record.message_type === "sticker" && hasMedia) {
        const textNotice = `🚨 STIKER DIHAPUS\n\n${chatLabel}: ${chatDisplayName}\nSender  : ${sender}\nSent    : ${sentTime}\nDeleted : ${deletedTime}`;
        await this.sock.sendMessage(destination, { text: textNotice });
        await this.sock.sendMessage(destination, {
          sticker: fs.readFileSync(record.media_path!),
        });
      } else {
        // Teks biasa ATAU pesan media yang file-nya tidak tersedia
        let messageText = `🚨 PESAN DIHAPUS\n\n${chatLabel}: ${chatDisplayName}\nSender  : ${sender}\nSent    : ${sentTime}\nDeleted : ${deletedTime}`;

        if (record.media_filename || record.media_mime_type) {
          messageText += `\n\n📎 File: ${record.media_filename || "Media file"}`;
          messageText += `\n⚠ File tidak tersedia karena gagal disimpan saat pesan diterima atau melebihi batas ukuran (${config.MAX_MEDIA_SIZE_MB}MB).`;
        }

        if (record.text_content) {
          messageText += `\n\n💬 ${record.text_content}`;
        }

        await this.sock.sendMessage(destination, { text: messageText });
      }

      logger.info(
        `FORWARDED message="${record.message_id}" destination="${destination}"`
      );
    } catch (error) {
      logger.error(
        { error, messageId: record.message_id, destination },
        "Failed to forward deleted message notification"
      );
    }
  }
}
