import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi, postApi } from '@/api/client';

export interface AvailableModel {
  name: string;
  size: number;
  loaded: boolean;
  family?: string;
  quantization?: string;
}

export interface AvailableModelsResponse {
  models: AvailableModel[];
  error?: string;
}

export function useAvailableModels() {
  return useQuery({
    queryKey: ['models', 'available'],
    queryFn: () => fetchApi<AvailableModelsResponse>('/models/available'),
    refetchInterval: 30000,
  });
}

export function usePullModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (modelName: string) =>
      postApi('/models/pull', { name: modelName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      queryClient.invalidateQueries({ queryKey: ['budget'] });
    },
  });
}

export function useWarmModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (modelName: string) =>
      postApi('/models/warm', { name: modelName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      queryClient.invalidateQueries({ queryKey: ['budget'] });
    },
  });
}

export function useUnloadModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (modelName: string) =>
      postApi('/models/warm', { name: modelName, keep_alive: '0' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      queryClient.invalidateQueries({ queryKey: ['budget'] });
    },
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (modelName: string) =>
      postApi('/models/delete', { name: modelName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      queryClient.invalidateQueries({ queryKey: ['budget'] });
    },
  });
}
