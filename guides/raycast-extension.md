# Raycast Extension Example

A simple Raycast script command to interact with Pilot AI.

## Quick Setup (Script Command)

### 1. Create script command

In Raycast, go to **Extensions > Script Commands > Create Script Command**.

### 2. pilot-ask.sh

Save this as a Raycast script command:

```bash
#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Ask Pilot
# @raycast.mode fullOutput
# @raycast.packageName Pilot AI

# Optional parameters:
# @raycast.icon 🤖
# @raycast.argument1 { "type": "text", "placeholder": "Command" }

TOKEN=$(cat ~/.pilot/config.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('api',{}).get('token',''))")
COMMAND="$1"

RESPONSE=$(curl -s -X POST http://127.0.0.1:3141/api/command \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"command\": \"$COMMAND\"}")

echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result','No response'))"
```

### 3. pilot-status.sh

Check agent status:

```bash
#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title Pilot Status
# @raycast.mode inline
# @raycast.packageName Pilot AI
# @raycast.icon 🤖

RESPONSE=$(curl -s http://127.0.0.1:3141/health 2>/dev/null)
if [ $? -eq 0 ]; then
  echo "✅ Running"
else
  echo "❌ Offline"
fi
```

### 4. pilot-clipboard.sh

Analyze clipboard content:

```bash
#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title Pilot: Analyze Clipboard
# @raycast.mode fullOutput
# @raycast.packageName Pilot AI
# @raycast.icon 🤖

TOKEN=$(cat ~/.pilot/config.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('api',{}).get('token',''))")
CLIP=$(pbpaste)

RESPONSE=$(curl -s -X POST http://127.0.0.1:3141/api/command \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"command\": \"Analyze this: $CLIP\"}")

echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result','No response'))"
```

## Installation

1. Copy the `.sh` files to your Raycast Script Commands directory
2. Make them executable: `chmod +x pilot-*.sh`
3. Raycast will auto-detect them
