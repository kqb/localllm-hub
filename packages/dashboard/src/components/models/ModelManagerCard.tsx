import { useState } from 'react';
import { Card, CardHeader, CardContent, LoadingText, Badge, Button } from '@/components/ui';
import {
  useModelManager,
  usePullModel,
  useDeleteModel,
  useWarmModel,
  useUnloadModelManager,
} from '@/api/queries';

export function ModelManagerCard() {
  const { data, isLoading, error } = useModelManager();
  const pullModel = usePullModel();
  const deleteModel = useDeleteModel();
  const warmModel = useWarmModel();
  const unloadModel = useUnloadModelManager();

  const [pullName, setPullName] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ text: string; color: string } | null>(null);

  const handlePull = async () => {
    if (!pullName.trim()) return;
    setStatusMsg({ text: `Pulling ${pullName}... (this may take a while)`, color: 'text-accent' });
    try {
      await pullModel.mutateAsync(pullName);
      setStatusMsg({ text: `Pulled ${pullName} successfully`, color: 'text-green' });
      setPullName('');
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err) {
      setStatusMsg({ text: `Pull failed: ${err}`, color: 'text-red' });
    }
  };

  const handleWarm = async (name: string) => {
    setStatusMsg({ text: `Warming ${name}...`, color: 'text-accent' });
    try {
      await warmModel.mutateAsync(name);
      setStatusMsg({ text: `${name} loaded into memory`, color: 'text-green' });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err) {
      setStatusMsg({ text: `Warm failed: ${err}`, color: 'text-red' });
    }
  };

  const handleUnload = async (name: string) => {
    setStatusMsg({ text: `Unloading ${name}...`, color: 'text-accent' });
    try {
      await unloadModel.mutateAsync(name);
      setStatusMsg({ text: `${name} unloaded`, color: 'text-green' });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err) {
      setStatusMsg({ text: `Unload failed: ${err}`, color: 'text-red' });
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete model ${name}? This cannot be undone.`)) return;
    setStatusMsg({ text: `Deleting ${name}...`, color: 'text-accent' });
    try {
      await deleteModel.mutateAsync(name);
      setStatusMsg({ text: `${name} deleted`, color: 'text-green' });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err) {
      setStatusMsg({ text: `Delete failed: ${err}`, color: 'text-red' });
    }
  };

  return (
    <Card>
      <CardHeader>🗂️ Model Manager</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && (
          <div className="text-red text-sm">Failed to load models</div>
        )}
        {data && (
          <>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={pullName}
                onChange={(e) => setPullName(e.target.value)}
                placeholder="Model name to pull (e.g. llama3:8b)"
                className="flex-1 bg-bg3 border border-border rounded px-3 py-2 text-sm text-text outline-none focus:border-accent"
              />
              <Button
                onClick={handlePull}
                disabled={pullModel.isPending || !pullName.trim()}
              >
                Pull
              </Button>
            </div>
            {statusMsg && (
              <div className={`text-sm mb-2 ${statusMsg.color}`}>
                {statusMsg.text}
              </div>
            )}
            {data.models.length === 0 ? (
              <div className="text-center py-6 text-text-2 text-sm">
                No models found in Ollama
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 font-semibold text-text-2">Model</th>
                      <th className="text-left py-2 px-2 font-semibold text-text-2">Size</th>
                      <th className="text-left py-2 px-2 font-semibold text-text-2">Family</th>
                      <th className="text-left py-2 px-2 font-semibold text-text-2">Quant</th>
                      <th className="text-left py-2 px-2 font-semibold text-text-2">Status</th>
                      <th className="text-left py-2 px-2 font-semibold text-text-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.models.map((model: any) => {
                      const sizeGB = (model.size / 1073741824).toFixed(1);
                      return (
                        <tr key={model.name} className="border-b border-border last:border-b-0">
                          <td className="py-2 px-2 font-semibold">{model.name}</td>
                          <td className="py-2 px-2">{sizeGB} GB</td>
                          <td className="py-2 px-2">{model.family || '—'}</td>
                          <td className="py-2 px-2">{model.quantization || '—'}</td>
                          <td className="py-2 px-2">
                            <Badge variant={model.loaded ? 'green' : 'yellow'}>
                              {model.loaded ? 'Loaded' : 'Cold'}
                            </Badge>
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex gap-2">
                              {!model.loaded ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleWarm(model.name)}
                                  disabled={warmModel.isPending}
                                >
                                  Warm
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleUnload(model.name)}
                                  disabled={unloadModel.isPending}
                                >
                                  Unload
                                </Button>
                              )}
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => handleDelete(model.name)}
                                disabled={deleteModel.isPending}
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
