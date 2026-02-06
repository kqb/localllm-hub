import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi, postApi } from '@/api/client';

export interface CompactionSettings {
  reserveTokensFloor: number;
  memoryFlush: {
    enabled: boolean;
    softThresholdTokens: number;
    prompt: string;
    systemPrompt?: string;
  };
}

export interface CompactionResponse {
  compaction: CompactionSettings;
  error?: string;
}

export function useCompaction() {
  return useQuery({
    queryKey: ['compaction'],
    queryFn: () => fetchApi<CompactionResponse>('/compaction'),
  });
}

export function useUpdateCompaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: CompactionSettings) =>
      postApi('/compaction', settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compaction'] });
    },
  });
}
