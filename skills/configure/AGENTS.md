<!-- Parent: ../AGENTS.md -->

# configure

## Purpose
Configuration skill for WeCom channel. Handles bot credential setup (single and multi-bot) and status checking. User-invocable via `/wecom:configure`.

## Key Files

| File | Description |
|------|-------------|
| `SKILL.md` | Skill definition — commands: `set`, `add`, `remove`, `list`, `clear`, status |
| `../../bot-manager.ts` | BotManager — multi-bot orchestration |
| `../../server.ts` | Channel mode server (reads credentials at startup) |
| `../../acp-bridge.ts` | ACP bridge (reads credentials at startup) |

## For AI Agents

### Working In This Directory
- Credentials are saved to `~/.claude/channels/wecom/credentials.json`
- **Session restart required** after credential changes (server reads at boot)
- Supports both legacy single-bot and multi-bot formats

### Commands
| Command | Action |
|---------|--------|
| (no args) | Show status: credentials, access, next steps |
| `set <botId> <secret>` | Save single WeCom bot credentials (legacy format) |
| `set <name> <botId> <secret>` | Add named bot (multi-bot format) |
| `remove <name>` | Remove a named bot from multi-bot config |
| `list` | List all configured bots |
| `clear` | Delete all credentials |

### State Files
- `credentials.json` (legacy): `{botId, secret}`
- `credentials.json` (multi-bot): `{bots: [{name, botId, secret}, ...]}`
- Get credentials from WeChat Work admin console (应用管理 → 自建应用 → 智能机器人)

### Migration
- Legacy → multi-bot: original bot becomes "default", new bot added by name
- Multi-bot → legacy: when only one bot remains after `remove`, auto-converts

### User Communication
- On save (single): *"Credentials saved. Restart Claude Code with: claude --dangerously-load-development-channels plugin:wecom"*
- On save (multi): *"Bot "name" added. Total N bot(s) configured. Restart to apply."*
- On clear: *"Credentials removed"*

## Dependencies

### Internal
- `../../server.ts` — Reads credentials at startup via BotManager
- `../../acp-bridge.ts` — Reads credentials at startup via BotManager
- `../../bot-manager.ts` — Shared multi-bot orchestration module
- `../access/` — Access control management
