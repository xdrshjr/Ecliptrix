import { ScriptSegment } from '@/types';
import { translations, SupportedLocale } from '@/lib/i18n';

// Mock数据 - 文本脚本片段
// 根据语言环境获取对应的脚本片段
export const getMockScriptSegments = (locale: SupportedLocale = 'zh-CN'): ScriptSegment[] => {
  const t = translations[locale];
  
  return [
    {
      id: 'segment-1',
      title: t.defaultContent.scriptSegments.segment1.title,
      duration: 15,
      sentences: [
        {
          id: 'sentence-1-1',
          text: t.defaultContent.scriptSegments.segment1.sentences[0],
          startTime: 0,
          endTime: 3
        },
        {
          id: 'sentence-1-2',
          text: t.defaultContent.scriptSegments.segment1.sentences[1],
          startTime: 3,
          endTime: 8
        },
        {
          id: 'sentence-1-3',
          text: t.defaultContent.scriptSegments.segment1.sentences[2],
          startTime: 8,
          endTime: 15
        }
      ]
    },
    {
      id: 'segment-2',
      title: t.defaultContent.scriptSegments.segment2.title,
      duration: 25,
      sentences: [
        {
          id: 'sentence-2-1',
          text: t.defaultContent.scriptSegments.segment2.sentences[0],
          startTime: 15,
          endTime: 20
        },
        {
          id: 'sentence-2-2',
          text: t.defaultContent.scriptSegments.segment2.sentences[1],
          startTime: 20,
          endTime: 27
        },
        {
          id: 'sentence-2-3',
          text: t.defaultContent.scriptSegments.segment2.sentences[2],
          startTime: 27,
          endTime: 32
        },
        {
          id: 'sentence-2-4',
          text: t.defaultContent.scriptSegments.segment2.sentences[3],
          startTime: 32,
          endTime: 40
        }
      ]
    },
    {
      id: 'segment-3',
      title: t.defaultContent.scriptSegments.segment3.title,
      duration: 30,
      sentences: [
        {
          id: 'sentence-3-1',
          text: t.defaultContent.scriptSegments.segment3.sentences[0],
          startTime: 40,
          endTime: 45
        },
        {
          id: 'sentence-3-2',
          text: t.defaultContent.scriptSegments.segment3.sentences[1],
          startTime: 45,
          endTime: 52
        },
        {
          id: 'sentence-3-3',
          text: t.defaultContent.scriptSegments.segment3.sentences[2],
          startTime: 52,
          endTime: 58
        },
        {
          id: 'sentence-3-4',
          text: t.defaultContent.scriptSegments.segment3.sentences[3],
          startTime: 58,
          endTime: 65
        },
        {
          id: 'sentence-3-5',
          text: t.defaultContent.scriptSegments.segment3.sentences[4],
          startTime: 65,
          endTime: 70
        }
      ]
    }
  ];
};

// 保持向后兼容性的默认导出
export const mockScriptSegments: ScriptSegment[] = getMockScriptSegments();

// 系统「示意 / 模板」脚本的固定 segment id 集合。
// 这组 id 由 getMockScriptSegments 产出且与 locale 无关（id 是字面量，仅文案随 i18n 变化），
// 真实脚本生成路径使用互斥前缀（agent-segment-* / seg-<uuid> / ai-video-seg-* / storyboard-seg-*），
// 永远不会落到 segment-1/2/3。故按段 id 判定「占位」不会误删真实内容（依据见 analysis.md §3.6）。
export const PLACEHOLDER_SEGMENT_IDS: ReadonlySet<string> = new Set(
  getMockScriptSegments().map(segment => segment.id),
);

// 判断一组 segments 是否仍是「系统示意占位」：非空且每个 segment id 都属于占位 id 集合。
// 用「子集（every）」而非严格相等，对「占位内文案/句子被编辑」鲁棒（段 id 不变），
// 也能覆盖「用户先删掉部分占位段再首次生成」的子场景。
export function isPlaceholderScript(segments: ScriptSegment[]): boolean {
  return segments.length > 0
    && segments.every(segment => PLACEHOLDER_SEGMENT_IDS.has(segment.id));
}
