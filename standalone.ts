#!/usr/bin/env bun
/**
 * 独立企微机器人服务 - 桥接 Claude Code
 *
 * 启动方式:
 *   bun standalone.ts [--workdir <目录>]
 *   npm run standalone -- --workdir /path/to/project
 *
 * 消息流转:
 *   企业微信 → standalone.ts → Claude Code (每次新进程) → 回复 → 企业微信
 */

import { WSClient, generateReqId, type WsFrame } from '@wecom/aibot-node-sdk'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { randomBytes } from 'crypto'
import { $ } from 'bun'

// 配置
const STATE_DIR = join(homedir(), '.claude', 'channels', 'wecom')
const CREDENTIALS_FILE = join(STATE_DIR, 'credentials.json')
const ACCESS_FILE = join(STATE_DIR, 'access.json')

// 类型定义
type Credentials = { botId: string; secret: string }
type Access = {
  dmPolicy: 'pairing' | 'allowlist' | 'disabled'
  allowFrom: string[]
  pending: Record<string, { senderId: string; createdAt: number; expiresAt: number; replies: number }>
}

// 加载凭证
function loadCredentials(): Credentials | null {
  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8'))
  } catch {
    return null
  }
}

// 加载/保存访问控制
function loadAccess(): Access {
  try {
    return JSON.parse(readFileSync(ACCESS_FILE, 'utf8'))
  } catch {
    return { dmPolicy: 'pairing', allowFrom: [], pending: {} }
  }
}

function saveAccess(a: Access): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  writeFileSync(ACCESS_FILE, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 })
}

// 消息上下文
const contextMap = new Map<string, { frame: WsFrame; ts: number }>()

// Markdown 转纯文本
function markdownToPlaintext(md: string): string {
  return md
    .replace(/```[\s\S]*?\n([\s\S]*?)```/g, '\n$1\n')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/!\[([^\]]*)]\(([^)]+)\)/g, '[图片]')
    .replace(/^>\s+/gm, '')
    .replace(/^---+$/gm, '————')
    .replace(/^[\s]*[-*+]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 分块
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

// 访问控制
type GateResult =
  | { action: 'deliver'; access: Access }
  | { action: 'drop' }
  | { action: 'pair'; code: string; isResend: boolean }

function gate(senderId: string): GateResult {
  const access = loadAccess()
  if (!senderId) return { action: 'drop' }
  if (access.dmPolicy === 'disabled') return { action: 'drop' }
  if (access.allowFrom.includes(senderId)) return { action: 'deliver', access }
  if (access.dmPolicy === 'allowlist') return { action: 'drop' }

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
  access.pending[code] = { senderId, createdAt: now, expiresAt: now + 60 * 60 * 1000, replies: 1 }
  saveAccess(access)
  return { action: 'pair', code, isResend: false }
}

// 提取消息内容
function extractMessageContent(frame: WsFrame): string {
  const body = frame.body as any
  const msgtype = body.msgtype
  const parts: string[] = []

  if (msgtype === 'text' && body.text?.content) {
    parts.push(body.text.content)
  } else if (msgtype === 'image') {
    parts.push('[图片]')
  } else if (msgtype === 'voice') {
    parts.push(body.voice?.content ? `[语音转文字: ${body.voice.content}]` : '[语音]')
  } else if (msgtype === 'file') {
    parts.push(`[文件: ${body.file?.name || '未知'}]`)
  } else if (msgtype === 'video') {
    parts.push('[视频]')
  }

  if (body.quote?.text?.content) {
    parts.push(`\n[引用回复: ${body.quote.text.content}]`)
  }

  return parts.join('\n') || '[空消息]'
}

// ============================================
// Claude Code 调用（每次新进程）
// ============================================

let workdir: string = process.cwd()

async function callClaudeCode(message: string): Promise<string> {
  console.log(`🔄 调用 Claude Code (目录: ${workdir})...`)

  try {
    // 使用 --resume 恢复上次会话，保持上下文
    const result = await $`claude --dangerously-skip-permissions --resume -p ${message}`.cwd(workdir).quiet()

    const output = result.stdout.toString().trim()

    if (!output) {
      const stderr = result.stderr.toString().trim()
      if (stderr) {
        console.log(`[Claude stderr] ${stderr}`)
      }
      return '(Claude 返回空响应)'
    }

    return output
  } catch (e: any) {
    const output = e.stdout?.toString().trim() || ''
    const stderr = e.stderr?.toString().trim() || ''

    if (output) {
      return output
    }

    throw new Error(`Claude Code 执行失败: ${stderr || e.message}`)
  }
}

// ============================================
// 主程序
// ============================================

// 解析命令行参数
function parseArgs(): void {
  const args = process.argv.slice(2)

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--workdir' || args[i] === '-w') && args[i + 1]) {
      workdir = resolve(args[++i])
    }
  }
}

