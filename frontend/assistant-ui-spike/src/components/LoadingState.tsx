/**
 * Loading State Component
 * 
 * Displayed while loading room data.
 */

interface LoadingStateProps {
  roomKey?: string;
}

export function LoadingState({ roomKey }: LoadingStateProps) {
  return (
    <div className="loading-state">
      <div className="loading-spinner"></div>
      <p className="loading-text">
        {roomKey ? `Loading room "${roomKey}"...` : 'Loading...'}
      </p>
    </div>
  );
}

export default LoadingState;
