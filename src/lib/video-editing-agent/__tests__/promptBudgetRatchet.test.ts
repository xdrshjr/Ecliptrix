/**
 * L0 提示词预算的**回归网**（spec `agent-browser-workspace-r3` §2.1.3 / AC-R3-1..3）。
 *
 * 三件事，缺一不算：
 *
 * 1. **逐段棘轮**：12 段任一段超过基线即红，并报出是哪一段。基线数字由
 *    `measurePrompt()` 实测写入 `prompt-budget-baseline.json`（`WRITE_PROMPT_BUDGET_BASELINE=1`
 *    时重写），**禁止手填**——评审 P0-3 的教训是手算的分段数字与实测差 2 506 字符。
 * 2. **上限一致性**：`L0_PROMPT_CHAR_CEILING === L0_NO_INDEX_CHAR_MAX + SKILL_INDEX_TOTAL_MAX_CHARS`。
 *    这条等式替代了被删掉的「净增 ≤400」断言（那条与「索引段 ≤1 300」数学上互斥，
 *    见 spec §2.1.1 的算术证明），它保证以后没人能再手填一个不相容的常数。
 * 3. **规则锚点**：压缩 `视频轨道时长规则` + `同轨不可重叠` 两段时**只许同义压缩、
 *    不许删规则**。12 条锚点逐条断言仍在，是「减字不减约束」的唯一可验证办法。
 *
 * 运行：`npx vitest run --environment node src/lib/video-editing-agent/__tests__/promptBudgetRatchet.test.ts`
 * （`--environment node` 必需：默认 jsdom 下本目录的依赖链加载即失败，见 spec §2.1.4）
 */

/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { L0_NO_INDEX_CHAR_MAX, L0_PROMPT_CHAR_CEILING } from '../systemPrompt';
import { SKILL_INDEX_TOTAL_MAX_CHARS } from '../skillContext';
import {
  DERIVED_PROMPT_CEILING,
  MAX_INDEX,
  measurePrompt,
  renderWorstCasePrompt,
  type PromptBudgetBaseline,
  type PromptSegmentName,
} from './fixtures/promptBudget';

const BASELINE_PATH = join(__dirname, 'fixtures', 'prompt-budget-baseline.json');

function loadBaseline(): PromptBudgetBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as PromptBudgetBaseline;
}

const SEGMENT_NAMES: PromptSegmentName[] = [
  'rules', 'residentTools', 'onDemandCatalog', 'coreWorkflowTools', 'projectState',
  'recipes', 'skillIndex', 'trackDuration', 'noOverlap', 'generalResident',
  'plan', 'memory',
];

/**
 * §2.1.3 的 12 条规则锚点。压缩两段强制约束时，任何一条不再匹配即为缺陷：
 * 说明有人为了减字符把规则删了（spec R-3，**高**风险）。
 */
const RULE_ANCHORS: ReadonlyArray<{ id: number; label: string; pattern: RegExp }> = [
  { id: 1, label: '视频轨道必须是最长轨道', pattern: /视频轨道必须是最长的轨道/ },
  { id: 2, label: '明确时长只能由用户修改', pattern: /明确时长只能由用户修改/ },
  { id: 3, label: '不为消警告延长总长', pattern: /不为消警告延长总长/ },
  { id: 4, label: '多片段首尾相连不留空隙', pattern: /首尾相连[\s\S]{0,6}不留空隙/ },
  { id: 5, label: '编辑后查 get_timeline 的 constraintCheck', pattern: /get_timeline[^\n]{0,40}constraintCheck/ },
  { id: 6, label: '同轨任意两片段区间不得重叠', pattern: /同一轨道[^\n]{0,24}区间不得重叠/ },
  { id: 7, label: 'overlapWarning 必须立即 auto_fix_overlaps 一次', pattern: /overlapWarning[\s\S]{0,60}auto_fix_overlaps[\s\S]{0,12}一次/ },
  { id: 8, label: '报告完成之前 check_timeline_overlaps 至 valid=true', pattern: /报告完成之?前[\s\S]{0,120}valid=true/ },
  { id: 9, label: '连续 2 次 fixedCount=0 或 noop=true 立即停止', pattern: /连续 2 次[\s\S]{0,24}fixedCount=0[\s\S]{0,24}noop=true/ },
  { id: 10, label: 'autoFixable=false 的 subtitle/locked 不自动修', pattern: /autoFixable=false[\s\S]{0,60}subtitle\/locked/ },
  { id: 11, label: '自检仅用于编辑路径', pattern: /仅用于编辑路径/ },
  { id: 12, label: '刻意留白用 move_clip 显式调整', pattern: /刻意留白[\s\S]{0,24}move_clip/ },
];

/** 强制约束两段在提示词里的切片（锚点起、到通用层引导止）。 */
function hardConstraintsSlice(): string {
  const text = renderWorstCasePrompt(MAX_INDEX);
  const start = text.indexOf('## ⚠️ 强制约束：视频轨道时长规则');
  const stop = text.indexOf('For a task with 3+ steps');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(stop).toBeGreaterThan(start);
  return text.slice(start, stop);
}

