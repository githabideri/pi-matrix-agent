/**
 * App Shell Component
 * 
 * Provides the polished layout structure for the chat interface.
 * Includes top bar, content area, and footer.
 */

import React from 'react';
import { ProcessingIndicator } from './ProcessingIndicator';
import { ModelBadge } from './ModelBadge';

interface AppShellProps {
  roomKey: string;
  sessionId: string;
  isProcessing: boolean;
  model?: string;
  children: React.ReactNode;
}

export function AppShell({ roomKey, sessionId, isProcessing, model, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <h1 className="app-title">Assistant</h1>
          <span className="app-room-label">{roomKey}</span>
        </div>
        <div className="app-header-right">
          {model && <ModelBadge model={model} />}
          <ProcessingIndicator isProcessing={isProcessing} />
          <span className="app-session-id">{sessionId}</span>
        </div>
      </header>
      
      <main className="app-main">
        {children}
      </main>
    </div>
  );
}

export default AppShell;
