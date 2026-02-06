import { cn } from '@/utils/cn';
import type { AgentState } from '@/types';

interface AgentProgressProps {
  progress: number;
  state: AgentState['state'];
}

export function AgentProgress({ progress, state }: AgentProgressProps) {
  const getProgressColor = (state: AgentState['state']) => {
    switch (state) {
      case 'READING':
        return 'bg-blue';
      case 'WORKING':
        return 'bg-purple';
      case 'IDLE':
        return 'bg-yellow';
      case 'STUCK':
      case 'ERROR':
        return 'bg-red';
      default:
        return 'bg-accent';
    }
  };

  return (
    <div className="w-full bg-bg rounded h-2 overflow-hidden">
      <div
        className={cn(
          'h-full transition-all duration-300 rounded',
          getProgressColor(state)
        )}
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}
