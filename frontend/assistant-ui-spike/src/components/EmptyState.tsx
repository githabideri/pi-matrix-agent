/**
 * Empty State Component
 * 
 * Displayed when there are no messages in the conversation.
 */

export function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">💬</div>
      <h2 className="empty-state-title">No messages yet</h2>
      <p className="empty-state-text">
        Start the conversation by typing a message below.
      </p>
    </div>
  );
}

export default EmptyState;
