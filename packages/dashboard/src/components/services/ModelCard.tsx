import { Card, CardHeader, CardContent, LoadingText, Badge } from '@/components/ui';
import { useModels } from '@/api/queries';

export function ModelCard() {
  const { data, isLoading, error } = useModels();

  const formatSize = (bytes: number) => {
    const gb = bytes / 1024 / 1024 / 1024;
    return `${gb.toFixed(1)} GB`;
  };

  return (
    <Card>
      <CardHeader>🤖 Loaded Models (Ollama)</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && (
          <div className="text-red text-sm">Failed to load models</div>
        )}
        {data?.error && (
          <div className="text-red text-sm">{data.error}</div>
        )}
        {data?.models && data.models.length === 0 && (
          <div className="text-text-2 text-sm text-center py-6">
            No models loaded
          </div>
        )}
        {data?.models && data.models.length > 0 && (
          <div className="flex flex-col gap-2">
            {data.models.map((model) => (
              <div
                key={model.digest}
                className="flex items-center gap-3 py-2 border-b border-border last:border-b-0"
              >
                <span className="font-semibold text-sm flex-1">
                  {model.name}
                </span>
                <span className="text-text-2 text-sm">
                  {formatSize(model.size)}
                </span>
                <Badge variant="green">Loaded</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
