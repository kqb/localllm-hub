import { useState, useRef, useEffect } from 'react';
import { Card, CardHeader, CardContent, Button } from '@/components/ui';
import { useEmbeddings } from '@/hooks/useEmbeddings';

interface ProjectedPoint {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  file: string;
  text: string;
}

export function EmbeddingsCard() {
  const [limit, setLimit] = useState(200);
  const [loadEnabled, setLoadEnabled] = useState(false);
  const [projection, setProjection] = useState<ProjectedPoint[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<ProjectedPoint | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { data, isLoading } = useEmbeddings(limit, loadEnabled);

  useEffect(() => {
    if (data && data.samples && data.samples.length > 0) {
      projectAndDraw(data.samples);
      setLoadEnabled(false);
    }
  }, [data]);

  const projectAndDraw = (samples: Array<{ file: string; text: string; embedding: number[] }>) => {
    // Simple 2D projection: pick two random dimensions
    const dim1 = Math.floor(Math.random() * samples[0].embedding.length);
    const dim2 = Math.floor(Math.random() * samples[0].embedding.length);

    const projected = samples.map((s) => ({
      x: s.embedding[dim1],
      y: s.embedding[dim2],
      canvasX: 0,
      canvasY: 0,
      file: s.file,
      text: s.text,
    }));

    // Normalize to canvas coordinates
    const xVals = projected.map((p) => p.x);
    const yVals = projected.map((p) => p.y);
    const xMin = Math.min(...xVals);
    const xMax = Math.max(...xVals);
    const yMin = Math.min(...yVals);
    const yMax = Math.max(...yVals);

    const canvas = canvasRef.current;
    if (!canvas) return;

    const w = canvas.width;
    const h = canvas.height;
    const padding = 40;

    projected.forEach((p) => {
      p.canvasX = padding + ((p.x - xMin) / (xMax - xMin)) * (w - 2 * padding);
      p.canvasY = padding + ((p.y - yMin) / (yMax - yMin)) * (h - 2 * padding);
    });

    setProjection(projected);
    drawPoints(projected, canvas);
  };

  const drawPoints = (points: ProjectedPoint[], canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = 'var(--bg)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw points
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.canvasX, p.canvasY, 3, 0, 2 * Math.PI);
      ctx.fillStyle = 'var(--accent)';
      ctx.fill();
    });
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Find closest point
    let closest: ProjectedPoint | null = null;
    let minDist = Infinity;

    for (const p of projection) {
      const dist = Math.sqrt(
        Math.pow(p.canvasX - clickX, 2) + Math.pow(p.canvasY - clickY, 2)
      );
      if (dist < minDist && dist < 10) {
        minDist = dist;
        closest = p;
      }
    }

    setSelectedPoint(closest);
  };

  return (
    <Card>
      <CardHeader>🔮 Embedding Explorer</CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm">
            Sample size:
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              min={50}
              max={500}
              step={50}
              className="ml-2 w-20 bg-bg-3 border border-border rounded px-2 py-1 text-sm text-text outline-none focus:border-accent"
            />
          </label>
          <Button onClick={() => setLoadEnabled(true)} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Load'}
          </Button>
          {data?.samples && (
            <span className="text-sm text-text-2">
              Loaded {data.samples.length} points
            </span>
          )}
          {data?.error && (
            <span className="text-sm text-red">Error: {data.error}</span>
          )}
        </div>

        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          onClick={handleCanvasClick}
          className="border border-border bg-bg cursor-crosshair w-full max-w-[800px] h-auto"
          style={{ aspectRatio: '800/600' }}
        />

        {selectedPoint && (
          <div className="mt-4 p-3 bg-bg-2 border border-border rounded">
            <div className="font-semibold text-sm mb-2">{selectedPoint.file}</div>
            <pre className="text-xs whitespace-pre-wrap text-text-2">
              {selectedPoint.text}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
