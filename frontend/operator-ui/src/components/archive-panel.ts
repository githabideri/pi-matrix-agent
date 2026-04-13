/**
 * Archive panel component.
 */

import type { ArchiveSession } from "../types.js";

export class ArchivePanel {
  private container: HTMLElement;
  private archiveListEl: HTMLElement;

  constructor() {
    this.container = document.createElement("section");
    this.container.className = "panel archive-panel";
    this.container.innerHTML = `
      <h2>Archived Sessions</h2>
      <div class="archive-list"></div>
    `;
    this.archiveListEl = this.container.querySelector(".archive-list")!;
  }

  update(sessions: ArchiveSession[]): void {
    if (sessions.length === 0) {
      this.archiveListEl.innerHTML = "<p>No archived sessions</p>";
      return;
    }

    const listItems = sessions
      .map(
        (session) => `
        <li>
          <a href="/room/${this.escapeHtml(session.sessionId)}/archive-view" target="_blank">
            <code>${this.escapeHtml(session.sessionId)}</code>
          </a>
          ${
            session.firstMessage
              ? `
            <div class="archive-preview">${this.escapeHtml(session.firstMessage.slice(0, 80))}...</div>
          `
              : ""
          }
        </li>
      `,
      )
      .join("");

    this.archiveListEl.innerHTML = `
      <p>${sessions.length} archived session(s)</p>
      <ul>${listItems}</ul>
    `;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  render(): HTMLElement {
    return this.container;
  }
}
