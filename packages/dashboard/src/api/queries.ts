import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi, postApi } from './client';
import type { ServiceStatus, ModelsResponse } from '@/types';

export const queryKeys = {
  status: ['status'] as const,
  models: ['models'] as const,
  mlxStatus: ['mlx', 'status'] as const,
  contextMonitor: ['context', 'monitor'] as const,
  agents: ['agents'] as const,
  config: ['config'] as const,
};

export function useServiceStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: () => fetchApi<ServiceStatus>('/status'),
    refetchInterval: 30000,
  });
}

export function useModels() {
  return useQuery({
    queryKey: queryKeys.models,
    queryFn: () => fetchApi<ModelsResponse>('/models'),
    refetchInterval: 30000,
  });
}

export function useLoadModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (modelName: string) =>
      postApi('/models/load', { model: modelName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.models });
    },
  });
}

export function useUnloadModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (modelName: string) =>
      postApi('/models/unload', { model: modelName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.models });
    },
  });
}
