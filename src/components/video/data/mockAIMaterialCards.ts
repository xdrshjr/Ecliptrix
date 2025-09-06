import { AIMaterialCard, AIMaterialCategory } from '../types';

export const mockAIMaterialCards: AIMaterialCard[] = [
  // Text-to-Image 默认卡片
  {
    id: 'flux-text-to-image',
    name: 'FLUX.1 文生图',
    description: '基于FLUX.1模型的高质量文生图工具，支持多种风格和尺寸',
    category: 'text-to-image',
    thumbnailUrl: '/api/placeholder/300/200?text=FLUX+Text+to+Image',
    isDefault: true,
    parameters: [
      {
        id: 'positive_prompt',
        name: 'positive_prompt',
        type: 'text',
        label: '正面提示词',
        placeholder: '请输入图像描述，如：一只可爱的小猫坐在花园里',
        required: true,
        defaultValue: ''
      },
      {
        id: 'negative_prompt',
        name: 'negative_prompt',
        type: 'text',
        label: '负面提示词',
        placeholder: '请输入不希望出现的内容，如：模糊、低质量',
        required: false,
        defaultValue: 'blurry, low quality, distorted'
      },
      {
        id: 'width',
        name: 'width',
        type: 'select',
        label: '图像宽度',
        required: true,
        defaultValue: 1024,
        options: [
          { value: 512, label: '512px' },
          { value: 768, label: '768px' },
          { value: 1024, label: '1024px' },
          { value: 1280, label: '1280px' },
          { value: 1536, label: '1536px' }
        ]
      },
      {
        id: 'height',
        name: 'height',
        type: 'select',
        label: '图像高度',
        required: true,
        defaultValue: 1024,
        options: [
          { value: 512, label: '512px' },
          { value: 768, label: '768px' },
          { value: 1024, label: '1024px' },
          { value: 1280, label: '1280px' },
          { value: 1536, label: '1536px' }
        ]
      },
      {
        id: 'steps',
        name: 'steps',
        type: 'slider',
        label: '采样步数',
        required: true,
        defaultValue: 20,
        min: 10,
        max: 100,
        step: 1
      },
      {
        id: 'cfg',
        name: 'cfg',
        type: 'slider',
        label: 'CFG Scale',
        required: true,
        defaultValue: 7.5,
        min: 1,
        max: 20,
        step: 0.5
      },
      {
        id: 'seed',
        name: 'seed',
        type: 'number',
        label: '随机种子 (可选)',
        placeholder: '留空则随机生成',
        required: false,
        defaultValue: null
      }
    ]
  },
  
  // Text-to-Video 默认卡片
  {
    id: 'wan-text-to-video',
    name: 'WAN2.2 文生视频',
    description: '基于WAN2.2模型的高质量文生视频工具，支持多种长宽比和时长',
    category: 'text-to-video',
    thumbnailUrl: '/api/placeholder/300/200?text=WAN+Text+to+Video',
    isDefault: true,
    parameters: [
      {
        id: 'positive_prompt',
        name: 'positive_prompt',
        type: 'text',
        label: '正面提示词',
        placeholder: '请输入视频描述，如：一只小鸟在蓝天中自由飞翔',
        required: true,
        defaultValue: ''
      },
      {
        id: 'negative_prompt',
        name: 'negative_prompt',
        type: 'text',
        label: '负面提示词',
        placeholder: '请输入不希望出现的内容',
        required: false,
        defaultValue: 'blurry, low quality, static'
      },
      {
        id: 'aspect_ratio',
        name: 'aspect_ratio',
        type: 'select',
        label: '宽高比',
        required: true,
        defaultValue: '16:9',
        options: [
          { value: '16:9', label: '16:9 (横屏)' },
          { value: '9:16', label: '9:16 (竖屏)' },
          { value: '1:1', label: '1:1 (方形)' },
          { value: '4:3', label: '4:3' },
          { value: '3:4', label: '3:4' },
          { value: '21:9', label: '21:9 (超宽屏)' }
        ]
      },
      {
        id: 'duration_seconds',
        name: 'duration_seconds',
        type: 'slider',
        label: '视频时长 (秒)',
        required: true,
        defaultValue: 5,
        min: 2,
        max: 10,
        step: 1
      },
      {
        id: 'steps',
        name: 'steps',
        type: 'slider',
        label: '采样步数',
        required: true,
        defaultValue: 30,
        min: 10,
        max: 100,
        step: 1
      },
      {
        id: 'enable_lora',
        name: 'enable_lora',
        type: 'select',
        label: '启用LoRA增强',
        required: true,
        defaultValue: false,
        options: [
          { value: false, label: '禁用' },
          { value: true, label: '启用' }
        ]
      },
      {
        id: 'seed',
        name: 'seed',
        type: 'number',
        label: '随机种子 (可选)',
        placeholder: '留空则随机生成',
        required: false,
        defaultValue: null
      }
    ]
  }
];

export const aiMaterialCategories = [
  {
    id: 'text-to-image' as AIMaterialCategory,
    name: '文生图',
    icon: '🎨'
  },
  {
    id: 'image-to-image' as AIMaterialCategory,
    name: '图生图',
    icon: '🖼️'
  },
  {
    id: 'text-to-video' as AIMaterialCategory,
    name: '文生视频',
    icon: '🎬'
  },
  {
    id: 'image-to-video' as AIMaterialCategory,
    name: '图生视频',
    icon: '🎞️'
  },
  {
    id: 'digital-human' as AIMaterialCategory,
    name: '数字人',
    icon: '👤'
  }
];

export const getCardsForCategory = (category: AIMaterialCategory): AIMaterialCard[] => {
  return mockAIMaterialCards.filter(card => card.category === category);
};