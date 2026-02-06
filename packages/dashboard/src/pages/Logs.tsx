import { Card, CardHeader, CardContent } from '@/components/ui';

export function Logs() {
  return (
    <div className="max-w-[1400px] mx-auto p-6 flex flex-col gap-6">
      <Card>
        <CardHeader>📋 System Logs</CardHeader>
        <CardContent>
          <div className="text-text-2 text-sm">
            Log viewer - Coming soon
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>📦 Package Health</CardHeader>
        <CardContent>
          <div className="text-text-2 text-sm">
            Package health grid - Coming soon
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
