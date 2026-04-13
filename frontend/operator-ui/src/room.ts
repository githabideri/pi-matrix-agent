/**
 * Main room view that coordinates all panels.
 */

import { connectEvents, getArchiveSessions, getContextManifest, getLiveRoom, getLiveTranscript } from "./api.js";
import { ArchivePanel } from "./components/archive-panel.js";
import { ManifestPanel } from "./components/manifest-panel.js";
import { LiveStatusPanel } from "./components/status-panel.js";
import { TranscriptPanel } from "./components/transcript-panel.js";

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
    this.archivePanel = new ArchivePanel(roomKey);
  }

  async load(): Promise<void> {
    try {
      console.log(`[RoomView] Loading room: ${this.roomKey}`);

      // Load initial data
      await this.refreshAll();

      // Connect to SSE for live updates
      this.connectSSE();

      // Start polling for updates
      this.startPolling();

      console.log(`[RoomView] Room loaded successfully`);
    } catch (error) {
      console.error("Failed to load room data:", error);
    }
  }

  /**
   * Refresh all data from the server.
   */
  async refreshAll(): Promise<void> {
    await Promise.all([this.refreshRoom(), this.refreshManifest(), this.refreshTranscript(), this.refreshArchives()]);
  }

  /**
   * Refresh room details.
   */
  async refreshRoom(): Promise<void> {
    try {
      const roomData = await getLiveRoom(this.roomKey);
      this.liveStatusPanel.update(roomData);
      console.log(`[RoomView] Room refreshed: ${roomData.roomId}`);
    } catch (error: any) {
      console.warn(`[RoomView] Failed to refresh room: ${error?.message || error}`);
      this.liveStatusPanel.update(null);
    }
  }

  /**
   * Refresh context manifest.
   */
  async refreshManifest(): Promise<void> {
    try {
      const manifest = await getContextManifest(this.roomKey);
      this.manifestPanel.update(manifest);
      console.log(`[RoomView] Manifest refreshed: ${manifest?.toolNames.length || 0} tools`);
    } catch (error: any) {
      console.warn(`[RoomView] Failed to refresh manifest: ${error?.message || error}`);
      this.manifestPanel.update(null);
    }
  }

  /**
   * Refresh transcript.
   */
  async refreshTranscript(): Promise<void> {
    try {
      const transcript = await getLiveTranscript(this.roomKey);
      if (transcript) {
        // Only update if we don't already have content (avoid clearing SSE deltas)
        if (this.transcriptPanel.getItemCount() === 0) {
          this.transcriptPanel.setInitialTranscript(transcript.items);
        }
      }
      console.log(`[RoomView] Transcript refreshed: ${transcript?.items?.length || 0} items`);
    } catch (error: any) {
      console.warn(`[RoomView] Failed to refresh transcript: ${error?.message || error}`);
    }
  }

  /**
   * Refresh archived sessions.
   */
  async refreshArchives(): Promise<void> {
    try {
      const archives = await getArchiveSessions(this.roomKey);
      this.archivePanel.update(archives);
      console.log(`[RoomView] Archives refreshed: ${archives?.length || 0} sessions`);
    } catch (error: any) {
      console.warn(`[RoomView] Failed to refresh archives: ${error?.message || error}`);
      this.archivePanel.update([]);
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
    console.log(`[RoomView] SSE event: ${event.type}`);

    switch (event.type) {
      case "text_delta":
        // Backend sends: { type: "text_delta", delta: "..." }
        // NOT { type: "text_delta", data: { text: "..." } }
        this.transcriptPanel.appendTextDelta(event.delta || "");
        break;
      case "run_start":
        console.log(`[RoomView] Run started`);
        this.liveStatusPanel.setProcessing(true);
        break;
      case "run_end":
        console.log(`[RoomView] Run ended - refreshing transcript`);
        this.liveStatusPanel.setProcessing(false);
        // Refresh transcript to get final persisted content
        void this.refreshTranscript();
        break;
      case "tool_start":
        console.log(`[RoomView] Tool started: ${event.toolName}`);
        break;
      case "tool_end":
        console.log(`[RoomView] Tool ended: ${event.toolName}, success: ${event.success}`);
        break;
    }
  }

  private startPolling(): void {
    // Poll every 5 seconds for state updates
    setInterval(() => {
      // Always refresh room details and archives on every cycle
      void this.refreshRoom();
      void this.refreshArchives();

      // Refresh manifest and transcript less frequently (every 3rd cycle = 15s)
      // to reduce server load while still catching updates
      if ((Date.now() / 5000) % 3 < 1) {
        void this.refreshManifest();
        void this.refreshTranscript();
      }
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
