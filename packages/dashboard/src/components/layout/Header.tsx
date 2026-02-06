import { StatusDot, Button } from '@/components/ui';
import { useServiceStatus } from '@/api/queries';

export function Header() {
  const { data } = useServiceStatus();

  const handleExportDiagnostics = () => {
    // TODO: Implement diagnostics export
    console.log('Export diagnostics clicked');
  };

  return (
    <header className="bg-bg-2 border-b border-border px-6 py-4 flex items-center gap-4">
      <h1 className="text-xl font-semibold">
        🧠 <span className="text-accent">LocalLLM</span> Hub
      </h1>
      <StatusDot
        status={data?.ollama.healthy ? 'ok' : 'warn'}
        title={data?.ollama.healthy ? 'Connected' : 'Checking...'}
      />
      <span className="text-sm text-text-2">
        {data?.ollama.healthy ? 'Ollama Connected' : 'Checking Ollama...'}
      </span>
      <div className="ml-auto flex items-center gap-3">
        <Button size="sm" onClick={handleExportDiagnostics}>
          📥 Export Diagnostics
        </Button>
        <div className="text-text-2 text-[13px]">
          Last update: {data ? new Date(data.timestamp).toLocaleTimeString() : '—'}
        </div>
      </div>
    </header>
  );
}
