import { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent, Button, LoadingText } from '@/components/ui';
import { useChatSessions, useChatMessages } from '@/hooks/useChat';
import type { ChatMessage } from '@/hooks/useChat';

export function ChatCard() {
  const { data: sessions } = useChatSessions();
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [showThinking, setShowThinking] = useState(true);
  const [showTools, setShowTools] = useState(true);
  const [showUsage, setShowUsage] = useState(false);

  const { data: messagesData, isLoading } = useChatMessages(selectedSession, offset);

  useEffect(() => {
    if (sessions && sessions.length > 0 && !selectedSession) {
      setSelectedSession(sessions[0].sessionId);
    }
  }, [sessions, selectedSession]);

  const handleSessionChange = (sessionId: string) => {
    setSelectedSession(sessionId);
    setOffset(0);
  };

  const handleLoadMore = () => {
    setOffset((prev) => prev + 50);
  };

  const formatSize = (bytes: number) => {
    return bytes > 1048576
      ? `${(bytes / 1048576).toFixed(1)}MB`
      : `${(bytes / 1024).toFixed(0)}KB`;
  };

  const renderMessage = (msg: ChatMessage, idx: number) => {
    if (msg.role === 'toolResult') {
      if (!showTools) return null;
      return (
        <div
          key={idx}
          className="border-l-2 border-accent/30 pl-3 py-2 mb-3 bg-bg-3/50"
        >
          <div className="text-xs font-semibold text-accent mb-1">
            🔧 {msg.toolResult?.toolName || 'tool result'}
          </div>
          <div
            className={`text-xs font-mono ${
              msg.toolResult?.isError ? 'text-red' : 'text-text-2'
            }`}
          >
            {msg.toolResult?.content && msg.toolResult.content.length > 500
              ? msg.toolResult.content.slice(0, 500) + '...'
              : msg.toolResult?.content}
          </div>
        </div>
      );
    }

    return (
      <div
        key={idx}
        className={`mb-4 pb-4 border-b border-border last:border-b-0 ${
          msg.role === 'user' ? 'bg-bg-3/30' : ''
        } p-3 rounded`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">
            {msg.role === 'user' ? '👤 User' : '🤖 Assistant'}
            {msg.model && (
              <span className="ml-2 text-xs text-text-2 font-normal">
                · {msg.model}
              </span>
            )}
          </div>
          {msg.timestamp && (
            <div className="text-xs text-text-2">
              {new Date(msg.timestamp).toLocaleTimeString()}
            </div>
          )}
        </div>

        {msg.thinking && showThinking && (
          <details className="mb-2 bg-bg-3 border border-border rounded p-2">
            <summary className="text-xs text-accent cursor-pointer">
              🧠 Thinking
            </summary>
            <div className="mt-2 text-xs text-text-2 whitespace-pre-wrap font-mono">
              {msg.thinking}
            </div>
          </details>
        )}

        {msg.content && (
          <div className="text-sm text-text whitespace-pre-wrap">
            {msg.content}
          </div>
        )}

        {msg.toolCalls && msg.toolCalls.length > 0 && showTools && (
          <div className="mt-2 space-y-2">
            {msg.toolCalls.map((tool, i) => (
              <details
                key={i}
                className="bg-bg-3 border border-accent/30 rounded p-2"
              >
                <summary className="text-xs text-accent cursor-pointer">
                  🔧 {tool.name}
                </summary>
                <pre className="mt-2 text-xs text-text-2 overflow-x-auto">
                  {JSON.stringify(tool.arguments, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        )}

        {msg.usage && showUsage && (
          <div className="mt-2 flex gap-4 text-xs text-text-2">
            <span>📥 {msg.usage.inputTokens.toLocaleString()}</span>
            <span>📤 {msg.usage.outputTokens.toLocaleString()}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>💬 Conversation</CardHeader>
      <CardContent>
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select
            value={selectedSession || ''}
            onChange={(e) => handleSessionChange(e.target.value)}
            className="flex-1 min-w-[200px] bg-bg-3 border border-border rounded px-3 py-2 text-sm text-text outline-none focus:border-accent"
          >
            <option value="">Select session...</option>
            {sessions?.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.sessionId.slice(0, 8)}... ({formatSize(s.sizeBytes)},{' '}
                {new Date(s.lastModified).toLocaleString()})
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant={showThinking ? 'primary' : 'outline'}
            onClick={() => setShowThinking(!showThinking)}
          >
            🧠 Thinking
          </Button>
          <Button
            size="sm"
            variant={showTools ? 'primary' : 'outline'}
            onClick={() => setShowTools(!showTools)}
          >
            🔧 Tools
          </Button>
          <Button
            size="sm"
            variant={showUsage ? 'primary' : 'outline'}
            onClick={() => setShowUsage(!showUsage)}
          >
            📊 Usage
          </Button>
        </div>

        {/* Messages */}
        <div className="space-y-3">
          {isLoading && <LoadingText />}
          {!selectedSession && !isLoading && (
            <div className="text-center text-text-2 text-sm py-6">
              Select a session to view messages
            </div>
          )}
          {selectedSession && !isLoading && messagesData && (
            <>
              {messagesData.hasMore && (
                <div className="text-center mb-4">
                  <Button size="sm" variant="outline" onClick={handleLoadMore}>
                    Load More ↑
                  </Button>
                </div>
              )}
              <div className="max-h-[600px] overflow-y-auto space-y-3">
                {messagesData.messages.map((msg, idx) => renderMessage(msg, idx))}
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
