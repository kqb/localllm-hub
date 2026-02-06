import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi, postApi } from './client';
import type {
  ServiceStatus,
  ModelsResponse,
  ContextMonitorData,
  AgentState,
  JobsStats,
  PipelinesStats,
  Session,
  CronJob,
  ModelManagerResponse,
} from '@/types';

export const queryKeys = {
  status: ['status'] as const,
  models: ['models'] as const,
  mlxStatus: ['mlx', 'status'] as const,
  contextMonitor: ['context', 'monitor'] as const,
  agents: ['agents'] as const,
  config: ['config'] as const,
  clawdbotConfig: ['clawdbot', 'config'] as const,
  memoryConfig: ['memory', 'config'] as const,
  chatSessions: ['chat', 'sessions'] as const,
  zoidActivity: ['zoid', 'activity'] as const,
  jobs: ['jobs'] as const,
  pipelines: ['pipelines'] as const,
  sessions: ['sessions'] as const,
  cron: ['cron'] as const,
  modelManager: ['models', 'available'] as const,
};

// Service Status
export function useServiceStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: () => fetchApi<ServiceStatus>('/status'),
    refetchInterval: 30000,
  });
}

// Models
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

// MLX Models
export function useMLXStatus() {
  return useQuery({
    queryKey: queryKeys.mlxStatus,
    queryFn: () => fetchApi<any>('/mlx/status'),
    refetchInterval: 30000,
  });
}

// Context Monitor
export function useContextMonitor() {
  return useQuery({
    queryKey: queryKeys.contextMonitor,
    queryFn: () => fetchApi<ContextMonitorData>('/context-monitor'),
    refetchInterval: 30000,
  });
}

// Agents
export function useAgents() {
  return useQuery({
    queryKey: queryKeys.agents,
    queryFn: () => fetchApi<AgentState[]>('/agents'),
    refetchInterval: 10000,
  });
}

// Config
export function useClawdbotConfig() {
  return useQuery({
    queryKey: queryKeys.clawdbotConfig,
    queryFn: () => fetchApi<any>('/clawdbot/config'),
  });
}

export function useUpdateClawdbotConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: any) =>
      postApi('/clawdbot/config', config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clawdbotConfig });
    },
  });
}

export function useMemoryConfig() {
  return useQuery({
    queryKey: queryKeys.memoryConfig,
    queryFn: () => fetchApi<any>('/config'),
  });
}

export function useUpdateMemoryConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: any) =>
      postApi('/config', config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memoryConfig });
    },
  });
}

// Chat Sessions
export function useChatSessions() {
  return useQuery({
    queryKey: queryKeys.chatSessions,
    queryFn: () => fetchApi<any[]>('/chat/sessions'),
  });
}

// Zoid Activity
export function useZoidActivity() {
  return useQuery({
    queryKey: queryKeys.zoidActivity,
    queryFn: () => fetchApi<any[]>('/zoid/activity'),
    refetchInterval: 10000,
  });
}

export function useLogZoidActivity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (activity: any) =>
      postApi('/zoid/activity', activity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.zoidActivity });
    },
  });
}

// Jobs & Ingestion
export function useJobs() {
  return useQuery({
    queryKey: queryKeys.jobs,
    queryFn: () => fetchApi<JobsStats>('/jobs'),
    refetchInterval: 60000,
  });
}

export function useTriggerReindex() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => postApi('/reindex', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    },
  });
}

// Pipelines
export function usePipelines() {
  return useQuery({
    queryKey: queryKeys.pipelines,
    queryFn: () => fetchApi<PipelinesStats>('/pipelines/stats'),
    refetchInterval: 60000,
  });
}

// Sessions
export function useSessions() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => fetchApi<Session[]>('/sessions/list'),
  });
}

// Cron
export function useCron() {
  return useQuery({
    queryKey: queryKeys.cron,
    queryFn: () => fetchApi<CronJob[]>('/cron/list'),
  });
}

export function useRunCronJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => postApi('/cron/run', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cron });
    },
  });
}

// Model Manager
export function useModelManager() {
  return useQuery({
    queryKey: queryKeys.modelManager,
    queryFn: () => fetchApi<ModelManagerResponse>('/models/available'),
    refetchInterval: 30000,
  });
}

export function usePullModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => postApi('/models/pull', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modelManager });
      queryClient.invalidateQueries({ queryKey: queryKeys.models });
    },
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => postApi('/models/delete', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modelManager });
      queryClient.invalidateQueries({ queryKey: queryKeys.models });
    },
  });
}

export function useWarmModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => postApi('/models/warm', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modelManager });
      queryClient.invalidateQueries({ queryKey: queryKeys.models });
    },
  });
}

export function useUnloadModelManager() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => postApi('/models/warm', { name, keep_alive: 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modelManager });
      queryClient.invalidateQueries({ queryKey: queryKeys.models });
    },
  });
}
