/**
 * Markdown Renderer Component
 * 
 * Renders markdown text using react-markdown.
 * Provides syntax highlighting and proper code block rendering.
 * 
 * Memoized to prevent unnecessary re-renders during streaming.
 */

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  text: string;
  isStreaming?: boolean;
}

function MarkdownRendererImpl({ text }: MarkdownRendererProps) {
  return (
    <div className="message-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownRenderer = memo(
  MarkdownRendererImpl,
  (prevProps, nextProps) => {
    // Skip render if text hasn't changed
    return prevProps.text === nextProps.text && 
           prevProps.isStreaming === nextProps.isStreaming;
  }
);

MarkdownRenderer.displayName = 'MarkdownRenderer';

export default MarkdownRenderer;