describe('L0 规则锚点（减字不减约束）', () => {
  it('keeps all 12 hard-constraint rules matchable after compression', () => {
    const slice = hardConstraintsSlice();
    const missing = RULE_ANCHORS
      .filter(rule => !rule.pattern.test(slice))
      .map(rule => `#${rule.id} ${rule.label}`);
    expect(missing, `丢失的规则锚点：${missing.join(' | ')}`).toEqual([]);
  });

  it('keeps the two hard-constraint headings intact', () => {
    const text = renderWorstCasePrompt(MAX_INDEX);
    expect(text).toContain('## ⚠️ 强制约束：视频轨道时长规则');
    expect(text).toContain('## ⚠️ 强制约束：同轨不可重叠（反思-修复闭环）');
  });

  it('keeps the browser rule exempt from every compression (I-5)', () => {
    // 浏览器规则 132 字符 / YOLO 变体 119 字符是全 L0 里唯一不可压缩的安全规则。
    const text = renderWorstCasePrompt(MAX_INDEX);
    expect(text).toContain('实时/真实内容走浏览器');
    expect(text).toContain('真实照片禁用 AI 图冒充');
  });
});

describe('L0 上限可推导（替代被删除的「净增 ≤400」）', () => {
  it('derives the ceiling as no-index max + skill index budget', () => {
    expect(L0_NO_INDEX_CHAR_MAX).toBe(18_500);
    expect(SKILL_INDEX_TOTAL_MAX_CHARS).toBe(1_300);
    expect(L0_PROMPT_CHAR_CEILING).toBe(19_800);
    // 这条等式就是「19 800 不是手填」的机器证据（spec §2.1.2 / AC-R3-1）。
    expect(L0_PROMPT_CHAR_CEILING).toBe(DERIVED_PROMPT_CEILING);
    expect(DERIVED_PROMPT_CEILING).toBe(L0_NO_INDEX_CHAR_MAX + SKILL_INDEX_TOTAL_MAX_CHARS);
  });

  it('keeps the worst case inside both ceilings', () => {
    const measured = measurePrompt();
    expect(measured.noIndexTotal).toBeLessThanOrEqual(L0_NO_INDEX_CHAR_MAX);
    expect(measured.total).toBeLessThanOrEqual(L0_PROMPT_CHAR_CEILING);
    expect(measured.indexSection).toBeLessThanOrEqual(SKILL_INDEX_TOTAL_MAX_CHARS);
  });

  it('keeps the index section the only difference between the two worst cases', () => {
    const measured = measurePrompt();
    // 满索引 − 无索引 必须正好等于「索引段 + 段间分隔符」：否则说明索引之外的
    // 段也随索引变化，「18 500 + 1 300 = 19 800」这条推导就失效了。
    // 分隔符固定为 `sections.join('\n\n')` 的 2 个字符（spec §2.1.2）。
    const SECTION_SEPARATOR = 2;
    expect(measured.total - measured.noIndexTotal)
      .toBe(measured.indexSection + SECTION_SEPARATOR);
  });
});

describe('L0 逐段棘轮（任一段增长即红并可定位）', () => {
  const measured = measurePrompt();

  // spec §5.1：基线由实测写入，禁止手改。设 WRITE_PROMPT_BUDGET_BASELINE=1 时重写。
  if (process.env.WRITE_PROMPT_BUDGET_BASELINE === '1') {
    const baseline: PromptBudgetBaseline = {
      version: 1,
      measuredAt: new Date().toISOString().slice(0, 10),
      noIndexTotal: measured.noIndexTotal,
      fullIndexTotal: measured.total,
      indexSection: measured.indexSection,
      segments: measured.segments,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  }

  it('measures all 12 segments', () => {
    expect(Object.keys(measured.segments).sort()).toEqual([...SEGMENT_NAMES].sort());
    for (const name of SEGMENT_NAMES) {
      expect(measured.segments[name], `段 ${name} 长度为 0，可能锚点已失效`).toBeGreaterThan(0);
    }
  });

  it('keeps every segment under its measured baseline', () => {
    const baseline = loadBaseline();
    const grown = SEGMENT_NAMES
      .filter(name => measured.segments[name] > baseline.segments[name])
      .map(name => `${name}: ${measured.segments[name]} > ${baseline.segments[name]}`);
    expect(grown, `超出基线的段：${grown.join(' | ')}`).toEqual([]);
  });

  it('keeps the totals under the baseline', () => {
    const baseline = loadBaseline();
    expect(measured.noIndexTotal).toBeLessThanOrEqual(baseline.noIndexTotal);
    expect(measured.total).toBeLessThanOrEqual(baseline.fullIndexTotal);
    expect(measured.indexSection).toBeLessThanOrEqual(baseline.indexSection);
  });

  it('records a baseline that is itself inside the product ceilings', () => {
    const baseline = loadBaseline();
    // 基线不能比产品上限更宽，否则「棘轮绿 + 产品红」会同时成立，看起来像通过。
    expect(baseline.noIndexTotal).toBeLessThanOrEqual(L0_NO_INDEX_CHAR_MAX);
    expect(baseline.fullIndexTotal).toBeLessThanOrEqual(L0_PROMPT_CHAR_CEILING);
  });
});
