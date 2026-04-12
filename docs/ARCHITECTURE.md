# Documentation

## Architecture

### Message Flow

1. **MatrixTransport** receives message event from Matrix SDK
2. **Router** checks policy (room allowlist, user allowlist)
3. **Command parser** determines if control command or chat prompt
4. **Control handlers** respond directly (ping, status, help, reset)
5. **InferenceBackend** sends plain text to GPU server

### Components

| File | Purpose |
|------|--------|
|  | Matrix SDK wrapper, event handling |
|  | Message routing and dispatch |
|  | Command parsing |
|  | Allowlist enforcement |
|  | HTTP client for GPU server |
|  | Session registry (currently minimal) |
|  | Configuration loading |
|  | Entry point, wiring |

## Future Work

- [ ] Per-room session persistence
- [ ] Streaming responses
- [ ] Rich text formatting
- [ ] Image handling
- [ ] Voice/message attachments


