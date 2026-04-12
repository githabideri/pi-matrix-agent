/**
 * Context manifest panel component.
 */

import type { ContextManifestResponse } from '../types.js';

export class ManifestPanel {
  private container: HTMLElement;
  private contentEl: HTMLElement;

  constructor() {
    this.container = document.createElement('section');
    this.container.className = 'panel manifest-panel';
    this.container.innerHTML = `
      <h2>Context Manifest</h2>
      <div class="manifest-content"></div>
    `;
    this.contentEl = this.container.querySelector('.manifest-content')!;
  }

  update(data: ContextManifestResponse | null): void {
    if (!data) {
      this.contentEl.innerHTML = '<p>No context manifest available</p>';
      return;
    }

    const toolsList = data.toolNames
      .map((t) => `<li><code>${this.escapeHtml(t)}</code></li>`)
      .join('');

    const sourcesList = data.contextSources
      .map((s) => `
        <li>
          <code>${this.escapeHtml(s.type)}</code>: 
          ${this.escapeHtml(s.relativePath || s.path)}
          ${s.description ? `<em> (${this.escapeHtml(s.description)})</em>` : ''}
        </li>
      `)
      .join('');

    this.contentEl.innerHTML = `
      <dl>
        <dt>Resource Loader</dt>
        <dd>${this.escapeHtml(data.resourceLoaderType)}</dd>
        
        <dt>Tools (${data.toolNames.length})</dt>
        <dd>
          <ul>${toolsList}</ul>
        </dd>
        
        <dt>Context Sources (${data.contextSources.length})</dt>
        <dd>
          <ul>${sourcesList}</ul>
        </dd>
        
        <dt>Generated At</dt>
        <dd>${new Date(data.generatedAt).toLocaleString()}</dd>
      </dl>
    `;
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
