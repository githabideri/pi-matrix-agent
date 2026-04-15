/**
 * Processing Indicator Component
 * 
 * Shows a visual indicator when the assistant is processing.
 */

interface ProcessingIndicatorProps {
  isProcessing: boolean;
}

export function ProcessingIndicator({ isProcessing }: ProcessingIndicatorProps) {
  if (!isProcessing) return null;
  
  return (
    <span className="processing-indicator" title="Processing">
      <span className="processing-dot"></span>
      <span className="processing-text">Processing</span>
    </span>
  );
}

export default ProcessingIndicator;
