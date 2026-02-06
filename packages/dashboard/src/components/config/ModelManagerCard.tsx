import { useState } from 'react';
import { Card, CardHeader, CardContent, Button, Badge, LoadingText } from '@/components/ui';
import {
  useAvailableModels,
  usePullModel,
  useWarmModel,
  useUnloadModel,
  useDeleteModel,
} from '@/hooks/useModelManager';

export function ModelManagerCard() {
  const { data, isLoading, error } = useAvailableModels();
  const pullModel = usePullModel();
  const warmModel = useWarmModel();
  const unloadModel = useUnloadModel();
  const deleteModel = useDeleteModel();

  const [pullName, setPullName] = useState('');
  const [status, setStatus] = useState<{ message: string; color: string } | null>(null);

  const showStatus = (message: string, color: string) => {
    setStatus({ message, color });
    setTimeout(() => setStatus(null), 5000);
  };

  const handlePull = async () => {
    if (!pullName.trim()) return;
    showStatus(`Pulling ${pullName}...`, 'var(--accent)');
    try {
      await pullModel.mutateAsync(pullName);
      showStatus(`${pullName} pulled successfully`, 'var(--green)');
      setPullName('');
    } catch (err: any) {
      showStatus(`Pull failed: ${err.message}`, 'var(--red)');
    }
  };

  const handleWarm = async (name: string) => {
    showStatus(`Warming ${name}...`, 'var(--accent)');
    try {
      await warmModel.mutateAsync(name);
      showStatus(`${name} loaded into memory`, 'var(--green)');
    } catch (err: any) {
      showStatus(`Warm failed: ${err.message}`, 'var(--red)');
    }
  };

  const handleUnload = async (name: string) => {
    showStatus(`Unloading ${name}...`, 'var(--accent)');
    try {
      await unloadModel.mutateAsync(name);
      showStatus(`${name} unloaded from memory`, 'var(--green)');
    } catch (err: any) {
      showStatus(`Unload failed: ${err.message}`, 'var(--red)');
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete model "${name}"? This cannot be undone.`)) return;
    showStatus(`Deleting ${name}...`, 'var(--red)');
    try {
      await deleteModel.mutateAsync(name);
      showStatus(`${name} deleted`, 'var(--green)');
    } catch (err: any) {
      showStatus(`Delete failed: ${err.message}`, 'var(--red)');
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>🗂️ Model Manager</CardHeader>
        <CardContent><LoadingText /></CardContent>
      </Card>
    );
  }

  if (error || data?.error) {
    return (
      <Card>
        <CardHeader>🗂️ Model Manager</CardHeader>
        <CardContent>
          <div className="text-red text-sm">
            {data?.error || 'Failed to load models'}
          </div>
        </CardContent>
      </Card>
    );
  }

  const models = data?.models || [];

  return (
    <Card>
      <CardHeader>🗂️ Model Manager</CardHeader>
      <CardContent>
        {/* Pull Model Input */}
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={pullName}
            onChange={(e) => setPullName(e.target.value)}
            placeholder="Model name to pull (e.g. llama3:8b)"
            className="flex-1 bg-bg-3 border border-border rounded px-3 py-2 text-sm text-text outline-none focus:border-accent"
          />
          <Button
            onClick={handlePull}
            disabled={!pullName.trim() || pullModel.isPending}
          >
            Pull
          </Button>
        </div>

        {/* Status Message */}
        {status && (
          <div
            className="mb-3 text-sm"
            style={{ color: status.color }}
          >
            {status.message}
          </div>
        )}

        {/* Models Table */}
        {models.length === 0 ? (
          <div className="text-center text-text-2 text-sm py-6">
            No models found in Ollama
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-text-2 font-medium">Model</th>
                  <th className="text-left py-2 px-3 text-text-2 font-medium">Size</th>
                  <th className="text-left py-2 px-3 text-text-2 font-medium">Family</th>
                  <th className="text-left py-2 px-3 text-text-2 font-medium">Quant</th>
                  <th className="text-left py-2 px-3 text-text-2 font-medium">Status</th>
                  <th className="text-left py-2 px-3 text-text-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => {
                  const sizeGB = (model.size / 1073741824).toFixed(1);
                  return (
                    <tr
                      key={model.name}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="py-2 px-3 font-semibold">{model.name}</td>
                      <td className="py-2 px-3">{sizeGB} GB</td>
                      <td className="py-2 px-3">{model.family || '—'}</td>
                      <td className="py-2 px-3">{model.quantization || '—'}</td>
                      <td className="py-2 px-3">
                        <Badge variant={model.loaded ? 'green' : 'yellow'}>
                          {model.loaded ? 'Loaded' : 'Cold'}
                        </Badge>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex gap-2">
                          {!model.loaded ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleWarm(model.name)}
                              disabled={warmModel.isPending}
                            >
                              Warm
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleUnload(model.name)}
                              disabled={unloadModel.isPending}
                            >
                              Unload
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDelete(model.name)}
                            disabled={deleteModel.isPending}
                            className="text-red hover:text-red"
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
