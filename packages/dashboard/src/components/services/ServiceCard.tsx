import { Card, CardHeader, CardContent, LoadingText } from '@/components/ui';
import { useServiceStatus } from '@/api/queries';
import { ServiceStatus } from './ServiceStatus';

export function ServiceCard() {
  const { data, isLoading, error } = useServiceStatus();

  return (
    <Card>
      <CardHeader>⚡ Service Status</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && (
          <div className="text-red text-sm">Failed to load service status</div>
        )}
        {data && <ServiceStatus status={data} />}
      </CardContent>
    </Card>
  );
}
