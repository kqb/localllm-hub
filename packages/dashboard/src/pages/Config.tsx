import { useState } from 'react';
import { Card, CardHeader, CardContent, LoadingText, Button } from '@/components/ui';
import {
  useClawdbotConfig,
  useUpdateClawdbotConfig,
  useMemoryConfig,
  useUpdateMemoryConfig,
} from '@/api/queries';

export function Config() {
  return (
    <div className="max-w-[1400px] mx-auto p-6 flex flex-col gap-6">
      <ClawdbotConfigCard />
      <MemoryConfigCard />
    </div>
  );
}

function ClawdbotConfigCard() {
  const { data, isLoading, error } = useClawdbotConfig();
  const updateConfig = useUpdateClawdbotConfig();
  const [editedConfig, setEditedConfig] = useState<string>('');
  const [editing, setEditing] = useState(false);

  const handleEdit = () => {
    if (data) {
      setEditedConfig(JSON.stringify(data, null, 2));
      setEditing(true);
    }
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(editedConfig);
      updateConfig.mutate(parsed, {
        onSuccess: () => {
          setEditing(false);
        },
      });
    } catch (err) {
      alert('Invalid JSON');
    }
  };

  return (
    <Card>
      <CardHeader>⚙️ Clawdbot Configuration</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && <div className="text-red text-sm">Failed to load config</div>}
        {data && !editing && (
          <div>
            <pre className="bg-bg-3 border border-border rounded p-3 text-xs overflow-auto max-h-96 scrollbar-thin">
              {JSON.stringify(data, null, 2)}
            </pre>
            <Button onClick={handleEdit} className="mt-3">
              Edit Config
            </Button>
          </div>
        )}
        {editing && (
          <div>
            <textarea
              value={editedConfig}
              onChange={(e) => setEditedConfig(e.target.value)}
              className="w-full h-96 bg-bg-3 border border-border rounded p-3 text-xs font-mono text-text resize-none scrollbar-thin"
            />
            <div className="flex gap-2 mt-3">
              <Button onClick={handleSave} disabled={updateConfig.isPending}>
                {updateConfig.isPending ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MemoryConfigCard() {
  const { data, isLoading, error } = useMemoryConfig();
  const updateConfig = useUpdateMemoryConfig();
  const [editedConfig, setEditedConfig] = useState<string>('');
  const [editing, setEditing] = useState(false);

  const handleEdit = () => {
    if (data) {
      setEditedConfig(JSON.stringify(data, null, 2));
      setEditing(true);
    }
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(editedConfig);
      updateConfig.mutate(parsed, {
        onSuccess: () => {
          setEditing(false);
        },
      });
    } catch (err) {
      alert('Invalid JSON');
    }
  };

  return (
    <Card>
      <CardHeader>🧠 Memory Configuration</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && <div className="text-red text-sm">Failed to load config</div>}
        {data && !editing && (
          <div>
            <pre className="bg-bg-3 border border-border rounded p-3 text-xs overflow-auto max-h-96 scrollbar-thin">
              {JSON.stringify(data, null, 2)}
            </pre>
            <Button onClick={handleEdit} className="mt-3">
              Edit Config
            </Button>
          </div>
        )}
        {editing && (
          <div>
            <textarea
              value={editedConfig}
              onChange={(e) => setEditedConfig(e.target.value)}
              className="w-full h-96 bg-bg-3 border border-border rounded p-3 text-xs font-mono text-text resize-none scrollbar-thin"
            />
            <div className="flex gap-2 mt-3">
              <Button onClick={handleSave} disabled={updateConfig.isPending}>
                {updateConfig.isPending ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
