import { useRouterHealth } from '@/api/queries';
import { Card, CardHeader, CardContent, LoadingText, Badge } from '@/components/ui';

export function RouterHealth() {
  const { data, isLoading, error } = useRouterHealth();

  if (isLoading) return (
    <Card>
      <CardHeader>🎯 Router Health</CardHeader>
      <CardContent><LoadingText /></CardContent>
    </Card>
  );

  if (error || data?.error) return (
    <Card>
      <CardHeader>🎯 Router Health</CardHeader>
      <CardContent>
        <div className="text-red text-sm">
          {error?.message || data?.error || 'Failed to load router health'}
        </div>
      </CardContent>
    </Card>
  );

  const overrideNum = parseFloat(data.overrideRate) || 0;
  const overrideClass = overrideNum < 1 ? 'text-green' : overrideNum < 5 ? 'text-yellow' : 'text-red';

  return (
    <Card>
      <CardHeader>🎯 Router Health</CardHeader>
      <CardContent>
        {/* Override Rate Metric */}
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-text-2 mb-1">Override Rate</div>
          <div className={`text-2xl font-bold ${overrideClass}`}>{data.overrideRate}</div>
          <div className="text-xs text-text-2 mt-1">Target: &lt; 1%</div>
        </div>

        {/* Auto-Escalations Metric */}
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-text-2 mb-1">Auto-Escalations</div>
          <div className="text-2xl font-bold">{data.autoEscalations || 0}</div>
        </div>

        {/* Model Distribution */}
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-text-2 mb-2">Model Distribution</div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(data.modelDistribution || {}).map(([model, pct]) => {
              const short = model.replace('claude_', '').toUpperCase().slice(0, 1);
              return (
                <Badge key={model} variant="blue" title={model}>
                  {short}: {pct as string}
                </Badge>
              );
            })}
          </div>
        </div>

        {/* Mini Chart */}
        {data.timeline && data.timeline.length > 0 && (
          <div className="flex gap-0.5 items-end h-16">
            {data.timeline.map((day: any, i: number) => {
              const maxVal = Math.max(
                ...data.timeline.map((t: any) => (t.overrides || 0) + (t.escalations || 0)),
                1
              );
              const height = Math.max(2, ((day.overrides + day.escalations) / maxVal) * 100);
              return (
                <div
                  key={i}
                  className="flex-1 bg-accent opacity-60 rounded-t"
                  style={{ height: `${height}%` }}
                  title={`${day.date}: ${day.overrides} overrides, ${day.escalations} escalations`}
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
