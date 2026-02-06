import { Button } from '@/components/ui';
import type { AgentState } from '@/types';

interface AgentActionsProps {
  session: string;
  state: AgentState['state'];
  onNudge?: (session: string) => void;
  onKill?: (session: string) => void;
  onSuppressAlerts?: (session: string, duration: number) => void;
}

export function AgentActions({
  session,
  state,
  onNudge,
  onKill,
  onSuppressAlerts,
}: AgentActionsProps) {
  const handleNudge = () => onNudge?.(session);
  const handleKill = () => {
    if (confirm(`Kill agent session "${session}"?`)) {
      onKill?.(session);
    }
  };
  const handleSuppress = () => {
    const duration = parseInt(prompt('Suppress alerts for how many minutes?', '30') || '0');
    if (duration > 0) {
      onSuppressAlerts?.(session, duration);
    }
  };

  const isStuckOrError = state === 'STUCK' || state === 'ERROR';

  return (
    <div className="flex gap-2 flex-wrap">
      <Button
        size="sm"
        variant="outline"
        onClick={handleNudge}
        disabled={!onNudge}
      >
        👋 Nudge
      </Button>
      <Button
        size="sm"
        variant="danger"
        onClick={handleKill}
        disabled={!onKill}
      >
        ❌ Kill
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={handleSuppress}
        disabled={!onSuppressAlerts}
      >
        🔕 Suppress
      </Button>
      {isStuckOrError && (
        <span className="text-xs text-red self-center ml-2">
          ⚠️ Needs attention
        </span>
      )}
    </div>
  );
}
