import { useTrustScore } from '@/api/queries';
import { Card, CardHeader, CardContent, LoadingText } from '@/components/ui';
import { cn } from '@/utils/cn';

export function TrustScore() {
  const { data, isLoading, error } = useTrustScore();

  if (isLoading) return (
    <Card>
      <CardHeader>🤝 Trust Score</CardHeader>
      <CardContent><LoadingText /></CardContent>
    </Card>
  );

  if (error || data?.error) return (
    <Card>
      <CardHeader>🤝 Trust Score</CardHeader>
      <CardContent>
        <div className="text-red text-sm">
          {error?.message || data?.error || 'Failed to load trust score'}
        </div>
      </CardContent>
    </Card>
  );

  const score = data.score || 0;
  const scoreClass =
    score >= 70 ? 'text-green' :
    score >= 50 ? 'text-yellow' : 'text-red';

  const trendIcon =
    data.trend === 'improving' ? '📈' :
    data.trend === 'declining' ? '📉' : '➡️';

  return (
    <Card>
      <CardHeader>🤝 Trust Score</CardHeader>
      <CardContent>
        {/* Trust Gauge */}
        <div className="flex items-center gap-2 mb-6">
          <span className={cn("text-5xl font-bold", scoreClass)}>
            {score}
          </span>
          <span className="text-2xl">{trendIcon}</span>
        </div>

        {/* Factor Bars */}
        <div className="flex flex-col gap-3 mb-4">
          {Object.entries(data.factors || {}).map(([factor, value]) => {
            const pct = Math.min(100, Math.max(0, value as number));
            const color =
              pct >= 70 ? 'bg-green' :
              pct >= 50 ? 'bg-yellow' : 'bg-red';

            // Convert camelCase to Title Case
            const label = factor.replace(/([A-Z])/g, ' $1').trim();

            return (
              <div key={factor} className="flex items-center gap-3">
                <div className="text-xs text-text-2 w-24 flex-shrink-0">
                  {label}
                </div>
                <div className="flex-1 h-4 bg-bg-3 rounded overflow-hidden">
                  <div
                    className={cn("h-full transition-all duration-300", color)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-xs font-semibold w-8 text-right">
                  {pct}
                </div>
              </div>
            );
          })}
        </div>

        {/* Recent Events */}
        {data.recentEvents && data.recentEvents.length > 0 && (
          <div className="border-t border-border pt-4">
            <div className="text-xs uppercase tracking-wide text-text-2 mb-2">
              Recent Events
            </div>
            <div className="flex flex-col gap-2">
              {data.recentEvents.slice(0, 5).map((ev: any, i: number) => {
                const icon =
                  ev.type === 'manual_override' ? '⚠️' :
                  ev.type === 'memory_miss' ? '🧠' : '✓';

                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs p-2 bg-bg-3 rounded"
                  >
                    <span className="text-base">{icon}</span>
                    <span className="font-medium">
                      {ev.type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-text-2 flex-1 truncate">
                      {ev.detail || ''}
                    </span>
                    <span className="text-text-2 flex-shrink-0">
                      {ev.date || ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
