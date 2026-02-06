import { useState } from 'react';
import { Card, CardHeader, CardContent, LoadingText, Badge, StatusDot, Button } from '@/components/ui';
import { useDaemons, useDaemonLogs, useRestartDaemon } from '@/api/queries';
import { cn } from '@/utils/cn';

export function DaemonsCard() {
  const { data: daemons, isLoading, error } = useDaemons();
  const restartMutation = useRestartDaemon();
  const [expandedLogs, setExpandedLogs] = useState<{ label: string; src: 'out' | 'err' } | null>(null);

  const handleToggleLogs = (label: string, src: 'out' | 'err') => {
    if (expandedLogs?.label === label && expandedLogs?.src === src) {
      setExpandedLogs(null);
    } else {
      setExpandedLogs({ label, src });
    }
  };

  const handleRestart = async (label: string) => {
    if (confirm(`Restart daemon ${label}?`)) {
      await restartMutation.mutateAsync(label);
    }
  };

  return (
    <Card>
      <CardHeader>🔄 Daemons</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && <div className="text-red text-sm">Failed to load daemons</div>}
        {daemons && (
          <>
            {daemons.length === 0 ? (
              <div className="text-text-2 text-sm text-center py-6">No daemons configured</div>
            ) : (
              <div className="flex flex-col gap-2">
                {daemons.map((daemon: any) => (
                  <DaemonItem
                    key={daemon.label}
                    daemon={daemon}
                    expandedLogs={expandedLogs}
                    onToggleLogs={handleToggleLogs}
                    onRestart={handleRestart}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface DaemonItemProps {
  daemon: {
    label: string;
    name: string;
    running: boolean;
    pid?: number;
  };
  expandedLogs: { label: string; src: 'out' | 'err' } | null;
  onToggleLogs: (label: string, src: 'out' | 'err') => void;
  onRestart: (label: string) => void;
}

function DaemonItem({ daemon, expandedLogs, onToggleLogs, onRestart }: DaemonItemProps) {
  const isStdoutExpanded = expandedLogs?.label === daemon.label && expandedLogs?.src === 'out';
  const isStderrExpanded = expandedLogs?.label === daemon.label && expandedLogs?.src === 'err';

  const { data: stdoutLogs } = useDaemonLogs(daemon.label, 'out', isStdoutExpanded);
  const { data: stderrLogs } = useDaemonLogs(daemon.label, 'err', isStderrExpanded);

  return (
    <div className="bg-bg rounded-lg border border-border p-3.5">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-2">
        <StatusDot status={daemon.running ? 'ok' : 'error'} />
        <span className="font-semibold text-sm flex-1">{daemon.name}</span>
        <Badge variant={daemon.running ? 'green' : 'red'}>
          {daemon.running ? `Running (PID ${daemon.pid})` : 'Stopped'}
        </Badge>
      </div>

      {/* Label */}
      <div className="text-xs text-text-2 mb-2">{daemon.label}</div>

      {/* Actions */}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onToggleLogs(daemon.label, 'out')}
        >
          📄 Stdout
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onToggleLogs(daemon.label, 'err')}
        >
          ⚠️ Stderr
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => onRestart(daemon.label)}
        >
          🔄 Restart
        </Button>
      </div>

      {/* Stdout Logs */}
      {isStdoutExpanded && (
        <div className="mt-2 bg-bg-2 rounded p-2 max-h-[300px] overflow-y-auto font-mono text-xs">
          {stdoutLogs && stdoutLogs.lines.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {stdoutLogs.lines.map((line: any, idx: number) => (
                <div
                  key={idx}
                  className={cn(
                    'border-b border-border/50 py-0.5',
                    line.text.includes('[chunk]') ? 'text-green' : 'text-text-2'
                  )}
                >
                  {line.text}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-text-2">No logs</div>
          )}
        </div>
      )}

      {/* Stderr Logs */}
      {isStderrExpanded && (
        <div className="mt-2 bg-bg-2 rounded p-2 max-h-[300px] overflow-y-auto font-mono text-xs">
          {stderrLogs && stderrLogs.lines.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {stderrLogs.lines.map((line: any, idx: number) => (
                <div
                  key={idx}
                  className={cn(
                    'border-b border-border/50 py-0.5',
                    line.text.includes('[ERROR]') ? 'text-red' : 'text-yellow'
                  )}
                >
                  {line.text}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-text-2">No logs</div>
          )}
        </div>
      )}
    </div>
  );
}
