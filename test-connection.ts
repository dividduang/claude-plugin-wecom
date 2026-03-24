#!/usr/bin/env bun
/**
 * 独立测试脚本 - 测试企微 WebSocket 连接
 * 不依赖 MCP 协议，直接测试 SDK 连接
 */

import { WSClient } from '@wecom/aibot-node-sdk'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const STATE_DIR = join(homedir(), '.claude', 'channels', 'wecom')
const CREDENTIALS_FILE = join(STATE_DIR, 'credentials.json')

// 加载凭证
function loadCredentials() {
  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8'))
  } catch {
    return null
  }
}

const creds = loadCredentials()

if (!creds?.botId || !creds?.secret) {
  console.error('❌ 未找到凭证，请先配置：')
  console.error('   mkdir -p ~/.claude/channels/wecom')
  console.error('   echo \'{"botId":"xxx","secret":"xxx"}\' > ~/.claude/channels/wecom/credentials.json')
  process.exit(1)
}

console.log('📝 凭证已加载:')
console.log(`   botId: ${creds.botId.substring(0, 8)}...`)
console.log('')

// 创建 WebSocket 客户端
const wsClient = new WSClient({
  botId: creds.botId,
  secret: creds.secret,
})

// 监听事件
wsClient.on('connected', () => {
  console.log('✅ WebSocket 已连接')
})

wsClient.on('authenticated', () => {
  console.log('🔐 认证成功！')
  console.log('')
  console.log('📱 现在你可以从企业微信给机器人发消息了')
  console.log('   发送消息后，这里会显示收到的内容')
  console.log('')
  console.log('按 Ctrl+C 退出')
})

wsClient.on('disconnected', (reason) => {
  console.log(`❌ 连接断开: ${reason}`)
})

wsClient.on('error', (error) => {
  console.error('⚠️ 错误:', error.message)
})

wsClient.on('message', (frame) => {
  const body = frame.body as any
  console.log('')
  console.log('📨 收到消息:')
  console.log(`   类型: ${body.msgtype}`)
  console.log(`   发送者: ${body.from?.userid}`)
  console.log(`   内容: ${JSON.stringify(body).substring(0, 200)}...`)
})

wsClient.on('message.text', (frame) => {
  const body = frame.body as any
  console.log('')
  console.log('💬 收到文本消息:')
  console.log(`   发送者: ${body.from?.userid}`)
  console.log(`   内容: ${body.text?.content}`)

  // 自动回复
  wsClient.replyStream(frame, `test-${Date.now()}`, `收到你的消息：${body.text?.content}`, true)
    .then(() => console.log('   ✅ 已自动回复'))
    .catch((err) => console.error('   ❌ 回复失败:', err.message))
})

wsClient.on('message.image', (frame) => {
  const body = frame.body as any
  console.log('')
  console.log('🖼️ 收到图片消息:')
  console.log(`   发送者: ${body.from?.userid}`)
  console.log(`   URL: ${body.image?.url}`)
})

wsClient.on('message.voice', (frame) => {
  const body = frame.body as any
  console.log('')
  console.log('🎙️ 收到语音消息:')
  console.log(`   发送者: ${body.from?.userid}`)
  console.log(`   转文字: ${body.voice?.content}`)
})

wsClient.on('message.file', (frame) => {
  const body = frame.body as any
  console.log('')
  console.log('📁 收到文件消息:')
  console.log(`   发送者: ${body.from?.userid}`)
})

wsClient.on('message.video', (frame) => {
  const body = frame.body as any
  console.log('')
  console.log('🎥 收到视频消息:')
  console.log(`   发送者: ${body.from?.userid}`)
})

wsClient.on('event.enter_chat', (frame) => {
  const body = frame.body as any
  console.log('')
  console.log('👋 用户进入会话:')
  console.log(`   用户: ${body.from?.userid}`)
})

// 连接
console.log('🔌 正在连接企业微信...')
wsClient.connect()

// 优雅退出
process.on('SIGINT', () => {
  console.log('')
  console.log('正在断开连接...')
  wsClient.disconnect()
  process.exit(0)
})

process.on('SIGTERM', () => {
  wsClient.disconnect()
  process.exit(0)
})
