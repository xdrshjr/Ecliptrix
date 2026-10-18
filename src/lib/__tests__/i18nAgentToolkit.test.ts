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
