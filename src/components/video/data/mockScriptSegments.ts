import { ScriptSegment } from '@/types';

// Mock数据 - 文本脚本片段
export const mockScriptSegments: ScriptSegment[] = [
  {
    id: 'segment-1',
    title: '开场介绍',
    duration: 15,
    sentences: [
      {
        id: 'sentence-1-1',
        text: '大家好，欢迎来到今天的视频教程。',
        startTime: 0,
        endTime: 3
      },
      {
        id: 'sentence-1-2',
        text: '今天我们要学习如何使用这个强大的视频编辑工具。',
        startTime: 3,
        endTime: 8
      },
      {
        id: 'sentence-1-3',
        text: '这个工具可以帮助我们快速创建专业级的视频内容。',
        startTime: 8,
        endTime: 15
      }
    ]
  },
  {
    id: 'segment-2',
    title: '功能演示',
    duration: 25,
    sentences: [
      {
        id: 'sentence-2-1',
        text: '首先，我们来看看界面的基本布局。',
        startTime: 15,
        endTime: 20
      },
      {
        id: 'sentence-2-2',
        text: '左侧是我们的项目文档编辑区域，可以记录项目相关信息。',
        startTime: 20,
        endTime: 27
      },
      {
        id: 'sentence-2-3',
        text: '右侧是视频预览和脚本显示区域。',
        startTime: 27,
        endTime: 32
      },
      {
        id: 'sentence-2-4',
        text: '这样的布局设计让我们能够同时处理文档和视频内容。',
        startTime: 32,
        endTime: 40
      }
    ]
  },
  {
    id: 'segment-3',
    title: '实际操作',
    duration: 30,
    sentences: [
      {
        id: 'sentence-3-1',
        text: '现在让我们开始实际操作演示。',
        startTime: 40,
        endTime: 45
      },
      {
        id: 'sentence-3-2',
        text: '我们可以在左侧编辑器中输入项目相关的文档内容。',
        startTime: 45,
        endTime: 52
      },
      {
        id: 'sentence-3-3',
        text: '同时，右侧的脚本面板会显示对应的文本内容。',
        startTime: 52,
        endTime: 58
      },
      {
        id: 'sentence-3-4',
        text: '这种设计让内容创作变得更加高效和直观。',
        startTime: 58,
        endTime: 65
      },
      {
        id: 'sentence-3-5',
        text: '每个脚本片段都对应着视频中的一个具体段落。',
        startTime: 65,
        endTime: 70
      }
    ]
  }
]; 