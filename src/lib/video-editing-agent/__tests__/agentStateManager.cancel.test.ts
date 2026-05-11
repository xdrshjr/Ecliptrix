import { describe, it, expect } from 'vitest';
import { AgentStateManager } from '../AgentStateManager';

describe('AgentStateManager.markCancelled', () => {
  it('seals in-flight tool calls as cancelled and flags the message', () => {
    const sm = new AgentStateManager('msg-1');
    sm.appendText('partial content');
    sm.addToolCall({ id: 'tc-1', name: 'search_materials', params: {}, status: 'executing' });
    sm.updateToolStatus('tc-1', 'completed', { ok: true });
    sm.addToolCall({ id: 'tc-2', name: 'add_to_track', params: {}, status: 'executing' });

    sm.markCancelled({ appendMarker: true });

    const update = sm.toMessageUpdate();
    expect(update.isCancelled).toBe(true);
    expect(update.isStreaming).toBe(false);
    expect(update.content).toContain('_[Stopped by user]_');
    expect(update.agentToolCalls?.[0].status).toBe('completed');
    expect(update.agentToolCalls?.[1].status).toBe('cancelled');
  });

  it('does NOT append the marker when content is empty', () => {
    const sm = new AgentStateManager('msg-2');
    sm.addToolCall({ id: 'tc-1', name: 'search_materials', params: {}, status: 'executing' });
    sm.markCancelled({ appendMarker: true });
    const update = sm.toMessageUpdate();
    expect(update.content).toBe('');
    expect(update.isCancelled).toBe(true);
  });

  it('cancelByNavigation path (appendMarker: false) does not add the marker', () => {
    const sm = new AgentStateManager('msg-3');
    sm.appendText('working');
    sm.addToolCall({ id: 'tc-1', name: 'search_materials', params: {}, status: 'executing' });
    sm.markCancelled({ appendMarker: false });
    const update = sm.toMessageUpdate();
    expect(update.content).toBe('working');
    expect(update.agentToolCalls?.[0].status).toBe('cancelled');
  });

  it('is idempotent — calling twice is a no-op', () => {
    const sm = new AgentStateManager('msg-4');
    sm.appendText('working');
    sm.markCancelled({ appendMarker: true });
    const first = sm.toMessageUpdate();
    sm.markCancelled({ appendMarker: true });
    const second = sm.toMessageUpdate();
    // Content must not have the marker appended twice.
    expect(first.content).toBe(second.content);
    expect(second.content.match(/_\[Stopped by user]_/g)?.length).toBe(1);
  });
});
