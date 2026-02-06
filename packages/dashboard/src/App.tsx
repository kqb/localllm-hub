import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Header, TabBar } from '@/components/layout';
import { Dashboard, Models, Config, Development, Logs } from '@/pages';
import { useUIStore } from '@/stores/uiStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAgentStore } from '@/stores/agentStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AppContent() {
  const { activeTab } = useUIStore();
  const { setAgent, updateAgent } = useAgentStore();

  useWebSocket({
    onMessage: (message) => {
      console.log('[WebSocket]', message.type, message);

      switch (message.type) {
        case 'agent_state':
          if (message.session && typeof message.session === 'string') {
            setAgent(message.session, message as any);
          }
          break;
        case 'progress':
          if (message.session && typeof message.session === 'string') {
            updateAgent(message.session, { progress: message.progress as number });
          }
          break;
        case 'agent_stuck':
          if (message.session && typeof message.session === 'string') {
            updateAgent(message.session, {
              state: 'STUCK',
              last_output: (message.output as string) || '',
            });
          }
          break;
        case 'agent_error':
          if (message.session && typeof message.session === 'string') {
            updateAgent(message.session, {
              state: 'ERROR',
              last_output: (message.output as string) || '',
            });
          }
          break;
        case 'agent_complete':
          if (message.session && typeof message.session === 'string') {
            updateAgent(message.session, {
              state: 'IDLE',
              progress: 100,
            });
          }
          break;
        case 'initial_state':
          if (message.agents && Array.isArray(message.agents)) {
            message.agents.forEach((agent: any) => {
              setAgent(agent.session, agent);
            });
          }
          break;
        case 'agent_watcher_update':
          // New agent-watcher signal-based updates
          if (message.sessions && Array.isArray(message.sessions)) {
            message.sessions.forEach((session: any) => {
              // Map watcher state to UI state
              const uiState = session.state === 'done' ? 'IDLE' 
                : session.state === 'error' ? 'ERROR'
                : session.state === 'waiting_input' ? 'STUCK'
                : 'WORKING';
              setAgent(session.session, {
                session: session.session,
                state: uiState,
                progress: session.progress || 0,
                last_activity: session.lastActivity || Date.now(),
                last_output: session.recentSignals?.[0]?.payload || '',
              });
            });
          }
          break;
      }
    },
    onOpen: () => console.log('[WebSocket] Connected'),
    onClose: () => console.log('[WebSocket] Disconnected'),
  });

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <Header />
      <TabBar />
      <main className="flex-1">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'models' && <Models />}
        {activeTab === 'config' && <Config />}
        {activeTab === 'development' && <Development />}
        {activeTab === 'logs' && <Logs />}
      </main>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
