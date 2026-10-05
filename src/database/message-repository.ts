import { Database as DatabaseType } from "better-sqlite3";
import { getDatabase } from "./database.js";

export type MessageStatus = "active" | "deleted";

export interface MessageRecord {
  id?: number;
  message_id: string;
  chat_id: string;
  chat_name: string | null;
  sender_id: string | null;
  sender_name: string | null;
  message_type: string;
  text_content: string | null;
  media_path: string | null;
  media_filename: string | null;
  media_mime_type: string | null;
  media_size: number | null;
  status: MessageStatus;
  sent_at: number;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

export type NewMessageInput = Omit<MessageRecord, "id" | "created_at" | "updated_at">;

export class MessageRepository {
  private db: DatabaseType;

  constructor(db?: DatabaseType) {
    this.db = db || getDatabase();
  }

  saveMessage(msg: NewMessageInput): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO messages (
        message_id,
        chat_id,
        chat_name,
        sender_id,
        sender_name,
        message_type,
        text_content,
        media_path,
        media_filename,
        media_mime_type,
        media_size,
        status,
        sent_at,
        deleted_at,
        created_at,
        updated_at
      ) VALUES (
        @message_id,
        @chat_id,
        @chat_name,
        @sender_id,
        @sender_name,
        @message_type,
        @text_content,
        @media_path,
        @media_filename,
        @media_mime_type,
        @media_size,
        @status,
        @sent_at,
        @deleted_at,
        @created_at,
        @updated_at
      )
    `);

    const result = stmt.run({
      ...msg,
      created_at: now,
      updated_at: now,
    });

    return result.changes > 0;
  }

  findByMessageId(messageId: string): MessageRecord | undefined {
    const stmt = this.db.prepare<[string], MessageRecord>(`
      SELECT * FROM messages WHERE message_id = ?
    `);
    return stmt.get(messageId);
  }

  markAsDeleted(messageId: string, deletedAt: number = Date.now()): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE messages
      SET status = 'deleted',
          deleted_at = ?,
          updated_at = ?
      WHERE message_id = ?
        AND status != 'deleted'
    `);

    const result = stmt.run(deletedAt, now, messageId);
    return result.changes > 0;
  }

  findExpiredActiveMessages(retentionDays: number): MessageRecord[] {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const stmt = this.db.prepare<[number], MessageRecord>(`
      SELECT * FROM messages
      WHERE status = 'active'
        AND sent_at < ?
      ORDER BY sent_at ASC
    `);
    return stmt.all(cutoff);
  }

  deleteMessage(messageId: string): boolean {
    // Safety requirement: NEVER delete records where status = 'deleted'
    const stmt = this.db.prepare(`
      DELETE FROM messages
      WHERE message_id = ?
        AND status = 'active'
    `);
    const result = stmt.run(messageId);
    return result.changes > 0;
  }

  getStats(): { total: number; active: number; deleted: number } {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS deleted
         FROM messages`
      )
      .get() as { total: number; active: number; deleted: number };

    return {
      total: row?.total ?? 0,
      active: row?.active ?? 0,
      deleted: row?.deleted ?? 0,
    };
  }
}
