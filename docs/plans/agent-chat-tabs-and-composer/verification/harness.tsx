import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider, useLocale } from '@/contexts/LocaleContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import AgentChatDock from '@/components/video/components/AgentChatDock/AgentChatDock';
import { useVideoChatContentBridge } from '@/components/video/hooks/useVideoChatContentBridge';
import { useVideoChatSessions } from '@/components/video/hooks/useVideoChatSessions';
import type { VideoEditingTaskContent } from '@/types';
import type { AgentExecutionState } from '@/components/video/hooks/useAgentExecutionState';
import '@/styles/globals.css';
import '@/styles/video-editing.css';

function Harness() {
  const { t, setLocale } = useLocale();
  const [content, setContent] = useState<VideoEditingTaskContent>({
    markdownContent: '', lastModified: new Date(), conversations: [],
  });
  const [open, setOpen] = useState(true);
  const [yolo, setYolo] = useState(false);
  const [agentMode, setAgentMode] = useState(true);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  runningRef.current = running;
  const bridge = useVideoChatContentBridge({ projectKey: 'verification',
    content, onUpdateContent: setContent });
  const sessions = useVideoChatSessions({ projectKey: 'verification',
    contentBridge: bridge, isConversationReady: true,
    getBusyReason: () => runningRef.current ? '任务处理中' : null,
    labels: t.agentConversations });
  const state: AgentExecutionState = { status: running ? 'executing' : 'idle',
    startTime: null, elapsedTime: 0, retryCount: 0, completedTools: [],
    currentTool: null, pendingMessage: '', error: null, isThinking: running };
  const steering = { notes: [], queued: [], runId: null,
    submit: () => 'accepted' as const, cancelNote: () => true,
    promoteToStop: () => {}, startTurn: () => {}, onRunStarted: () => {},
    onRestart: () => {}, onSteerApplied: () => {}, onSteerDropped: () => {},
    onTurnEnd: () => {}, hasPendingInput: () => false };
  return <main style={{ background: 'var(--background)', color: 'var(--foreground)',
    height: '100vh', padding: 16, fontFamily: 'Arial, sans-serif' }}>
    <div style={{ display: 'flex', gap: 16 }}>
      <strong>Ecliptrix · 会话输入区验收</strong>
      <button onClick={() => setRunning(!running)}>模拟运行</button>
      <button onClick={() => { document.documentElement.className =
        document.documentElement.classList.contains('light') ? 'dark' : 'light'; }}>
        深浅色</button>
      <button onClick={() => setLocale('en')}>English</button>
      <button onClick={() => setLocale('zh-CN')}>中文</button>
    </div>
    <section className="ws-main" style={{ position: 'relative', height: 'calc(100% - 48px)',
      marginTop: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
      <div style={{ padding: 24, color: 'var(--muted-foreground)' }}>
        直接渲染生产 Dock、会话 hook、输入区和消息组件；网络为本地夹具。
      </div>
      <AgentChatDock isOpen={open} onOpen={() => setOpen(true)}
        onMinimize={() => setOpen(false)} agentIsExecuting={running}
        contextLabel={null} sessions={{ ...sessions,
          busyReason: running ? t.agentConversations.busyAgent : null,
          hasContent: id => sessions.viewCache.hasContent(id) }}
        chatProps={{ conversation: sessions.activeConversation,
          onSendMessage: async text => {
            const id = bridge.getActiveConversationId()!;
            const scope = sessions.captureWriteScope(id)!;
            sessions.writeMessages(scope, [...bridge.getConversation(id)!.messages,
              { id: crypto.randomUUID(), role: 'user', content: text,
                timestamp: new Date() }]);
            return { accepted: true };
          }, onClearMessages: id => { if (id) sessions.clearMessages(id); },
          isLoading: !sessions.isReady, agentMode, onAgentModeChange: setAgentMode,
          agentIsExecuting: running, executionState: state, steering,
          onCancel: () => setRunning(false), yolo, yoloReady: true,
          onYoloChange: setYolo, viewCache: sessions.viewCache,
          draftProjectKey: 'verification', mentionMaterials: [],
          onCreativeBrainstormingClick: () => {}, onPolishClick: () => {},
        }} />
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LocaleProvider>
  <NotificationProvider><Harness /></NotificationProvider>
</LocaleProvider>);
