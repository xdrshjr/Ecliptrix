import { describe, expect, it } from 'vitest';
import { translations } from '@/lib/i18n';

/**
 * YOLO 文案的 en / zh 对称性
 * （docs/plans/agent-yolo-autonomous-mode spec.md §4.9.6 / AC-E1）。
 */

const EN = translations.en;
const ZH = translations['zh-CN'];

describe('i18n：YOLO 文案', () => {
  it('declares the same videoChatWindow.yolo* keys in both locales', () => {
    const enKeys = Object.keys(EN.videoChatWindow).filter(key => key.startsWith('yolo'));
    const zhKeys = Object.keys(ZH.videoChatWindow).filter(key => key.startsWith('yolo'));
    expect(enKeys.length).toBeGreaterThanOrEqual(11);
    expect(new Set(enKeys)).toEqual(new Set(zhKeys));
  });

  it('has no empty strings and keeps YOLO untranslated', () => {
    for (const locale of [EN, ZH]) {
      for (const [key, value] of Object.entries(locale.videoChatWindow)) {
        if (!key.startsWith('yolo')) continue;
        expect(typeof value).toBe('string');
        expect((value as string).trim().length).toBeGreaterThan(0);
      }
      expect(locale.videoChatWindow.yoloToggleLabel).toBe('YOLO');
    }
  });

  it('keeps the tooltip sentences short enough for the 360px panel', () => {
    for (const locale of [EN, ZH]) {
      expect(locale.videoChatWindow.yoloTitleOn.length).toBeLessThanOrEqual(96);
      expect(locale.videoChatWindow.yoloTitleOff.length).toBeLessThanOrEqual(96);
    }
  });

  it('declares the settings section copy in both locales', () => {
    for (const locale of [EN, ZH]) {
      const autonomy = locale.agentSettings.autonomy;
      expect(autonomy.title.trim()).not.toBe('');
      expect(autonomy.description.trim()).not.toBe('');
      expect(autonomy.saveFailed.trim()).not.toBe('');
    }
    expect(Object.keys(EN.agentSettings.autonomy))
      .toEqual(Object.keys(ZH.agentSettings.autonomy));
  });
});
