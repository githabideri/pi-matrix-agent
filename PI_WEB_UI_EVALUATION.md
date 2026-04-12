# pi-web-ui Evaluation

**Date**: 2026-04-12  
**Status**: Evaluated, not integrated

## Investigation Summary

### What pi-web-ui offers

`@mariozechner/pi-web-ui` is a **browser-based chat UI package** built with mini-lit web components and Tailwind CSS v4.

**Key features**:
- Full `ChatPanel` component with message history, streaming, tool execution
- `AgentInterface` for custom layouts
- IndexedDB-backed storage (`AppStorage`, `SessionsStore`, `IndexedDBStorageBackend`)
- Attachments (PDF, DOCX, XLSX, images)
- Artifacts (HTML, SVG, Markdown with sandboxed execution)
- Custom provider support (Ollama, LM Studio, vLLM)

### Our architecture

**Current setup**:
- **Server owns session state** - persisted to disk, not browser storage
- **Matrix is the input mechanism** - not a browser chat interface
- **Read-only operator dashboard** - not an interactive chat app
- **API-based data access** - `GET /api/live/rooms/:roomKey/transcript`
- **SSE for live updates** - `GET /api/live/rooms/:roomKey/events`

### Mismatch analysis

| Aspect | pi-web-ui | Our setup |
|--------|-----------|-----------|
| Storage | IndexedDB (browser) | Disk (server) |
| Input | Browser chat interface | Matrix bot |
| Use case | Interactive chat app | Read-only operator dashboard |
| State owner | Browser/Client | Server |
| Session model | `Agent` + `SessionsStore` | `PiSessionBackend` + disk files |

## Decision: Not integrated

**Rationale**:

1. **Different architecture**: pi-web-ui assumes browser-owned state with IndexedDB storage. We have server-owned sessions persisted to disk.

2. **Different use case**: pi-web-ui is for interactive chat apps. We need a read-only operator dashboard.

3. **Different input mechanism**: pi-web-ui provides a chat interface. We use Matrix as the input mechanism.

4. **Integration cost**: Decoupling pi-web-ui from its Agent/IndexedDB model would require significant refactoring, essentially rebuilding the parts we need.

5. **Current solution works**: Our custom Vite frontend already provides:
   - Live status panel
   - Context manifest panel
   - Transcript panel with threading
   - Archive panel
   - SSE integration for live updates

## What we kept from the investigation

- **Custom Vite frontend** at `/app/room/:roomKey`
- **Existing transcript parser** in `src/transcript.ts`
- **API-based data access** pattern
- **EJS fallback** at `/room/:roomKey`

## When pi-web-ui would make sense

- Building a standalone browser-based chat interface
- Needing attachment/artifact rendering features
- Wanting IndexedDB-backed session persistence
- Building a consumer-facing chat application

## Notes for future reference

If the project evolves to include a browser-based chat interface alongside the Matrix bot, pi-web-ui could be evaluated again for that specific use case. The current server-owned, read-only operator dashboard model is fundamentally different from what pi-web-ui provides.
