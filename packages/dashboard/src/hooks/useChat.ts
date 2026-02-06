import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/api/client';

export const queryKeys = {
  chatSessions: ['chat', 'sessions'] as const,
  chatMessages: (sessionId: string, offset: number) =>
    ['chat', 'messages', sessionId, offset] as const,
  chatStream: (sessionId: string, last: number) =>
    ['chat', 'stream', sessionId, last] as const,
};

export interface ChatSession {
  sessionId: string;
  sizeBytes: number;
  lastModified: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'toolResult';
  content?: string;
  thinking?: string;
  thinkingSignature?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  toolResult?: {
    toolName: string;
    content: string;
    isError: boolean;
  };
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  timestamp?: string;
}

export interface ChatMessagesResponse {
  messages: ChatMessage[];
  total: number;
  hasMore: boolean;
}

export function useChatSessions() {
  return useQuery({
    queryKey: queryKeys.chatSessions,
    queryFn: () => fetchApi<ChatSession[]>('/chat/sessions'),
  });
}

export function useChatMessages(sessionId: string | null, offset = 0) {
  return useQuery({
    queryKey: queryKeys.chatMessages(sessionId || '', offset),
    queryFn: () =>
      fetchApi<ChatMessagesResponse>(
        `/chat/${sessionId}/messages?limit=50&offset=${offset}`
      ),
    enabled: !!sessionId,
  });
}
