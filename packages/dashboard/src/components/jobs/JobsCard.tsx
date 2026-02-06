import { Card, CardHeader, CardContent, LoadingText, Button } from '@/components/ui';
import { useJobs, useTriggerReindex } from '@/api/queries';

export function JobsCard() {
  const { data, isLoading, error } = useJobs();
  const triggerReindex = useTriggerReindex();

  const handleReindex = () => {
    triggerReindex.mutate();
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <Card>
      <CardHeader>📊 Ingestion Stats</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && (
          <div className="text-red text-sm">Failed to load jobs stats</div>
        )}
        {data && !data.hasData && (
          <div className="text-center py-6 text-text-2 text-sm">
            No ingestion data yet. Run <code className="bg-bg3 px-2 py-1 rounded text-xs">localllm chat ingest</code>
          </div>
        )}
        {data && data.hasData && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {data.filesIndexed != null && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-text-2 uppercase tracking-wider">Files Indexed</span>
                  <span className="text-2xl font-bold tabular-nums">{data.filesIndexed}</span>
                </div>
              )}
              {data.chatSessions != null && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-text-2 uppercase tracking-wider">Chat Sessions</span>
                  <span className="text-2xl font-bold tabular-nums">{data.chatSessions}</span>
                </div>
              )}
              {data.chatChunks != null && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-text-2 uppercase tracking-wider">Chat Chunks</span>
                  <span className="text-2xl font-bold tabular-nums">{data.chatChunks.toLocaleString()}</span>
                </div>
              )}
              {data.telegramChunks != null && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-text-2 uppercase tracking-wider">Telegram Chunks</span>
                  <span className="text-2xl font-bold tabular-nums">{data.telegramChunks.toLocaleString()}</span>
                </div>
              )}
            </div>
            {data.lastUpdate && (
              <div className="mt-2 text-xs text-text-2">
                Last update: {data.lastUpdate}
              </div>
            )}
          </>
        )}
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReindex}
            disabled={triggerReindex.isPending}
          >
            {triggerReindex.isPending ? '⏳ Reindexing...' : '🔄 Reindex Memory'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
          >
            ↻ Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
