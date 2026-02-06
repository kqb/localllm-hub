import { Card, CardHeader, CardContent, LoadingText } from '@/components/ui';
import { useEconomics } from '@/hooks/useEconomics';

export function EconomicsCard() {
  const { data, isLoading, error } = useEconomics();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>💰 Token Economics</CardHeader>
        <CardContent><LoadingText /></CardContent>
      </Card>
    );
  }

  if (error || data?.error) {
    return (
      <Card>
        <CardHeader>💰 Token Economics</CardHeader>
        <CardContent>
          <div className="text-red text-sm">
            {data?.error || 'Failed to load economics data'}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const models = Object.entries(data.models || {});

  if (models.length === 0) {
    return (
      <Card>
        <CardHeader>💰 Token Economics</CardHeader>
        <CardContent>
          <div className="text-text-2 text-sm">No token usage data yet</div>
        </CardContent>
      </Card>
    );
  }

  let totalInput = 0;
  let totalOutput = 0;
  for (const [, stats] of models) {
    totalInput += stats.inputTokens;
    totalOutput += stats.outputTokens;
  }

  const sorted = models.sort(
    (a, b) =>
      b[1].inputTokens + b[1].outputTokens - (a[1].inputTokens + a[1].outputTokens)
  );

  return (
    <Card>
      <CardHeader>💰 Token Economics</CardHeader>
      <CardContent>
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="space-y-1">
            <div className="text-xs text-text-2">Sessions</div>
            <div className="text-lg font-semibold">{data.sessions || 0}</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-text-2">Total Input</div>
            <div className="text-lg font-semibold">
              {(totalInput / 1000000).toFixed(2)}M
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-text-2">Total Output</div>
            <div className="text-lg font-semibold">
              {(totalOutput / 1000000).toFixed(2)}M
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-text-2">Est. API Cost</div>
            <div className="text-lg font-semibold text-red">
              ${(data.totalEstimatedCost || 0).toFixed(2)}
            </div>
          </div>
        </div>

        <div className="mb-4 p-3 bg-green/10 border border-green/20 rounded">
          <div className="text-sm font-semibold text-green">
            Actual Cost: $0 (Max Subscription)
          </div>
        </div>

        {/* Per-Model Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 text-text-2 font-medium">Model</th>
                <th className="text-left py-2 px-3 text-text-2 font-medium">Messages</th>
                <th className="text-left py-2 px-3 text-text-2 font-medium">
                  Input Tokens
                </th>
                <th className="text-left py-2 px-3 text-text-2 font-medium">
                  Output Tokens
                </th>
                <th className="text-left py-2 px-3 text-text-2 font-medium">
                  Est. API Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(([model, stats]) => (
                <tr key={model} className="border-b border-border last:border-b-0">
                  <td className="py-2 px-3 font-semibold">{model}</td>
                  <td className="py-2 px-3">{stats.messageCount.toLocaleString()}</td>
                  <td className="py-2 px-3">{stats.inputTokens.toLocaleString()}</td>
                  <td className="py-2 px-3">{stats.outputTokens.toLocaleString()}</td>
                  <td className="py-2 px-3">
                    {stats.estimatedCost != null
                      ? `$${stats.estimatedCost.toFixed(2)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data.note && (
          <div className="mt-3 text-xs text-text-2">{data.note}</div>
        )}
      </CardContent>
    </Card>
  );
}
