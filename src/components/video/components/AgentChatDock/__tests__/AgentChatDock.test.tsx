/**
 * @vitest-environment node
 *
 * AgentChatDock — structural verification of the floating assistant
 * (editor-shell-ui-consolidation W5: the draggable FAB + floating panel are
 * restored from b4f6a4a, the right-hand drawer is removed).
 *
 * The project's tsconfig has `jsx: 'preserve'`, so this file asserts on the
 * source text; behaviour (open from the FAB, focus, Escape, context line,
 * conversation survival) is covered by AgentChatDock.lifecycle.test.tsx and
 * useDraggableFab.test.ts, which mount the real code.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(__dirname, '..');
const dock = readFileSync(resolve(DIR, 'AgentChatDock.tsx'), 'utf-8');
const fab = readFileSync(resolve(DIR, 'AgentChatFloatingButton.tsx'), 'utf-8');
const panel = readFileSync(resolve(DIR, 'AgentChatFloatingPanel.tsx'), 'utf-8');
const barrel = readFileSync(resolve(DIR, 'index.ts'), 'utf-8');

const INTERFACE = resolve(__dirname, '../../..', 'VideoEditingInterface.tsx');
const interfaceSrc = readFileSync(INTERFACE, 'utf-8');
const TOP_BAR = resolve(__dirname, '../../..', 'workbench', 'EditorTopBar.tsx');
const topBarSrc = readFileSync(TOP_BAR, 'utf-8');

const STYLES = resolve(__dirname, '../../../../..', 'styles');
const cssSrc = readFileSync(resolve(STYLES, 'video-editing.css'), 'utf-8');
const workbenchCss = readFileSync(resolve(STYLES, 'editor-workbench.css'), 'utf-8');

function cssRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[2] : '';
}

describe('AgentChatDock — floating button replaces the drawer', () => {
  it('the FAB, its drag hook and the floating panel exist; the drawer is gone', () => {
    expect(existsSync(resolve(DIR, 'AgentChatFloatingButton.tsx'))).toBe(true);
    expect(existsSync(resolve(DIR, 'useDraggableFab.ts'))).toBe(true);
    expect(existsSync(resolve(DIR, 'AgentChatFloatingPanel.tsx'))).toBe(true);
    expect(existsSync(resolve(DIR, 'AgentChatDrawer.tsx'))).toBe(false);
    expect(dock).toContain('useDraggableFab(fabRef)');
    expect(dock).toContain('onOpen();');
  });

  it('the FAB is always mounted and activation toggles the panel', () => {
    expect(dock).toContain('<AgentChatFloatingButton');
    expect(dock).toContain('onActivate={toggle}');
    expect(dock).toContain('if (isOpen) minimize();');
    expect(dock).toContain('{presence.mounted && (');
    expect(dock).toContain('<AgentChatFloatingPanel');
    expect(dock).toContain('key={conversationKey} {...chatProps}');
    expect(dock).toContain('isVisible={isOpen && !presence.isHidden}');
  });

  it('the panel carries the stable AGENT_PANEL_ID the top bar points at', () => {
    expect(dock).toContain("export const AGENT_PANEL_ID = 'ws-assistant-panel';");
    expect(dock).toContain('panelId={AGENT_PANEL_ID}');
    expect(dock).not.toContain('useId');
    expect(topBarSrc).toContain('aria-controls={AGENT_PANEL_ID}');
  });

  it('shows the context line under the panel title', () => {
    expect(dock).toContain(
      'contextLabel={contextLabel ?? t.workbench.assistant.contextProject}',
    );
    expect(panel).toContain('data-dock-context');
  });

  it('Escape is handled only inside the panel and never while composing', () => {
    expect(dock).toContain("event.key !== 'Escape'");
    expect(dock).toContain('event.nativeEvent.isComposing');
    expect(dock).not.toContain("addEventListener('keydown'");
  });

  it('returns focus to the FAB after closing', () => {
    expect(dock).toContain('fabRef.current?.focus()');
    expect(fab).toContain('forwardRef');
  });
});

describe('AgentChatDock — stacking without the removed tailwind dock tokens', () => {
  it('no z-dock / z-dock-panel classes remain on the JSX', () => {
    expect(fab).not.toMatch(/z-dock/);
    expect(panel).not.toMatch(/z-dock/);
  });

  it('the CSS writes the z-index directly: above the lock overlay, below modals', () => {
    const fabZ = Number(cssRule(cssSrc, '.agent-chat-fab').match(/z-index:\s*(\d+)/)?.[1]);
    const panelZ = Number(
      cssRule(cssSrc, '.agent-chat-floating-panel').match(/z-index:\s*(\d+)/)?.[1],
    );
    expect(fabZ).toBe(850);
    expect(panelZ).toBe(860);
  });

  it('the FAB default position clears the 32px timeline bottom bar', () => {
    expect(cssRule(cssSrc, '.agent-chat-fab')).toMatch(/bottom:\s*48px/);
    expect(cssRule(cssSrc, '.agent-chat-fab')).toContain('var(--primary-foreground)');
  });
});

describe('AgentChatDock — chat props pass-through', () => {
  it('passes_through_chat_props: spreads chatProps into VideoChatWindow', () => {
    expect(dock).toContain('chatProps: VideoChatWindowProps');
    expect(dock).toContain('{...chatProps}');
  });

  it('imports the shared VideoChatWindowProps type (single source of truth)', () => {
    expect(dock).toContain("type VideoChatWindowProps } from '../VideoChatWindow'");
  });
});

describe('AgentChatDock — barrel export', () => {
  it('re-exports AgentChatDock and the panel id from its module index', () => {
    expect(barrel).toContain('default as AgentChatDock');
    expect(barrel).toContain('AGENT_PANEL_ID');
    expect(barrel).not.toContain('AGENT_DRAWER_ID');
  });
});

describe('VideoEditingInterface — floating assistant wiring', () => {
  it('mounts the AgentChatDock in the assistant slot with open/close, busy and context', () => {
    expect(interfaceSrc).toContain('assistant={');
    expect(interfaceSrc).not.toContain('drawer={');
    expect(interfaceSrc).toContain('<AgentChatDock');
    expect(interfaceSrc).toContain('isOpen={isAgentDockOpen} onOpen={() => setIsAgentDockOpen(true)}');
    expect(interfaceSrc).toContain('onMinimize={() => setIsAgentDockOpen(false)}');
    expect(interfaceSrc).toContain('agentIsExecuting={agent.agentIsExecuting}');
    expect(interfaceSrc).toContain('contextLabel=');
    expect(interfaceSrc).toContain('chatProps={{');
  });

  it('keeps the left chat sidebar removed', () => {
    expect(interfaceSrc).not.toContain('video-editing-left-sidebar');
    expect(interfaceSrc).not.toContain('<VideoChatWindow');
  });
});

describe('stylesheets — legacy layout and drawer removed', () => {
  it.each([
    '.video-editing-right-area', '.video-editing-upper-panels',
    '.video-editing-script-panel', '.video-editing-player-panel',
    '.video-editing-materials-panel', '.video-editing-timeline-section',
    '.video-editing-left-sidebar',
  ])('drops the fixed-percentage rule %s', (selector) => {
    expect(cssSrc).not.toContain(selector);
  });

  it('drops the drawer rules', () => {
    expect(workbenchCss).not.toContain('.ws-drawer');
  });

  it('keeps the chat body rules VideoChatWindow still uses', () => {
    expect(cssSrc).toContain('.agent-chat-messages');
    expect(cssSrc).toContain('.agent-chat-input-area');
  });

  it('the FAB is positioned inside .ws-main', () => {
    expect(cssRule(workbenchCss, '.ws-main')).toMatch(/position:\s*relative/);
  });
});
