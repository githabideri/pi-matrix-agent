/**
 * Markdown Renderer Component
 * 
 * Renders markdown text using react-markdown.
 * Provides syntax highlighting and proper code block rendering.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  text: string;
}

export function MarkdownRenderer({ text }: MarkdownRendererProps) {
  return (
    <div className="message-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
