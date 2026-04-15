/**
 * Message Renderer Component
 * 
 * Custom renderer for chat messages that properly handles:
 * - User messages
 * - Assistant messages with thinking/reasoning blocks
 * - Tool calls and results
 */

import React from 'react';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallCard } from './ToolCallCard';
import { ToolResultCard } from './ToolResultCard';

interface MessageRendererProps {
  role: 'user' | 'assistant' | 'tool';
  content: Array<{ type: 'text'; text: string }> | string;
  thinking?: string;
  name?: string;
  isStreaming?: boolean;
}

export function MessageRenderer({ role, content, thinking, name, isStreaming }: MessageRendererProps) {
  // Convert content to text string
  const getTextContent = () => {
    if (typeof content === 'string') return content;
    return content.filter(c => c.type === 'text').map(c => c.text).join('');
  };

  // Render markdown-like content with basic formatting
  const renderContent = (text: string) => {
    if (!text) return null;
    
    // Check if this is a tool call/result HTML snippet (legacy format)
    if (text.includes('<span class="tool-call">')) {
      // Parse legacy tool call format
      const match = text.match(/<strong>Tool Call:\\?\<\/strong>\s*(.+?)(?:\\n|$)/);
      if (match) {
        const toolName = match[1].trim();
        const toolCallIdMatch = text.match(/\((.+?)\)/);
        return (
          <ToolCallCard
            toolName={toolName}
            toolCallId={toolCallIdMatch ? toolCallIdMatch[1] : undefined}
          />
        );
      }
    }
    
    if (text.includes('<span class="tool-result">')) {
      // Parse legacy tool result format
      const match = text.match(/<strong>Result:\\?\<\/strong>\s*(\S+)\s*(\S)/);
      if (match) {
        const toolName = match[1];
        const success = match[2] === '✓';
        return <ToolResultCard toolName={toolName} success={success} />;
      }
    }
    
    // Check for thinking tags
    if (text.startsWith('<thinking>') && text.endsWith('</thinking>')) {
      const thinkingContent = text.slice(9, -11);
      return <ThinkingBlock content={thinkingContent} isStreaming={isStreaming} />;
    }
    
    // Render as formatted text (basic markdown-like)
    return (
      <div className="message-content">
        {text.split('\n').map((line, i) => (
          <React.Fragment key={i}>
            {renderLine(line)}
            {i < text.split('\n').length - 1 && <br />}
          </React.Fragment>
        ))}
      </div>
    );
  };
  
  const renderLine = (line: string) => {
    // Code blocks
    if (line.startsWith('```')) {
      const code = line.slice(3);
      return <pre className="code-block"><code>{code}</code></pre>;
    }
    
    // Inline code
    const parts: React.ReactNode[] = [];
    let currentText = '';
    let inCode = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '`') {
        if (inCode) {
          parts.push(<code key={parts.length}>{currentText}</code>);
          currentText = '';
          inCode = false;
        } else {
          if (currentText) parts.push(currentText);
          currentText = '';
          inCode = true;
        }
      } else {
        currentText += char;
      }
    }
    
    if (currentText) {
      if (inCode) {
        parts.push(<code key={parts.length}>{currentText}`</code>);
      } else {
        parts.push(currentText);
      }
    }
    
    return parts;
  };

  const textContent = getTextContent();

  if (role === 'tool' && name) {
    // Tool messages get special treatment
    if (textContent.includes('Tool Call:')) {
      // Legacy tool call - parse and render as card
      const match = textContent.match(/<strong>Tool Call:\\?\<\/strong>\s*(.+?)(?:\\n|$)/s);
      if (match) {
        const toolName = match[1].trim().replace(/<[^>]*>/g, '');
        return <ToolCallCard toolName={toolName} />;
      }
    }
    if (textContent.includes('Result:')) {
      // Legacy tool result - parse and render as card
      const match = textContent.match(/<strong>Result:\\?\<\/strong>\s*(\S+)\s*(\S)/s);
      if (match) {
        const toolName = match[1];
        const success = match[2] === '✓';
        return <ToolResultCard toolName={toolName} success={success} />;
      }
    }
    // Fallback for tool messages
    return (
      <div className="tool-message">
        {renderContent(textContent)}
      </div>
    );
  }

  // User or assistant message
  return (
    <div className={`message-wrapper ${role}`}>
      {thinking && (
        <ThinkingBlock content={thinking} isStreaming={isStreaming} />
      )}
      {textContent && renderContent(textContent)}
      {isStreaming && (
        <span className="streaming-cursor">▊</span>
      )}
    </div>
  );
}

export default MessageRenderer;
