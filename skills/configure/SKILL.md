---
name: configure
description: Set up the WeCom channel — configure bot credentials (single or multi-bot). Use when the user asks to configure WeCom, set credentials, add bots, or check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
---

# /wecom:configure — WeCom Channel Setup

Manages WeChat Work (企业微信) intelligent robot credentials. Supports single-bot
(legacy) and multi-bot configurations. Credentials live in
`~/.claude/channels/wecom/credentials.json`.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status

1. **Credentials** — check `~/.claude/channels/wecom/credentials.json` for
   bot configs. Show:
   - If legacy format `{botId, secret}`: show botId (first 8 chars masked)
   - If multi-bot format `{bots: [...]}`: list each bot name and botId (first 8 chars masked)

2. **Access** — read `~/.claude/channels/wecom/access.json` (missing file
   = defaults: `dmPolicy: "pairing"`, empty allowlist). Show:
   - DM policy and what it means
   - Allowed senders: count and list
   - Pending pairings: count with codes and sender IDs

3. **What next** — concrete next step based on state:
   - No credentials → *"Run `/wecom:configure set <botId> <secret>` with your WeCom bot credentials."*
   - Credentials set, nobody allowed → *"Send a message to the bot on WeCom. It replies with a code; approve with `/wecom:access pair <code>`."*
   - Credentials set, someone allowed → *"Ready. Message the bot on WeCom to reach the assistant."*

### `set <botId> <secret>` — save credentials (single bot, legacy format)

1. Validate both botId and secret are provided
2. Create `~/.claude/channels/wecom/` directory if needed
3. Write credentials to `credentials.json`:
   ```json
   { "botId": "<botId>", "secret": "<secret>" }
   ```
4. Confirm: *"Credentials saved (single bot). Restart Claude Code with: claude --dangerously-load-development-channels plugin:wecom"*

### `set <name> <botId> <secret>` — save named bot credentials

When three arguments are provided, the first is the bot name. This writes the
multi-bot format.

1. Validate name, botId and secret are all provided
2. Create `~/.claude/channels/wecom/` directory if needed
3. Read existing `credentials.json` if present
4. If file has legacy format `{botId, secret}`, migrate to multi-bot:
   ```json
   {
     "bots": [
       { "name": "default", "botId": "<old_botId>", "secret": "<old_secret>" },
       { "name": "<name>", "botId": "<botId>", "secret": "<secret>" }
     ]
   }
   ```
5. If file already has multi-bot format, append new entry to `bots` array
6. Write updated `credentials.json`
7. Confirm: *"Bot "<name>" added. Total N bot(s) configured. Restart Claude Code to apply."*

### `remove <name>` — remove a named bot

1. Read `~/.claude/channels/wecom/credentials.json`
2. If legacy format, tell user to use `clear` instead
3. If multi-bot format, find and remove the bot with matching name
4. If only one bot remains, convert back to legacy format `{botId, secret}`
5. Write updated file
6. Confirm removal

### `list` — list all configured bots

1. Read `~/.claude/channels/wecom/credentials.json`
2. Show each bot: name, botId (first 8 chars masked)
3. If legacy format, show as single unnamed bot

### `clear` — remove all credentials

Delete `~/.claude/channels/wecom/credentials.json`. Confirm removal.

---

## Credential formats

### Legacy (single bot, backward compatible)
```json
{ "botId": "xxx", "secret": "xxx" }
```

### Multi-bot
```json
{
  "bots": [
    { "name": "客服机器人", "botId": "xxx", "secret": "xxx" },
    { "name": "技术支持", "botId": "yyy", "secret": "yyy" }
  ]
}
```

Both formats are automatically supported by the channel server and ACP bridge.

---

## Implementation notes

- The channels dir might not exist if the server hasn't run yet. Missing file
  = not configured, not an error.
- The server reads credentials.json once at boot. Credential changes need a
  session restart.
- Get botId and secret from WeChat Work admin console (应用管理 → 自建应用 → 智能机器人)
- When migrating from legacy to multi-bot, the original bot is named "default"
