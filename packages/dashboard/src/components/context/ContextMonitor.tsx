import { Card, CardHeader, CardContent, LoadingText, Badge } from '@/components/ui';
import { useContextMonitor } from '@/api/queries';
import { cn } from '@/utils/cn';

export function ContextMonitor() {
  const { data, isLoading, error } = useContextMonitor();

  const getProgressColor = (percentage: number) => {
    if (percentage >= 90) return 'bg-red';
    if (percentage >= 75) return 'bg-yellow';
    return 'bg-green';
  };

  const getStatusBadge = (percentage: number) => {
    if (percentage >= 90) return <Badge variant="red">Critical</Badge>;
    if (percentage >= 75) return <Badge variant="yellow">Warning</Badge>;
    return <Badge variant="green">Healthy</Badge>;
  };

  return (
    <Card>
      <CardHeader>📊 Context Monitor</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && <div className="text-red text-sm">Failed to load context data</div>}
        {data && (
          <div className="flex flex-col gap-4">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-text-2">
                  {data.total_tokens.toLocaleString()} / {data.limit.toLocaleString()} tokens
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{data.percentage.toFixed(1)}%</span>
                  {getStatusBadge(data.percentage)}
                </div>
              </div>
              <div className="w-full h-4 bg-bg rounded overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all duration-300',
                    getProgressColor(data.percentage)
                  )}
                  style={{ width: `${data.percentage}%` }}
                />
              </div>
            </div>

            {/* File breakdown */}
            {data.files && data.files.length > 0 && (
              <div className="border-t border-border pt-3">
                <h3 className="text-xs text-text-2 uppercase tracking-wide mb-2">
                  Top Files by Token Cost
                </h3>
                <div className="flex flex-col gap-1.5">
                  {data.files.slice(0, 5).map((file, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-text-2 truncate flex-1">
                        {file.path.split('/').pop()}
                      </span>
                      <span className="text-text font-mono ml-2">
                        {file.tokens.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
