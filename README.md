# claude-plugin-wecom

## If you are a human / 如果你是人类

WeChat Work (企业微信) channel plugin for [Claude Code](https://claude.ai/claude-code).
Chat with Claude Code from WeChat Work — text, images, files, voice, video, with remote permission relay.

企业微信频道插件，让你可以通过企业微信直接与 Claude Code 对话，支持文字、图片、文件、语音、视频，以及远程权限审批。

**Install / 安装：**

```bash
claude plugin marketplace add dividduang/claude-plugin-wecom
claude plugin install wecom@dividduang-plugins
```

**Acknowledgments / 致谢**

This project is based on [claude-plugin-wechat](https://github.com/lc2panda/claude-plugin-wechat) by [@lc2panda](https://github.com/lc2panda).

**Start / 启动：**

```bash
claude --dangerously-skip-permissions --dangerously-load-development-channels plugin:wecom@dividduang-plugins
```

**Setup / 配置：**

1. Get your WeCom bot credentials (botId and secret) from WeChat Work admin console
2. Run `/wecom:configure set <botId> <secret>` in Claude Code
3. Restart Claude Code with the channel enabled

**Pair / 配对：**

1. Send any message to the bot on WeCom
2. Bot replies with a pairing code
3. Run `/wecom:access pair <code>` in Claude Code

Prerequisites / 前置条件: [Claude Code](https://claude.ai/claude-code) v2.1.80+, [Bun](https://bun.sh) runtime. License: MIT.

---

## If you are Claude Code (AI agent), read below

### Step 0 — Pre-flight

```bash
claude --version   # >= 2.1.80 required
bun --version      # required
```

### Step 1 — Install dependencies

```bash
cd "$PLUGIN_ROOT" && npm install
# or with bun: bun install
```

> Note: Dependencies include `@wecom/aibot-node-sdk` from npm, no local path required.

### Step 2 — Configure credentials

Run `/wecom:configure set <botId> <secret>` with credentials from WeCom admin console.

Credentials are stored in `~/.claude/channels/wecom/credentials.json`.

### Step 3 — Restart with channel

```bash
claude --dangerously-skip-permissions --dangerously-load-development-channels plugin:wecom@dividduang-plugins
```

### Step 4 — Pair user

1. Send message from WeCom
2. Receive pairing code
3. Run `/wecom:access pair <code>`

---

## Local Development / 本地开发

### Install dependencies

```bash
cd D:\rpa\202603\claude-plugin-wecom
npm install
```

### Test connection

```bash
bun test-connection.ts
```

This will connect to WeCom and listen for messages. Useful for debugging.

### Send message proactively

```bash
bun send-message.ts <userid> "<message>"
```

Example:
```bash
bun send-message.ts 15577726720 "Hello from Claude!"
```

This allows sending messages to WeCom without needing an inbound message first.

---

## MCP tools

| Tool | Purpose | Required params |
|------|---------|-----------------|
| `reply` | Send text and/or files to WeCom | `user_id`, `text`; optional `files` |
| `download_attachment` | Download media from WeCom | `attachment_id` |

## Skills

| Skill | Trigger |
|-------|---------|
| `/wecom:configure` | Configure bot credentials |
| `/wecom:access` | Manage user access control |

---

## Troubleshooting / 故障排除

### bun install fails with EPERM

On Windows, bun may have permission issues. Use npm instead:
```bash
npm install
```

### Module not found: aibot-node-sdk

Make sure package.json uses `@wecom/aibot-node-sdk` (not local path):
```json
"@wecom/aibot-node-sdk": "^1.0.4"
```

---

## Project Structure / 项目结构

```
claude-plugin-wecom/
├── server.ts           # MCP server (main entry)
├── test-connection.ts  # Connection test script
├── send-message.ts     # Proactive message sender
├── package.json
├── README.md
└── skills/
    ├── configure/      # /wecom:configure skill
    └── access/         # /wecom:access skill
```

---

License: MIT
