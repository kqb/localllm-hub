import { Card, CardHeader, CardContent, LoadingText, Badge, Button } from '@/components/ui';
import { useCron, useRunCronJob } from '@/api/queries';

export function CronCard() {
  const { data, isLoading, error } = useCron();
  const runCronJob = useRunCronJob();

  const handleRunJob = (id: string) => {
    runCronJob.mutate(id);
  };

  return (
    <Card>
      <CardHeader>⏰ Cron Manager</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && (
          <div className="text-red text-sm">Clawdbot CLI not available or no cron jobs configured</div>
        )}
        {data && data.length === 0 && (
          <div className="text-center py-6 text-text-2 text-sm">
            No cron jobs found
          </div>
        )}
        {data && data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2 font-semibold text-text-2">ID</th>
                  <th className="text-left py-2 px-2 font-semibold text-text-2">Schedule</th>
                  <th className="text-left py-2 px-2 font-semibold text-text-2">Text</th>
                  <th className="text-left py-2 px-2 font-semibold text-text-2">Enabled</th>
                  <th className="text-left py-2 px-2 font-semibold text-text-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.map((job) => {
                  const id = job.id || job.name || '?';
                  const schedule = job.schedule || job.cron || job.interval || '—';
                  const text = job.text || job.command || job.description || '—';
                  const enabled = job.enabled !== false;

                  return (
                    <tr key={id} className="border-b border-border last:border-b-0">
                      <td className="py-2 px-2 font-mono text-xs">{id}</td>
                      <td className="py-2 px-2">
                        <code className="bg-bg3 px-2 py-1 rounded text-xs">{schedule}</code>
                      </td>
                      <td className="py-2 px-2 max-w-[200px] truncate" title={text}>
                        {text.slice(0, 100)}
                      </td>
                      <td className="py-2 px-2">
                        <Badge variant={enabled ? 'green' : 'red'}>
                          {enabled ? 'yes' : 'no'}
                        </Badge>
                      </td>
                      <td className="py-2 px-2">
                        <Button
                          size="sm"
                          onClick={() => handleRunJob(id)}
                          disabled={runCronJob.isPending}
                        >
                          Run
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
