/**
 * Live status panel component.
 */

import type { LiveRoomResponse } from '../types.js';

export class LiveStatusPanel {
  private container: HTMLElement;
  private statusEl: HTMLElement;
  private fieldsEl: HTMLElement;

  constructor() {
    this.container = document.createElement('section');
    this.container.className = 'panel status-panel';
    this.container.innerHTML = `
      <h2>Live Status</h2>
      <div class="status-indicator">
        <span class="status-dot"></span>
        <span class="status-text">Unknown</span>
      </div>
      <div class="status-fields"></div>
    `;
    this.statusEl = this.container.querySelector('.status-indicator')!;
    this.fieldsEl = this.container.querySelector('.status-fields')!;
  }

  update(data: LiveRoomResponse | null): void {
    if (!data) {
      this.statusEl.querySelector('.status-text')!.textContent = 'Not Live';
      this.fieldsEl.innerHTML = '<p>No live session for this room</p>';
      return;
    }

    const isProcessing = data.isProcessing;
    const isStreaming = data.isStreaming;

    // Update status indicator
    const statusDot = this.statusEl.querySelector('.status-dot')!;
    const statusText = this.statusEl.querySelector('.status-text')!;

    if (isProcessing || isStreaming) {
      statusDot.className = 'status-dot active';
      statusText.textContent = isStreaming ? 'Streaming' : 'Processing';
    } else {
      statusDot.className = 'status-dot idle';
      statusText.textContent = 'Idle';
    }

    // Update fields
    this.fieldsEl.innerHTML = `
      <dl>
        <dt>Room ID</dt>
        <dd><code>${this.escapeHtml(data.roomId)}</code></dd>
        <dt>Room Key</dt>
        <dd><code>${this.escapeHtml(data.roomKey)}</code></dd>
        ${data.sessionId ? `
        <dt>Session ID</dt>
        <dd><code>${this.escapeHtml(data.sessionId)}</code></dd>
        ` : ''}
        ${data.relativeSessionPath ? `
        <dt>Session File</dt>
        <dd><code>${this.escapeHtml(data.relativeSessionPath)}</code></dd>
        ` : ''}
        ${data.model ? `
        <dt>Model</dt>
        <dd>${this.escapeHtml(data.model)}</dd>
        ` : ''}
        ${data.workingDirectory ? `
        <dt>Working Directory</dt>
        <dd><code>${this.escapeHtml(data.workingDirectory)}</code></dd>
        ` : ''}
        ${data.processingStartedAt ? `
        <dt>Processing Started</dt>
        <dd>${new Date(data.processingStartedAt).toLocaleString()}</dd>
        ` : ''}
        ${data.lastEventAt ? `
        <dt>Last Event</dt>
        <dd>${new Date(data.lastEventAt).toLocaleString()}</dd>
        ` : ''}
      </dl>
    `;
  }

  setProcessing(processing: boolean): void {
    const statusDot = this.statusEl.querySelector('.status-dot')!;
    const statusText = this.statusEl.querySelector('.status-text')!;

    if (processing) {
      statusDot.className = 'status-dot active';
      statusText.textContent = 'Processing';
    } else {
      statusDot.className = 'status-dot idle';
      statusText.textContent = 'Idle';
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  render(): HTMLElement {
    return this.container;
  }
}
