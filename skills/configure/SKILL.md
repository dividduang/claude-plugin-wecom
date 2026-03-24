---
name: configure
description: Set up the WeCom channel — configure bot credentials (botId + secret). Use when the user asks to configure WeCom, set credentials, or check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
---

# /wecom:configure — WeCom Channel Setup

Manages WeChat Work (企业微信) intelligent robot credentials. Credentials live in
`~/.claude/channels/wecom/credentials.json`.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status

1. **Credentials** — check `~/.claude/channels/wecom/credentials.json` for
   `botId` and `secret`. Show set/not-set; if set, show botId (first 8 chars
   masked for security).

2. **Access** — read `~/.claude/channels/wecom/access.json` (missing file
   = defaults: `dmPolicy: "pairing"`, empty allowlist). Show:
   - DM policy and what it means
   - Allowed senders: count and list
   - Pending pairings: count with codes and sender IDs

3. **What next** — concrete next step based on state:
   - No credentials → *"Run `/wecom:configure set <botId> <secret>` with your WeCom bot credentials."*
   - Credentials set, nobody allowed → *"Send a message to the bot on WeCom. It replies with a code; approve with `/wecom:access pair <code>`."*
   - Credentials set, someone allowed → *"Ready. Message the bot on WeCom to reach the assistant."*

### `set <botId> <secret>` — save credentials

1. Validate both botId and secret are provided
2. Create `~/.claude/channels/wecom/` directory if needed
3. Write credentials to `credentials.json`:
   ```json
   { "botId": "<botId>", "secret": "<secret>" }
   ```
4. Confirm: *"Credentials saved. Restart Claude Code with: claude --dangerously-load-development-channels plugin:wecom"*

### `clear` — remove credentials

Delete `~/.claude/channels/wecom/credentials.json`. Confirm removal.

---

## Implementation notes

- The channels dir might not exist if the server hasn't run yet. Missing file
  = not configured, not an error.
- The server reads credentials.json once at boot. Credential changes need a
  session restart.
- Get botId and secret from WeChat Work admin console (应用管理 → 自建应用 → 智能机器人)
