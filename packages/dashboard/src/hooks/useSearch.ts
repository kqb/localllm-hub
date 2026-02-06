import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/api/client';

export interface SearchResult {
  file: string;
  source: string;
  score: number;
  text: string;
  start_line?: number;
  end_line?: number;
}

export interface SearchParams {
  query: string;
  sources: string[];
  topk: number;
}

export function useSearch(params: SearchParams, enabled = false) {
  const { query, sources, topk } = params;
  const sourcesQuery = sources.join(',');

  return useQuery({
    queryKey: ['search', query, sourcesQuery, topk],
    queryFn: () =>
      fetchApi<SearchResult[]>(
        `/search?q=${encodeURIComponent(query)}&sources=${sourcesQuery}&topk=${topk}`
      ),
    enabled: enabled && query.length > 0,
  });
}
