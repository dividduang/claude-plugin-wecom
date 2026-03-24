#!/usr/bin/env bun
/**
 * 主动发送消息脚本
 */

import { WSClient } from '@wecom/aibot-node-sdk'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const STATE_DIR = join(homedir(), '.claude', 'channels', 'wecom')
const CREDENTIALS_FILE = join(STATE_DIR, 'credentials.json')

function loadCredentials() {
  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8'))
  } catch {
    return null
  }
}

const creds = loadCredentials()

if (!creds?.botId || !creds?.secret) {
  console.error('❌ 未找到凭证')
  process.exit(1)
}

const targetUserId = process.argv[2] || '15577726720'
const message = process.argv[3] || '你好！这是 Claude 主动发送的测试消息。'

console.log(`📤 准备发送消息给: ${targetUserId}`)
console.log(`📝 消息内容: ${message}`)

const wsClient = new WSClient({
  botId: creds.botId,
  secret: creds.secret,
})

wsClient.on('authenticated', async () => {
  console.log('🔐 认证成功，正在发送消息...')

  try {
    await wsClient.sendMessage(targetUserId, {
      msgtype: 'markdown',
      markdown: { content: message },
    })
    console.log('✅ 消息发送成功！')

    // 等待一下确保消息发出
    setTimeout(() => {
      wsClient.disconnect()
      process.exit(0)
    }, 1000)
  } catch (err: any) {
    console.error('❌ 发送失败:', err.message)
    wsClient.disconnect()
    process.exit(1)
  }
})

wsClient.on('error', (error) => {
  console.error('⚠️ 连接错误:', error.message)
})

console.log('🔌 正在连接企业微信...')
wsClient.connect()
