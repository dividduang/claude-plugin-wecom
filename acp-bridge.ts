#!/usr/bin/env bun
/**
 * Input: WeCom messages via WebSocket + ACP agent responses
 * Output: WeCom replies via WebSocket
 * Pos: ACP bridge — connects WeCom to any ACP-compatible AI agent (Claude Code, Copilot, Gemini, Codex, etc.)
 *
 * Uses Agent Client Protocol (ACP) for persistent agent sessions.
 * Each WeCom user gets a dedicated agent subprocess with session continuity.
 * State lives in ~/.claude/channels/wecom/
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync,
  statSync, renameSync, realpathSync,
} from 'fs'
import fs from 'node:fs'
import { homedir } from 'os'
import { join, sep } from 'path'
import { spawn, type ChildProcess } from 'node:child_process'
import { Writable, Readable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { WSClient, generateReqId, type WsFrame, type TextMessage, type ImageMessage, type MixedMessage, type VoiceMessage, type FileMessage, type VideoMessage } from '@wecom/aibot-node-sdk'

// --- State directories ---

const STATE_DIR = join(homedir(), '.claude', 'channels', 'wecom')
const ACCESS_FILE = join(STATE_DIR, 'access.json')
const APPROVED_DIR = join(STATE_DIR, 'approved')
const CREDENTIALS_FILE = join(STATE_DIR, 'credentials.json')
const CONTEXT_TOKENS_FILE = join(STATE_DIR, 'context-tokens.json')
const INBOX_DIR = join(STATE_DIR, 'inbox')
const USER_CWD_FILE = join(STATE_DIR, 'user-cwd.json')
const DEBUG_MODE_FILE = join(STATE_DIR, 'debug-mode.json')

// --- ACP Agent configuration ---

// Built-in agent presets (matching wechat-acp convention)
// Claude Code CLI does NOT natively speak ACP — it needs the @zed-industries/claude-code-acp wrapper.
const AGENT_PRESETS: Record<string, { command: string; args: string[] }> = {
  claude:   { command: 'npx', args: ['@zed-industries/claude-code-acp'] },
  copilot:  { command: 'npx', args: ['@github/copilot', '--acp', '--yolo'] },
  gemini:   { command: 'npx', args: ['@google/gemini-cli', '--experimental-acp'] },
  qwen:     { command: 'npx', args: ['@qwen-code/qwen-code', '--acp', '--experimental-skills'] },
  codex:    { command: 'npx', args: ['@zed-industries/codex-acp'] },
  opencode: { command: 'npx', args: ['opencode-ai', 'acp'] },
}

const agentName = process.env.ACP_AGENT ?? 'claude'
const preset = AGENT_PRESETS[agentName]
const AGENT_COMMAND = process.env.ACP_AGENT_COMMAND ?? preset?.command ?? agentName
const AGENT_ARGS = process.env.ACP_AGENT_ARGS
  ? process.env.ACP_AGENT_ARGS.split(' ').filter(Boolean)
  : preset?.args ?? []

// Parse CLI arguments
const cliArgs = process.argv.slice(2)
let defaultCwd = process.env.ACP_AGENT_CWD ?? process.cwd()
for (let i = 0; i < cliArgs.length; i++) {
  if (cliArgs[i] === '--cwd' && cliArgs[i + 1]) {
    defaultCwd = cliArgs[i + 1]
    i++
  } else if (cliArgs[i]?.startsWith('--cwd=')) {
    defaultCwd = cliArgs[i].split('=')[1]
  }
}

const AGENT_CWD = defaultCwd
const AGENT_ENV: Record<string, string> = (() => {
  const raw = process.env.ACP_AGENT_ENV ?? ''
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
})()
const MAX_CONCURRENT_USERS = parseInt(process.env.ACP_MAX_USERS ?? '10', 10)
const IDLE_TIMEOUT_MS = parseInt(process.env.ACP_IDLE_TIMEOUT ?? '86400000', 10) // 24h default

// --- Debug mode ---

function isDebugMode(): boolean {
  try { return JSON.parse(readFileSync(DEBUG_MODE_FILE, 'utf8')).enabled === true } catch { return false }
}

function setDebugMode(enabled: boolean): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  const tmp = DEBUG_MODE_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify({ enabled }, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, DEBUG_MODE_FILE)
}

// --- Load credentials ---

type Credentials = {
  botId: string
  secret: string
}

function loadCredentials(): Credentials | null {
  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8'))
  } catch {
    return null
  }
}

const creds = loadCredentials()

if (!creds?.botId || !creds?.secret) {
  process.stderr.write(
    `wecom acp-bridge: credentials required\n` +
    `  run /wecom:configure set <botId> <secret> in Claude Code\n`,
  )
  process.exit(1)
}

// --- Types ---

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
  ackText?: string
  textChunkLimit?: number
  humanDelay?: boolean
}

function defaultAccess(): Access {
  return { dmPolicy: 'pairing', allowFrom: [], pending: {} }
}

const MAX_CHUNK_LIMIT = 2000

// Runtime set of allowed from_user_ids for outbound validation.
const knownUsers = new Set<string>()

// Map userid -> context info (for replies)
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
    renameSync(tmp, CONTEXT_TOKENS_FILE)
  } catch (err) {
    process.stderr.write(`wecom acp-bridge: context-tokens persist failed: ${err}\n`)
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

// Per-user working directory overrides
const userCwdMap = new Map<string, string>(
  (() => {
    try {
      const data = JSON.parse(readFileSync(USER_CWD_FILE, 'utf8'))
      return Object.entries(data) as [string, string][]
    } catch {
      return []
    }
  })()
)

function persistUserCwd(): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
    const obj = Object.fromEntries(userCwdMap)
    const tmp = USER_CWD_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, USER_CWD_FILE)
  } catch (err) {
    process.stderr.write(`wecom acp-bridge: user-cwd persist failed: ${err}\n`)
  }
}

function getUserCwd(userId: string): string {
  return userCwdMap.get(userId) ?? AGENT_CWD
}

// Map attachment_id → download info for deferred media downloads
const pendingAttachments = new Map<string, { url: string; aeskey?: string; filename: string }>()

// --- Access persistence ---

function readAccessFile(): Access {
  try {
    const raw = readFileSync(ACCESS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Access>
    return {
      dmPolicy: parsed.dmPolicy ?? 'pairing',
      allowFrom: parsed.allowFrom ?? [],
      pending: parsed.pending ?? {},
      ackText: parsed.ackText,
      textChunkLimit: parsed.textChunkLimit,
      humanDelay: parsed.humanDelay,
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultAccess()
    try {
      renameSync(ACCESS_FILE, `${ACCESS_FILE}.corrupt-${Date.now()}`)
    } catch {}
    process.stderr.write(`wecom acp-bridge: access.json is corrupt, moved aside. Starting fresh.\n`)
    return defaultAccess()
  }
}

function loadAccess(): Access {
  return readAccessFile()
}

function saveAccess(a: Access): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  const tmp = ACCESS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, ACCESS_FILE)
}

function pruneExpired(a: Access): boolean {
  const now = Date.now()
  let changed = false
  for (const code of Object.keys(a.pending)) {
    const p = a.pending[code]
    if (p.expiresAt < now) {
      delete a.pending[code]
      changed = true
    }
  }
  return changed
}

// --- Gate ---

type GateResult =
  | { action: 'deliver'; access: Access }
  | { action: 'drop' }
  | { action: 'pair'; code: string; isResend: boolean }

function gate(senderId: string): GateResult {
  const access = loadAccess()
  const pruned = pruneExpired(access)
  if (pruned) saveAccess(access)

  if (!senderId) return { action: 'drop' }

  if (access.dmPolicy === 'disabled') return { action: 'drop' }
  if (access.allowFrom.includes(senderId)) return { action: 'deliver', access }
  if (access.dmPolicy === 'allowlist') return { action: 'drop' }

  // pairing mode
  for (const code of Object.keys(access.pending)) {
    const p = access.pending[code]
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

// --- Pairing approval polling ---

function checkApprovals(): void {
  let files: string[]
  try {
    files = readdirSync(APPROVED_DIR)
  } catch { return }
  if (files.length === 0) return

  for (const senderId of files) {
    const file = join(APPROVED_DIR, senderId)
    rmSync(file, { force: true })
  }
}

setInterval(checkApprovals, 5000)

// --- Markdown to plaintext ---

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

// --- Chunking ---

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

// --- Extract message content from WeCom frame ---

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

// --- Inline media download ---

async function downloadAttachment(attachmentId: string): Promise<string | null> {
  const info = pendingAttachments.get(attachmentId)
  if (!info) return null

  mkdirSync(INBOX_DIR, { recursive: true, mode: 0o700 })

  // Use WSClient's downloadFile method
  const wsClient = new WSClient({
    botId: creds!.botId,
    secret: creds!.secret,
  })

  const { buffer, filename } = await wsClient.downloadFile(info.url, info.aeskey)
  const safeName = (filename || info.filename).replace(/[^a-zA-Z0-9._-]/g, '_')
  const outPath = join(INBOX_DIR, `${Date.now()}-${safeName}`)
  writeFileSync(outPath, buffer, { mode: 0o600 })

  pendingAttachments.delete(attachmentId)
  return outPath
}

// --- ACP Client implementation ---

class WeComAcpClient implements acp.Client {
  private chunks: string[] = []
  private lastTypingAt = 0
  private static readonly TYPING_INTERVAL_MS = 5_000
  private sendTypingFn: () => Promise<void>
  private logFn: (msg: string) => void

  constructor(opts: { sendTyping: () => Promise<void>; log: (msg: string) => void }) {
    this.sendTypingFn = opts.sendTyping
    this.logFn = opts.log
  }

  updateSendTyping(sendTypingFn: () => Promise<void>): void {
    this.sendTypingFn = sendTypingFn
  }

  async requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const allowOpt = params.options.find(
      (o) => o.kind === 'allow_once' || o.kind === 'allow_always',
    )
    const optionId = allowOpt?.optionId ?? params.options[0]?.optionId ?? 'allow'

    this.logFn(`[permission] auto-allowed: ${params.toolCall?.title ?? 'unknown'} → ${optionId}`)

    return {
      outcome: {
        outcome: 'selected',
        optionId,
      },
    }
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    const update = params.update

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text') {
          this.chunks.push(update.content.text)
        }
        await this.maybeSendTyping()
        break

      case 'tool_call':
        this.logFn(`[tool] ${update.title} (${update.status})`)
        await this.maybeSendTyping()
        break

      case 'tool_call_update':
        if (update.status === 'completed' && update.content) {
          for (const c of update.content) {
            if (c.type === 'diff') {
              const diff = c as acp.Diff
              const header = `--- ${diff.path}`
              const lines: string[] = [header]
              if (diff.oldText != null) {
                for (const l of diff.oldText.split('\n')) lines.push(`- ${l}`)
              }
              if (diff.newText != null) {
                for (const l of diff.newText.split('\n')) lines.push(`+ ${l}`)
              }
              this.chunks.push('\n```diff\n' + lines.join('\n') + '\n```\n')
            }
          }
        }
        if (update.status) {
          this.logFn(`[tool] ${update.toolCallId} → ${update.status}`)
        }
        break

      case 'plan':
        if (update.entries) {
          const items = update.entries
            .map((e: acp.PlanEntry, i: number) => `  ${i + 1}. [${e.status}] ${e.content}`)
            .join('\n')
          this.logFn(`[plan]\n${items}`)
        }
        break
    }
  }

  async readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    try {
      const content = await fs.promises.readFile(params.path, 'utf-8')
      return { content }
    } catch (err) {
      throw new Error(`Failed to read file ${params.path}: ${String(err)}`)
    }
  }

  async writeTextFile(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> {
    try {
      await fs.promises.writeFile(params.path, params.content, 'utf-8')
      return {}
    } catch (err) {
      throw new Error(`Failed to write file ${params.path}: ${String(err)}`)
    }
  }

  flush(): string {
    const text = this.chunks.join('')
    this.chunks = []
    this.lastTypingAt = 0
    return text
  }

  private async maybeSendTyping(): Promise<void> {
    const now = Date.now()
    if (now - this.lastTypingAt < WeComAcpClient.TYPING_INTERVAL_MS) return
    this.lastTypingAt = now
    try {
      await this.sendTypingFn()
    } catch {
      // typing is best-effort
    }
  }
}

// --- ACP session management ---

type UserSession = {
  userId: string
  frame: WsFrame
  client: WeComAcpClient
  process: ChildProcess
  connection: acp.ClientSideConnection
  sessionId: string
  queue: Array<{ prompt: acp.ContentBlock[]; frame: WsFrame }>
  processing: boolean
  lastActivity: number
}

const userSessions = new Map<string, UserSession>()

// Idle session cleanup every 2 minutes
const cleanupTimer = setInterval(() => {
  if (IDLE_TIMEOUT_MS <= 0) return
  const now = Date.now()
  for (const [userId, session] of userSessions) {
    if (now - session.lastActivity > IDLE_TIMEOUT_MS && !session.processing) {
      process.stderr.write(`wecom acp-bridge: session for ${userId} idle for ${Math.round((now - session.lastActivity) / 60_000)}min, removing\n`)
      if (!session.process.killed) session.process.kill('SIGTERM')
      userSessions.delete(userId)
    }
  }
}, 2 * 60_000)
cleanupTimer.unref()

function evictOldestSession(): void {
  let oldest: { userId: string; lastActivity: number } | null = null
  for (const [uid, s] of userSessions) {
    if (!s.processing && (!oldest || s.lastActivity < oldest.lastActivity)) {
      oldest = { userId: uid, lastActivity: s.lastActivity }
    }
  }
  if (oldest) {
    process.stderr.write(`wecom acp-bridge: evicting oldest idle session: ${oldest.userId}\n`)
    const s = userSessions.get(oldest.userId)
    if (s && !s.process.killed) s.process.kill('SIGTERM')
    userSessions.delete(oldest.userId)
  }
}

// Global WSClient for sending messages
const wsClient = new WSClient({
  botId: creds.botId,
  secret: creds.secret,
})

async function createSession(userId: string, frame: WsFrame): Promise<UserSession> {
  process.stderr.write(`wecom acp-bridge: creating session for ${userId}\n`)

  const client = new WeComAcpClient({
    sendTyping: () => {
      // WeCom doesn't have a typing indicator API like WeChat
      return Promise.resolve()
    },
    log: (msg) => process.stderr.write(`wecom acp-bridge [${userId}]: ${msg}\n`),
  })

  // Spawn agent subprocess
  const useShell = process.platform === 'win32'
  const proc = spawn(AGENT_COMMAND, AGENT_ARGS, {
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: getUserCwd(userId),
    env: { ...process.env, ...AGENT_ENV },
    shell: useShell,
  })

  proc.on('error', (err) => {
    process.stderr.write(`wecom acp-bridge [${userId}]: agent process error: ${String(err)}\n`)
  })

  if (!proc.stdin || !proc.stdout) {
    proc.kill()
    throw new Error('Failed to get agent process stdio')
  }

  // Set up ACP connection
  const input = Writable.toWeb(proc.stdin)
  const output = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>
  const stream = acp.ndJsonStream(input, output)
  const connection = new acp.ClientSideConnection(() => client, stream)

  // Initialize ACP
  process.stderr.write(`wecom acp-bridge [${userId}]: initializing ACP connection...\n`)
  const initResult = await connection.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientInfo: {
      name: 'wecom-acp-bridge',
      title: 'WeCom ACP Bridge',
      version: '1.0.0',
    },
    clientCapabilities: {
      fs: {
        readTextFile: true,
        writeTextFile: true,
      },
    },
  })
  process.stderr.write(`wecom acp-bridge [${userId}]: ACP initialized (protocol v${initResult.protocolVersion})\n`)

  // Create session
  const sessionResult = await connection.newSession({
    cwd: getUserCwd(userId),
    mcpServers: [],
  })
  process.stderr.write(`wecom acp-bridge [${userId}]: session created (sessionId=${sessionResult.sessionId})\n`)

  const session: UserSession = {
    userId,
    frame,
    client,
    process: proc,
    connection,
    sessionId: sessionResult.sessionId,
    queue: [],
    processing: false,
    lastActivity: Date.now(),
  }

  // Clean up on process exit
  proc.on('exit', (code, signal) => {
    process.stderr.write(`wecom acp-bridge [${userId}]: agent exited code=${code} signal=${signal}\n`)
    const s = userSessions.get(userId)
    if (s?.process === proc) userSessions.delete(userId)
  })

  userSessions.set(userId, session)
  return session
}

async function processQueue(session: UserSession): Promise<void> {
  try {
    while (session.queue.length > 0 && !shuttingDown) {
      const pending = session.queue.shift()!

      // Update frame for the new message
      session.frame = pending.frame

      // Reset chunks for the new turn
      session.client.flush()

      try {
        // Send ACP prompt
        process.stderr.write(`wecom acp-bridge [${session.userId}]: sending prompt to agent...\n`)
        const result = await session.connection.prompt({
          sessionId: session.sessionId,
          prompt: pending.prompt,
        })

        // Collect accumulated text
        let replyText = session.client.flush()

        if (result.stopReason === 'cancelled') {
          replyText += '\n[cancelled]'
        } else if (result.stopReason === 'refusal') {
          replyText += '\n[agent refused to continue]'
        }

        process.stderr.write(`wecom acp-bridge [${session.userId}]: agent done (${result.stopReason}), reply ${replyText.length} chars\n`)

        // Send reply back to WeCom
        if (replyText.trim()) {
          const plainText = markdownToPlaintext(replyText)
          const access = loadAccess()
          const limit = Math.max(1, Math.min(access.textChunkLimit ?? MAX_CHUNK_LIMIT, MAX_CHUNK_LIMIT))
          const chunks = chunk(plainText, limit)
          const streamId = generateReqId('stream')

          for (let i = 0; i < chunks.length; i++) {
            const isLast = i === chunks.length - 1
            if (access.humanDelay && chunks.length > 1) {
              await Bun.sleep(Math.min(chunks[i].length * 50, 3000))
            }
            await wsClient.replyStream(pending.frame, streamId, chunks[i], isLast)
          }
        }
      } catch (err) {
        process.stderr.write(`wecom acp-bridge [${session.userId}]: agent prompt error: ${String(err)}\n`)

        // Check if agent died
        if (session.process.killed || session.process.exitCode !== null) {
          process.stderr.write(`wecom acp-bridge [${session.userId}]: agent process died, removing session\n`)
          userSessions.delete(session.userId)
          return
        }

        // Send error message to user
        try {
          const streamId = generateReqId('stream')
          await wsClient.replyStream(
            pending.frame,
            streamId,
            `⚠️ Agent error: ${String(err)}`,
            true,
          )
        } catch {
          // best effort
        }
      }
    }
  } finally {
    session.processing = false
  }
}

async function enqueueMessage(userId: string, promptBlocks: acp.ContentBlock[], frame: WsFrame): Promise<void> {
  let session = userSessions.get(userId)

  if (!session || session.process.killed || session.process.exitCode !== null) {
    // Need a new session
    if (userSessions.has(userId)) userSessions.delete(userId)
    if (userSessions.size >= MAX_CONCURRENT_USERS) {
      evictOldestSession()
    }
    session = await createSession(userId, frame)
  }

  // Always update frame to the latest
  session.frame = frame
  session.lastActivity = Date.now()
  session.queue.push({ prompt: promptBlocks, frame })

  if (!session.processing) {
    session.processing = true
    processQueue(session).catch((err) => {
      process.stderr.write(`wecom acp-bridge [${userId}]: queue processing error: ${String(err)}\n`)
    })
  }
}

// --- Inbound message handler ---

async function handleInbound(frame: WsFrame): Promise<void> {
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
    await wsClient.replyStream(frame, streamId, `${lead} — 在 Claude Code 终端运行：\n\n/wecom:access pair ${result.code}`, true).catch(() => {})
    return
  }

  // Message approved
  knownUsers.add(userId)

  // Handle commands
  const cmdText = body.msgtype === 'text' && body.text?.content ? body.text.content.trim() : ''

  if (cmdText === '/toggle-debug') {
    setDebugMode(!isDebugMode())
    const streamId = generateReqId('stream')
    await wsClient.replyStream(frame, streamId, `Debug 模式已${isDebugMode() ? '开启' : '关闭'}`, true).catch(() => {})
    return
  }

  if (cmdText.startsWith('/echo ')) {
    const streamId = generateReqId('stream')
    await wsClient.replyStream(frame, streamId, `${cmdText.slice(6)}\n\n⏱ 延迟: ${Date.now() - (body.create_time ? body.create_time * 1000 : Date.now())}ms`, true).catch(() => {})
    return
  }

  if (cmdText.startsWith('/cwd')) {
    const newCwd = cmdText.slice(4).trim()
    if (!newCwd) {
      // Show current cwd
      const currentCwd = getUserCwd(userId)
      const streamId = generateReqId('stream')
      await wsClient.replyStream(frame, streamId, `当前工作目录: ${currentCwd}`, true).catch(() => {})
      return
    }
    // Validate path exists
    try {
      const stat = statSync(newCwd)
      if (!stat.isDirectory()) {
        const streamId = generateReqId('stream')
        await wsClient.replyStream(frame, streamId, `❌ 路径不是目录: ${newCwd}`, true).catch(() => {})
        return
      }
    } catch {
      const streamId = generateReqId('stream')
      await wsClient.replyStream(frame, streamId, `❌ 目录不存在: ${newCwd}`, true).catch(() => {})
      return
    }
    // Save per-user cwd
    userCwdMap.set(userId, newCwd)
    persistUserCwd()
    // Destroy current session, next message will create new one with new cwd
    const existingSession = userSessions.get(userId)
    if (existingSession) {
      if (!existingSession.process.killed) existingSession.process.kill('SIGTERM')
      userSessions.delete(userId)
    }
    const streamId = generateReqId('stream')
    await wsClient.replyStream(frame, streamId, `✅ 工作目录已切换: ${newCwd}\nAgent 会话已重置，下条消息将在新目录启动`, true).catch(() => {})
    return
  }

  // Extract text and download any media attachments inline
  const text = extractMessageContent(frame)

  // Download any pending attachments and include file paths in prompt
  let promptText = text
  const attachmentIds = [...text.matchAll(/attachment_id=([a-z_0-9]+)/g)].map(m => m[1])
  if (attachmentIds.length > 0) {
    const downloadedPaths: string[] = []
    for (const aid of attachmentIds) {
      try {
        const localPath = await downloadAttachment(aid)
        if (localPath) downloadedPaths.push(localPath)
      } catch (err) {
        process.stderr.write(`wecom acp-bridge: attachment download failed (${aid}): ${err}\n`)
      }
    }
    if (downloadedPaths.length > 0) {
      promptText += '\n\n[已下载的附件文件路径:\n' + downloadedPaths.join('\n') + '\n]'
    }
  }

  // Send to ACP agent via session queue
  const promptBlocks: acp.ContentBlock[] = [{ type: 'text', text: promptText }]
  await enqueueMessage(userId, promptBlocks, frame)
}

// --- Start ---

let shuttingDown = false

process.stderr.write(`wecom acp-bridge: started (ACP mode, agent=${AGENT_COMMAND} ${AGENT_ARGS.join(' ')}, default cwd=${AGENT_CWD})\n`)
process.stderr.write('wecom acp-bridge: connecting to WeCom...\n')

wsClient.connect()

// --- WebSocket event handlers ---

wsClient.on('authenticated', () => {
  process.stderr.write('wecom acp-bridge: WebSocket authenticated\n')
})

wsClient.on('disconnected', (reason) => {
  process.stderr.write(`wecom acp-bridge: disconnected (${reason})\n`)
})

wsClient.on('error', (error) => {
  process.stderr.write(`wecom acp-bridge: error - ${error.message}\n`)
})

// Handle all messages
wsClient.on('message', (frame: WsFrame) => {
  handleInbound(frame).catch((err) => {
    process.stderr.write(`wecom acp-bridge: message handler error: ${err}\n`)
  })
})

// --- Graceful shutdown ---

function shutdown(reason: string): void {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write(`wecom acp-bridge: shutting down (${reason})\n`)

  // Persist any pending context tokens
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
    persistContextTokens()
  }

  // Kill all agent sessions
  for (const [uid, s] of userSessions) {
    process.stderr.write(`wecom acp-bridge: stopping session for ${uid}\n`)
    if (!s.process.killed) {
      s.process.kill('SIGTERM')
      // Force kill after 5s if still alive
      setTimeout(() => {
        if (!s.process.killed) s.process.kill('SIGKILL')
      }, 5_000).unref()
    }
  }
  userSessions.clear()

  // Clear idle cleanup timer
  clearInterval(cleanupTimer)

  // Disconnect WebSocket
  wsClient.disconnect()

  const forceTimer = setTimeout(() => {
    process.stderr.write('wecom acp-bridge: force exit after timeout\n')
    process.exit(0)
  }, 2000)
  forceTimer.unref()

  // Exit after a short delay for pending I/O
  setTimeout(() => {
    clearTimeout(forceTimer)
    process.exit(0)
  }, 500)
}

process.stdin.on('end', () => shutdown('stdin EOF'))
process.stdin.on('error', () => shutdown('stdin error'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('unhandledRejection', (err) => {
  process.stderr.write(`wecom acp-bridge: unhandled rejection: ${err}\n`)
})
process.on('uncaughtException', (err) => {
  process.stderr.write(`wecom acp-bridge: uncaught exception: ${err}\n`)
  shutdown('uncaughtException')
})
