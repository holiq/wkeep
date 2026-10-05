# WKeep — WhatsApp Deleted Message Monitor

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v20%2B-green.svg" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue.svg" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Database-SQLite%203-lightgrey.svg" alt="SQLite" />
  <img src="https://img.shields.io/badge/Queue-BullMQ%20%2B%20Redis-red.svg" alt="BullMQ & Redis" />
  <img src="https://img.shields.io/badge/License-MIT-brightgreen.svg" alt="License" />
</p>

**WKeep** is a high-performance, lightweight WhatsApp background daemon built with TypeScript and Baileys. It detects messages revoked (*"Delete for Everyone"*) by their senders in real time and automatically forwards the original content (text, images, videos, audio, documents, and stickers) to your designated personal monitor group or chat.

---

## 💡 Core Principle

> **"Normal messages are temporary (7 days). Deleted messages are permanent."**

Every incoming message from monitored chats is cached temporarily in a local, embedded SQLite database for 7 days. If a sender deletes a message before retention expires, WKeep catches the revoke event, marks the record as `deleted`, permanently preserves the original media, and forwards it to your private monitor destination through an anti-ban rate-limited queue.

---

## 🚀 Key Features

- **⚡ Lightweight & Zero HTTP Overhead**: Runs strictly as a background service. No web dashboard, no REST/GraphQL API, and no unnecessary open ports.
- **🗄️ High-Performance Local Storage**: Powered by `better-sqlite3` in Write-Ahead Logging (WAL) mode for fast concurrent reads and writes.
- **📷 Instant Media Preservation**: Images, videos, documents, voice notes, and stickers are downloaded immediately upon receipt—ensuring media is already safely cached locally before any sender can delete it.
- **🛡️ Anti-Ban Queue (BullMQ + Redis)**: Outgoing notifications are processed through a persistent BullMQ queue with automatic rate-limiting (1 message per 1.5s) to protect your WhatsApp account from spam-detection bans.
- **🎯 Granular Monitoring Scope**:
  - **Personal Chats**: All 1-on-1 direct messages (`@s.whatsapp.net` and `@lid`) are automatically monitored.
  - **Group Chats**: Monitored strictly based on a configurable allowlist (`MONITORED_GROUP_IDS`).
  - **Anti-Looping**: The monitor destination (`MONITOR_CHAT_ID`) is automatically excluded to prevent recursive message forwarding loops.
- **🧹 Non-Destructive 7-Day Cleanup**: Automatically purges active messages and expired physical media older than 7 days, while **strictly never touching records marked as `deleted`**.
- **🔒 Privacy-First CLI Logging**: Terminal logs print only essential metadata (chat, sender, message ID, type, timestamp)—never full private text contents.
- **⚙️ Production-Ready**: Bundled with `systemd` service and timer units for automated startup, crash-recovery, and daily maintenance on Linux servers.

---

## 🏗️ Architecture

```text
                           WhatsApp Web (Baileys)
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │    WhatsAppClient     │
                         └───────────┬───────────┘
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
           Incoming Message (upsert)       Revoke Event (delete)
                     │                               │
            Filter isMonitoredChat                   │
       (All Personal + Group Allowlist)              │
                     │                               ▼
                     ▼                         RevokeHandler
              MessageHandler                         │
                     │                         Find message ID
              Contains Media?                 in SQLite Database
            ┌────────┴────────┐                      │
           Yes                No               Mark status = 'deleted'
            │                 │                      │
            ▼                 │                      ▼
       MediaHandler           │            [whatsapp-notifications]
    Download Immediately      │            BullMQ Queue (Redis)
            │                 │                      │
            └────────┬────────┘                      ▼
                     ▼                      Notification Worker
             MessageRepository           Rate-Limited (1 msg / 1.5s)
             (SQLite Database)                       │
                     │                               ▼
                     ▼                        MonitorNotifier
             Local Filesystem              (Forward original text
             (data/media/)                & media to MONITOR_CHAT_ID)
```

---

## 📋 Prerequisites

- **Node.js**: `v20.x` or later (tested on `v24.x`)
- **Redis Server**: `v6.x` or later (for BullMQ queue processing)
- **Linux OS**: Ubuntu / Debian / Rocky Linux / Arch (recommended for `systemd` deployment)

---

## 🛠️ Quick Start

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/your-username/wkeep.git
cd wkeep
npm install
```

### 2. Verify Redis Server

Ensure your local Redis server is active:
```bash
redis-cli ping
# Expected output: PONG
```

If Redis is not yet running:
```bash
sudo systemctl enable --now redis-server
```

### 3. Configure Environment

Copy the example environment configuration:
```bash
cp .env.example .env
```

Edit `.env` to match your environment:
```env
NODE_ENV=production

# Database & Local Media
DATABASE_PATH=./data/whatsapp-monitor.sqlite
MEDIA_DIR=./data/media
AUTH_DIR=./auth

