/**
 * Composer Component
 * 
 * Input area for composing new messages.
 * Shows a stop button when processing is active.
 */

import React, { useState, useRef, KeyboardEvent } from 'react';

interface ComposerProps {
  isProcessing: boolean;
  onSend: (text: string) => void;
  onInterrupt?: () => void;  // Optional interrupt handler
}

export function Composer({ isProcessing, onSend, onInterrupt }: ComposerProps) {
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
    if (isProcessing && e.key === 'Escape') {
      // Escape interrupts when processing is active
      e.preventDefault();
      handleInterrupt();
      return;
    }
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
  
  const handleInterrupt = async () => {
    if (!onInterrupt || !isProcessing) return;
    try {
      await onInterrupt();
    } catch (error) {
      console.error('Failed to interrupt:', error);
    }
  };
  
  return (
    <div className="composer">
      <div className="composer-container">
        {isProcessing ? (
          // Stop button shown when processing
          <>
            <div className="composer-processing-placeholder">
              Processing... use stop button to interrupt
            </div>
            <button
              className="composer-stop-button"
              onClick={handleInterrupt}
              title="Stop current operation (Escape)"
            >
              <span className="stop-icon">⏹</span>
            </button>
          </>
        ) : (
          // Normal input shown when not processing
          <>
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
          </>
        )}
      </div>
      <div className="composer-hint">
        {isProcessing ? 'Press Escape to stop' : 'Press Enter to send, Shift+Enter for new line'}
      </div>
    </div>
  );
}

export default Composer;
