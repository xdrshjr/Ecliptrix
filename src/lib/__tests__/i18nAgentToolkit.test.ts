import { describe, expect, it } from 'vitest';
import { translations } from '../i18n';

/**
 * `agentToolkit` 命名空间的双语一致性（AC-22 / R-27）。
 *
 * 仓库此前**没有** en/zh 键集合校验测试，这里是第一条：任何只加了一种语言的
 * 键都会立刻变红，而不是等到界面上出现空白文案。
 */

const TOOL_NAMES = [
  'update_plan', 'ask_user', 'workspace_list', 'workspace_read',
  'workspace_write', 'workspace_delete', 'workspace_import_material',
  'read_document', 'run_analysis', 'memory_write', 'memory_search',
  'memory_forget',
];

describe('agentToolkit i18n', () => {
  it('has the same key set in en and zh-CN', () => {
    const en = Object.keys(translations.en.agentToolkit).sort();
    const zh = Object.keys(translations['zh-CN'].agentToolkit).sort();
    expect(zh).toEqual(en);
  });

  it('never ships an empty string', () => {
    for (const locale of ['en', 'zh-CN'] as const) {
      for (const [key, value] of Object.entries(
        translations[locale].agentToolkit)) {
        if (key === 'tools') continue;
        expect(String(value).trim().length, `${locale}.${key}`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('names all 12 toolkit tools in both languages', () => {
    for (const locale of ['en', 'zh-CN'] as const) {
      const tools = translations[locale].agentToolkit.tools;
      expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES].sort());
      for (const name of TOOL_NAMES) {
        expect(tools[name].trim().length, `${locale}.tools.${name}`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('keeps the two mandatory sandbox risk sentences', () => {
    // 规格要求面板文案同时包含两句：非内核级隔离 + 没有内存上限（§6.1）。
    // 中文句子短，所以只断言「有实质内容」而不是字节数。
    for (const locale of ['en', 'zh-CN'] as const) {
      const copy = translations[locale].agentToolkit;
      expect(copy.analysisRisk.length).toBeGreaterThan(40);
      expect(copy.analysisRiskNoMemory.length).toBeGreaterThan(8);
    }
  });
});


/**
 * `agentVision` 命名空间的双语一致性（agent-visual-review AC-21）。
 *
 * 与上面同一套纪律，另外多钉三条：15 条自检规则标题、19 个错误码文案、
 * 4 个工具名都必须两种语言齐备——它们都是卡片与面板的渲染输入，缺一个就会在
 * 用户面前显示成 key 或空白。
 */

const LINT_CODES = [
  'missing_material', 'clip_bounds', 'item_overlap', 'subtitle_overflow',
  'subtitle_overlap', 'subtitle_style_drift', 'track_hidden', 'audio_gap',
  'volume_out_of_range', 'upscale_blur', 'static_image_too_long',
  'timeline_gap', 'cover_not_applied', 'duration_mismatch', 'timeline_empty',
];

// 工具的人类可读名沿用 `agentTimeline.toolNames`（ToolStep 也读它），
// 不新增第二份：一处命名，两处消费。
const VISION_TOOLS = [
  'view_image', 'review_frames', 'inspect_export', 'check_timeline',
];

const VISION_ERROR_CODES = [
  'vision_disabled', 'vision_unavailable', 'vision_quota_exceeded',
  'model_not_multimodal', 'model_failed', 'model_timeout',
  'source_not_found', 'source_unsupported', 'image_too_large',
  'image_invalid', 'image_encode_failed', 'ffmpeg_unavailable',
  'composition_not_found', 'observation_not_found', 'invalid_call_id',
  'origin_forbidden', 'request_too_large', 'storage_unavailable',
  'invalid_argument',
];

describe('agentVision i18n', () => {
  it('has the same key set in en and zh-CN', () => {
    const en = Object.keys(translations.en.agentVision).sort();
    const zh = Object.keys(translations['zh-CN'].agentVision).sort();
    expect(zh).toEqual(en);
  });

  it('never ships an empty string', () => {
    for (const locale of ['en', 'zh-CN'] as const) {
      for (const [key, value] of Object.entries(
        translations[locale].agentVision)) {
        if (key === 'errors' || key === 'lint') continue;
        expect(String(value).trim().length, `${locale}.${key}`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('titles all 15 self-check rules in both languages', () => {
    for (const locale of ['en', 'zh-CN'] as const) {
      const lint = translations[locale].agentVision.lint;
      expect(Object.keys(lint).sort()).toEqual([...LINT_CODES].sort());
      for (const code of LINT_CODES) {
        expect(lint[code].trim().length, `${locale}.lint.${code}`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('explains every user-actionable vision error code', () => {
    // `invalid_call_id` / `origin_forbidden` 是内部闸门失败（调用方 bug 或
    // 跨源攻击），用户无事可做，卡片按 `visionErrorKey()` 回落到 internal，
    // 因此刻意不占文案位。
    const internal = new Set(['invalid_call_id', 'origin_forbidden']);
    for (const locale of ['en', 'zh-CN'] as const) {
      const errors = translations[locale].agentVision.errors;
      for (const code of VISION_ERROR_CODES) {
        if (internal.has(code)) continue;
        expect(errors[code], `${locale}.errors.${code}`).toBeDefined();
        expect(errors[code].trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('names all four vision tools in both languages', () => {
    for (const locale of ['en', 'zh-CN'] as const) {
      const tools = translations[locale].agentTimeline.toolNames;
      for (const name of VISION_TOOLS) {
        const label = (tools as Record<string, string>)[name];
        expect(label, `${locale}.toolNames.${name}`).toBeDefined();
        expect(label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the fixed "self-check has no switch" sentence', () => {
    // §4.12 / P2-10：这句话缺失，用户就会以为「关掉视觉 = 关掉自检」。
    for (const locale of ['en', 'zh-CN'] as const) {
      expect(translations[locale].agentVision.lintAlwaysOn.length)
        .toBeGreaterThan(20);
    }
  });
});
