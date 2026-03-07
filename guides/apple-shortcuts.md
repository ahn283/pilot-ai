# Apple Shortcuts Integration Guide

Pilot AI exposes a local HTTP API that Apple Shortcuts can call.

## Prerequisites

1. Pilot AI agent running (`npx pilot-ai start`)
2. API token generated during setup (stored in `~/.pilot/config.json` as `api.token`)

## Setup

### 1. Get your API token

```bash
cat ~/.pilot/config.json | grep token
```

### 2. Create a Shortcut

1. Open **Shortcuts** app on macOS or iOS
2. Create a new Shortcut
3. Add **"Get Contents of URL"** action:
   - URL: `http://127.0.0.1:3141/api/command`
   - Method: POST
   - Headers:
     - `Authorization`: `Bearer YOUR_TOKEN`
     - `Content-Type`: `application/json`
   - Request Body (JSON):
     ```json
     {
       "command": "Shortcut variable or text"
     }
     ```
4. Add **"Get Dictionary Value"** to extract `result` from response
5. Add **"Show Result"** or **"Quick Look"** to display

### 3. Example Shortcuts

**"Ask Pilot"** - Voice command shortcut:
1. "Dictate Text" action
2. "Get Contents of URL" with dictated text as command
3. "Show Result"

**"Summarize Clipboard"** - Summarize clipboard content:
1. "Get Clipboard"
2. "Get Contents of URL" with body: `{"command": "Summarize this: [Clipboard]"}`
3. "Copy to Clipboard" the result

**"Daily Standup"** - Morning routine:
1. "Get Contents of URL" with body: `{"command": "Show my Linear issues and today's calendar"}`
2. "Show Result"

### 4. Keyboard Shortcut

Assign a keyboard shortcut to your Shortcut:
1. System Settings > Keyboard > Keyboard Shortcuts > Services
2. Find your Shortcut and assign a key combination
