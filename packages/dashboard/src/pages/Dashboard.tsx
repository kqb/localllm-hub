import { ServiceCard, ModelCard } from '@/components/services';
import { MLXStatus } from '@/components/mlx';
import { ContextMonitor } from '@/components/context';
import { AgentMonitor } from '@/components/agents';
import { ZoidActivity } from '@/components/zoid';
import { ChatCard, SearchCard, EmbeddingsCard } from '@/components/tools';
import { useWebSocket } from '@/hooks/useWebSocket';

export function Dashboard() {
  const { send } = useWebSocket({
    onMessage: (message) => {
      // Messages are handled in App.tsx
      console.log('[Dashboard] WebSocket message:', message.type);
    },
  });

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
      {/* Status Row */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ServiceCard />
        <ModelCard />
      </section>

      {/* MLX Models */}
      <section>
        <MLXStatus />
      </section>

      {/* Context Monitor */}
      <section>
        <ContextMonitor />
      </section>

      {/* Agent Monitor */}
      <section>
        <div className="bg-bg-2 border border-border rounded p-5">
          <h2 className="text-sm uppercase tracking-wide text-text-2 mb-4">
            🤖 Agent Monitor
          </h2>
          <AgentMonitor
            onNudge={handleNudge}
            onKill={handleKill}
            onSuppressAlerts={handleSuppressAlerts}
          />
        </div>
      </section>

      {/* Zoid Activity */}
      <section>
        <ZoidActivity />
      </section>

      {/* Chat */}
      <section>
        <ChatCard />
      </section>

      {/* Search */}
      <section>
        <SearchCard />
      </section>

      {/* Embeddings Explorer */}
      <section>
        <EmbeddingsCard />
      </section>
    </div>
  );
}
