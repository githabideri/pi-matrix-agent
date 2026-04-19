/**
 * Tool Call Card Component
 * 
 * Displays a tool call in a structured card format.
 * Memoized to prevent unnecessary re-renders during streaming.
 */

import { useState, memo } from 'react';

interface ToolCallCardProps {
  toolName: string;
  arguments?: string;
  toolCallId?: string;
}

function ToolCallCardImpl({ toolName, arguments: args, toolCallId }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <div className="tool-card tool-call-card">
      <div className="tool-card-header">
        <span className="tool-name">{toolName}</span>
        <span className="tool-status tool-status-pending">Calling...</span>
      </div>
      
      {args && (
        <>
          <button 
            className="tool-toggle"
            onClick={() => setIsExpanded(!isExpanded)}
            type="button"
          >
            <span className="toggle-icon">{isExpanded ? '▼' : '▶'}</span>
            <span className="toggle-label">Arguments</span>
          </button>
          
          <div className={`tool-details ${isExpanded ? 'expanded' : ''}`}>
            <pre className="tool-arguments">{args}</pre>
          </div>
        </>
      )}
      
      {toolCallId && (
        <div className="tool-call-id">ID: {toolCallId}</div>
      )}
    </div>
  );
}

export const ToolCallCard = memo(
  ToolCallCardImpl,
  (prevProps, nextProps) => {
    return prevProps.toolName === nextProps.toolName &&
           prevProps.arguments === nextProps.arguments &&
           prevProps.toolCallId === nextProps.toolCallId;
  }
);

ToolCallCard.displayName = 'ToolCallCard';

export default ToolCallCard;
