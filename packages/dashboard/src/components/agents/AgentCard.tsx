import { useState } from 'react';
import { Card, Badge, StatusDot } from '@/components/ui';
import { AgentProgress } from './AgentProgress';
import { AgentActions } from './AgentActions';
import type { AgentState } from '@/types';

interface AgentCardProps {
  agent: AgentState;
  onNudge?: (session: string) => void;
  onKill?: (session: string) => void;
  onSuppressAlerts?: (session: string, duration: number) => void;
}

export function AgentCard({ agent, onNudge, onKill, onSuppressAlerts }: AgentCardProps) {
  const [expanded, setExpanded] = useState(false);

  const getStateColor = (state: AgentState['state']) => {
    switch (state) {
      case 'READING':
        return 'blue';
      case 'WORKING':
        return 'purple';
      case 'IDLE':
        return 'yellow';
      case 'STUCK':
        return 'red';
      case 'ERROR':
        return 'red';
      default:
        return 'blue';
    }
  };

  const getStatusDotStatus = (state: AgentState['state']) => {
    switch (state) {
      case 'READING':
      case 'WORKING':
        return 'ok';
      case 'IDLE':
        return 'warn';
      case 'STUCK':
      case 'ERROR':
        return 'error';
      default:
        return 'ok';
    }
  };

  const idleTime = Math.floor((Date.now() - agent.last_activity) / 1000);

  return (
    <Card className="transition-all hover:border-accent/50">
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center gap-3">
          <StatusDot status={getStatusDotStatus(agent.state)} />
          <span className="font-semibold text-[15px] flex-1">{agent.session}</span>
          <Badge variant={getStateColor(agent.state)}>{agent.state}</Badge>
        </div>

        {/* Progress */}
        <AgentProgress progress={agent.progress} state={agent.state} />

        {/* Metadata */}
        <div className="flex items-center gap-4 text-xs text-text-2">
          <span>Idle: {idleTime}s</span>
          <span>Progress: {agent.progress}%</span>
        </div>

        {/* Output (expandable) */}
        {agent.last_output && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-accent hover:underline mb-1"
            >
              {expanded ? '▼' : '▶'} Output
            </button>
            {expanded && (
              <div className="bg-bg border border-border rounded p-2 max-h-32 overflow-y-auto scrollbar-thin">
                <pre className="text-xs text-text-2 whitespace-pre-wrap font-mono">
                  {agent.last_output.slice(-500)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <AgentActions
          session={agent.session}
          state={agent.state}
          onNudge={onNudge}
          onKill={onKill}
          onSuppressAlerts={onSuppressAlerts}
        />
      </div>
    </Card>
  );
}
