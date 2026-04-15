/**
 * Tool Result Card Component
 * 
 * Displays a tool result in a structured card format.
 */

import { useState } from 'react';

interface ToolResultCardProps {
  toolName: string;
  success: boolean;
  result?: string;
  error?: string;
  toolCallId?: string;
}

export function ToolResultCard({ toolName, success, result, error, toolCallId }: ToolResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasOutput = !!(result || error);
  
  const statusText = success ? 'Success' : 'Failed';
  
  return (
    <div className={`tool-card tool-result-card ${success ? 'success' : 'error'}`}>
      <div className="tool-card-header">
        <span className="tool-name">{toolName}</span>
        <span className={`tool-status ${success ? 'success' : 'error'}`}>
          {success ? '✓' : '✗'} {statusText}
        </span>
      </div>
      
      {hasOutput && (
        <>
          <button 
            className="tool-toggle"
            onClick={() => setIsExpanded(!isExpanded)}
            type="button"
          >
            <span className="toggle-icon">{isExpanded ? '▼' : '▶'}</span>
            <span className="toggle-label">
              {success ? 'View result' : 'View error'}
            </span>
          </button>
          
          <div className={`tool-details ${isExpanded ? 'expanded' : ''}`}>
            {error ? (
              <pre className="tool-error">{error}</pre>
            ) : (
              <pre className="tool-result">{result}</pre>
            )}
          </div>
        </>
      )}
      
      {toolCallId && !hasOutput && (
        <div className="tool-call-id">ID: {toolCallId}</div>
      )}
    </div>
  );
}

export default ToolResultCard;
