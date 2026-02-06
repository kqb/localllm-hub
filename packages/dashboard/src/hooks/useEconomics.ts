import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/api/client';

export interface ModelStats {
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost?: number;
}

export interface EconomicsResponse {
  sessions: number;
  totalEstimatedCost: number;
  models: Record<string, ModelStats>;
  note?: string;
  error?: string;
}

export function useEconomics() {
  return useQuery({
    queryKey: ['economics'],
    queryFn: () => fetchApi<EconomicsResponse>('/economics'),
    refetchInterval: 120000,
  });
}
