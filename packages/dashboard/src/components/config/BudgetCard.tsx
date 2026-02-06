import { Card, CardHeader, CardContent, LoadingText } from '@/components/ui';
import { useBudget } from '@/hooks/useBudget';

export function BudgetCard() {
  const { data, isLoading, error } = useBudget();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>💾 Model Budget Visualizer</CardHeader>
        <CardContent><LoadingText /></CardContent>
      </Card>
    );
  }

  if (error || data?.error) {
    return (
      <Card>
        <CardHeader>💾 Model Budget Visualizer</CardHeader>
        <CardContent>
          <div className="text-red text-sm">
            {data?.error || 'Failed to load budget data'}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const totalGB = data.totalRam / 1073741824;
  const osGB = data.osOverhead / 1073741824;
  const freeGB = data.freeHeadroom / 1073741824;

  const osPct = (data.osOverhead / data.totalRam) * 100;
  const freePct = (data.freeHeadroom / data.totalRam) * 100;

  const loaded = data.models.filter((m) => m.loaded);
  const modelColors = ['#4ade80', '#a78bfa', '#60a5fa', '#fb923c', '#fbbf24'];

  return (
    <Card>
      <CardHeader>💾 Model Budget Visualizer</CardHeader>
      <CardContent>
        {/* Budget Bar */}
        <div className="relative h-12 bg-bg-3 rounded overflow-hidden flex mb-4">
          {/* OS Overhead */}
          <div
            className="flex items-center justify-center text-xs font-medium"
            style={{
              width: `${osPct}%`,
              background: 'var(--red)',
              opacity: 0.7,
            }}
          >
            {osPct > 8 ? `${osGB.toFixed(1)}G` : ''}
          </div>

          {/* Loaded Models */}
          {loaded.map((model, idx) => {
            const mPct = (model.size / data.totalRam) * 100;
            const color = modelColors[idx % modelColors.length];
            const label = mPct > 5 ? model.name.split(':')[0] : '';
            return (
              <div
                key={model.name}
                className="flex items-center justify-center text-xs font-medium"
                style={{
                  width: `${mPct}%`,
                  background: color,
                  opacity: 0.8,
                }}
              >
                {label}
              </div>
            );
          })}

          {/* Free Headroom */}
          <div
            className="flex items-center justify-center text-xs font-medium border border-dashed border-border"
            style={{
              width: `${freePct}%`,
              background: 'var(--bg)',
            }}
          >
            <span className="text-text-2">{freeGB.toFixed(1)}G free</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mb-4 text-xs">
          <div className="flex items-center gap-1">
            <div
              className="w-3 h-3 rounded"
              style={{ background: 'var(--red)', opacity: 0.7 }}
            />
            <span className="text-text-2">OS ~{osGB.toFixed(0)}GB</span>
          </div>
          {loaded.map((model, idx) => {
            const color = modelColors[idx % modelColors.length];
            const sizeGB = (model.size / 1073741824).toFixed(1);
            return (
              <div key={model.name} className="flex items-center gap-1">
                <div
                  className="w-3 h-3 rounded"
                  style={{ background: color, opacity: 0.8 }}
                />
                <span className="text-text-2">
                  {model.name} {sizeGB}GB
                </span>
              </div>
            );
          })}
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-bg border border-dashed border-border" />
            <span className="text-text-2">Free {freeGB.toFixed(1)}GB</span>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <div className="text-xs text-text-2">Total RAM</div>
            <div className="text-lg font-semibold">{totalGB.toFixed(0)} GB</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-text-2">Models Loaded</div>
            <div className="text-lg font-semibold">{loaded.length}</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-text-2">Models Available</div>
            <div className="text-lg font-semibold">{data.models.length}</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-text-2">Headroom</div>
            <div
              className="text-lg font-semibold"
              style={{
                color:
                  freeGB < 5
                    ? 'var(--red)'
                    : freeGB < 10
                    ? 'var(--yellow)'
                    : 'var(--green)',
              }}
            >
              {freeGB.toFixed(1)} GB
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