# WhatsApp Monitor Configuration
# Monitored Group IDs (comma-separated list of group JIDs ending in @g.us)
MONITORED_GROUP_IDS=120363111111111111@g.us,120363222222222222@g.us

# Destination group/chat JID where deleted messages are forwarded
MONITOR_CHAT_ID=120363999999999999@g.us

# Retention & Limits
MESSAGE_RETENTION_DAYS=7
MAX_MEDIA_SIZE_MB=50

# Redis Connection (BullMQ)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

# Logging
LOG_LEVEL=info
```

### 4. Secure Filesystem Permissions

Restrict sensitive authentication and data folders to your current user:
```bash
chmod 700 auth data
```

### 5. Pair WhatsApp Account

Start the application in development mode to link your device:
```bash
npm run dev
```

A QR code will be printed in your terminal. Open WhatsApp on your primary phone:
> **Settings > Linked Devices > Link a Device > Scan QR Code**

Upon successful connection, WKeep will log all participating groups with their corresponding JIDs:
```text
INFO: CONNECTED to WhatsApp successfully
INFO: Bot is participating in 5 group(s):
INFO:  -> [MONITORED] Development Team (120363111111111111@g.us)
INFO:  -> [IGNORED] Family Group (120363222222222222@g.us)
```
*(Copy any desired group JIDs into your `MONITORED_GROUP_IDS` variable).*

---

## 🔔 Notification Showcase

When a message is revoked, WKeep sends formatted notifications to `MONITOR_CHAT_ID`:

### 💬 Text Message
```text
🚨 PESAN DIHAPUS

Group   : Development Team
Sender  : Budi
Sent    : 2026-10-05 10:22:15
Deleted : 2026-10-05 10:23:01

💬 Meeting besok jam 10 pagi jangan sampai telat ya.
```

### 📷 Image Message
The notification delivers the **original, full-resolution image** along with the caption:
```text
🚨 PESAN GAMBAR DIHAPUS

Chat    : Sarah (628123456789)
Sender  : Sarah
Sent    : 2026-10-05 11:15:00
Deleted : 2026-10-05 11:16:30

💬 Bukti transfer pembayaran invoice #1024
[Attached Image File]
```

### 📄 Document Message
The notification delivers the **original file attachment** (PDF, Excel, Word, ZIP, etc.):
```text
🚨 DOKUMEN DIHAPUS

Group   : Accounting Department
Sender  : Finance Staff
File    : Laporan_Q3_Draft.pdf
Sent    : 2026-10-05 09:30:10
Deleted : 2026-10-05 09:35:00
[Attached Document File]
```

---

## ⚙️ Production Deployment (`systemd`)

Run WKeep continuously as a Linux system service with automatic restart on failures.

### 1. Configure Unit Files

Review `systemd/wa-monitor.service` and ensure `User` and `WorkingDirectory` point to your deployment directory:

```ini
[Unit]
Description=WhatsApp Deleted Message Monitor (WKeep)
After=network-online.target redis-server.service
Wants=network-online.target redis-server.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/opt/wkeep
ExecStart=/usr/bin/node /opt/wkeep/dist/index.js
Restart=always
RestartSec=5

EnvironmentFile=/opt/wkeep/.env

NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### 2. Install & Start Services

```bash
# Build production assets
npm run build

# Install systemd service and cleanup timer
sudo cp systemd/wa-monitor.service /etc/systemd/system/
sudo cp systemd/wa-monitor-cleanup.service /etc/systemd/system/
sudo cp systemd/wa-monitor-cleanup.timer /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start bot daemon
sudo systemctl enable --now wa-monitor

# Enable daily 03:00 AM retention cleanup timer
sudo systemctl enable --now wa-monitor-cleanup.timer
```

### 3. Monitoring Service Logs

```bash
# Follow live logs
journalctl -u wa-monitor -f

# View retention cleanup timer history
systemctl list-timers | grep wa-monitor
```

---

## 💻 Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Runs the bot with `tsx` (TypeScript execute) without compiling. |
| `npm run build` | Compiles TypeScript source files into `dist/`. |
| `npm start` | Runs the compiled production build from `dist/index.js`. |
| `npm run cleanup` | Manually triggers the 7-day retention cleanup routine. |
| `npm test` | Executes unit and retention lifecycle tests with Vitest. |
| `npm run lint` | Performs strict TypeScript type checks without emitting files. |

---

## 🛡️ Security & Privacy Notice

- **Authentication Data (`auth/`)**: Contains WhatsApp encryption keys and active session tokens. Never commit the `auth/` directory or share session files.
- **Privacy First**: WKeep never exposes message data over any network port or web interface.
- **Offline Limitations**: WKeep can only preserve messages received while the bot process was online and connected. Messages sent and revoked while the bot was offline cannot be recovered.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
