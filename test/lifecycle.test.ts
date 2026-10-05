import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CleanupService } from "../src/cleanup/cleanup-service.js";
import { MessageRepository } from "../src/database/message-repository.js";
import { runMigrations } from "../src/database/migrations.js";
import { getMessageTypeAndText } from "../src/whatsapp/message-handler.js";

describe("WKeep Core Lifecycle & Retention Tests", () => {
  let db: ReturnType<typeof Database>;
  let repository: MessageRepository;
  let cleanupService: CleanupService;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wkeep-test-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    db = new Database(dbPath);
    runMigrations(db);
    repository = new MessageRepository(db);
    cleanupService = new CleanupService(repository);
  });

  afterEach(() => {
    try {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors in tests
    }
  });

  it("should save and retrieve an active message", () => {
    const success = repository.saveMessage({
      message_id: "MSG_001",
      chat_id: "120363001@g.us",
      chat_name: "Test Group",
      sender_id: "62812345678@s.whatsapp.net",
      sender_name: "Budi",
      message_type: "text",
      text_content: "Meeting besok jam 10.",
      media_path: null,
      media_filename: null,
      media_mime_type: null,
      media_size: null,
      status: "active",
      sent_at: Date.now(),
      deleted_at: null,
    });

    expect(success).toBe(true);

    const record = repository.findByMessageId("MSG_001");
    expect(record).toBeDefined();
    expect(record?.message_id).toBe("MSG_001");
    expect(record?.text_content).toBe("Meeting besok jam 10.");
    expect(record?.status).toBe("active");
  });

  it("should handle revoke/delete idempotently", () => {
    repository.saveMessage({
      message_id: "MSG_REVOKE",
      chat_id: "120363001@g.us",
      chat_name: "Test Group",
      sender_id: "62812345678@s.whatsapp.net",
      sender_name: "Budi",
      message_type: "text",
      text_content: "Pesan rahasia",
      media_path: null,
      media_filename: null,
      media_mime_type: null,
      media_size: null,
      status: "active",
      sent_at: Date.now() - 5000,
      deleted_at: null,
    });

    const deleteTimestamp = Date.now();
    const firstMark = repository.markAsDeleted("MSG_REVOKE", deleteTimestamp);
    expect(firstMark).toBe(true);

    const updated = repository.findByMessageId("MSG_REVOKE");
    expect(updated?.status).toBe("deleted");
    expect(updated?.deleted_at).toBe(deleteTimestamp);

    // Second revoke call must be ignored and return false
    const secondMark = repository.markAsDeleted("MSG_REVOKE", deleteTimestamp + 1000);
    expect(secondMark).toBe(false);

    const recordAfterSecond = repository.findByMessageId("MSG_REVOKE");
    expect(recordAfterSecond?.deleted_at).toBe(deleteTimestamp); // unmutated
  });

  it("should enforce 7-day retention: active > 7 days deleted, deleted status preserved forever", () => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Create dummy media file
    const activeOldMediaPath = path.join(tempDir, "old_media.jpg");
    fs.writeFileSync(activeOldMediaPath, "dummy image content");

    const deletedOldMediaPath = path.join(tempDir, "preserved_media.jpg");
    fs.writeFileSync(deletedOldMediaPath, "preserved image content");

    // 1. Active message, 8 days old (should be cleaned up)
    repository.saveMessage({
      message_id: "ACTIVE_8_DAYS",
      chat_id: "120363001@g.us",
      chat_name: "Test Group",
      sender_id: "sender1",
      sender_name: "User 1",
      message_type: "image",
      text_content: "Gambar lama",
      media_path: activeOldMediaPath,
      media_filename: "old_media.jpg",
      media_mime_type: "image/jpeg",
      media_size: 100,
      status: "active",
      sent_at: now - 8 * oneDayMs,
      deleted_at: null,
    });

    // 2. Active message, 5 days old (should be retained)
    repository.saveMessage({
      message_id: "ACTIVE_5_DAYS",
      chat_id: "120363001@g.us",
      chat_name: "Test Group",
      sender_id: "sender2",
      sender_name: "User 2",
      message_type: "text",
      text_content: "Pesan 5 hari lalu",
      media_path: null,
      media_filename: null,
      media_mime_type: null,
      media_size: null,
      status: "active",
      sent_at: now - 5 * oneDayMs,
      deleted_at: null,
    });

    // 3. Deleted message, 30 days old (MUST BE PRESERVED FOREVER)
    repository.saveMessage({
      message_id: "DELETED_30_DAYS",
      chat_id: "120363001@g.us",
      chat_name: "Test Group",
      sender_id: "sender3",
      sender_name: "User 3",
      message_type: "image",
      text_content: "Pesan dihapus 30 hari lalu",
      media_path: deletedOldMediaPath,
      media_filename: "preserved_media.jpg",
      media_mime_type: "image/jpeg",
      media_size: 100,
      status: "deleted",
      sent_at: now - 30 * oneDayMs,
      deleted_at: now - 30 * oneDayMs + 1000,
    });

    // 4. Deleted message, 365 days old (MUST BE PRESERVED FOREVER)
    repository.saveMessage({
      message_id: "DELETED_365_DAYS",
      chat_id: "120363001@g.us",
      chat_name: "Test Group",
      sender_id: "sender4",
      sender_name: "User 4",
      message_type: "text",
      text_content: "Pesan dihapus 1 tahun lalu",
      media_path: null,
      media_filename: null,
      media_mime_type: null,
      media_size: null,
      status: "deleted",
      sent_at: now - 365 * oneDayMs,
      deleted_at: now - 365 * oneDayMs + 500,
    });

    // Run Cleanup
    const result = cleanupService.runCleanup(7);

    expect(result.deletedMessages).toBe(1);
    expect(result.deletedMedia).toBe(1);

    // Verify Active 8 days was removed from DB and filesystem
    expect(repository.findByMessageId("ACTIVE_8_DAYS")).toBeUndefined();
    expect(fs.existsSync(activeOldMediaPath)).toBe(false);

    // Verify Active 5 days is still present
    expect(repository.findByMessageId("ACTIVE_5_DAYS")).toBeDefined();

    // Verify Deleted 30 days and 365 days are STILL PRESENT (never deleted)
    expect(repository.findByMessageId("DELETED_30_DAYS")).toBeDefined();
    expect(repository.findByMessageId("DELETED_30_DAYS")?.status).toBe("deleted");
    expect(fs.existsSync(deletedOldMediaPath)).toBe(true); // media preserved

    expect(repository.findByMessageId("DELETED_365_DAYS")).toBeDefined();
    expect(repository.findByMessageId("DELETED_365_DAYS")?.status).toBe("deleted");
  });

  it("should extract message types and content accurately", () => {
    // Text conversation
    const res1 = getMessageTypeAndText({
      key: { id: "1" },
      message: { conversation: "Hello World" },
    });
    expect(res1.messageType).toBe("text");
    expect(res1.textContent).toBe("Hello World");
    expect(res1.hasMedia).toBe(false);

    // Image message
    const res2 = getMessageTypeAndText({
      key: { id: "2" },
      message: { imageMessage: { caption: "Foto kantor", mimetype: "image/jpeg" } },
    });
    expect(res2.messageType).toBe("image");
    expect(res2.textContent).toBe("Foto kantor");
    expect(res2.hasMedia).toBe(true);

    // Ephemeral wrapped text
    const res3 = getMessageTypeAndText({
      key: { id: "3" },
      message: {
        ephemeralMessage: {
          message: {
            conversation: "Ephemeral text",
          },
        },
      },
    });
    expect(res3.messageType).toBe("text");
    expect(res3.textContent).toBe("Ephemeral text");
  });
});
