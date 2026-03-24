<!-- Parent: ../AGENTS.md -->

# configure

## Purpose
Configuration skill for WeCom channel. Handles bot credential setup and status checking. User-invocable via `/wecom:configure`.

## Key Files

| File | Description |
|------|-------------|
| `SKILL.md` | Skill definition — commands: `set`, `clear`, status |

## For AI Agents

### Working In This Directory
- Credentials are saved to `~/.claude/channels/wecom/credentials.json`
- **Session restart required** after credential changes (server reads at boot)

### Commands
| Command | Action |
|---------|--------|
| (no args) | Show status: credentials, access, next steps |
| `set <botId> <secret>` | Save WeCom bot credentials |
| `clear` | Delete credentials file |

### State Files
- `credentials.json`: `{botId, secret}`
- Get credentials from WeChat Work admin console (应用管理 → 自建应用 → 智能机器人)

### User Communication
- On save: *"Credentials saved. Restart Claude Code with: claude --dangerously-load-development-channels plugin:wecom"*
- On clear: *"Credentials removed"*

## Dependencies

### Internal
- `../../server.ts` — Reads credentials at startup
- `../access/` — Access control management
