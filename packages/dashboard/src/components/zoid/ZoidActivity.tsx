import { Card, CardHeader, CardContent, LoadingText, Badge } from '@/components/ui';
import { useZoidActivity } from '@/api/queries';

const ACTION_COLORS: Record<string, 'green' | 'yellow' | 'red' | 'purple' | 'blue'> = {
  check: 'blue',
  assess: 'yellow',
  nudge: 'purple',
  kill: 'red',
  spawn: 'green',
  suppress: 'yellow',
};

export function ZoidActivity() {
  const { data, isLoading, error } = useZoidActivity();

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <Card>
      <CardHeader>🦑 Zoid Activity Log</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && <div className="text-red text-sm">Failed to load activity log</div>}
        {data && data.length === 0 && (
          <div className="text-text-2 text-sm text-center py-6">
            No recent activity
          </div>
        )}
        {data && data.length > 0 && (
          <div className="flex flex-col gap-2 max-h-96 overflow-y-auto scrollbar-thin">
            {data.slice(0, 20).map((activity: any, i: number) => (
              <div
                key={i}
                className="flex items-start gap-3 py-2 border-b border-border last:border-b-0"
              >
                <Badge variant={ACTION_COLORS[activity.action] || 'blue'}>
                  {activity.action}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {activity.session}
                  </div>
                  {activity.details && (
                    <div className="text-xs text-text-2 mt-0.5">
                      {activity.details}
                    </div>
                  )}
                </div>
                <div className="text-xs text-text-2 whitespace-nowrap">
                  {formatTime(activity.timestamp)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
