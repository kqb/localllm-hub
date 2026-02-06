import { useState } from 'react';
import { Card, CardHeader, CardContent, Button, LoadingText } from '@/components/ui';
import { useSearch } from '@/hooks/useSearch';

export function SearchCard() {
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState({
    memory: true,
    chat: true,
    telegram: true,
  });
  const [topk, setTopk] = useState(5);
  const [searchEnabled, setSearchEnabled] = useState(false);

  const sourcesArray = Object.entries(sources)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  const { data: results, isLoading } = useSearch(
    { query, sources: sourcesArray, topk },
    searchEnabled
  );

  const handleSearch = () => {
    if (query.trim()) {
      setSearchEnabled(true);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <Card>
      <CardHeader>🔍 Semantic Search</CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Search memory, chats, and Telegram..."
            className="flex-1 bg-bg-3 border border-border rounded px-3 py-2 text-sm text-text outline-none focus:border-accent"
          />
          <Button onClick={handleSearch} disabled={!query.trim()}>
            Search
          </Button>
        </div>

        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sources.memory}
              onChange={(e) => setSources({ ...sources, memory: e.target.checked })}
              className="rounded border-border"
            />
            📝 Memory
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sources.chat}
              onChange={(e) => setSources({ ...sources, chat: e.target.checked })}
              className="rounded border-border"
            />
            💬 Chat
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sources.telegram}
              onChange={(e) => setSources({ ...sources, telegram: e.target.checked })}
              className="rounded border-border"
            />
            📱 Telegram
          </label>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-text-2">Top-K:</span>
            <input
              type="range"
              min="1"
              max="20"
              value={topk}
              onChange={(e) => setTopk(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-sm text-text min-w-[20px]">{topk}</span>
          </div>
        </div>

        <div className="space-y-3">
          {isLoading && <LoadingText />}
          {!isLoading && results && results.length === 0 && (
            <div className="text-center text-text-2 text-sm py-6">No results found</div>
          )}
          {!isLoading && results && results.length > 0 && (
            <>
              {results.map((result, idx) => (
                <div
                  key={idx}
                  className="bg-bg-3 border border-border rounded p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-mono text-accent truncate flex-1">
                      {result.file}
                      {result.start_line && `:${result.start_line}`}
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-bg border border-border capitalize">
                        {result.source}
                      </span>
                      <span className="text-xs text-green">
                        {(result.score * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="text-sm text-text-2 whitespace-pre-wrap">
                    {result.text.length > 300
                      ? result.text.slice(0, 300) + '...'
                      : result.text}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
