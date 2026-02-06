import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi, postApi } from './client';
import type { ServiceStatus, ModelsResponse, ContextMonitorData, AgentState } from '@/types';

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
  daemons: ['daemons'] as const,
  daemonLogs: (label: string, src: string) => ['daemons', label, 'logs', src] as const,
  memory: ['memory'] as const,
  memoryPerformance: ['memory', 'performance'] as const,
  ragChunks: (source: string, offset: number) => ['rag', 'chunks', source, offset] as const,
  ragConfig: ['rag', 'config'] as const,
  contextPipelineHookStatus: ['contextPipeline', 'hookStatus'] as const,
  contextPipelineActivity: ['contextPipeline', 'activity'] as const,
  contextPipelineConfig: ['contextPipeline', 'config'] as const,
  routerHealth: ['router', 'health'] as const,
  routerPrompt: ['router', 'prompt'] as const,
  routes: ['routes'] as const,
  alerts: ['alerts'] as const,
  trust: ['trust'] as const,
  corrections: ['corrections'] as const,
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

// Daemons
export function useDaemons() {
  return useQuery({
    queryKey: queryKeys.daemons,
    queryFn: () => fetchApi<any[]>('/daemons'),
    refetchInterval: 60000,
  });
}

export function useDaemonLogs(label: string, src: 'out' | 'err', enabled: boolean = false) {
  return useQuery({
    queryKey: queryKeys.daemonLogs(label, src),
    queryFn: () => fetchApi<any>(`/daemons/${encodeURIComponent(label)}/logs?src=${src}&lines=50`),
    enabled,
    refetchInterval: 10000,
  });
}

export function useRestartDaemon() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (label: string) =>
      postApi(`/daemons/${encodeURIComponent(label)}/restart`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.daemons });
    },
  });
}

// Memory
export function useMemory() {
  return useQuery({
    queryKey: queryKeys.memory,
    queryFn: () => fetchApi<any>('/memory'),
    refetchInterval: 60000,
  });
}

export function useMemoryPerformance() {
  return useQuery({
    queryKey: queryKeys.memoryPerformance,
    queryFn: () => fetchApi<any>('/memory/performance'),
    refetchInterval: 60000,
  });
}

// RAG
export function useRAGChunks(source: 'memory' | 'chat', offset: number = 0, limit: number = 20) {
  return useQuery({
    queryKey: queryKeys.ragChunks(source, offset),
    queryFn: () => fetchApi<any>(`/rag/chunks?source=${source}&offset=${offset}&limit=${limit}`),
  });
}

export function useRAGConfig() {
  return useQuery({
    queryKey: queryKeys.ragConfig,
    queryFn: () => fetchApi<any>('/rag/config'),
  });
}

export function useReindexRAG() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => postApi('/rag/reindex', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ragChunks('memory', 0) });
    },
  });
}

// Context Pipeline
export function useContextPipelineHookStatus() {
  return useQuery({
    queryKey: queryKeys.contextPipelineHookStatus,
    queryFn: () => fetchApi<any>('/context-pipeline/hook-status'),
    refetchInterval: 30000,
  });
}

export function useContextPipelineActivity() {
  return useQuery({
    queryKey: queryKeys.contextPipelineActivity,
    queryFn: () => fetchApi<any[]>('/context-pipeline/activity'),
    refetchInterval: 30000,
  });
}

export function useContextPipelineConfig() {
  return useQuery({
    queryKey: queryKeys.contextPipelineConfig,
    queryFn: () => fetchApi<any>('/context-pipeline/config'),
  });
}

export function useUpdateContextPipelineConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: any) => postApi('/context-pipeline/config', config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contextPipelineConfig });
    },
  });
}

// Router Health
export function useRouterHealth() {
  return useQuery({
    queryKey: queryKeys.routerHealth,
    queryFn: () => fetchApi<any>('/router/health'),
    refetchInterval: 30000,
  });
}

// Router Prompt
export function useRouterPrompt() {
  return useQuery({
    queryKey: queryKeys.routerPrompt,
    queryFn: () => fetchApi<any>('/router/prompt'),
  });
}

export function useUpdateRouterPrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => postApi('/router/prompt', { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.routerPrompt });
    },
  });
}

export function useTestRoute() {
  return useMutation({
    mutationFn: (query: string) => fetchApi<any>(`/router/test?query=${encodeURIComponent(query)}`),
  });
}

// Routes Config
export function useRoutes() {
  return useQuery({
    queryKey: queryKeys.routes,
    queryFn: () => fetchApi<any>('/routes/config'),
  });
}

// Alerts
export function useAlerts() {
  return useQuery({
    queryKey: queryKeys.alerts,
    queryFn: () => fetchApi<any>('/alerts/config'),
    refetchInterval: 10000,
  });
}

export function useUpdateAlerts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: any) => postApi('/alerts/config', config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
    },
  });
}

// Trust
export function useTrustScore() {
  return useQuery({
    queryKey: queryKeys.trust,
    queryFn: () => fetchApi<any>('/trust'),
    refetchInterval: 30000,
  });
}

// Corrections
export function useCorrections() {
  return useQuery({
    queryKey: queryKeys.corrections,
    queryFn: () => fetchApi<any[]>('/corrections'),
  });
}

// Jobs
export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: () => fetchApi<any>('/jobs'),
    refetchInterval: 10000,
  });
}

export function useTriggerReindex() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postApi('/memory/reindex', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

// Pipelines
export function usePipelines() {
  return useQuery({
    queryKey: ['pipelines'],
    queryFn: () => fetchApi<any[]>('/pipelines'),
    refetchInterval: 30000,
  });
}

// Sessions
export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => fetchApi<any[]>('/sessions/list'),
    refetchInterval: 30000,
  });
}

// Cron
export function useCron() {
  return useQuery({
    queryKey: ['cron'],
    queryFn: () => fetchApi<any[]>('/cron'),
  });
}

export function useRunCronJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => postApi(`/cron/${jobId}/run`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron'] });
    },
  });
}

// Model Manager
export function useModelManager() {
  return useQuery({
    queryKey: ['modelManager'],
    queryFn: () => fetchApi<any>('/models/available'),
    refetchInterval: 30000,
  });
}

export function usePullModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => postApi('/models/pull', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modelManager'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.models });
    },
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => postApi('/models/delete', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modelManager'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.models });
    },
  });
}

export function useWarmModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => postApi('/models/warm', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modelManager'] });
    },
  });
}

// Single Correction
export function useCorrection(name: string) {
  return useQuery({
    queryKey: ['correction', name],
    queryFn: () => fetchApi<any>(`/corrections/${encodeURIComponent(name)}`),
    enabled: !!name,
  });
}

// Unload Model Manager
export function useUnloadModelManager() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => postApi('/models/warm', { name, keep_alive: 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modelManager'] });
    },
  });
}
