import { useState } from 'react';
import { Card, CardHeader, CardContent, LoadingText, Button } from '@/components/ui';
import { useMemory, useMemoryConfig, useUpdateMemoryConfig } from '@/api/queries';

export function MemoryConfig() {
  const { data: memoryData, isLoading: memoryLoading } = useMemory();
  const { data: configData, isLoading: configLoading } = useMemoryConfig();
  const updateConfig = useUpdateMemoryConfig();
  const [saving, setSaving] = useState(false);

  const isLoading = memoryLoading || configLoading;

  const handleSave = async () => {
    setSaving(true);
    try {
      // In a real implementation, collect form values and save
      await updateConfig.mutateAsync(configData);
    } catch (error) {
      console.error('Failed to save config:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>🧠 Memory Configuration</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {(memoryData || configData) && (
          <div className="flex flex-col gap-4">
            {/* Pipeline Sources */}
            {memoryData?.pipeline && (
              <div>
                <h3 className="text-sm font-semibold mb-2">📊 Pipeline</h3>
                <div className="bg-bg rounded p-3 space-y-2">
                  <div className="text-xs text-text-2 mb-2">
                    Sources → Chunking → Embedding → SQLite
                  </div>
                  {memoryData.pipeline.sources.map((source: any, idx: number) => (
                    <div key={idx} className="flex justify-between items-center py-1.5 border-b border-border last:border-b-0">
                      <span className="text-text-2 text-sm">{source.name}</span>
                      <span className="text-xs text-text-2">{source.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Embedding Config */}
            {configData?.active && (
              <div>
                <h3 className="text-sm font-semibold mb-2">⚙️ Embedding Config</h3>
                <div className="bg-bg rounded p-3 space-y-2">
                  <ConfigRow label="Embed Model" value={configData.active.models?.embed} />
                  <ConfigRow label="Dimensions" value={configData.active.embedding?.dimension} />
                  <ConfigRow label="Chunk Size" value={`${configData.active.embedding?.chunkSize} chars`} />
                  <ConfigRow label="Chunk Overlap" value={`${configData.active.embedding?.chunkOverlap} chars`} />
                </div>
              </div>
            )}

            {/* Models Config */}
            {configData?.active?.models && (
              <div>
                <h3 className="text-sm font-semibold mb-2">🤖 Models</h3>
                <div className="bg-bg rounded p-3 space-y-2">
                  <ConfigRow label="Triage" value={configData.active.models.triage} />
                  <ConfigRow label="Code" value={configData.active.models.code} />
                  <ConfigRow label="Reasoning" value={configData.active.models.reasoning} />
                  <ConfigRow label="Embed Fast" value={configData.active.models.embedFast} />
                </div>
              </div>
            )}

            {/* Save Button */}
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>
                💾 {saving ? 'Saving...' : 'Save Config'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ConfigRowProps {
  label: string;
  value: any;
}

function ConfigRow({ label, value }: ConfigRowProps) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border last:border-b-0">
      <span className="text-text-2 text-sm">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
