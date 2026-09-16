/**
 * @vitest-environment node
 *
 * AgentChatDock — structural verification.
 *
 * The project's tsconfig has `jsx: 'preserve'` (Next.js compiles JSX itself via
 * swc), so Vitest cannot mount tsx files containing JSX literals. Following the
 * established pattern in this repo (see ../../__tests__/MaterialCacheBadge.test.tsx
 * and AiImageModal/__tests__/layoutFixes.test.tsx) we read the source files and
 * assert on the structure that matters for the floating Agent dock behaviour:
 *
 *   - dock renders the FAB when closed and the panel (hosting VideoChatWindow)
 *     when open
 *   - the FAB opens the dock; the close button and Escape close it
 *   - a busy indicator shows on the FAB while the Agent is executing
 *   - chatProps are spread through to VideoChatWindow unchanged
 *   - z-dock / z-dock-panel tokens are applied so the dock stays above the
 *     timeline lock overlay during execution (spec R-2)
 *   - the left chat sidebar is gone and the DaVinci panel order is script →
 *     preview → materials, with the dock wired into VideoEditingInterface
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(__dirname, '..');
const dock = readFileSync(resolve(DIR, 'AgentChatDock.tsx'), 'utf-8');
const fab = readFileSync(resolve(DIR, 'AgentChatFloatingButton.tsx'), 'utf-8');
const panel = readFileSync(resolve(DIR, 'AgentChatFloatingPanel.tsx'), 'utf-8');
const hook = readFileSync(resolve(DIR, 'useDraggableFab.ts'), 'utf-8');
const barrel = readFileSync(resolve(DIR, 'index.ts'), 'utf-8');

const INTERFACE = resolve(__dirname, '../../..', 'VideoEditingInterface.tsx');
const interfaceSrc = readFileSync(INTERFACE, 'utf-8');

const I18N = resolve(__dirname, '../../../../..', 'lib', 'i18n.ts');
const i18nSrc = readFileSync(I18N, 'utf-8');

const TAILWIND = resolve(__dirname, '../../../../../..', 'tailwind.config.js');
const tailwindSrc = readFileSync(TAILWIND, 'utf-8');

const CSS = resolve(__dirname, '../../../../..', 'styles', 'video-editing.css');
const cssSrc = readFileSync(CSS, 'utf-8');

describe('AgentChatDock — FAB always mounted + panel overlay', () => {
  it('renders_fab_always: the FAB is mounted unconditionally (no closed-state early return)', () => {
    // FAB now stays mounted while the panel is open (half-covered, never disappears):
    // the old `if (!isOpen) { return <FAB/> }` early-return block is gone.
    expect(dock).toContain('<AgentChatFloatingButton');
    expect(dock).toContain('{presence.mounted && (');
    expect(dock).not.toContain('{isOpen && (');
  });

  it('toggles_panel_on_fab_activate: the FAB activation is wired to a toggle (not onClick={onOpen})', () => {
    // The old `onClick={onOpen}` is gone — activation is now a single onActivate/toggle path (spec R1/R2).
    expect(dock).not.toContain('onClick={onOpen}');
    expect(dock).toContain('onActivate={toggle}');
    expect(dock).toContain('const toggle = ()');
    expect(dock).toContain('if (isOpen) minimize();');
    expect(dock).toContain('onOpen();');
    // open branch renders the panel hosting VideoChatWindow
    expect(dock).toContain('<AgentChatFloatingPanel');
    expect(dock).toContain('key={conversationKey} {...chatProps}');
    expect(dock).toContain('isVisible={isOpen && !presence.isHidden}');
  });

  it('局部 Escape 和水平短线按钮最小化助手', () => {
    expect(dock).toContain("event.key !== 'Escape'");
    expect(dock).toContain('onMinimize()');
    expect(dock).not.toContain("addEventListener('keydown'");
    expect(panel).toContain('onClick={onMinimize}');
    expect(panel).toContain('d="M5 12h14"');
  });

  it('returns focus to the FAB after closing (a11y, spec R-4)', () => {
    expect(dock).toContain('fabRef');
    expect(dock).toContain('fabRef.current?.focus()');
    expect(fab).toContain('forwardRef');
  });
});

describe('AgentChatFloatingButton — busy indicator', () => {
  it('shows_busy_indicator_on_fab_when_executing: toggles the is-busy class', () => {
    expect(fab).toContain("isExecuting ? ' is-busy' : ''");
    expect(fab).toContain('agent-chat-fab');
  });

  it('the dock surfaces the busy label while executing', () => {
    expect(dock).toContain('agentIsExecuting');
    expect(dock).toContain('t.videoEditing.agentDock.busy');
    expect(dock).toContain('t.videoEditing.agentDock.fabLabel');
  });
});

describe('AgentChatDock — draggable FAB (spec 2.4)', () => {
  it('uses the useDraggableFab hook for position + drag handlers', () => {
    expect(dock).toContain("from './useDraggableFab'");
    expect(dock).toContain('useDraggableFab()');
    expect(hook).toContain('export function useDraggableFab');
  });

  it('spreads pointer drag handlers onto the FAB (mouse + touch)', () => {
    expect(fab).toContain('dragHandlers');
    expect(fab).toContain('{...dragHandlers}');
    expect(hook).toContain('onPointerDown');
    expect(hook).toContain('onPointerMove');
    expect(hook).toContain('onPointerUp');
  });

  it('single activation path: onClick guarded by movedRef, pointerup never activates (spec R1)', () => {
    expect(fab).toContain('movedRef');
    expect(fab).toContain('movedRef.current && event.detail !== 0');
    expect(fab).toContain('onActivate()');
    // the hook's pointer handlers must NOT call onActivate (no double-trigger)
    expect(hook).not.toContain('onActivate');
  });

  it('applies the is-dragging visual state and inline position', () => {
    expect(fab).toContain('is-dragging');
    expect(fab).toContain('position ?');
  });

  it('uses a drag threshold and a resize guard', () => {
    expect(hook).toContain('DRAG_THRESHOLD');
    expect(hook).toContain("addEventListener('resize'");
  });

  it('面板使用布局尺寸钳制，并观察工作区及面板尺寸变化', () => {
    expect(dock).toContain('anchor={position}');
    expect(panel).toContain('anchor');
    expect(panel).toContain('element.offsetWidth');
    expect(panel).toContain('element.offsetHeight');
    expect(panel).toContain('new ResizeObserver');
    expect(panel).toContain('FAB_HALF');
  });

  it('the CSS gives the FAB drag affordances', () => {
    expect(cssSrc).toContain('touch-action: none');
    expect(cssSrc).toContain('cursor: grab');
    expect(cssSrc).toContain('.agent-chat-fab.is-dragging');
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

describe('AgentChatDock — z-index tokens applied (spec R-2)', () => {
  it('the FAB carries z-dock and the panel carries z-dock-panel', () => {
    expect(fab).toContain('agent-chat-fab z-dock');
    expect(panel).toContain('agent-chat-floating-panel z-dock-panel');
  });

  it('tailwind defines the dock / dock-panel semantic tokens above the lock overlay (50)', () => {
    expect(tailwindSrc).toContain("dock: '850'");
    expect(tailwindSrc).toContain("'dock-panel': '860'");
  });

  it('工作区内宽高夹定，移除旧入场动画和窄屏规则', () => {
    expect(cssSrc).toContain('.agent-chat-fab');
    expect(cssSrc).toContain('.agent-chat-floating-panel');
    expect(cssSrc).toContain('clamp(360px, 32%, 520px)');
    expect(cssSrc).toContain('clamp(320px, 80%, 760px)');
    expect(cssSrc).not.toContain('agent-panel-in');
    expect(fab).toContain('isOccluded || isFocused || isDragging ? 861');
  });
});

describe('AgentChatDock — barrel export', () => {
  it('re-exports AgentChatDock from its module index', () => {
    expect(barrel).toContain("export { default as AgentChatDock } from './AgentChatDock'");
  });
});

describe('i18n agentDock keys (interface + en + zh)', () => {
  it('declares the agentDock type signature under videoEditing', () => {
    expect(i18nSrc).toContain('agentDock: {');
    expect(i18nSrc).toContain('fabLabel: string;');
    expect(i18nSrc).toContain('panelTitle: string;');
    expect(i18nSrc).toContain('minimize: string;');
    expect(i18nSrc).toContain('busy: string;');
  });

  it('has English translations', () => {
    expect(i18nSrc).toContain("fabLabel: 'AI editing assistant'");
    expect(i18nSrc).toContain("busy: 'Agent running…'");
  });

  it('has Chinese translations', () => {
    expect(i18nSrc).toContain("fabLabel: 'AI 剪辑助手'");
    expect(i18nSrc).toContain("busy: 'Agent 执行中…'");
  });
});

describe('VideoEditingInterface — DaVinci layout + dock wiring', () => {
  it('removes the left chat sidebar and its inline VideoChatWindow mount', () => {
    expect(interfaceSrc).not.toContain('video-editing-left-sidebar');
    expect(interfaceSrc).not.toContain('<VideoChatWindow');
  });

  it('mounts the AgentChatDock with the open/close state and chatProps', () => {
    expect(interfaceSrc).toContain('<AgentChatDock');
    expect(interfaceSrc).toContain('isOpen={isAgentDockOpen}');
    expect(interfaceSrc).toContain('onOpen={() => setIsAgentDockOpen(true)}');
    expect(interfaceSrc).toContain('onMinimize={() => setIsAgentDockOpen(false)}');
    expect(interfaceSrc).toContain('chatProps={{');
  });

  it('declares the isAgentDockOpen memory state (default closed, not persisted)', () => {
    expect(interfaceSrc).toContain('const [isAgentDockOpen, setIsAgentDockOpen] = useState<boolean>(false)');
  });

  it('anchors the workspace root with relative for absolute dock positioning', () => {
    expect(interfaceSrc).toContain('flex-1 flex min-h-0 overflow-hidden relative');
  });

  it('orders the upper panels script → preview → materials', () => {
    const scriptIdx = interfaceSrc.indexOf('video-editing-script-panel');
    const playerIdx = interfaceSrc.indexOf('video-editing-player-panel');
    const materialsIdx = interfaceSrc.indexOf('video-editing-materials-panel');
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(playerIdx).toBeGreaterThan(scriptIdx);
    expect(materialsIdx).toBeGreaterThan(playerIdx);
  });
});

describe('video-editing.css — DaVinci 25/50/25 layout', () => {
  it('drops the left sidebar rule', () => {
    expect(cssSrc).not.toContain('.video-editing-left-sidebar');
  });

  it('right area is full width; script/materials are 25%, preview flexes to fill', () => {
    expect(cssSrc).toContain('.video-editing-right-area');
    expect(cssSrc).toMatch(/\.video-editing-script-panel\s*\{[^}]*width:\s*25%/);
    expect(cssSrc).toMatch(/\.video-editing-materials-panel\s*\{[^}]*width:\s*25%/);
    expect(cssSrc).toMatch(/\.video-editing-player-panel\s*\{[^}]*flex:\s*1/);
  });
});
