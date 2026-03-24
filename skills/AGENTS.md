# skills

WeCom channel plugin skills directory.

## Skills

| Skill | Description |
|-------|-------------|
| `configure` | Bot credential setup (`/wecom:configure`) |
| `access` | User access control (`/wecom:access`) |

## For AI Agents

Skills are user-invocable commands for managing the WeCom channel.

### Invocation
- `/wecom:configure [args]` — Configure bot credentials
- `/wecom:access [args]` — Manage access control

### State Location
All state files live in `~/.claude/channels/wecom/`:
- `credentials.json` — Bot credentials (read at startup)
- `access.json` — Access control (read on every message)
