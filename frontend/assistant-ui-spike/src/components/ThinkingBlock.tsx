/**
 * Thinking Block Component
 * 
 * Displays assistant reasoning/thinking in a collapsible section.
 * Collapsed by default, visually distinct from the final answer.
 */

import { useState } from 'react';

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

export function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Show first few lines when collapsed
  const lines = content.split('\n');
  const previewLines = lines.slice(0, 3);
  const hasMore = lines.length > 3;
  
  return (
    <div className="thinking-block">
      <button 
        className="thinking-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        type="button"
        aria-expanded={isExpanded}
      >
        <span className="thinking-icon">
          {isExpanded ? '▲' : '▼'}
        </span>
        <span className="thinking-label">
          {isStreaming ? 'Thinking...' : isExpanded ? 'Hide reasoning' : 'Show reasoning'}
        </span>
      </button>
      
      <div className={`thinking-content ${isExpanded ? 'expanded' : ''}`}>
        <pre className="thinking-text">
          {isExpanded ? content : previewLines.join('\n')}
          {hasMore && !isExpanded && '\n...'}
        </pre>
      </div>
    </div>
  );
}

export default ThinkingBlock;
