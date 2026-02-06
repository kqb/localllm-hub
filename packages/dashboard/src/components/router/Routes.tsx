import { useState } from 'react';
import { useRoutes, useTestRoute } from '@/api/queries';
import { Card, CardHeader, CardContent, LoadingText, Badge, Button } from '@/components/ui';

const tierColors: Record<string, 'purple' | 'orange' | 'blue' | 'green' | 'yellow'> = {
  S1: 'purple',
  S2: 'orange',
  A: 'blue',
  B: 'green',
  C: 'yellow',
};

const routeColors: Record<string, string> = {
  gemini_3_pro: 'purple',
  claude_opus: 'orange',
  claude_sonnet: 'blue',
  claude_haiku: 'green',
  local_qwen: 'yellow',
};

export function Routes() {
  const { data, isLoading, error } = useRoutes();
  const testRoute = useTestRoute();
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<any>(null);

  const handleTestRoute = async () => {
    if (!testInput.trim()) return;
    try {
      const result = await testRoute.mutateAsync(testInput);
      setTestResult(result);
    } catch (err) {
      setTestResult({ error: (err as Error).message });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTestRoute();
    }
  };

  if (isLoading) return (
    <Card>
      <CardHeader>🚦 Route Switcher</CardHeader>
      <CardContent><LoadingText /></CardContent>
    </Card>
  );

  if (error) return (
    <Card>
      <CardHeader>🚦 Route Switcher</CardHeader>
      <CardContent>
        <div className="text-red text-sm">Failed to load routes</div>
      </CardContent>
    </Card>
  );

  const tiers = data?.tiers || [];

  return (
    <Card>
      <CardHeader>🚦 Route Switcher</CardHeader>
      <CardContent>
        {/* 5-Tier Table */}
        <div className="overflow-x-auto mb-4">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs uppercase tracking-wide text-text-2 py-2 px-2">Tier</th>
                <th className="text-left text-xs uppercase tracking-wide text-text-2 py-2 px-2">Model</th>
                <th className="text-left text-xs uppercase tracking-wide text-text-2 py-2 px-2">Role</th>
                <th className="text-left text-xs uppercase tracking-wide text-text-2 py-2 px-2">Best Use Case</th>
                <th className="text-left text-xs uppercase tracking-wide text-text-2 py-2 px-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier: any, i: number) => (
                <tr key={i} className="border-b border-border last:border-b-0">
                  <td className="py-2 px-2">
                    <Badge variant={tierColors[tier.tier] || 'blue'}>
                      {tier.tier}
                    </Badge>
                  </td>
                  <td className="py-2 px-2 font-semibold">{tier.model}</td>
                  <td className="py-2 px-2">{tier.role}</td>
                  <td className="py-2 px-2 text-xs text-text-2">{tier.use}</td>
                  <td className="py-2 px-2">{tier.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Router Model */}
        <div className="text-xs text-text-2 mb-3">
          Router model: <Badge variant="blue">{data?.routerModel || '?'}</Badge>
        </div>

        {/* Test Panel */}
        <div>
          <h3 className="text-base font-semibold mb-2">Test Routing</h3>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a prompt to test routing..."
              className="flex-1 bg-bg-3 border border-border rounded px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />
            <Button onClick={handleTestRoute} disabled={testRoute.isPending}>
              {testRoute.isPending ? 'Routing...' : 'Route'}
            </Button>
          </div>

          {/* Test Result */}
          {testResult && (
            <div className="bg-bg-3 rounded p-3 font-mono text-sm">
              {testResult.error ? (
                <div className="text-red">{testResult.error}</div>
              ) : (
                <div>
                  <div className="mb-2 flex gap-2">
                    <Badge
                      variant={routeColors[testResult.route] as any || 'blue'}
                      className="text-sm px-3"
                    >
                      {testResult.route}
                    </Badge>
                    <Badge
                      variant={
                        testResult.priority === 'high' ? 'red' :
                        testResult.priority === 'low' ? 'green' : 'yellow'
                      }
                    >
                      {testResult.priority}
                    </Badge>
                  </div>
                  <div className="text-text-2">{testResult.reason}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
