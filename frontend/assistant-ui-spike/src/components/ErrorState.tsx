/**
 * Error State Component
 * 
 * Displayed when an error occurs.
 */

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="error-state">
      <div className="error-state-icon">⚠️</div>
      <h2 className="error-state-title">Something went wrong</h2>
      <p className="error-state-text">{message}</p>
      {onRetry && (
        <button className="error-state-retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export default ErrorState;
