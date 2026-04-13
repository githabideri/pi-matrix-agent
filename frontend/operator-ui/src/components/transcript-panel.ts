/**
 * Transcript panel component.
 */

import type { AnyTranscriptItem } from "../types.js";

export class TranscriptPanel {
  private container: HTMLElement;
  private transcriptEl: HTMLElement;
  private items: AnyTranscriptItem[] = [];

  constructor() {
    this.container = document.createElement("section");
    this.container.className = "panel transcript-panel";
    this.container.innerHTML = `
      <h2>Transcript</h2>
      <div class="transcript"></div>
    `;
    this.transcriptEl = this.container.querySelector(".transcript")!;
  }

  setInitialTranscript(items: AnyTranscriptItem[]): void {
    this.items = items;
    this.renderTranscript();
  }

  appendTextDelta(text: string): void {
    // Find the last assistant message and append to it
    const lastAssistant = this.items.filter((i) => i.kind === "assistant_message").pop();
    if (lastAssistant) {
      lastAssistant.text += text;
      this.renderTranscript();
      this.scrollToBottom();
    }
  }

  private renderTranscript(): void {
    const groups = this.groupByThread();

    this.transcriptEl.innerHTML = groups.map((group) => this.renderThread(group)).join("");
  }

  private groupByThread(): Array<{ user: AnyTranscriptItem; assistant: AnyTranscriptItem[] }> {
    const groups: Array<{ user: AnyTranscriptItem; assistant: AnyTranscriptItem[] }> = [];
    let currentGroup: { user: AnyTranscriptItem; assistant: AnyTranscriptItem[] } | null = null;

    for (const item of this.items) {
      if (item.kind === "user_message") {
        if (currentGroup) {
          groups.push(currentGroup);
        }
        currentGroup = { user: item, assistant: [] };
      } else if (currentGroup) {
        currentGroup.assistant.push(item);
      }
    }

    if (currentGroup) {
      groups.push(currentGroup);
    }

    return groups;
  }

  private renderThread(group: { user: AnyTranscriptItem; assistant: AnyTranscriptItem[] }): string {
    const userHtml = `
      <div class="transcript-thread">
        <div class="message user-message">
          <div class="message-header">
            <span class="message-role">User</span>
            <span class="message-time">${this.formatTime(group.user.timestamp)}</span>
          </div>
          <div class="message-content">${this.escapeHtml(group.user.text)}</div>
        </div>
    `;

    const assistantHtml = group.assistant
      .map((item) => {
        switch (item.kind) {
          case "assistant_message":
            return `
              <div class="message assistant-message">
                <div class="message-header">
                  <span class="message-role">Assistant</span>
                  <span class="message-time">${this.formatTime(item.timestamp)}</span>
                </div>
                <div class="message-content">${this.escapeHtml(item.text)}</div>
              </div>
            `;
          case "thinking":
            return `
              <div class="message thinking-message">
                <div class="message-header">
                  <span class="message-role">Thinking</span>
                </div>
                <div class="message-content">${this.escapeHtml(item.text)}</div>
              </div>
            `;
          case "tool_start":
            return `
              <div class="message tool-message">
                <div class="message-content">
                  <code>🔧 Starting tool: ${this.escapeHtml(item.toolName)}</code>
                </div>
              </div>
            `;
          case "tool_end":
            return `
              <div class="message tool-message">
                <div class="message-content">
                  <code>✅ Tool ${this.escapeHtml(item.toolName)}: ${item.success ? "success" : "failed"}</code>
                </div>
              </div>
            `;
          default:
            return "";
        }
      })
      .join("");

    return `${userHtml + assistantHtml}</div>`;
  }

  private formatTime(timestamp: string): string {
    try {
      return new Date(timestamp).toLocaleTimeString();
    } catch {
      return "";
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private scrollToBottom(): void {
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
  }

  render(): HTMLElement {
    return this.container;
  }
}
