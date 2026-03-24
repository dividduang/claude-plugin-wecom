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
