# pi-matrix-agent

A Matrix bot that connects to local LLM inference endpoints for chat interactions.

## Overview

This bot listens to Matrix rooms and routes messages through a local inference backend. It supports:

- **Autorespond mode**: Plain text messages from allowlisted users trigger inference
- **Control commands**: `!ping`, `!status`, `!help`, `!reset` for bot management
- **Per-room isolation**: Each Matrix room has independent context
- **Sender allowlists**: Only authorized users can trigger responses

## Architecture

```
Matrix Client → MatrixTransport → Router → InferenceBackend → GPU Server
```

- **MatrixTransport**: Handles Matrix SDK connection and message routing
- **Router**: Dispatches messages to control handlers or inference backend
- **Policy**: Enforces room and user allowlists
- **InferenceBackend**: Stateless HTTP client for OpenAI-compatible APIs

## Current State

⚠️ **Note**: The current inference backend is **stateless**. Each message is processed independently without conversation history. Per-room session persistence is planned for a future release.

## Development

### Prerequisites

- Node.js >= 20
- npm

### Setup

```bash
npm install
npm run build
npm test
```

### Running

1. Copy `config.example.json` to `config.json`
2. Fill in your Matrix server details, bot token, and inference endpoint
3. Run: `node dist/index.js`

## Configuration

See `config.example.json` for available options:

| Key | Description |
|-----|-------------|
| `homeserverUrl` | Matrix homeserver URL |
| `accessToken` | Bot access token |
| `botUserId` | Bot's Matrix user ID |
| `allowedRoomIds` | List of room IDs the bot should respond in |
| `allowedUserIds` | List of user IDs allowed to trigger responses |
| `inferenceBaseUrl` | Inference server base URL (OpenAI-compatible) |
| `inferenceModel` | Model ID to use |

## Deployment

Deployment configuration (systemd units, production configs, secrets) is intentionally kept **outside** this repository. See your deployment documentation for details.

## License

MIT License - see LICENSE file.
