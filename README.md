# claude-plugin-wecom

## If you are a human / 如果你是人类

WeChat Work (企业微信) channel plugin for [Claude Code](https://claude.ai/claude-code).
Chat with Claude Code from WeChat Work — text, images, files, voice, video, with remote permission relay.

企业微信频道插件，让你可以通过企业微信直接与 Claude Code 对话，支持文字、图片、文件、语音、视频，以及远程权限审批。

---

## 选择模式

```
你的 Claude Code 怎么登录的？
        │
        ├── claude.ai 账号 ──→ ✅ Channel 模式（全功能，微信远程审批）
        │                         ↓ 往下看「Channel 模式」
        │
        └── API Key ──→ ✅ ACP 模式（支持 Claude / Copilot / Gemini / Codex / 通义千问）
                          ↓ 往下看「ACP 模式」
```

---

<details open>
<summary><h3>Channel 模式</h3></summary>

> 前置条件：[Claude Code](https://claude.ai/claude-code) **v2.1.81+**，使用 claude.ai 账号登录。
>
> 检查版本：终端输入 `claude --version`，低于 2.1.81 请先更新：`claude update`

#### 第 1 步 · 安装插件

在 Claude Code 终端中输入：
```bash
claude plugin marketplace add dividduang/claude-plugin-wecom
claude plugin install wecom@dividduang-plugins
```

#### 第 2 步 · 配置企业微信机器人

1. 在企业微信管理后台创建智能机器人，获取 `botId` 和 `secret`
2. 在 Claude Code 终端中输入 `/wecom:configure set <botId> <secret>`

#### 第 3 步 · 启动

退出 Claude Code，用以下命令重新启动：
```bash
# 自动授权（更快）
claude --dangerously-skip-permissions --dangerously-load-development-channels plugin:wecom@dividduang-plugins

# 手动确认（更安全，通过企业微信审批每个操作）
claude --dangerously-load-development-channels plugin:wecom@dividduang-plugins
```

#### 第 4 步 · 配对

1. 从企业微信发送任意消息给机器人
2. 机器人回复配对码
3. 在 Claude Code 终端输入 `/wecom:access pair <配对码>` 授权

> 停止：在 Claude Code 中按 `Ctrl+C` 或输入 `/exit`

</details>

---

<details open>
<summary><h3>ACP 模式</h3></summary>

> `wecom-acp` 是一个桥接服务：**企业微信 ↔ AI 引擎**。
> 在终端运行后，它会自动在后台启动 AI 引擎（默认 Claude Code），你不需要手动打开 Claude Code。
>
> 支持 macOS / Linux / Windows，以下命令在你电脑的**终端**中输入（Terminal / PowerShell / CMD）。

#### 第 1 步 · 安装

<details>
<summary>前置：安装 Bun 运行时（已有可跳过，<code>bun --version</code> 检查）</summary>

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```
</details>

在终端输入：
```bash
bun add -g github:dividduang/claude-plugin-wecom
```

安装完成，`wecom-acp` 命令全局可用。

#### 第 2 步 · 配置企业微信机器人

首次运行前，需要配置企业微信机器人凭据：

```bash
# 在任意目录创建配置文件
mkdir -p ~/.claude/channels/wecom
echo '{"botId":"你的botId","secret":"你的secret"}' > ~/.claude/channels/wecom/credentials.json
```

或使用 Claude Code 的配置 skill：
```bash
claude
> /wecom:configure set <botId> <secret>
```

#### 第 3 步 · 启动

```bash
wecom-acp
```

- **首次运行：** 连接企业微信 WebSocket，等待消息
- **已配置：** 直接启动

保持终端窗口开着，服务运行中。

> 重新配置：`/wecom:configure set <botId> <secret>`

Alternative ways to start:
```bash
wecom-acp --cwd /path/to/project     # Set default working directory
ACP_AGENT=gemini wecom-acp           # Use different agent
cd "$PLUGIN_ROOT" && bun acp-bridge.ts # Run from plugin directory
bunx claude-channel-wecom              # Zero-install
```

Built-in agent presets: `claude` (default), `copilot`, `gemini`, `qwen`, `codex`, `opencode`.

The bridge spawns the correct ACP command automatically (e.g. `npx @zed-industries/claude-code-acp` for claude). Each WeCom user gets a persistent ACP session with dedicated agent subprocess.

Users can switch working directory from WeCom by sending `/cwd /new/path`. This destroys the current session and creates a new one in the target directory.

#### 第 4 步 · 配对

1. 从企业微信发送任意消息给机器人
2. 机器人回复配对码
3. 在另一个终端启动 Claude Code，输入 `/wecom:access pair <配对码>` 授权

**完成！** 企业微信发消息 → AI 回复。

---

<details>
<summary><b>工作原理</b></summary>

```
企业微信 → wecom-acp 桥接服务 → Claude Code（自动启动） → AI 回复 → 企业微信收到
```

- `wecom-acp` 通过 WebSocket 接收企业微信消息，转发给 AI 引擎
- AI 引擎是后台子进程，你看不到它
- 每个企业微信用户有独立的 AI 会话，互不干扰

</details>

<details>
<summary><b>切换项目目录</b></summary>

在企业微信中发送：
```
/cwd /path/to/your/project
```
AI 会话在新目录重启，不用动终端。

查看当前目录：`/cwd`

</details>


> 停止：在运行 `wecom-acp` 的终端按 `Ctrl+C`

</details>

---

<details>
<summary><h3>企业微信端命令</h3></summary>

在企业微信中发送以下命令：

| 命令 | 作用 |
|------|------|
| `/cwd [路径]` | 查看或切换工作目录（ACP 模式） |
| `/toggle-debug` | 切换调试模式 |
| `/echo <文字>` | 回显并显示延迟 |

</details>

### 相关项目

- **微信：** [lc2panda/claude-plugin-wechat](https://github.com/lc2panda/claude-plugin-wechat)

---

## For Claude Code (AI agent) — machine-readable instructions

Follow sequentially. Steps marked **[HUMAN]** need physical user action.

### Step 0 — Pre-flight & mode detection

```bash
claude --version   # >= 2.1.81 required (Channels introduced in 2.1.81)
bun --version      # required
```

If Claude Code version is below 2.1.81, tell user to update: `claude update`
If `bun` is missing, tell user to install: `curl -fsSL https://bun.sh/install | bash`

**Detect auth mode:**
```bash
claude auth status --text
```
- **claude.ai login** → Channel mode (Steps 1-6)
- **API key / Console / Bedrock / Vertex** → ACP mode (Steps 1-3 then ACP setup)
- Ask user if unclear.

---

### Channel mode (claude.ai users)

#### Step 1 — Locate plugin root

Set `$PLUGIN_ROOT` to the absolute path of the directory containing this README.

#### Step 2 — Install dependencies

```bash
cd "$PLUGIN_ROOT" && bun install --no-summary
```

Verify: `node_modules/@modelcontextprotocol`, `node_modules/zod` must exist.

#### Step 3 — Build validation

```bash
cd "$PLUGIN_ROOT" && bun build --target=bun server.ts --outdir /tmp/wecom-build-check 2>&1
rm -rf /tmp/wecom-build-check
```

#### Step 4 — Register and install

```bash
claude plugin marketplace add dividduang/claude-plugin-wecom
claude plugin install wecom@dividduang-plugins
```

#### Step 5 — Configure WeCom bot [HUMAN]

Check if credentials exist: `cat ~/.claude/channels/wecom/credentials.json 2>/dev/null`

If yes, skip to Step 6. Otherwise:

1. Get botId and secret from WeCom admin console
2. Run `/wecom:configure set <botId> <secret>` in Claude Code

#### Step 6 — Restart with channel [HUMAN]

Ask user which permission mode:

**Option A — Auto-approve (faster):**
```
claude --dangerously-skip-permissions --dangerously-load-development-channels plugin:wecom@dividduang-plugins
```

**Option B — Manual confirm (safer, approvals via WeCom):**
```
claude --dangerously-load-development-channels plugin:wecom@dividduang-plugins
```

---

### ACP mode (API Key users)

For users with API key / Console / Bedrock / Vertex auth. Uses ACP (Agent Client Protocol) with persistent agent subprocess.

#### Step 1 — Install globally [HUMAN]

```bash
bun add -g github:dividduang/claude-plugin-wecom
```

If `bun` is missing, tell user to install: `curl -fsSL https://bun.sh/install | bash`

#### Step 2 — Configure WeCom credentials [HUMAN]

```bash
# Create config directory
mkdir -p ~/.claude/channels/wecom

# Set credentials (get botId and secret from WeCom admin console)
echo '{"botId":"YOUR_BOT_ID","secret":"YOUR_SECRET"}' > ~/.claude/channels/wecom/credentials.json
```

#### Step 3 — Start the bridge [HUMAN]

```bash
wecom-acp
```

The bridge connects to WeCom via WebSocket and waits for messages.

Alternative ways to start:
```bash
wecom-acp --cwd /path/to/project     # Set default working directory
ACP_AGENT=gemini wecom-acp           # Use different agent
cd "$PLUGIN_ROOT" && bun acp-bridge.ts # Run from plugin directory
bunx claude-channel-wecom              # Zero-install
```

Built-in agent presets: `claude` (default), `copilot`, `gemini`, `qwen`, `codex`, `opencode`.

The bridge spawns the correct ACP command automatically (e.g. `npx @zed-industries/claude-code-acp` for claude). Each WeCom user gets a persistent ACP session with dedicated agent subprocess.

Users can switch working directory from WeCom by sending `/cwd /new/path`. This destroys the current session and creates a new one in the target directory.

#### Step 4 — Pair users [HUMAN]

**Other users** who want to chat must go through pairing:
1. They send any message to the bot from WeCom.
2. Bot replies with a 6-char code.
3. The device owner runs `/wecom:access pair <code>` in a separate Claude Code session to approve.

---

## Reference (for AI)

### MCP tools (Channel mode only)

| Tool | Purpose | Params |
|------|---------|--------|
| `reply` | Send text/files to WeCom | `user_id`, `text`; optional `files[]` |
| `download_attachment` | Download media from WeCom | `attachment_id` |

### Channel protocol

- Capabilities: `claude/channel` + `claude/channel/permission`
- Inbound: `notifications/claude/channel` → meta `{user_id, ts}`
- Outbound: `reply` tool.
- Permission relay: user replies `yes <code>` / `no <code>` from WeCom
- Media: images, files, voice, video via WeCom intelligent robot API

### ACP protocol

- Uses Agent Client Protocol (ACP) — JSON-RPC 2.0 over stdio
- Persistent agent subprocess per user (no cold start per message)
- Streaming responses via `session/update` → `agent_message_chunk`
- Permission requests via `session/request_permission` (auto-approved by default)
- Supports any ACP-compatible agent: Claude Code, Copilot, Gemini, Codex, Qwen, OpenCode
- Same media pipeline as Channel mode (inline download)
- Per-user working directory via `/cwd` command (persisted in `user-cwd.json`)

### WeCom commands (both modes)

| Command | Effect |
|---------|--------|
| `/cwd [path]` | Show or switch working directory (ACP only) |
| `/toggle-debug` | Toggle debug mode |
| `/echo <text>` | Echo with latency measurement |

### Skills (Channel mode only)

| Skill | Trigger |
|-------|---------|
| `/wecom:configure` | Set botId, secret |
| `/wecom:access` | Pair, allow/remove, policy, `humanDelay`, `textChunkLimit` |

### Mode comparison

| Feature | Channel | ACP |
|---------|---------|-----------|
| Auth | claude.ai OAuth | API Key / any provider |
| Permission relay | via WeCom | auto-approve (extensible) |
| Connection | Persistent MCP | Persistent ACP subprocess |
| Streaming | yes | yes (agent_message_chunk) |
| Multi-agent | Claude Code only | Any ACP agent (Claude/Copilot/Gemini/Codex) |
| Multi-turn | yes | yes (persistent session) |
| Media | yes | yes |
| Working dir switch | N/A (bound to session) | `/cwd` command from WeCom |
| Global install | Plugin marketplace | `bun add -g` / `bunx` |

### State files (`~/.claude/channels/wecom/`)

| File | Content |
|------|---------|
| `credentials.json` | Bot auth (botId, secret) |
| `access.json` | Access control |
| `context-tokens.json` | Per-user context info |
| `user-cwd.json` | Per-user working directory (ACP) |
| `debug-mode.json` | Debug toggle |
| `inbox/` | Downloaded media |
| `approved/` | Pairing markers |

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Channels are not currently available` | Use ACP mode, or `claude logout` → `claude login` for claude.ai |
| `credentials required` | Run `/wecom:configure set <botId> <secret>` |
| No channel events | Add `--dangerously-load-development-channels` flag |
| `user not allowlisted` | `/wecom:access pair <code>` |
| WebSocket disconnected | Check network, bot credentials |
| Wrong working directory (ACP) | Send `/cwd /correct/path` from WeCom |

---

## Acknowledgement / 致谢

This project is based on [claude-plugin-wechat](https://github.com/lc2panda/claude-plugin-wechat) by [@lc2panda](https://github.com/lc2panda).

本项目基于 [claude-plugin-wechat](https://github.com/lc2panda/claude-plugin-wechat) 开发，感谢原作者的贡献。

---

License: MIT
