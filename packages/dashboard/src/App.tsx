import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Header, TabBar } from '@/components/layout';
import { Dashboard } from '@/pages/Dashboard';
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
        {activeTab === 'models' && (
          <div className="p-6 text-text-2">Models page - Coming soon</div>
        )}
        {activeTab === 'config' && (
          <div className="p-6 text-text-2">Config page - Coming soon</div>
        )}
        {activeTab === 'development' && (
          <div className="p-6 text-text-2">Development page - Coming soon</div>
        )}
        {activeTab === 'logs' && (
          <div className="p-6 text-text-2">Logs page - Coming soon</div>
        )}
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
