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
    mutationFn: (content: string) =>
      postApi('/router/prompt', { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.routerPrompt });
    },
  });
}

export function useTestRoute() {
  return useMutation({
    mutationFn: (prompt: string) =>
      postApi('/routes/test', { prompt }),
  });
}

// Routes
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
    queryFn: () => fetchApi<any[]>('/alerts'),
    refetchInterval: 30000,
  });
}

// Trust Score
export function useTrustScore() {
  return useQuery({
    queryKey: queryKeys.trust,
    queryFn: () => fetchApi<any>('/trust/score'),
    refetchInterval: 60000,
  });
}

// Corrections
export function useCorrections() {
  return useQuery({
    queryKey: queryKeys.corrections,
    queryFn: () => fetchApi<any[]>('/corrections'),
  });
}

export function useCorrection(name: string) {
  return useQuery({
    queryKey: ['correction', name],
    queryFn: () => fetchApi<any>(`/corrections/${encodeURIComponent(name)}`),
    enabled: !!name,
  });
}