parseArgs()

console.log('')
console.log('🤖 企微机器人 → Claude Code 桥接服务')
console.log('====================================')
console.log('')

// 加载凭证
const creds = loadCredentials()
if (!creds?.botId || !creds?.secret) {
  console.error('❌ 未找到凭证，请先配置：')
  console.error('')
  console.error('   mkdir -p ~/.claude/channels/wecom')
  console.error('   echo \'{"botId":"xxx","secret":"xxx"}\' > ~/.claude/channels/wecom/credentials.json')
  process.exit(1)
}

console.log(`📝 凭证: botId=${creds.botId.substring(0, 8)}...`)
console.log(`📁 工作目录: ${workdir}`)
console.log('')

// 测试 Claude Code 是否可用
console.log('🔍 检查 Claude Code...')
try {
  const testResult = await $`claude --version`.quiet()
  console.log(`✅ Claude Code: ${testResult.stdout.toString().trim()}`)
} catch {
  console.error('❌ Claude Code 未安装或不在 PATH 中')
  console.error('   请先安装: https://claude.ai/claude-code')
  process.exit(1)
}
console.log('')

// 创建 WebSocket 客户端
const wsClient = new WSClient({
  botId: creds.botId,
  secret: creds.secret,
})

// 连接事件
wsClient.on('connected', () => {
  console.log('✅ 企微 WebSocket 已连接')
})

wsClient.on('authenticated', () => {
  console.log('🔐 企微认证成功！')
  console.log('')
  console.log('📱 现在你可以从企业微信给机器人发消息了')
  console.log('   消息会被转发给 Claude Code 处理')
  console.log('')
  console.log('按 Ctrl+C 退出')
  console.log('')
})

wsClient.on('disconnected', (reason) => {
  console.log(`❌ 企微连接断开: ${reason}`)
})

wsClient.on('error', (error) => {
  console.error('⚠️ 企微错误:', error.message)
})

// 消息处理
wsClient.on('message', async (frame: WsFrame) => {
  const body = frame.body as any
  const userId = body.from?.userid
  if (!userId) return

  contextMap.set(userId, { frame, ts: Date.now() })

  const result = gate(userId)

  if (result.action === 'drop') return

  if (result.action === 'pair') {
    const streamId = generateReqId('stream')
    const lead = result.isResend ? '仍在等待配对' : '需要配对验证'
    await wsClient.replyStream(frame, streamId, `${lead}\n\n请在终端运行：\n/wecom:access pair ${result.code}`, true)
    return
  }

  // 提取消息
  const content = extractMessageContent(frame)
  console.log(`\n📨 [${userId}] ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`)

  try {
    // 转发给 Claude Code
    const reply = await callClaudeCode(content)

    // 发送回复
    const plainText = markdownToPlaintext(reply)
    const chunks = chunk(plainText, 2000)
    const streamId = generateReqId('stream')

    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1
      await wsClient.replyStream(frame, streamId, chunks[i], isLast)
      if (!isLast) await Bun.sleep(500)
    }

    console.log(`✅ 已回复 [${userId}]`)
  } catch (e) {
    console.error(`❌ 处理失败 [${userId}]:`, e)
    const streamId = generateReqId('stream')
    await wsClient.replyStream(frame, streamId, `❌ 处理失败: ${e instanceof Error ? e.message : String(e)}`, true)
  }
})

// 特定消息类型日志
wsClient.on('message.text', (frame) => {
  const body = frame.body as any
  console.log(`💬 [${body.from?.userid}] ${body.text?.content}`)
})

wsClient.on('message.image', (frame) => {
  const body = frame.body as any
  console.log(`🖼️ [${body.from?.userid}] 发送了图片`)
})

wsClient.on('message.voice', (frame) => {
  const body = frame.body as any
  console.log(`🎙️ [${body.from?.userid}] 语音: ${body.voice?.content || '(无法识别)'}`)
})

wsClient.on('message.file', (frame) => {
  const body = frame.body as any
  console.log(`📁 [${body.from?.userid}] 文件: ${body.file?.name}`)
})

wsClient.on('event.enter_chat', (frame) => {
  const body = frame.body as any
  console.log(`👋 [${body.from?.userid}] 进入会话`)
})

// 启动连接
console.log('🔌 正在连接企业微信...')
wsClient.connect()

// 优雅退出
process.on('SIGINT', () => {
  console.log('')
  console.log('正在停止服务...')
  wsClient.disconnect()
  process.exit(0)
})

process.on('SIGTERM', () => {
  wsClient.disconnect()
  process.exit(0)
})
