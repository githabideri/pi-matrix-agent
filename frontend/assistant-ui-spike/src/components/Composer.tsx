/**
 * Composer Component
 * 
 * Input area for composing new messages.
 */

import React, { useState, useRef, KeyboardEvent } from 'react';

interface ComposerProps {
  isProcessing: boolean;
  onSend: (text: string) => void;
}

export function Composer({ isProcessing, onSend }: ComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const handleSubmit = () => {
    const trimmedText = text.trim();
    if (!trimmedText || isProcessing) return;
    
    onSend(trimmedText);
    setText('');
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };
  
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };
  
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  };
  
  return (
    <div className="composer">
      <div className="composer-container">
        <textarea
          ref={textareaRef}
          className="composer-input"
          placeholder="Type a message..."
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={isProcessing}
          rows={1}
          autoFocus
        />
        <button
          className="composer-send-button"
          onClick={handleSubmit}
          disabled={!text.trim() || isProcessing}
          title="Send message (Enter)"
        >
          <span className="send-icon">→</span>
        </button>
      </div>
      <div className="composer-hint">
        Press Enter to send, Shift+Enter for new line
      </div>
    </div>
  );
}

export default Composer;
