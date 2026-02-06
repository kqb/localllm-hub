import { Card, CardHeader, CardContent } from '@/components/ui';
import { AgentMonitor } from '@/components/agents';
import { useWebSocket } from '@/hooks/useWebSocket';

export function Development() {
  const { send } = useWebSocket({});

  const handleNudge = (session: string) => {
    send({ action: 'nudge', session });
  };

  const handleKill = (session: string) => {
    send({ action: 'kill', session });
  };

  const handleSuppressAlerts = (session: string, duration: number) => {
    send({ action: 'suppress_alerts', session, duration });
  };

  return (
    <div className="max-w-[1400px] mx-auto p-6 flex flex-col gap-6">
      <Card>
        <CardHeader>🛠️ Development Agent Monitor</CardHeader>
        <CardContent>
          <AgentMonitor
            onNudge={handleNudge}
            onKill={handleKill}
            onSuppressAlerts={handleSuppressAlerts}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>🔔 Alert Configuration</CardHeader>
        <CardContent>
          <div className="text-text-2 text-sm">
            Alert configuration UI - Coming soon
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
