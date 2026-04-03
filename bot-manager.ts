#!/usr/bin/env bun
/**
 * BotManager — multi-bot orchestrator for WeCom intelligent robots.
 *
 * Manages multiple WSClient instances with unified event routing.
 * Events are forwarded with bot name prefix: `{botName}.message`, `{botName}.authenticated`, etc.
 * Global lifecycle events: `bot.connected`, `bot.disconnected`, `bot.error`.
 *
 * Supports both legacy single-bot credentials `{ botId, secret }` and
 * multi-bot credentials `{ bots: [{ name, botId, secret }, ...] }`.
 */

import { EventEmitter } from 'events'
import { WSClient, type WsFrame } from '@wecom/aibot-node-sdk'

// --- Types ---

export type BotConfig = {
  name: string
  botId: string
  secret: string
}

export type BotStatus = {
  name: string
  connected: boolean
  authenticated: boolean
  lastError: string | null
}

/** Accepts both legacy single-bot and new multi-bot format */
export type MultiCredentials = {
  botId?: string
  secret?: string
  bots?: BotConfig[]
}

// --- Credential normalization ---

export function normalizeCredentials(creds: MultiCredentials): BotConfig[] {
  if (creds.bots && creds.bots.length > 0) {
    return creds.bots
  }
  // Legacy single-bot format
  if (creds.botId && creds.secret) {
    return [{ name: 'default', botId: creds.botId, secret: creds.secret }]
  }
  return []
}

// --- BotManager ---

export class BotManager extends EventEmitter {
  private bots = new Map<string, WSClient>()
  private configs = new Map<string, BotConfig>()
  private statuses = new Map<string, BotStatus>()

  get botNames(): string[] {
    return [...this.bots.keys()]
  }

  get botCount(): number {
    return this.bots.size
  }

  loadCredentials(creds: MultiCredentials): void {
    for (const config of normalizeCredentials(creds)) {
      this.addBot(config)
    }
  }

  addBot(config: BotConfig): void {
    if (this.bots.has(config.name)) {
      throw new Error(`Bot "${config.name}" already exists`)
    }

    const client = new WSClient({
      botId: config.botId,
      secret: config.secret,
    })

    this.configs.set(config.name, config)
    this.bots.set(config.name, client)
    this.statuses.set(config.name, {
      name: config.name,
      connected: false,
      authenticated: false,
      lastError: null,
    })

    this.forwardEvents(client, config.name)
  }

  private forwardEvents(client: WSClient, name: string): void {
    // Forward per-bot events with name prefix.
    // WSClient extends EventEmitter but its event types are not fully declared,
    // so we cast to any to register dynamic listeners.
    const eventNames = ['authenticated', 'disconnected', 'error', 'message'] as const
    for (const eventName of eventNames) {
      (client as any).on(eventName, (...args: any[]) => {
        this.emit(`${name}.${eventName}`, ...args)
      })
    }

    // Track status and emit global lifecycle events
    client.on('authenticated', () => {
      const status = this.statuses.get(name)!
      status.connected = true
      status.authenticated = true
      status.lastError = null
      this.emit('bot.connected', name)
    })

    client.on('disconnected', (reason: string) => {
      const status = this.statuses.get(name)!
      status.connected = false
      status.authenticated = false
      this.emit('bot.disconnected', name, reason)
    })

    client.on('error', (error: Error) => {
      const status = this.statuses.get(name)!
      status.lastError = error.message
      this.emit('bot.error', name, error)
    })
  }

  connectAll(): void {
    for (const [name, client] of this.bots) {
      process.stderr.write(`bot-manager: connecting bot "${name}"...\n`)
      client.connect()
    }
  }

  disconnectAll(): void {
    for (const [, client] of this.bots) {
      client.disconnect()
    }
  }

  getBot(name: string): WSClient | undefined {
    return this.bots.get(name)
  }

  getConfig(name: string): BotConfig | undefined {
    return this.configs.get(name)
  }

  getStatus(name: string): BotStatus | undefined {
    return this.statuses.get(name)
  }

  getAllStatuses(): BotStatus[] {
    return [...this.statuses.values()]
  }

  printStatus(): void {
    const statuses = this.getAllStatuses()
    process.stderr.write(`bot-manager: ${statuses.length} bot(s) configured\n`)
    for (const s of statuses) {
      process.stderr.write(
        `  ${s.name}: ${s.connected ? 'connected' : 'disconnected'}${s.lastError ? ` (error: ${s.lastError})` : ''}\n`,
      )
    }
  }
}
