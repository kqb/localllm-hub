import { useState } from 'react';
import { Card, CardHeader, CardContent, LoadingText, Badge, Button } from '@/components/ui';
import { useRAGChunks, useRAGConfig, useReindexRAG } from '@/api/queries';

export function RAGInspector() {
  const [source, setSource] = useState<'memory' | 'chat'>('memory');
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const { data: chunks, isLoading: chunksLoading } = useRAGChunks(source, offset, limit);
  const { data: config, isLoading: configLoading } = useRAGConfig();
  const reindexMutation = useReindexRAG();

  const isLoading = chunksLoading || configLoading;

  const handleReindex = () => {
    if (confirm('Reindex all chunks? This may take a while.')) {
      reindexMutation.mutate();
    }
  };

  const handlePrevPage = () => {
    setOffset(Math.max(0, offset - limit));
  };

  const handleNextPage = () => {
    if (chunks && offset + limit < chunks.total) {
      setOffset(offset + limit);
    }
  };

  return (
    <Card>
      <CardHeader>🔬 RAG Inspector</CardHeader>
      <CardContent>
        {isLoading && <LoadingText />}

        {config && (
          <div className="flex gap-4 mb-3 flex-wrap items-center text-xs">
            <div><span className="text-text-2">Chunk Size:</span> <strong>{config.chunkSize}</strong> chars</div>
            <div><span className="text-text-2">Overlap:</span> <strong>{config.chunkOverlap}</strong> chars</div>
            <div><span className="text-text-2">Dimensions:</span> <strong>{config.dimension}</strong></div>
            <Badge variant="blue">{config.model}</Badge>
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-2 mb-3 items-center">
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value as 'memory' | 'chat');
              setOffset(0);
            }}
            className="bg-bg border border-border rounded px-2 py-1 text-sm text-text"
          >
            <option value="memory">Memory Chunks</option>
            <option value="chat">Chat Chunks</option>
          </select>

          {chunks && (
            <span className="text-xs text-text-2">{chunks.total.toLocaleString()} total chunks</span>
          )}

          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="outline" onClick={handleReindex}>
              Reindex
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Refresh
            </Button>
          </div>
        </div>

        {/* Chunks List */}
        <div className="max-h-[500px] overflow-y-auto flex flex-col gap-2">
          {chunks && chunks.chunks.length === 0 ? (
            <div className="text-text-2 text-sm text-center py-6">No chunks found</div>
          ) : (
            chunks?.chunks.map((chunk: any) => (
              <ChunkItem key={chunk.id} chunk={chunk} />
            ))
          )}
        </div>

        {/* Pagination */}
        {chunks && chunks.total > limit && (
          <div className="flex gap-2 mt-3 justify-center items-center">
            {offset > 0 && (
              <Button size="sm" variant="outline" onClick={handlePrevPage}>
                Prev
              </Button>
            )}
            <span className="text-xs text-text-2">
              {offset + 1}-{Math.min(offset + limit, chunks.total)} of {chunks.total}
            </span>
            {offset + limit < chunks.total && (
              <Button size="sm" variant="outline" onClick={handleNextPage}>
                Next
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ChunkItemProps {
  chunk: {
    id: number;
    file?: string;
    start_line?: number;
    end_line?: number;
    session_id?: string;
    start_ts?: string;
    text: string;
  };
}

function ChunkItem({ chunk }: ChunkItemProps) {
  const [expanded, setExpanded] = useState(false);
  const preview = chunk.text.slice(0, 200);
  const hasMore = chunk.text.length > 200;

  return (
    <div className="bg-bg border border-border rounded p-3">
      {/* Meta */}
      <div className="flex gap-2 mb-2 flex-wrap text-xs">
        <Badge variant="blue">#{chunk.id}</Badge>
        {chunk.file && <span className="text-text-2">{chunk.file}</span>}
        {chunk.start_line != null && (
          <span className="text-text-2">L{chunk.start_line}-{chunk.end_line}</span>
        )}
        {chunk.session_id && (
          <span className="text-text-2">session:{chunk.session_id.slice(0, 8)}</span>
        )}
        {chunk.start_ts && <span className="text-text-2">{chunk.start_ts}</span>}
        <span className="text-text-2">{chunk.text.length} chars</span>
      </div>

      {/* Text */}
      <div
        className="text-xs text-text-2 cursor-pointer hover:text-text transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? chunk.text : preview}
        {hasMore && !expanded && '...'}
      </div>
    </div>
  );
}
