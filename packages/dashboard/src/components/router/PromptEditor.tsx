import { useState, useEffect } from 'react';
import { useRouterPrompt, useUpdateRouterPrompt, useTestRoute } from '@/api/queries';
import { Card, CardHeader, CardContent, LoadingText, Button, Badge } from '@/components/ui';

export function PromptEditor() {
  const { data, isLoading, error } = useRouterPrompt();
  const updatePrompt = useUpdateRouterPrompt();
  const testRoute = useTestRoute();

  const [promptText, setPromptText] = useState('');
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (data?.content) {
      setPromptText(data.content);
    }
  }, [data]);

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      await updatePrompt.mutateAsync(promptText);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleTest = async () => {
    if (!testInput.trim()) return;
    try {
      const result = await testRoute.mutateAsync(testInput);
      setTestResult(result);
    } catch (err) {
      setTestResult({ error: (err as Error).message });
    }
  };

  if (isLoading) return (
    <Card>
      <CardHeader>🧭 Router Prompt Editor</CardHeader>
      <CardContent><LoadingText /></CardContent>
    </Card>
  );

  if (error || data?.error) return (
    <Card>
      <CardHeader>🧭 Router Prompt Editor</CardHeader>
      <CardContent>
        <div className="text-red text-sm">
          {error?.message || data?.error || 'Failed to load prompt'}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader>🧭 Router Prompt Editor</CardHeader>
      <CardContent>
        {/* Prompt Textarea */}
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          className="w-full h-64 bg-bg-3 border border-border rounded p-3 text-sm font-mono text-text resize-none mb-3"
          placeholder="Enter router prompt template..."
        />

        {/* Save Button and Status */}
        <div className="flex items-center gap-3 mb-4">
          <Button
            onClick={handleSave}
            disabled={updatePrompt.isPending || saveStatus === 'saving'}
          >
            💾 {saveStatus === 'saving' ? 'Saving...' : 'Save Prompt'}
          </Button>
          {saveStatus === 'success' && (
            <Badge variant="green">✓ Saved</Badge>
          )}
          {saveStatus === 'error' && (
            <Badge variant="red">❌ Failed to save</Badge>
          )}
        </div>

        {/* Test Section */}
        <div className="border-t border-border pt-4">
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTest()}
              placeholder="Enter a test query..."
              className="flex-1 bg-bg-3 border border-border rounded px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testRoute.isPending}
            >
              🧪 Test Router
            </Button>
          </div>

          {/* Test Result */}
          {testResult && (
            <div className="bg-bg-3 rounded p-3 font-mono text-sm">
              {testResult.error ? (
                <div className="text-red">{testResult.error}</div>
              ) : (
                <div>
                  <div className="mb-2">
                    <span className="text-text-2">Route: </span>
                    <span className="font-bold">{testResult.route}</span>
                  </div>
                  <div className="mb-2">
                    <span className="text-text-2">Priority: </span>
                    <Badge
                      variant={
                        testResult.priority === 'high' ? 'red' :
                        testResult.priority === 'low' ? 'green' : 'yellow'
                      }
                    >
                      {testResult.priority}
                    </Badge>
                  </div>
                  <div>
                    <strong>Reason:</strong>
                    <div className="text-text-2 mt-1">{testResult.reason}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
