import { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent, Button, LoadingText } from '@/components/ui';
import { useCompaction, useUpdateCompaction } from '@/hooks/useCompaction';

export function CompactionCard() {
  const { data, isLoading, error } = useCompaction();
  const updateCompaction = useUpdateCompaction();

  const [reserveFloor, setReserveFloor] = useState(10000);
  const [softThreshold, setSoftThreshold] = useState(180000);
  const [flushEnabled, setFlushEnabled] = useState(true);
  const [flushPrompt, setFlushPrompt] = useState('');
  const [saveStatus, setSaveStatus] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (data?.compaction) {
      const { compaction } = data;
      setReserveFloor(compaction.reserveTokensFloor || 10000);
      setSoftThreshold(compaction.memoryFlush?.softThresholdTokens || 180000);
      setFlushEnabled(compaction.memoryFlush?.enabled !== false);
      setFlushPrompt(compaction.memoryFlush?.prompt || '');
    }
  }, [data]);

  const handleSave = () => {
    updateCompaction.mutate(
      {
        reserveTokensFloor: reserveFloor,
        memoryFlush: {
          enabled: flushEnabled,
          softThresholdTokens: softThreshold,
          prompt: flushPrompt,
        },
      },
      {
        onSuccess: () => {
          setSaveStatus({ message: 'Settings saved successfully', type: 'success' });
          setTimeout(() => setSaveStatus(null), 3000);
        },
        onError: (err: Error) => {
          setSaveStatus({ message: `Error: ${err.message}`, type: 'error' });
          setTimeout(() => setSaveStatus(null), 5000);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>💾 Compaction Settings</CardHeader>
        <CardContent><LoadingText /></CardContent>
      </Card>
    );
  }

  if (error || data?.error) {
    return (
      <Card>
        <CardHeader>💾 Compaction Settings</CardHeader>
        <CardContent>
          <div className="text-red text-sm">
            ❌ {data?.error || 'Failed to load compaction settings'}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>💾 Compaction Settings</CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text">
              Reserve Tokens Floor
            </label>
            <input
              type="number"
              value={reserveFloor}
              onChange={(e) => setReserveFloor(Number(e.target.value))}
              min={1000}
              max={50000}
              step={1000}
              className="w-full bg-bg-3 border border-border rounded px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />
            <span className="text-xs text-text-2">Minimum tokens always kept free</span>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-text">
              Soft Threshold (Tokens)
            </label>
            <input
              type="number"
              value={softThreshold}
              onChange={(e) => setSoftThreshold(Number(e.target.value))}
              min={100000}
              max={200000}
              step={5000}
              className="w-full bg-bg-3 border border-border rounded px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />
            <span className="text-xs text-text-2">
              Trigger flush when context reaches this size
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="flush-enabled"
              checked={flushEnabled}
              onChange={(e) => setFlushEnabled(e.target.checked)}
              className="rounded border-border"
            />
            <label htmlFor="flush-enabled" className="text-sm text-text-2">
              Enable automatic memory flush
            </label>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-text">Flush Prompt</label>
            <textarea
              value={flushPrompt}
              onChange={(e) => setFlushPrompt(e.target.value)}
              rows={4}
              className="w-full bg-bg-3 border border-border rounded px-3 py-2 text-sm text-text font-mono resize-y outline-none focus:border-accent"
            />
            <span className="text-xs text-text-2">
              Instruction sent to agent when triggering flush
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={updateCompaction.isPending}>
              {updateCompaction.isPending ? 'Saving...' : '💾 Save Settings'}
            </Button>
            {saveStatus && (
              <span
                className={`text-sm ${
                  saveStatus.type === 'success' ? 'text-green' : 'text-red'
                }`}
              >
                {saveStatus.message}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
