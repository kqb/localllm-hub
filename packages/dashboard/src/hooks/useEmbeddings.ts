import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/api/client';

export interface EmbeddingSample {
  file: string;
  text: string;
  embedding: number[];
}

export interface EmbeddingsResponse {
  samples: EmbeddingSample[];
  error?: string;
}

export function useEmbeddings(limit: number, enabled = false) {
  return useQuery({
    queryKey: ['embeddings', 'sample', limit],
    queryFn: () =>
      fetchApi<EmbeddingsResponse>(`/embeddings/sample?limit=${limit}`),
    enabled,
  });
}
