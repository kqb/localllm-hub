import { Card, CardHeader, CardContent, LoadingText, Badge } from '@/components/ui';
import { useContextPipelineHookStatus, useContextPipelineActivity } from '@/api/queries';
import { cn } from '@/utils/cn';

export function ContextPipelineCard() {
  const { data: status, isLoading: statusLoading } = useContextPipelineHookStatus();
  const { data: activity, isLoading: activityLoading } = useContextPipelineActivity();

  const isLoading = statusLoading || activityLoading;

  const getStatusColor = () => {
    if (!status) return 'yellow';
    if (status.registered && status.callCount > 0) return 'green';
    if (status.registered) return 'yellow';
    return 'red';
  };

  const getStatusText = () => {
    if (!status) return 'Unknown';
    if (status.registered && status.callCount > 0) return 'Active';
    if (status.registered) return 'Registered (No calls yet)';
    return 'Inactive';
  };

  return (
    <Card>
      <CardHeader>🔗 Context Pipeline Hook</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}

        {/* WIP Warning */}
        <div className="bg-yellow/10 border border-yellow rounded p-3 mb-4">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="text-lg">⚠️</span>
            <div className="font-semibold text-yellow text-sm">Routing Disabled (WIP)</div>
          </div>
          <div className="text-xs text-text-2 leading-relaxed">
            Model routing is disabled due to accuracy issues. RAG and context enrichment still active.
            See <code className="bg-bg px-1.5 py-0.5 rounded text-xs font-mono">~/Projects/localllm-hub/ROUTING.md</code> for re-enable instructions.
          </div>
        </div>

        {/* Status */}
        {status && (
          <div className="space-y-2">
            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="text-text-2 text-sm">Status</span>
              <div className="flex items-center gap-2">
                <div className={cn('w-2 h-2 rounded-full', `bg-${getStatusColor()}`)} />
                <span className={`text-${getStatusColor()} text-sm`}>{getStatusText()}</span>
              </div>
            </div>

            {status.lastCall && (
              <div className="flex items-center justify-between py-1.5 border-b border-border">
                <span className="text-text-2 text-sm">Last Call</span>
                <span className="text-xs">{new Date(status.lastCall).toLocaleString()}</span>
              </div>
            )}

            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="text-text-2 text-sm">Total Calls</span>
              <span className="text-sm">{status.callCount || 0}</span>
            </div>
          </div>
        )}

        {/* Recent Activity */}
        {activity && activity.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs text-text-2 uppercase tracking-wide mb-2">Recent Activity</h3>
            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
              {activity.slice(0, 5).map((item: any, idx: number) => (
                <div key={idx} className="bg-bg border border-border rounded p-2">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-xs text-text-2">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                    {item.routeDecision && (
                      <Badge variant="blue" className="text-xs">
                        {item.routeDecision.route}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-text-2 truncate">
                    {item.query.truncated}
                  </div>
                  {item.ragContext && item.ragContext.count > 0 && (
                    <div className="text-xs text-green mt-1">
                      {item.ragContext.count} RAG results
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
