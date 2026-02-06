import { AgentCard } from './AgentCard';
import { useAgentStore } from '@/stores/agentStore';

interface AgentMonitorProps {
  onNudge?: (session: string) => void;
  onKill?: (session: string) => void;
  onSuppressAlerts?: (session: string, duration: number) => void;
}

export function AgentMonitor({ onNudge, onKill, onSuppressAlerts }: AgentMonitorProps) {
  const agents = useAgentStore((state) => state.agents);

  const agentArray = Array.from(agents.values());

  if (agentArray.length === 0) {
    return (
      <div className="text-center py-12 text-text-2">
        <p className="text-sm">No active agent sessions</p>
        <p className="text-xs mt-2">Agents will appear here when they're running</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
      {agentArray.map((agent) => (
        <AgentCard
          key={agent.session}
          agent={agent}
          onNudge={onNudge}
          onKill={onKill}
          onSuppressAlerts={onSuppressAlerts}
        />
      ))}
    </div>
  );
}
