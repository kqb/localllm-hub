import { useState } from 'react';
import { useCorrections, useCorrection } from '@/api/queries';
import { Card, CardHeader, CardContent, LoadingText, Badge } from '@/components/ui';

export function Corrections() {
  const { data: corrections, isLoading, error } = useCorrections();
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  if (isLoading) return (
    <Card>
      <CardHeader>📈 Corrections Timeline</CardHeader>
      <CardContent><LoadingText /></CardContent>
    </Card>
  );

  if (error) return (
    <Card>
      <CardHeader>📈 Corrections Timeline</CardHeader>
      <CardContent>
        <div className="text-red text-sm">Failed to load corrections</div>
      </CardContent>
    </Card>
  );

  const correctionsList = Array.isArray(corrections) ? corrections : [];

  if (correctionsList.length === 0) return (
    <Card>
      <CardHeader>📈 Corrections Timeline</CardHeader>
      <CardContent>
        <div className="text-text-2 text-sm">No corrections found</div>
      </CardContent>
    </Card>
  );

  // Count corrections per date
  const dateCounts: Record<string, number> = {};
  for (const c of correctionsList) {
    const dateMatch = c.name.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      dateCounts[dateMatch[1]] = (dateCounts[dateMatch[1]] || 0) + 1;
    }
  }

  const handleToggle = (name: string) => {
    setExpandedFile(expandedFile === name ? null : name);
  };

  return (
    <Card>
      <CardHeader>📈 Corrections Timeline</CardHeader>
      <CardContent>
        <div className="text-sm text-text-2 mb-3">
          {correctionsList.length} correction files
        </div>

        <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
          {correctionsList.map((correction: any) => {
            const dateMatch = correction.name.match(/^(\d{4}-\d{2}-\d{2})/);
            const dateStr = dateMatch ? dateMatch[1] : '';
            const count = dateCounts[dateStr] || 0;
            const isExpanded = expandedFile === correction.name;

            return (
              <CorrectionItem
                key={correction.name}
                name={correction.name}
                sizeBytes={correction.sizeBytes}
                count={count > 1 ? count : undefined}
                isExpanded={isExpanded}
                onToggle={() => handleToggle(correction.name)}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface CorrectionItemProps {
  name: string;
  sizeBytes: number;
  count?: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function CorrectionItem({ name, sizeBytes, count, isExpanded, onToggle }: CorrectionItemProps) {
  const { data: content, isLoading } = useCorrection(isExpanded ? name : '');

  return (
    <div className="border border-border rounded">
      {/* Header */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-bg-3 transition-colors"
        onClick={onToggle}
      >
        <span className="flex-1 font-mono text-sm truncate">{name}</span>
        {count && <Badge variant="yellow">{count}/day</Badge>}
        <span className="text-xs text-text-2">
          {(sizeBytes / 1024).toFixed(1)} KB
        </span>
      </div>

      {/* Body */}
      {isExpanded && (
        <div className="border-t border-border p-3 bg-bg">
          {isLoading ? (
            <div className="text-sm text-text-2">Loading...</div>
          ) : content?.content ? (
            <pre className="text-xs text-text-2 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
              {content.content}
            </pre>
          ) : (
            <div className="text-sm text-text-2">Empty</div>
          )}
        </div>
      )}
    </div>
  );
}
