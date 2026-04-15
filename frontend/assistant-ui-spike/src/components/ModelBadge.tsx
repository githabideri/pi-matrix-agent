/**
 * Model Badge Component
 * 
 * Displays the current model in a styled badge.
 */

interface ModelBadgeProps {
  model: string;
}

export function ModelBadge({ model }: ModelBadgeProps) {
  return (
    <span className="model-badge" title={model}>
      {model}
    </span>
  );
}

export default ModelBadge;
