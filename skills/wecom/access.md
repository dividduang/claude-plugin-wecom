---
name: access
description: Manage WeCom user access control
invocable: true
---

# /wecom:access

Manage user access control for the WeCom channel.

## Usage

```
/wecom:access status                          # Show access policy and allowlist
/wecom:access pair <code>                     # Approve pending pairing request
/wecom:access remove <userid>                 # Remove user from allowlist
/wecom:access policy <pairing|allowlist|disabled>  # Change access policy
/wecom:access humanDelay <on|off>             # Toggle typing simulation
/wecom:access textChunkLimit <number>         # Set max chars per message
```

## Steps

### status

1. Read `~/.claude/channels/wecom/access.json`
2. Display:
   - Policy: {dmPolicy}
   - Allowed users: {allowFrom list}
   - Pending requests: {pending codes with senderId}

### pair <code>

1. Read `access.json`
2. Find pending entry with matching code
3. Move senderId to allowFrom array
4. Delete pending entry
5. Write updated `access.json`
6. Confirm: "User {senderId} added to allowlist"

### remove <userid>

1. Read `access.json`
2. Remove userid from allowFrom array
3. Write updated `access.json`
4. Confirm: "User {userid} removed from allowlist"

### policy <policy>

1. Read `access.json`
2. Update dmPolicy to: pairing | allowlist | disabled
3. Write updated `access.json`
4. Confirm: "Policy changed to {policy}"

### humanDelay <on|off>

1. Read `access.json`
2. Set humanDelay to true/false
3. Write updated `access.json`
4. Confirm: "Typing simulation {enabled/disabled}"

### textChunkLimit <number>

1. Read `access.json`
2. Set textChunkLimit to number (max 2000)
3. Write updated `access.json`
4. Confirm: "Chunk limit set to {number}"
