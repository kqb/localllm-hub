export interface OllamaStatus {
  healthy: boolean;
  detail: Record<string, unknown>;
}

export interface DatabaseInfo {
  exists: boolean;
  label: string;
  sizeBytes?: number;
  tables?: Record<string, number>;
  error?: string;
}

export interface ServiceStatus {
  ollama: OllamaStatus;
  whisper: {
    found: boolean;
    path: string | null;
  };
  databases: DatabaseInfo[];
  timestamp: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

export interface ModelsResponse {
  models?: OllamaModel[];
  error?: string;
}

export interface AgentState {
  session: string;
  state: 'READING' | 'WORKING' | 'IDLE' | 'STUCK' | 'ERROR';
  progress: number;
  last_activity: number;
  last_output: string;
}

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

export interface ContextMonitorData {
  total_tokens: number;
  limit: number;
  percentage: number;
  files: Array<{
    path: string;
    tokens: number;
  }>;
}

export type BadgeVariant = 'green' | 'red' | 'yellow' | 'blue' | 'purple' | 'orange';
