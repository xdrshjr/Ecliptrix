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