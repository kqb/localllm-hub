import { Card, CardHeader, CardContent, LoadingText, Badge, StatusDot } from '@/components/ui';
import { useMLXStatus } from '@/api/queries';

export function MLXStatus() {
  const { data, isLoading, error } = useMLXStatus();

  return (
    <Card>
      <CardHeader>🚀 MLX Models (M4 Optimized)</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && <div className="text-red text-sm">Failed to load MLX status</div>}
        {data?.error && <div className="text-red text-sm">{data.error}</div>}
        {data && !data.error && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="text-text-2 text-sm">MLX Server</span>
              <div className="flex items-center gap-2">
                <StatusDot status={data.running ? 'ok' : 'error'} />
                <Badge variant={data.running ? 'green' : 'red'}>
                  {data.running ? 'Running' : 'Offline'}
                </Badge>
              </div>
            </div>

            {data.running && data.models && (
              <div className="flex flex-col gap-2">
                {data.models.map((model: any) => (
                  <div
                    key={model.id}
                    className="flex items-center gap-3 py-2 border-b border-border last:border-b-0"
                  >
                    <span className="font-semibold text-sm flex-1">{model.id}</span>
                    <Badge variant="green">Loaded</Badge>
                  </div>
                ))}
              </div>
            )}

            {data.ramUsage && (
              <div className="text-xs text-text-2">
                RAM Usage: {data.ramUsage.toFixed(1)}%
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
