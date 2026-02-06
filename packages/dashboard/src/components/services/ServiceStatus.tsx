import { StatusDot, Badge } from '@/components/ui';
import type { ServiceStatus as ServiceStatusType } from '@/types';

interface ServiceStatusProps {
  status: ServiceStatusType;
}

export function ServiceStatus({ status }: ServiceStatusProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between py-1.5 border-b border-border text-sm">
        <span className="text-text-2">Ollama</span>
        <div className="flex items-center gap-2">
          <StatusDot status={status.ollama.healthy ? 'ok' : 'error'} />
          <Badge variant={status.ollama.healthy ? 'green' : 'red'}>
            {status.ollama.healthy ? 'Healthy' : 'Error'}
          </Badge>
        </div>
      </div>

      <div className="flex items-center justify-between py-1.5 border-b border-border text-sm">
        <span className="text-text-2">Whisper</span>
        <div className="flex items-center gap-2">
          <StatusDot status={status.whisper.found ? 'ok' : 'error'} />
          <Badge variant={status.whisper.found ? 'green' : 'red'}>
            {status.whisper.found ? 'Found' : 'Not Found'}
          </Badge>
        </div>
      </div>

      {status.databases.map((db) => (
        <div
          key={db.label}
          className="flex items-center justify-between py-1.5 text-sm last:border-b-0 border-b border-border"
        >
          <span className="text-text-2">{db.label}</span>
          <div className="flex items-center gap-2">
            <StatusDot status={db.exists && !db.error ? 'ok' : 'error'} />
            <Badge variant={db.exists && !db.error ? 'green' : 'red'}>
              {db.exists && !db.error ? 'OK' : 'Error'}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}
