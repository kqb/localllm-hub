import { Card, CardHeader, CardContent, LoadingText } from '@/components/ui';
import { useMemoryPerformance } from '@/api/queries';
import { cn } from '@/utils/cn';

export function MemoryPerformance() {
  const { data, isLoading, error } = useMemoryPerformance();

  const getMissRateClass = (missRate: string) => {
    const num = parseFloat(missRate);
    if (num < 10) return 'text-green';
    if (num < 20) return 'text-yellow';
    return 'text-red';
  };

  const getHerdingClass = (avg: string) => {
    const num = parseFloat(avg);
    if (num < 2) return 'text-green';
    if (num < 4) return 'text-yellow';
    return 'text-red';
  };

  return (
    <Card>
      <CardHeader>🧠 Memory Recall</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}
        {error && <div className="text-red text-sm">Failed to load memory performance</div>}
        {data && (
          <div className="flex flex-col gap-4">
            {/* Miss Rate */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-2 uppercase tracking-wide">Miss Rate</span>
              <span className={cn('text-2xl font-bold', getMissRateClass(data.missRate))}>
                {data.missRate}
              </span>
              <span className="text-xs text-text-2">Target: &lt; 10%</span>
            </div>

            {/* Herding Average */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-2 uppercase tracking-wide">Herding Avg</span>
              <span className={cn('text-2xl font-bold', getHerdingClass(data.herdingMessages?.avg))}>
                {data.herdingMessages?.avg || '0'}
              </span>
              <span className="text-xs text-text-2">Target: &lt; 2 messages</span>
            </div>

            {/* AVG RAG Score */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-2 uppercase tracking-wide">Avg RAG Score</span>
              <span className="text-2xl font-bold">{data.avgRAGScore}</span>
            </div>

            {/* Top Miss Categories */}
            {data.topMissCategories && data.topMissCategories.length > 0 && (
              <div className="border-t border-border pt-3">
                <div className="text-xs text-text-2 mb-2">Top Miss Categories:</div>
                <div className="flex flex-col gap-1">
                  {data.topMissCategories.map((category: string, idx: number) => (
                    <div key={idx} className="text-xs text-text-2">• {category}</div>
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
