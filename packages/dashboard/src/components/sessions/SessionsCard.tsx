import { Card, CardHeader, CardContent, LoadingText } from '@/components/ui';
import { useSessions } from '@/api/queries';

export function SessionsCard() {
  const { data, isLoading, error } = useSessions();

  const formatSessionId = (sessionId: string): string => {
    if (sessionId.length > 20) {
      return `${sessionId.slice(0, 8)}...${sessionId.slice(-8)}`;
    }
    return sessionId;
  };

  return (
    <Card>
      <CardHeader>📂 Session Manager</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && (
          <div className="text-red text-sm">Failed to load sessions</div>
        )}
        {data && data.length === 0 && (
          <div className="text-center py-6 text-text-2 text-sm">
            No sessions found
          </div>
        )}
        {data && data.length > 0 && (
          <>
            <div className="mb-2 text-sm text-text-2">
              {data.length} sessions
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border sticky top-0 bg-bg2">
                    <th className="text-left py-2 px-2 font-semibold text-text-2">Session ID</th>
                    <th className="text-left py-2 px-2 font-semibold text-text-2">Size</th>
                    <th className="text-left py-2 px-2 font-semibold text-text-2">Est. Messages</th>
                    <th className="text-left py-2 px-2 font-semibold text-text-2">Last Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((session) => {
                    const sizeMB = (session.sizeBytes / (1024 * 1024)).toFixed(2);
                    const modified = new Date(session.lastModified).toLocaleString();

                    return (
                      <tr key={session.sessionId} className="border-b border-border last:border-b-0">
                        <td className="py-2 px-2">
                          <span
                            className="cursor-pointer text-accent hover:underline font-mono text-xs"
                            title={session.sessionId}
                          >
                            {formatSessionId(session.sessionId)}
                          </span>
                        </td>
                        <td className="py-2 px-2">{sizeMB} MB</td>
                        <td className="py-2 px-2">{session.estimatedMessages.toLocaleString()}</td>
                        <td className="py-2 px-2 text-xs">{modified}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
