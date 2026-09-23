/**
 * @vitest-environment node
 *
 * AgentChatDock — structural verification of the workbench assistant drawer
 * (spec segment-centric-editor-workbench §3.9).
 *
 * The project's tsconfig has `jsx: 'preserve'`, so this file asserts on the
 * source text; behaviour (focus, Escape, context line, conversation survival)
 * is covered by AgentChatDock.lifecycle.test.tsx, which mounts the real
 * components.
 *
 *   - the draggable FAB and the floating panel are gone; the dock renders a
 *     right-hand drawer opened from the top bar / tool-window rail
 *   - the drawer's bottom edge follows `--ws-timeline-h`, so it never covers
 *     the timeline or its zoom controls
 *   - chatProps are spread through to VideoChatWindow unchanged
 *   - the old fixed-percentage DaVinci layout CSS is gone; the workbench
 *     stylesheet owns the layout
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(__dirname, '..');
const dock = readFileSync(resolve(DIR, 'AgentChatDock.tsx'), 'utf-8');
const drawer = readFileSync(resolve(DIR, 'AgentChatDrawer.tsx'), 'utf-8');
const barrel = readFileSync(resolve(DIR, 'index.ts'), 'utf-8');

const INTERFACE = resolve(__dirname, '../../..', 'VideoEditingInterface.tsx');
const interfaceSrc = readFileSync(INTERFACE, 'utf-8');

const STYLES = resolve(__dirname, '../../../../..', 'styles');
const cssSrc = readFileSync(resolve(STYLES, 'video-editing.css'), 'utf-8');
const workbenchCss = readFileSync(resolve(STYLES, 'editor-workbench.css'), 'utf-8');


function cssRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[2] : '';
}

describe('AgentChatDock — drawer replaces the floating button', () => {
  it('the FAB, its drag hook and the floating panel are deleted', () => {
    expect(existsSync(resolve(DIR, 'AgentChatFloatingButton.tsx'))).toBe(false);
    expect(existsSync(resolve(DIR, 'useDraggableFab.ts'))).toBe(false);
    expect(existsSync(resolve(DIR, 'AgentChatFloatingPanel.tsx'))).toBe(false);
    expect(dock).not.toContain('useDraggableFab');
    expect(dock).not.toContain('onOpen');
  });

  it('renders the drawer only once presence mounted it, hosting VideoChatWindow', () => {
    expect(dock).toContain('{presence.mounted && (');
    expect(dock).toContain('<AgentChatDrawer');
    expect(dock).toContain('key={conversationKey} {...chatProps}');
    expect(dock).toContain('isVisible={isOpen && !presence.isHidden}');
  });

  it('is a non-modal dialog section carrying the ws-drawer class', () => {
    expect(drawer).toContain('<section');
    expect(drawer).toContain('className="ws-drawer"');
    expect(drawer).toContain('role="dialog"');
    expect(drawer).toContain('aria-modal="false"');
    expect(drawer).toContain('inert={!presence.isInteractive}');
  });

  it('drawer_does_not_cover_timeline: bottom edge sits on --ws-timeline-h', () => {
    const rule = cssRule(workbenchCss, '.ws-drawer');
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/top:\s*0/);
    expect(rule).toMatch(/right:\s*0/);
    expect(rule).toMatch(/bottom:\s*calc\(var\(--ws-timeline-h\)\s*\+\s*4px\)/);
    expect(rule).toMatch(/width:\s*min\(400px,\s*90%\)/);
    expect(drawer).not.toMatch(/style=\{\{[^}]*bottom/);
  });

  it('drawer_stays_below_top_bar_popovers: one z-index, workbench scale', () => {
    const zIndexOf = (selector: string) =>
      Number(cssRule(workbenchCss, selector).match(/z-index:\s*(\d+)/)?.[1]);
    // A Tailwind z-* class would compete with the CSS rule by load order.
    expect(drawer).not.toMatch(/className="[^"]*z-/);
    expect(zIndexOf('.ws-drawer')).toBeLessThan(zIndexOf('.ws-task-popover'));
    expect(zIndexOf('.ws-drawer')).toBeLessThan(zIndexOf('.ws-menu'));
  });

  it('title bar shows the title, the context line and a labelled close button', () => {
    expect(dock).toContain('title={t.workbench.assistant.title}');
    expect(dock).toContain(
      'contextLabel={contextLabel ?? t.workbench.assistant.contextProject}',
    );
    expect(drawer).toContain('data-drawer-close');
    expect(drawer).toContain('aria-label={closeLabel}');
    expect(drawer).toContain('title={closeLabel}');
  });

  it('Escape is handled only inside the drawer and never while composing', () => {
    expect(dock).toContain("event.key !== 'Escape'");
    expect(dock).toContain('event.nativeEvent.isComposing');
    expect(dock).not.toContain("addEventListener('keydown'");
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
  it('re-exports AgentChatDock and the drawer id from its module index', () => {
    expect(barrel).toContain('default as AgentChatDock');
    expect(barrel).toContain('AGENT_DRAWER_ID');
  });
});

describe('VideoEditingInterface — drawer wiring', () => {
  it('mounts the AgentChatDock with open state, close handler, context and chatProps', () => {
    expect(interfaceSrc).toContain('<AgentChatDock');
    expect(interfaceSrc).toContain('isOpen={isAgentDockOpen}');
    expect(interfaceSrc).toContain('onMinimize={() => setIsAgentDockOpen(false)}');
    expect(interfaceSrc).toContain('contextLabel=');
    expect(interfaceSrc).toContain('chatProps={{');
  });

  it('keeps the left chat sidebar removed', () => {
    expect(interfaceSrc).not.toContain('video-editing-left-sidebar');
    expect(interfaceSrc).not.toContain('<VideoChatWindow');
  });
});

describe('video-editing.css — legacy layout removed (workbench owns layout)', () => {
  it.each([
    '.video-editing-right-area', '.video-editing-upper-panels',
    '.video-editing-script-panel', '.video-editing-player-panel',
    '.video-editing-materials-panel', '.video-editing-timeline-section',
    '.video-editing-left-sidebar',
  ])('drops the fixed-percentage rule %s', (selector) => {
    expect(cssSrc).not.toContain(selector);
  });

  it('drops the floating dock rules', () => {
    expect(cssSrc).not.toContain('.agent-chat-fab');
    expect(cssSrc).not.toContain('.agent-chat-floating-panel');
    expect(cssSrc).not.toContain('agent-fab-pulse');
  });

  it('keeps the chat body rules VideoChatWindow still uses', () => {
    expect(cssSrc).toContain('.agent-chat-messages');
    expect(cssSrc).toContain('.agent-chat-input-area');
  });

  it('the workbench stylesheet provides the panel layout', () => {
    expect(cssRule(workbenchCss, '.ws-left')).toContain('var(--ws-left-w)');
    expect(cssRule(workbenchCss, '.ws-right')).toContain('var(--ws-right-w)');
    expect(cssRule(workbenchCss, '.ws-timeline')).toContain('var(--ws-timeline-h)');
  });
});
