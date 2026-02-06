import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/api/client';

export interface BudgetModel {
  name: string;
  size: number;
  loaded: boolean;
  family?: string;
  quantization?: string;
}

export interface BudgetResponse {
  totalRam: number;
  osOverhead: number;
  freeHeadroom: number;
  models: BudgetModel[];
  error?: string;
}

export function useBudget() {
  return useQuery({
    queryKey: ['budget'],
    queryFn: () => fetchApi<BudgetResponse>('/budget'),
    refetchInterval: 30000,
  });
}
