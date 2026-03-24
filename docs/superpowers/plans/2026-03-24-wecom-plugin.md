# WeCom Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code channel plugin for WeChat Work (企业微信) intelligent robots using WebSocket protocol.

**Architecture:** Single-file MCP server (server.ts) using aibot-node-sdk for WebSocket communication. State stored in ~/.claude/channels/wecom/. Skills for configuration and access control.

**Tech Stack:** TypeScript, Bun runtime, aibot-node-sdk, @modelcontextprotocol/sdk, zod

---

## File Structure

```
claude-plugin-wecom/
├── package.json              # Project config and dependencies
├── README.md                 # Installation and usage guide
├── server.ts                 # Main MCP server (~400 lines)
├── skills/
│   └── wecom/
│       ├── configure.md      # /wecom:configure skill
│       └── access.md         # /wecom:access skill
└── manifest.json             # Claude plugin manifest
```

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `manifest.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "claude-channel-wecom",
  "version": "0.1.0",
  "license": "MIT",
  "type": "module",
  "bin": "./server.ts",
  "scripts": {
    "start": "bun install --no-summary && bun server.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "aibot-node-sdk": "file:../aibot-node-sdk",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Create manifest.json**

```json
{
  "name": "wecom",
  "version": "0.1.0",
  "description": "WeChat Work (企业微信) channel for Claude Code",
  "main": "server.ts",
  "channel": {
    "name": "wecom",
    "capabilities": ["claude/channel", "claude/channel/permission"]
  },
  "skills": [
    "skills/wecom/configure.md",
    "skills/wecom/access.md"
  ]
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd "D:/rpa/202603/claude-plugin-wecom" && bun install --no-summary`

Expected: Dependencies installed, node_modules created

- [ ] **Step 4: Commit**

```bash
cd "D:/rpa/202603/claude-plugin-wecom"
git add package.json manifest.json
git commit -m "chore: initialize project with dependencies"
```

---

## Task 2: MCP Server Foundation

**Files:**
- Create: `server.ts`

- [ ] **Step 1: Create server.ts with imports and constants**

```typescript
#!/usr/bin/env bun
/**
 * claude-plugin-wecom - WeChat Work (企业微信) channel for Claude Code
 *
 * MCP server bridging Claude Code and WeCom intelligent robots via WebSocket.
 * Uses aibot-node-sdk for WeCom protocol handling.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  realpathSync,
} from 'fs'
import { homedir } from 'os'
import { join, sep } from 'path'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { WSClient, generateReqId, type WsFrame, type TextMessage, type ImageMessage, type MixedMessage, type VoiceMessage, type FileMessage, type VideoMessage } from 'aibot-node-sdk'

// State directory
const STATE_DIR = join(homedir(), '.claude', 'channels', 'wecom')
const CREDENTIALS_FILE = join(STATE_DIR, 'credentials.json')
const ACCESS_FILE = join(STATE_DIR, 'access.json')
const CONTEXT_TOKENS_FILE = join(STATE_DIR, 'context-tokens.json')
const INBOX_DIR = join(STATE_DIR, 'inbox')
const APPROVED_DIR = join(STATE_DIR, 'approved')
```

- [ ] **Step 2: Add type definitions and state helpers**

```typescript
// --- Types ---

type Credentials = {
  botId: string
  secret: string
}

type PendingEntry = {
  senderId: string
  createdAt: number
  expiresAt: number
  replies: number
}

type Access = {
  dmPolicy: 'pairing' | 'allowlist' | 'disabled'
  allowFrom: string[]
  pending: Record<string, PendingEntry>
  textChunkLimit?: number
  humanDelay?: boolean
}

function defaultAccess(): Access {
  return { dmPolicy: 'pairing', allowFrom: [], pending: {} }
}

// --- State persistence ---

function loadCredentials(): Credentials | null {
  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8'))
  } catch {
    return null
  }
}

function loadAccess(): Access {
  try {
    const raw = readFileSync(ACCESS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Access>
    return {
      dmPolicy: parsed.dmPolicy ?? 'pairing',
      allowFrom: parsed.allowFrom ?? [],
      pending: parsed.pending ?? {},
      textChunkLimit: parsed.textChunkLimit,
      humanDelay: parsed.humanDelay,
    }
  } catch {
    return defaultAccess()
  }
}

function saveAccess(a: Access): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  const tmp = ACCESS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 })
  rmSync(ACCESS_FILE, { force: true })
  require('fs').renameSync(tmp, ACCESS_FILE)
}
```

- [ ] **Step 3: Add context token management**

```typescript
// Map userid → context info (for replies)
const contextMap = new Map<string, { frame: WsFrame; ts: number }>()

function persistContextTokens(): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
    const obj = Object.fromEntries(
      Array.from(contextMap.entries()).map(([k, v]) => [k, { ts: v.ts }])
    )
    const tmp = CONTEXT_TOKENS_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 })
    rmSync(CONTEXT_TOKENS_FILE, { force: true })
    require('fs').renameSync(tmp, CONTEXT_TOKENS_FILE)
  } catch (err) {
    process.stderr.write(`wecom channel: context-tokens persist failed: ${err}\n`)
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
function debouncedPersist(): void {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistContextTokens()
  }, 5000)
}
```

- [ ] **Step 4: Add utility functions**

```typescript
// --- Utilities ---

const MAX_CHUNK_LIMIT = 2000

function markdownToPlaintext(md: string): string {
  return md
    .replace(/```[\s\S]*?\n([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/!\[([^\]]*)]\(([^)]+)\)/g, '(图片: $2)')
    .replace(/^>\s+/gm, '')
    .replace(/^---+$/gm, '————')
    .replace(/^\*\*\*+$/gm, '————')
    .replace(/^[\s]*[-*+]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function chunk(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > limit) {
    const para = rest.lastIndexOf('\n\n', limit)
    const line = rest.lastIndexOf('\n', limit)
    const space = rest.lastIndexOf(' ', limit)
    const cut = para > limit / 2 ? para : line > limit / 2 ? line : space > 0 ? space : limit
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest) out.push(rest)
  return out
}
```

- [ ] **Step 5: Add access control gate**

```typescript
// --- Access control ---

type GateResult =
  | { action: 'deliver'; access: Access }
  | { action: 'drop' }
  | { action: 'pair'; code: string; isResend: boolean }

function pruneExpired(a: Access): boolean {
  const now = Date.now()
  let changed = false
  for (const [code, p] of Object.entries(a.pending)) {
    if (p.expiresAt < now) {
      delete a.pending[code]
      changed = true
    }
  }
  return changed
}

function gate(senderId: string): GateResult {
  const access = loadAccess()
  const pruned = pruneExpired(access)
  if (pruned) saveAccess(access)

  if (!senderId) return { action: 'drop' }

  if (access.dmPolicy === 'disabled') return { action: 'drop' }
  if (access.allowFrom.includes(senderId)) return { action: 'deliver', access }

  if (access.dmPolicy === 'allowlist') return { action: 'drop' }

  // pairing mode
  for (const [code, p] of Object.entries(access.pending)) {
    if (p.senderId === senderId) {
      if ((p.replies ?? 1) >= 2) return { action: 'drop' }
      p.replies = (p.replies ?? 1) + 1
      saveAccess(access)
      return { action: 'pair', code, isResend: true }
    }
  }
  if (Object.keys(access.pending).length >= 3) return { action: 'drop' }

  const code = randomBytes(3).toString('hex')
  const now = Date.now()
  access.pending[code] = {
    senderId,
    createdAt: now,
    expiresAt: now + 60 * 60 * 1000,
    replies: 1,
  }
  saveAccess(access)
  return { action: 'pair', code, isResend: false }
}
```

- [ ] **Step 6: Add message extraction**

```typescript
// --- Message extraction ---

const pendingAttachments = new Map<string, { url: string; aeskey?: string; filename: string }>()

function extractMessageContent(frame: WsFrame): string {
  const body = frame.body as any
  const msgtype = body.msgtype
  const parts: string[] = []

  if (msgtype === 'text' && body.text?.content) {
    parts.push(body.text.content)
  } else if (msgtype === 'image') {
    const url = body.image?.url
    const aeskey = body.image?.aeskey
    if (url) {
      const id = `img_${Date.now()}_${randomBytes(3).toString('hex')}`
      pendingAttachments.set(id, { url, aeskey, filename: 'image.jpg' })
      parts.push(`(image: attachment_id=${id})`)
    } else {
      parts.push('(image)')
    }
  } else if (msgtype === 'voice') {
    if (body.voice?.content) {
      parts.push(`(voice transcription: ${body.voice.content})`)
    } else {
      parts.push('(voice)')
    }
  } else if (msgtype === 'file') {
    const url = body.file?.url
    const aeskey = body.file?.aeskey
    const filename = body.file?.name || 'file'
    if (url) {
      const id = `file_${Date.now()}_${randomBytes(3).toString('hex')}`
      pendingAttachments.set(id, { url, aeskey, filename })
      parts.push(`(file: ${filename}, attachment_id=${id})`)
    } else {
      parts.push(`(file: ${filename})`)
    }
  } else if (msgtype === 'video') {
    const url = body.video?.url
    const aeskey = body.video?.aeskey
    if (url) {
      const id = `video_${Date.now()}_${randomBytes(3).toString('hex')}`
      pendingAttachments.set(id, { url, aeskey, filename: 'video.mp4' })
      parts.push(`(video: attachment_id=${id})`)
    } else {
      parts.push('(video)')
    }
  } else if (msgtype === 'mixed' && body.mixed?.msg_item) {
    for (const item of body.mixed.msg_item) {
      if (item.msgtype === 'text' && item.text?.content) {
        parts.push(item.text.content)
      } else if (item.msgtype === 'image') {
        const url = item.image?.url
        const aeskey = item.image?.aeskey
        if (url) {
          const id = `img_${Date.now()}_${randomBytes(3).toString('hex')}`
          pendingAttachments.set(id, { url, aeskey, filename: 'image.jpg' })
          parts.push(`(image: attachment_id=${id})`)
        }
      }
    }
  }

  // Handle quoted/referenced message
  if (body.quote?.text?.content) {
    parts.push(`[引用: ${body.quote.text.content}]`)
  }

  return parts.join('\n') || '(empty message)'
}
```

- [ ] **Step 7: Add MCP server setup**

```typescript
// --- MCP Server ---

const creds = loadCredentials()

if (!creds?.botId || !creds?.secret) {
  process.stderr.write(
    `wecom channel: credentials required\n` +
    `  run /wecom:configure set <botId> <secret> in Claude Code\n`,
  )
  process.exit(1)
}

// Initialize WSClient
const wsClient = new WSClient({
  botId: creds.botId,
  secret: creds.secret,
})

const mcp = new Server(
  { name: 'wecom', version: '1.0.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
    },
    instructions: [
      'The sender reads WeChat Work (企业微信), not this session. Anything you want them to see must go through the reply tool.',
      '',
      'Messages from WeCom arrive as <channel source="wecom" user_id="..." ts="...">. Reply with the reply tool.',
      '',
      'Media messages (images, files, video) arrive with attachment_id in the text. Use download_attachment tool to download them.',
      '',
      'The reply tool supports an optional files parameter to send attachments.',
      '',
      'Access is managed by /wecom:access skill.',
    ].join('\n'),
  },
)
```

- [ ] **Step 8: Add tool handlers**

```typescript
// --- Tool definitions ---

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Reply on WeCom. Pass user_id from inbound message.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'The userid from the inbound message.' },
          text: { type: 'string', description: 'Message text (Markdown supported).' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of local file paths to send as attachments.',
          },
        },
        required: ['user_id', 'text'],
      },
    },
    {
      name: 'download_attachment',
      description: 'Download a WeCom media attachment to local inbox.',
      inputSchema: {
        type: 'object',
        properties: {
          attachment_id: {
            type: 'string',
            description: 'The attachment ID from the inbound message.',
          },
        },
        required: ['attachment_id'],
      },
    },
  ],
}))
```

- [ ] **Step 9: Add reply tool implementation**

```typescript
// --- Tool implementations ---

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>

  try {
    switch (req.params.name) {
      case 'reply': {
        const userId = args.user_id as string
        const text = args.text as string

        if (!userId) throw new Error('user_id is required')

        // Get stored frame for this user
        const ctx = contextMap.get(userId)
        if (!ctx) {
          throw new Error(`No context for user ${userId}. Wait for an inbound message first.`)
        }

        // Check access
        const access = loadAccess()
        if (!access.allowFrom.includes(userId)) {
          throw new Error(`user ${userId} is not allowlisted — add via /wecom:access`)
        }

        // Process and send text
        const limit = Math.max(1, Math.min(access.textChunkLimit ?? MAX_CHUNK_LIMIT, MAX_CHUNK_LIMIT))
        const plainText = markdownToPlaintext(text)
        const chunks = chunk(plainText, limit)
        const streamId = generateReqId('stream')

        let chunksSent = 0
        for (let i = 0; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1
          if (access.humanDelay && chunks.length > 1) {
            await Bun.sleep(Math.min(chunks[i].length * 50, 3000))
          }
          await wsClient.replyStream(ctx.frame, streamId, chunks[i], isLast)
          chunksSent++
        }

        // Handle files if provided
        let filesSent = 0
        const rawFiles = args.files
        const files: string[] | undefined = Array.isArray(rawFiles)
          ? rawFiles
          : typeof rawFiles === 'string'
            ? (() => { try { const p = JSON.parse(rawFiles); return Array.isArray(p) ? p : undefined } catch { return undefined } })()
            : undefined

        if (files?.length) {
          for (const filePath of files) {
            try {
              const fileData = readFileSync(filePath)
              const ext = filePath.toLowerCase().split('.').pop() ?? ''
              const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])
              const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm'])
              const mediaType: 'image' | 'video' | 'file' = IMAGE_EXTS.has(ext) ? 'image' : VIDEO_EXTS.has(ext) ? 'video' : 'file'

              const uploadResult = await wsClient.uploadMedia(fileData, {
                type: mediaType,
                filename: filePath.split(/[/\\]/).pop() ?? 'file',
              })

              await wsClient.replyMedia(ctx.frame, mediaType, uploadResult.media_id)
              filesSent++
            } catch (err) {
              process.stderr.write(`wecom channel: file send failed for ${filePath}: ${err}\n`)
            }
          }
        }

        return { content: [{ type: 'text', text: `sent ${chunksSent} chunk(s)${filesSent > 0 ? ` + ${filesSent} file(s)` : ''}` }] }
      }
```

- [ ] **Step 10: Add download_attachment implementation**

```typescript
      case 'download_attachment': {
        const attachmentId = args.attachment_id as string
        if (!attachmentId) throw new Error('attachment_id is required')

        const info = pendingAttachments.get(attachmentId)
        if (!info) throw new Error(`attachment ${attachmentId} not found or already downloaded`)

        mkdirSync(INBOX_DIR, { recursive: true, mode: 0o700 })

        const { buffer, filename } = await wsClient.downloadFile(info.url, info.aeskey)
        const safeName = (filename || info.filename).replace(/[^a-zA-Z0-9._-]/g, '_')
        const outPath = join(INBOX_DIR, `${Date.now()}-${safeName}`)
        writeFileSync(outPath, buffer, { mode: 0o600 })

        pendingAttachments.delete(attachmentId)

        return { content: [{ type: 'text', text: outPath }] }
      }

      default:
        return {
          content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
          isError: true,
        }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: `${req.params.name} failed: ${msg}` }],
      isError: true,
    }
  }
})
```

- [ ] **Step 11: Add permission relay handler**

```typescript
// --- Permission relay ---

const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  const access = loadAccess()
  for (const userId of access.allowFrom) {
    const ctx = contextMap.get(userId)
    if (!ctx) continue
    try {
      const streamId = generateReqId('stream')
      const msg = `🔐 Claude 请求权限：${params.tool_name}\n${params.description}\n\n回复 "yes ${params.request_id}" 批准\n回复 "no ${params.request_id}" 拒绝`
      await wsClient.replyStream(ctx.frame, streamId, msg, true)
    } catch (err) {
      process.stderr.write(`wecom channel: permission relay failed for ${userId}: ${err}\n`)
    }
  }
})

const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i
```

- [ ] **Step 12: Add WebSocket event handlers**

```typescript
// --- WebSocket event handlers ---

wsClient.on('authenticated', () => {
  process.stderr.write('wecom channel: WebSocket authenticated\n')
})

wsClient.on('disconnected', (reason) => {
  process.stderr.write(`wecom channel: disconnected (${reason})\n`)
})

wsClient.on('error', (error) => {
  process.stderr.write(`wecom channel: error - ${error.message}\n`)
})

// Handle all messages
wsClient.on('message', (frame: WsFrame) => {
  const body = frame.body as any
  const userId = body.from?.userid
  if (!userId) return

  // Store frame for reply context
  contextMap.set(userId, { frame, ts: Date.now() })
  debouncedPersist()

  const result = gate(userId)

  if (result.action === 'drop') return

  if (result.action === 'pair') {
    const streamId = generateReqId('stream')
    const lead = result.isResend ? '仍在等待配对' : '需要配对验证'
    wsClient.replyStream(frame, streamId, `${lead} — 在 Claude Code 终端运行：\n\n/wecom:access pair ${result.code}`, true).catch(() => {})
    return
  }

  // Check for permission reply
  if (body.msgtype === 'text' && body.text?.content) {
    const match = PERMISSION_REPLY_RE.exec(body.text.content.trim())
    if (match) {
      void mcp.notification({
        method: 'notifications/claude/channel/permission',
        params: {
          request_id: match[2].toLowerCase(),
          behavior: match[1].toLowerCase().startsWith('y') ? 'allow' : 'deny',
        },
      })
      const streamId = generateReqId('stream')
      wsClient.replyStream(frame, streamId, `已${match[1].toLowerCase().startsWith('y') ? '批准' : '拒绝'}权限请求`, true).catch(() => {})
      return
    }
  }

  // Extract and forward message
  const content = extractMessageContent(frame)
  const ts = body.create_time ? new Date(body.create_time * 1000).toISOString() : new Date().toISOString()

  void mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content,
      meta: {
        user_id: userId,
        ts,
      },
    },
  })
})
```

- [ ] **Step 13: Add startup and shutdown**

```typescript
// --- Connect and start ---

await mcp.connect(new StdioServerTransport())

process.stderr.write('wecom channel: connecting to WeCom...\n')
wsClient.connect()

// --- Graceful shutdown ---

let shuttingDown = false

function shutdown(reason: string): void {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write(`wecom channel: shutting down (${reason})\n`)

  const forceTimer = setTimeout(() => {
    process.stderr.write('wecom channel: force exit after timeout\n')
    process.exit(0)
  }, 2000)
  forceTimer.unref()

  wsClient.disconnect()
  mcp.close().catch(() => {}).finally(() => {
    clearTimeout(forceTimer)
    process.exit(0)
  })
}

process.stdin.on('end', () => shutdown('stdin EOF'))
process.stdin.on('error', () => shutdown('stdin error'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('unhandledRejection', (err) => {
  process.stderr.write(`wecom channel: unhandled rejection: ${err}\n`)
})
process.on('uncaughtException', (err) => {
  process.stderr.write(`wecom channel: uncaught exception: ${err}\n`)
  shutdown('uncaughtException')
})
```

- [ ] **Step 14: Verify build**

Run: `cd "D:/rpa/202603/claude-plugin-wecom" && bun build --target=bun server.ts --outdir /tmp/wecom-build-check 2>&1`

Expected: Build succeeds with no errors

- [ ] **Step 15: Commit**

```bash
cd "D:/rpa/202603/claude-plugin-wecom"
git add server.ts
git commit -m "feat: implement MCP server with WeCom SDK integration

- WebSocket connection via aibot-node-sdk
- Text and media messaging support
- Permission relay for remote approval
- Access control with pairing flow"
```

---

## Task 3: Skills

**Files:**
- Create: `skills/wecom/configure.md`
- Create: `skills/wecom/access.md`

- [ ] **Step 1: Create skills directory**

Run: `mkdir -p "D:/rpa/202603/claude-plugin-wecom/skills/wecom"`

- [ ] **Step 2: Create configure.md skill**

```markdown
---
name: configure
description: Configure WeCom bot credentials
invocable: true
---

# /wecom:configure

Configure WeChat Work (企业微信) bot credentials.

## Usage

```
/wecom:configure status              # Show current configuration
/wecom:configure set <botId> <secret>  # Save bot credentials
/wecom:configure clear               # Remove saved credentials
```

## Steps

### status

1. Read `~/.claude/channels/wecom/credentials.json`
2. If exists, show: "Configured with botId: {botId}"
3. If not, show: "Not configured. Run /wecom:configure set <botId> <secret>"

### set

1. Validate botId and secret are provided
2. Create `~/.claude/channels/wecom/` directory if needed
3. Write credentials to `credentials.json`:
   ```json
   { "botId": "<botId>", "secret": "<secret>" }
   ```
4. Confirm: "Credentials saved. Restart Claude Code with: claude --dangerously-load-development-channels plugin:wecom"

### clear

1. Delete `~/.claude/channels/wecom/credentials.json`
2. Confirm: "Credentials removed"
```

- [ ] **Step 3: Create access.md skill**

```markdown
---
name: access
description: Manage WeCom user access control
invocable: true
---

# /wecom:access

Manage user access control for the WeCom channel.

## Usage

```
/wecom:access status                          # Show access policy and allowlist
/wecom:access pair <code>                     # Approve pending pairing request
/wecom:access remove <userid>                 # Remove user from allowlist
/wecom:access policy <pairing|allowlist|disabled>  # Change access policy
/wecom:access humanDelay <on|off>             # Toggle typing simulation
/wecom:access textChunkLimit <number>         # Set max chars per message
```

## Steps

### status

1. Read `~/.claude/channels/wecom/access.json`
2. Display:
   - Policy: {dmPolicy}
   - Allowed users: {allowFrom list}
   - Pending requests: {pending codes with senderId}

### pair <code>

1. Read `access.json`
2. Find pending entry with matching code
3. Move senderId to allowFrom array
4. Delete pending entry
5. Write updated `access.json`
6. Confirm: "User {senderId} added to allowlist"

### remove <userid>

1. Read `access.json`
2. Remove userid from allowFrom array
3. Write updated `access.json`
4. Confirm: "User {userid} removed from allowlist"

### policy <policy>

1. Read `access.json`
2. Update dmPolicy to: pairing | allowlist | disabled
3. Write updated `access.json`
4. Confirm: "Policy changed to {policy}"

### humanDelay <on|off>

1. Read `access.json`
2. Set humanDelay to true/false
3. Write updated `access.json`
4. Confirm: "Typing simulation {enabled/disabled}"

### textChunkLimit <number>

1. Read `access.json`
2. Set textChunkLimit to number (max 2000)
3. Write updated `access.json`
4. Confirm: "Chunk limit set to {number}"
```

- [ ] **Step 4: Commit skills**

```bash
cd "D:/rpa/202603/claude-plugin-wecom"
git add skills/
git commit -m "feat: add /wecom:configure and /wecom:access skills"
```

---

## Task 4: Documentation

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

```markdown
# claude-plugin-wecom

## If you are a human / 如果你是人类

WeChat Work (企业微信) channel plugin for [Claude Code](https://claude.ai/claude-code).
Chat with Claude Code from WeChat Work — text, images, files, voice, video, with remote permission relay.

企业微信频道插件，让你可以通过企业微信直接与 Claude Code 对话，支持文字、图片、文件、语音、视频，以及远程权限审批。

**Install / 安装：**

```bash
claude plugin marketplace add <your-repo>/claude-plugin-wecom
claude plugin install wecom
```

**Start / 启动：**

```bash
claude --dangerously-skip-permissions --dangerously-load-development-channels plugin:wecom
```

**Setup / 配置：**

1. Get your WeCom bot credentials (botId and secret) from WeChat Work admin console
2. Run `/wecom:configure set <botId> <secret>` in Claude Code
3. Restart Claude Code with the channel enabled

**Pair / 配对：**

1. Send any message to the bot on WeCom
2. Bot replies with a pairing code
3. Run `/wecom:access pair <code>` in Claude Code

Prerequisites / 前置条件: [Claude Code](https://claude.ai/claude-code) v2.1.80+, [Bun](https://bun.sh) runtime. License: MIT.

---

## If you are Claude Code (AI agent), read below

### Step 0 — Pre-flight

```bash
claude --version   # >= 2.1.80 required
bun --version      # required
```

### Step 1 — Install dependencies

```bash
cd "$PLUGIN_ROOT" && bun install --no-summary
```

### Step 2 — Configure credentials

Run `/wecom:configure set <botId> <secret>` with credentials from WeCom admin console.

### Step 3 — Restart with channel

```bash
claude --dangerously-skip-permissions --dangerously-load-development-channels plugin:wecom
```

### Step 4 — Pair user

1. Send message from WeCom
2. Receive pairing code
3. Run `/wecom:access pair <code>`

---

## MCP tools

| Tool | Purpose | Required params |
|------|---------|-----------------|
| `reply` | Send text and/or files to WeCom | `user_id`, `text`; optional `files` |
| `download_attachment` | Download media from WeCom | `attachment_id` |

## Skills

| Skill | Trigger |
|-------|---------|
| `/wecom:configure` | Configure bot credentials |
| `/wecom:access` | Manage user access control |

---

License: MIT
```

- [ ] **Step 2: Commit README**

```bash
cd "D:/rpa/202603/claude-plugin-wecom"
git add README.md
git commit -m "docs: add README with installation and usage instructions"
```

---

## Task 5: Final Verification

- [ ] **Step 1: Verify project structure**

Run: `cd "D:/rpa/202603/claude-plugin-wecom" && ls -la && ls -la skills/wecom/`

Expected:
```
package.json
manifest.json
server.ts
README.md
skills/wecom/configure.md
skills/wecom/access.md
```

- [ ] **Step 2: Verify build**

Run: `cd "D:/rpa/202603/claude-plugin-wecom" && bun build --target=bun server.ts --outdir /tmp/wecom-final-check 2>&1 && rm -rf /tmp/wecom-final-check`

Expected: Build succeeds

- [ ] **Step 3: Final commit**

```bash
cd "D:/rpa/202603/claude-plugin-wecom"
git status
# If clean, no action needed
# If uncommitted changes, commit them
```

---

## Summary

This plan creates a complete WeCom channel plugin with:

1. **Project setup** - package.json, manifest.json with dependencies
2. **MCP server** - Single-file server.ts with:
   - WebSocket connection via aibot-node-sdk
   - Text/media messaging (reply tool)
   - Media download (download_attachment tool)
   - Permission relay for remote approval
   - Access control with pairing flow
3. **Skills** - /wecom:configure and /wecom:access for configuration
4. **Documentation** - README with setup instructions

Total estimated implementation time: ~30 minutes
