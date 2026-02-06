import { useAlerts } from '@/api/queries';
import { Card, CardHeader, CardContent, LoadingText } from '@/components/ui';
import { cn } from '@/utils/cn';

export function Alerts() {
  const { data, isLoading, error } = useAlerts();

  if (isLoading) return (
    <Card>
      <CardHeader>🚨 Alert Configuration</CardHeader>
      <CardContent><LoadingText /></CardContent>
    </Card>
  );

  if (error) return (
    <Card>
      <CardHeader>🚨 Alert Configuration</CardHeader>
      <CardContent>
        <div className="text-red text-sm">Failed to load alerts</div>
      </CardContent>
    </Card>
  );

  const alerts = Array.isArray(data) ? data : [];

  if (alerts.length === 0) return (
    <Card>
      <CardHeader>🚨 Alert Configuration</CardHeader>
      <CardContent>
        <div className="text-text-2 text-sm">No alerts</div>
      </CardContent>
    </Card>
  );

  // Sort by severity: red > yellow > green
  const severityOrder = { red: 0, yellow: 1, green: 2 };
  const sortedAlerts = [...alerts].sort((a, b) => {
    const aOrder = severityOrder[a.severity as keyof typeof severityOrder] ?? 3;
    const bOrder = severityOrder[b.severity as keyof typeof severityOrder] ?? 3;
    return aOrder - bOrder;
  });

  return (
    <Card>
      <CardHeader>🚨 Alert Configuration</CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {sortedAlerts.map((alert: any, i: number) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 bg-bg-3 rounded border border-border"
            >
              {/* Severity Dot */}
              <span
                className={cn(
                  "w-2.5 h-2.5 rounded-full flex-shrink-0",
                  alert.severity === 'red' && "bg-red shadow-[0_0_6px_var(--red)]",
                  alert.severity === 'yellow' && "bg-yellow",
                  alert.severity === 'green' && "bg-green shadow-[0_0_6px_var(--green)]"
                )}
              />

              {/* Alert Content */}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{alert.title}</div>
                <div className="text-xs text-text-2">{alert.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
