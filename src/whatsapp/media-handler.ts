import { WAMessage, downloadMediaMessage } from "@whiskeysockets/baileys";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../logger.js";

export interface MediaDetails {
  mediaPath: string | null;
  mediaFilename: string | null;
  mediaMimeType: string | null;
  mediaSize: number | null;
}

export function getExtensionFromMime(mime: string): string {
  const baseMime = mime.split(";")[0].trim().toLowerCase();
  switch (baseMime) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "video/mp4":
      return ".mp4";
    case "video/3gpp":
      return ".3gp";
    case "video/quicktime":
      return ".mov";
    case "audio/ogg":
    case "audio/opus":
      return ".ogg";
    case "audio/mpeg":
    case "audio/mp3":
      return ".mp3";
    case "audio/mp4":
    case "audio/m4a":
      return ".m4a";
    case "application/pdf":
      return ".pdf";
    case "application/zip":
      return ".zip";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return ".docx";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return ".xlsx";
    default:
      return ".bin";
  }
}

export async function processAndSaveMedia(
  message: WAMessage,
  messageId: string
): Promise<MediaDetails> {
  const msg = message.message;
  if (!msg) {
    return { mediaPath: null, mediaFilename: null, mediaMimeType: null, mediaSize: null };
  }

  const mediaMsg =
    msg.imageMessage ||
    msg.videoMessage ||
    msg.documentMessage ||
    msg.audioMessage ||
    msg.stickerMessage;

  if (!mediaMsg) {
    return { mediaPath: null, mediaFilename: null, mediaMimeType: null, mediaSize: null };
  }

  const mimeType = mediaMsg.mimetype || "application/octet-stream";
  const originalFilename =
    "fileName" in mediaMsg && typeof mediaMsg.fileName === "string"
      ? mediaMsg.fileName
      : null;

  const declaredSize =
    typeof mediaMsg.fileLength === "number"
      ? mediaMsg.fileLength
      : typeof mediaMsg.fileLength === "object" && mediaMsg.fileLength !== null
      ? Number(mediaMsg.fileLength)
      : null;

  const maxSizeBytes = config.maxMediaSizeBytes();

  if (declaredSize && declaredSize > maxSizeBytes) {
    const sizeMb = (declaredSize / (1024 * 1024)).toFixed(2);
    logger.warn(
      `⚠ MEDIA_TOO_LARGE message="${messageId}" size=${sizeMb}MB limit=${config.MAX_MEDIA_SIZE_MB}MB`
    );
    return {
      mediaPath: null,
      mediaFilename: originalFilename,
      mediaMimeType: mimeType,
      mediaSize: declaredSize,
    };
  }

  try {
    const buffer = (await downloadMediaMessage(
      message,
      "buffer",
      {},
      {
        logger: logger as any,
        reuploadRequest: async () => {
          throw new Error("Re-upload not supported in downloadMediaMessage");
        },
      }
    )) as Buffer;

    if (!buffer || buffer.length === 0) {
      logger.warn({ messageId }, "Downloaded media buffer is empty");
      return {
        mediaPath: null,
        mediaFilename: originalFilename,
        mediaMimeType: mimeType,
        mediaSize: declaredSize,
      };
    }

    if (buffer.length > maxSizeBytes) {
      const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);
      logger.warn(
        `⚠ MEDIA_TOO_LARGE message="${messageId}" size=${sizeMb}MB limit=${config.MAX_MEDIA_SIZE_MB}MB`
      );
      return {
        mediaPath: null,
        mediaFilename: originalFilename,
        mediaMimeType: mimeType,
        mediaSize: buffer.length,
      };
    }

    // Determine extension
    let ext = getExtensionFromMime(mimeType);
    if (originalFilename) {
      const fileExt = path.extname(originalFilename);
      if (fileExt && fileExt.length <= 6) {
        ext = fileExt;
      }
    }

    const safeMessageId = messageId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const targetFilename = `${safeMessageId}${ext}`;
    const targetPath = path.join(config.MEDIA_DIR, targetFilename);

    // Save media to filesystem
    await fs.promises.writeFile(targetPath, buffer, { mode: 0o600 });

    const sizeKb = (buffer.length / 1024).toFixed(1);
    logger.info(`MEDIA_DOWNLOADED message="${messageId}" size=${sizeKb}KB path="${targetFilename}"`);

    return {
      mediaPath: targetPath,
      mediaFilename: originalFilename || targetFilename,
      mediaMimeType: mimeType,
      mediaSize: buffer.length,
    };
  } catch (error) {
    logger.error({ error, messageId }, "Failed to download media message");
    return {
      mediaPath: null,
      mediaFilename: originalFilename,
      mediaMimeType: mimeType,
      mediaSize: declaredSize,
    };
  }
}
