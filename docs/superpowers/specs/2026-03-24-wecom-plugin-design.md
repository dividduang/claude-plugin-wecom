# Claude Plugin for WeChat Work (企业微信) - Design Document

**Date:** 2026-03-24
**Status:** Draft
**Author:** Claude Code

## Overview

This document describes the design for `claude-plugin-wecom`, a Claude Code channel plugin that enables communication through WeChat Work (企业微信/WeCom) intelligent robots.

## Goals

- Bridge Claude Code sessions with WeChat Work users via the WeCom intelligent robot API
- Support core messaging features: text, images, files, videos, voice
- Implement permission relay for remote approval of Claude Code tool calls
- Provide secure access control via pairing/allowlist mechanism

## Non-Goals

- Full SDK feature set (streaming responses, template cards) - out of scope for initial version
- Webhook-based messaging - using WebSocket only
- Group chat support - focusing on 1:1 direct messages

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code Session                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  MCP Channel Interface                                   │    │
│  │  - notifications/claude/channel (inbound messages)       │    │
│  │  - reply tool (outbound messages)                        │    │
│  │  - download_attachment tool (media download)             │    │
│  │  - permission relay (approve/deny from WeCom)            │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    claude-plugin-wecom                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  MCP Server (server.ts)                                  │    │
│  │  - Channel protocol translation                          │    │
│  │  - Access control (pairing/allowlist)                    │    │
│  │  - Message formatting (WeCom ↔ MCP)                      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  aibot-node-sdk (dependency)                             │    │
│  │  - WSClient (WebSocket connection)                       │    │
│  │  - Message handling & parsing                            │    │
│  │  - Media upload/download                                 │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                    WeChat Work (企业微信)                        │
│                    Intelligent Robot API                         │
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
claude-plugin-wecom/
├── package.json              # Dependencies and scripts
├── README.md                 # Installation & usage instructions
├── server.ts                 # Main MCP server implementation
├── skills/
│   └── wecom/
│       ├── configure.md      # /wecom:configure skill
│       └── access.md         # /wecom:access skill
└── manifest.json             # Claude plugin manifest
```

### Dependencies

- `aibot-node-sdk` - WeCom WebSocket client SDK
- `@modelcontextprotocol/sdk` - MCP server implementation
- `zod` - Schema validation

### State Files

Location: `~/.claude/channels/wecom/`

| File | Purpose |
|------|---------|
| `credentials.json` | `{ botId, secret }` - WeCom bot credentials |
| `access.json` | Access control configuration |
| `context-tokens.json` | Userid → context_token mapping |
| `inbox/` | Downloaded media attachments |

## Data Flow

### Inbound Messages (WeCom → Claude Code)

1. WeCom user sends message to bot
2. `aibot-node-sdk` WSClient receives `message` event
3. `server.ts` extracts text/media content and sender info
4. Gate check validates access (pairing/allowlist)
5. MCP notification sent to Claude Code:
   ```
   notifications/claude/channel {
     content: "message text (image: attachment_id=xxx)",
     meta: { user_id, context_token, ts }
   }
   ```

### Outbound Messages (Claude Code → WeCom)

1. Claude Code calls `reply` tool with `{ user_id, text, context_token, files? }`
2. Validation: context_token present, user_id in allowlist
3. Text processing: Markdown → plaintext, chunking
4. Text sent via `wsClient.reply()` with stream message type
5. Files (if any) uploaded via `wsClient.uploadMedia()` and sent via `wsClient.replyMedia()`

### Message Type Mapping

| MCP/Channel | WeCom SDK | Notes |
|-------------|-----------|-------|
| Text | `text` / `mixed` | Direct text or mixed with media |
| Image | `image` | Download via SDK with AES decryption |
| File | `file` | Upload via SDK chunk upload |
| Video | `video` | Upload via SDK chunk upload |
| Voice | `voice` | May have ASR text or need download |

## MCP Tools

### `reply`

Send text and/or files to WeCom user.

**Parameters:**
- `user_id` (required): The sender's userid
- `text` (required): Message text (Markdown supported, converted to plaintext)
- `context_token` (required): Context token from inbound message
- `files` (optional): Array of local file paths to send as attachments

**Returns:** `{ content: [{ type: "text", text: "sent N chunk(s) + M file(s)" }] }`

### `download_attachment`

Download a WeCom media attachment to local inbox.

**Parameters:**
- `attachment_id` (required): The attachment ID from inbound message metadata

**Returns:** `{ content: [{ type: "text", text: "/path/to/downloaded/file" }] }`

## Skills

### `/wecom:configure`

Configure WeCom bot credentials.

**Actions:**
- `status` - Show current configuration status
- `set <botId> <secret>` - Save bot credentials
- `clear` - Remove saved credentials

### `/wecom:access`

Manage user access control.

**Actions:**
- `status` - Show current access policy and allowlist
- `pair <code>` - Approve a pending pairing request
- `remove <userid>` - Remove user from allowlist
- `policy <pairing|allowlist|disabled>` - Change access policy
- `humanDelay <on|off>` - Toggle typing simulation
- `textChunkLimit <number>` - Set max chars per message

### Pairing Flow

1. New user sends message to bot
2. Bot replies with 6-character pairing code
3. User tells Claude Code operator the code
4. Operator runs: `/wecom:access pair <code>`
5. User added to allowlist, future messages delivered

## Access Control

### Access Configuration Schema

```typescript
interface Access {
  dmPolicy: 'pairing' | 'allowlist' | 'disabled';
  allowFrom: string[];
  pending: Record<string, PendingEntry>;
  textChunkLimit?: number;
  humanDelay?: boolean;
}

