/**
 * @vitest-environment node
 *
 * AiGenerateMenu — structural verification.
 *
 * The project's tsconfig has `jsx: 'preserve'` (Next.js compiles JSX itself via
 * swc), so Vitest cannot mount tsx files containing JSX literals. Following the
 * established repo pattern (see ../../AgentChatDock/__tests__/AgentChatDock.test.tsx)
 * we read the source and assert on the structure that matters for folding the
 * "Convert All Speech" batch action into the AI-generate dropdown (spec
 * script-panel-toolbar-and-draggable-chat-dock, need 1).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(__dirname, '..');
const menu = readFileSync(resolve(DIR, 'AiGenerateMenu.tsx'), 'utf-8');

const SCRIPT_PANEL = resolve(__dirname, '../../..', 'ScriptPanel.tsx');
const scriptPanel = readFileSync(SCRIPT_PANEL, 'utf-8');

const I18N = resolve(__dirname, '../../../../..', 'lib', 'i18n.ts');
const i18nSrc = readFileSync(I18N, 'utf-8');

describe('AiGenerateMenu — convert-all-speech menu item (spec need 1)', () => {
  it('declares the convert-all-speech props (optional, backward compatible)', () => {
    expect(menu).toContain('onConvertAllSpeech?: () => void;');
    expect(menu).toContain('convertAllSpeechDisabled?: boolean;');
    expect(menu).toContain('isConvertingAllSpeech?: boolean;');
  });

  it('appends the convert-all-speech item only when onConvertAllSpeech is provided', () => {
    expect(menu).toContain("key: 'convert-all-speech'");
    expect(menu).toContain('t.scriptPanel.actions.convertAllSpeech');
    expect(menu).toContain('t.scriptPanel.actions.convertAllSpeechDesc');
    // conditional spread so the item is absent without the callback
    expect(menu).toContain('...(onConvertAllSpeech');
  });

  it('renders a separator before the batch-action item', () => {
    expect(menu).toContain('role="separator"');
    expect(menu).toContain("item.key === 'convert-all-speech'");
  });

  it('selectItem early-returns on disabled/busy items (no accidental trigger)', () => {
    expect(menu).toContain('if (item.disabled || item.busy) return;');
  });

  it('shows disabled / busy visual state on menu items', () => {
    expect(menu).toContain('opacity-50 cursor-not-allowed');
    expect(menu).toContain('aria-disabled');
    expect(menu).toContain('item.busy');
  });
});

describe('ScriptPanel — external batch button folded into the dropdown', () => {
  it('wires handleBatchConvertToSpeech + disabled/busy state into AiGenerateMenu', () => {
    expect(scriptPanel).toContain('onConvertAllSpeech={handleBatchConvertToSpeech}');
    expect(scriptPanel).toContain('convertAllSpeechDisabled={segments.length === 0}');
    expect(scriptPanel).toContain('isConvertingAllSpeech={isBatchConverting}');
    expect(scriptPanel).toContain('isBusy={isGenerating || isBatchConverting}');
  });

  it('removes the standalone Convert-All-Speech toolbar button', () => {
    expect(scriptPanel).not.toContain('onClick={handleBatchConvertToSpeech}');
  });
});

describe('i18n — script panel rename + convertAllSpeechDesc (spec need 2)', () => {
  it('renames the panel title to 文案/脚本 (zh) and Copy / Script (en)', () => {
    expect(i18nSrc).toContain("title: '文案/脚本'");
    expect(i18nSrc).toContain("title: 'Copy / Script'");
  });

  it('declares + translates convertAllSpeechDesc (interface + en + zh)', () => {
    expect(i18nSrc).toContain('convertAllSpeechDesc: string;');
    expect(i18nSrc).toContain("convertAllSpeechDesc: 'Run TTS on every segment in order'");
    expect(i18nSrc).toContain("convertAllSpeechDesc: '对全部片段依次生成语音'");
  });
});
