import { Card, CardHeader, CardContent, LoadingText, Button, Badge } from '@/components/ui';
import { useModels, useUnloadModel } from '@/api/queries';
import { ModelManagerCard, BudgetCard } from '@/components/config';

export function Models() {
  const { data, isLoading, error } = useModels();
  const unloadModel = useUnloadModel();

  const formatSize = (bytes: number) => {
    const gb = bytes / 1024 / 1024 / 1024;
    return `${gb.toFixed(1)} GB`;
  };

  const handleUnload = (modelName: string) => {
    if (confirm(`Unload model "${modelName}"?`)) {
      unloadModel.mutate(modelName);
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto p-6 flex flex-col gap-6">
      <Card>
        <CardHeader>🤖 Loaded Models</CardHeader>
        <CardContent>
          {isLoading && <LoadingText />}
          {error && <div className="text-red text-sm">Failed to load models</div>}
          {data?.error && <div className="text-red text-sm">{data.error}</div>}
          {data?.models && data.models.length === 0 && (
            <div className="text-text-2 text-sm text-center py-6">
              No models loaded
            </div>
          )}
          {data?.models && data.models.length > 0 && (
            <div className="flex flex-col gap-3">
              {data.models.map((model) => (
                <div
                  key={model.digest}
                  className="flex items-center gap-4 py-3 border-b border-border last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">
                      {model.name}
                    </div>
                    <div className="text-xs text-text-2 mt-0.5">
                      {formatSize(model.size)} • Modified{' '}
                      {new Date(model.modified_at).toLocaleDateString()}
                    </div>
                  </div>
                  <Badge variant="green">Loaded</Badge>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUnload(model.name)}
                      disabled={unloadModel.isPending}
                    >
                      Unload
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Model Manager */}
      <section>
        <ModelManagerCard />
      </section>

      {/* Budget Visualizer */}
      <section>
        <BudgetCard />
      </section>
    </div>
  );
}