interface PendingEntry {
  senderId: string;
  createdAt: number;
  expiresAt: number;
  replies: number;
}
```

### Gate Logic

1. If `dmPolicy === 'disabled'` → drop message
2. If sender in `allowFrom` → deliver message
3. If `dmPolicy === 'allowlist'` and sender not in allowlist → drop message
4. If `dmPolicy === 'pairing'`:
   - If sender has pending entry → send pairing prompt (up to 2 times)
   - If no pending entry → create new pairing code, send prompt
   - Pending entries expire after 1 hour
   - Max 3 pending entries at once

## Permission Relay

Allow WeCom users to approve/deny Claude Code permission requests remotely.

### Flow

1. Claude Code shows permission prompt
2. Plugin forwards prompt to allowlisted users via WeCom
3. User replies with `yes <code>` or `no <code>`
4. Plugin sends permission response to Claude Code

### Message Format

```
🔐 Claude 请求权限：tool_name
Description of the permission request

回复 "yes CODE" 批准
回复 "no CODE" 拒绝
```

## Error Handling

### Connection Errors

| Scenario | Handling |
|----------|----------|
| WebSocket disconnect | SDK auto-reconnects with exponential backoff |
| Auth failure | Log error, stop retrying, prompt re-configure |
| Max reconnect exceeded | Log error, exit gracefully |

### Message Errors

| Scenario | Handling |
|----------|----------|
| Missing context_token | Return error: "context_token is required" |
| User not allowlisted | Return error: "user X is not allowlisted" |
| Media upload fails | Retry up to 3 times, notify user on failure |
| Message too large | Auto-chunk into multiple messages |

### Graceful Shutdown

1. Set `shuttingDown` flag
2. Close WebSocket connection cleanly
3. Close MCP server
4. Persist any pending state
5. Exit with code 0

## Testing Strategy

1. **Unit tests** for utility functions (chunking, markdown conversion)
2. **Integration tests** with mock WeCom SDK
3. **Manual testing** with actual WeCom bot

## Implementation Notes

### Key Differences from WeChat Plugin

1. **Protocol**: WebSocket vs HTTP long-poll
2. **Authentication**: botId + secret vs QR code login
3. **Message format**: Different WeCom API structure
4. **Media handling**: Different encryption (AES-256-CBC vs AES-128-ECB)

### aibot-node-sdk Integration

The plugin uses `aibot-node-sdk` as a dependency for:
- WebSocket connection management
- Message serialization/deserialization
- Media upload (chunked)
- File download and decryption

Key imports:
```typescript
import { WSClient, type TextMessage, type ImageMessage } from 'aibot-node-sdk';
```

## Success Criteria

1. Users can send/receive text messages with Claude Code via WeCom
2. Media attachments (images, files) work in both directions
3. Permission relay allows remote approval
4. Pairing flow works correctly
5. Plugin handles disconnections gracefully
6. Clear error messages for configuration issues

## References

- Source project: `D:\rpa\202603\claude-plugin-wechat`
- Reference SDK: `D:\rpa\202603\aibot-node-sdk`
- WeCom API documentation: https://developer.work.weixin.qq.com/document/
