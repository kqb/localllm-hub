import { Card, CardHeader, CardContent, LoadingText, Badge } from '@/components/ui';
import { usePipelines } from '@/api/queries';
import type { BadgeVariant } from '@/types';

export function PipelinesCard() {
  const { data, isLoading, error } = usePipelines();

  const getPipelineIcon = (name: string): string => {
    if (name === 'email-triage') return '📧';
    if (name === 'voice-memo') return '🎤';
    return '⚡';
  };

  const getSuccessRateBadge = (rate: string): BadgeVariant => {
    const numRate = parseFloat(rate);
    if (numRate >= 90) return 'green';
    if (numRate >= 70) return 'yellow';
    return 'red';
  };

  return (
    <Card>
      <CardHeader>⚡ Pipelines</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && (
          <div className="text-red text-sm">Failed to load pipelines</div>
        )}
        {data && Object.keys(data).length === 0 && (
          <div className="text-center py-6 text-text-2 text-sm">
            No pipeline runs yet
          </div>
        )}
        {data && Object.keys(data).length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(data).map(([name, stats]) => (
              <div key={name} className="bg-bg3 border border-border rounded-lg p-4">
                <h3 className="text-sm font-semibold mb-2">
                  {getPipelineIcon(name)} {name}
                </h3>
                <div className="space-y-2">
                  <div className="flex justify-between py-1.5 border-b border-border text-sm">
                    <span className="text-text-2">Total Runs</span>
                    <span>{stats.total}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-border text-sm">
                    <span className="text-text-2">Successful</span>
                    <Badge variant="green">{stats.successful}</Badge>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-border text-sm">
                    <span className="text-text-2">Failed</span>
                    <Badge variant={stats.failed > 0 ? 'red' : 'green'}>{stats.failed}</Badge>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-border text-sm">
                    <span className="text-text-2">Success Rate</span>
                    <Badge variant={getSuccessRateBadge(stats.successRate)}>
                      {stats.successRate}%
                    </Badge>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-border text-sm">
                    <span className="text-text-2">Avg Duration</span>
                    <span>{stats.avgDuration}ms</span>
                  </div>
                  <div className="flex justify-between py-1.5 text-sm">
                    <span className="text-text-2">Last Run</span>
                    <span className="text-xs">
                      {new Date(stats.lastRun).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
