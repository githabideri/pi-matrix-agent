/**
 * Main room view that coordinates all panels.
 */

import { connectEvents, getArchiveSessions, getContextManifest, getLiveRoom, getLiveTranscript } from "./api.js";
import { ArchivePanel } from "./components/archive-panel.js";
import { ManifestPanel } from "./components/manifest-panel.js";
import { LiveStatusPanel } from "./components/status-panel.js";
import { TranscriptPanel } from "./components/transcript-panel.js";
import type { ArchiveSession, ContextManifestResponse, LiveRoomResponse, TranscriptResponse } from "./types.js";

export class RoomView {
  private roomKey: string;
  private liveStatusPanel: LiveStatusPanel;
  private manifestPanel: ManifestPanel;
  private transcriptPanel: TranscriptPanel;
  private archivePanel: ArchivePanel;
  private eventSource?: EventSource;

  constructor(roomKey: string) {
    this.roomKey = roomKey;
    this.liveStatusPanel = new LiveStatusPanel();
    this.manifestPanel = new ManifestPanel();
    this.transcriptPanel = new TranscriptPanel();
    this.archivePanel = new ArchivePanel();
  }

  async load(): Promise<void> {
    try {
      // Load initial data
      const [roomData, manifest, transcript, archives] = await Promise.all([
        getLiveRoom(this.roomKey).catch(() => null as LiveRoomResponse | null),
        getContextManifest(this.roomKey).catch(() => null as ContextManifestResponse | null),
        getLiveTranscript(this.roomKey).catch(() => null as TranscriptResponse | null),
        getArchiveSessions(this.roomKey).catch(() => [] as ArchiveSession[]),
      ]);

      // Render panels
      if (roomData) {
        this.liveStatusPanel.update(roomData);
      }
      if (manifest) {
        this.manifestPanel.update(manifest);
      }
      if (transcript) {
        this.transcriptPanel.setInitialTranscript(transcript.items);
      }
      this.archivePanel.update(archives);

      // Connect to SSE for live updates
      this.connectSSE();

      // Start polling for updates
      this.startPolling();
    } catch (error) {
      console.error("Failed to load room data:", error);
    }
  }

  private connectSSE(): void {
    this.eventSource = connectEvents(this.roomKey);

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleSSEEvent(data);
      } catch (e) {
        console.warn("Failed to parse SSE event:", e);
      }
    };
  }

  private handleSSEEvent(event: any): void {
    switch (event.type) {
      case "text_delta":
        this.transcriptPanel.appendTextDelta(event.data?.text || "");
        break;
      case "run_start":
        this.liveStatusPanel.setProcessing(true);
        break;
      case "run_end":
        this.liveStatusPanel.setProcessing(false);
        break;
      case "tool_start":
        // Could add tool event to transcript
        break;
      case "tool_end":
        // Could add tool event to transcript
        break;
    }
  }

  private startPolling(): void {
    // Poll every 5 seconds for state updates
    setInterval(() => {
      getLiveRoom(this.roomKey)
        .then((roomData) => {
          this.liveStatusPanel.update(roomData);
        })
        .catch(() => {
          // Room might be gone
        });

      getArchiveSessions(this.roomKey)
        .then((archives) => {
          this.archivePanel.update(archives);
        })
        .catch(() => {
          // Ignore errors
        });
    }, 5000);
  }

  render(): HTMLElement {
    const container = document.createElement("div");
    container.className = "room-view";

    // Header
    const header = document.createElement("header");
    header.className = "room-header";
    header.innerHTML = `
      <h1>Room: ${this.escapeHtml(this.roomKey)}</h1>
      <a href="/room/${this.escapeHtml(this.roomKey)}" target="_blank">View EJS fallback</a>
    `;
    container.appendChild(header);

    // Main content
    const main = document.createElement("main");
    main.className = "room-main";

    // Left column: Status and Manifest
    const leftCol = document.createElement("section");
    leftCol.className = "room-left";
    leftCol.appendChild(this.liveStatusPanel.render());
    leftCol.appendChild(this.manifestPanel.render());
    main.appendChild(leftCol);

    // Right column: Transcript and Archive
    const rightCol = document.createElement("section");
    rightCol.className = "room-right";
    rightCol.appendChild(this.transcriptPanel.render());
    rightCol.appendChild(this.archivePanel.render());
    main.appendChild(rightCol);

    container.appendChild(main);

    return container;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
