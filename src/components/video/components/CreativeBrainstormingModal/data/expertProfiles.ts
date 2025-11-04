import { ExpertProfile, ConfigCategory } from '../types';
import { Translations } from '@/lib/i18n';

// Expert base info (color and avatar are language-independent)
const expertBaseInfo: Record<string, { color: string; avatar: string }> = {
  'creative-director': { color: '#8B5CF6', avatar: '🎨' },
  'marketing-strategist': { color: '#10B981', avatar: '📊' },
  'content-writer': { color: '#F59E0B', avatar: '✍️' },
  'visual-designer': { color: '#EF4444', avatar: '🎭' },
  'ux-expert': { color: '#3B82F6', avatar: '👤' }
};

// Get expert profiles with translations
export const getExpertProfiles = (translations: Translations['creativeBrainstormingModal']): ExpertProfile[] => {
  const experts = translations.experts;
  
  return [
    {
      id: 'creative-director',
      name: experts.creativeDirector.name,
      title: experts.creativeDirector.title,
      expertise: experts.creativeDirector.expertise,
      personality: experts.creativeDirector.personality,
      color: expertBaseInfo['creative-director'].color,
      avatar: expertBaseInfo['creative-director'].avatar
    },
    {
      id: 'marketing-strategist',
      name: experts.marketingStrategist.name,
      title: experts.marketingStrategist.title,
      expertise: experts.marketingStrategist.expertise,
      personality: experts.marketingStrategist.personality,
      color: expertBaseInfo['marketing-strategist'].color,
      avatar: expertBaseInfo['marketing-strategist'].avatar
    },
    {
      id: 'content-writer',
      name: experts.contentWriter.name,
      title: experts.contentWriter.title,
      expertise: experts.contentWriter.expertise,
      personality: experts.contentWriter.personality,
      color: expertBaseInfo['content-writer'].color,
      avatar: expertBaseInfo['content-writer'].avatar
    },
    {
      id: 'visual-designer',
      name: experts.visualDesigner.name,
      title: experts.visualDesigner.title,
      expertise: experts.visualDesigner.expertise,
      personality: experts.visualDesigner.personality,
      color: expertBaseInfo['visual-designer'].color,
      avatar: expertBaseInfo['visual-designer'].avatar
    },
    {
      id: 'ux-expert',
      name: experts.uxExpert.name,
      title: experts.uxExpert.title,
      expertise: experts.uxExpert.expertise,
      personality: experts.uxExpert.personality,
      color: expertBaseInfo['ux-expert'].color,
      avatar: expertBaseInfo['ux-expert'].avatar
    }
  ];
};

// Legacy export for backward compatibility (will use default locale)
export const expertProfiles: ExpertProfile[] = [];

export const configCategories: ConfigCategory[] = [
  {
    id: 'creationType',
    title: '创作类型',
    description: '选择您的视频内容类型',
    multiple: true,
    options: [
      { id: 'brand-marketing', label: '品牌营销', description: '提升品牌知名度和影响力' },
      { id: 'educational-training', label: '教育培训', description: '知识传授和技能培训' },
      { id: 'entertainment-content', label: '娱乐内容', description: '娱乐观众，提供轻松体验' },
      { id: 'product-showcase', label: '产品展示', description: '展示产品特性和优势' },
      { id: 'storytelling', label: '故事叙述', description: '通过故事传达价值观念' }
    ]
  },
  {
    id: 'creationDomain',
    title: '创作领域',
    description: '选择您的专业领域',
    multiple: true,
    options: [
      { id: 'technology-digital', label: '科技数码', description: '前沿科技和数码产品' },
      { id: 'lifestyle', label: '生活方式', description: '日常生活和个人成长' },
      { id: 'business-finance', label: '商业金融', description: '商业策略和金融知识' },
      { id: 'health-medical', label: '健康医疗', description: '健康养生和医疗科普' },
      { id: 'arts-culture', label: '艺术文化', description: '艺术创作和文化传承' },
      { id: 'travel-food', label: '旅游美食', description: '旅行体验和美食分享' }
    ]
  },
  {
    id: 'creationGoal',
    title: '创作目标',
    description: '明确您的核心目标',
    multiple: true,
    options: [
      { id: 'brand-awareness', label: '提升品牌知名度', description: '增加品牌曝光和认知度' },
      { id: 'user-engagement', label: '增加用户参与度', description: '提高互动和用户黏性' },
      { id: 'knowledge-education', label: '教育普及知识', description: '传播知识和技能' },
      { id: 'sales-promotion', label: '促进产品销售', description: '推动转化和销售增长' },
      { id: 'audience-entertainment', label: '娱乐观众', description: '提供娱乐价值和愉悦体验' }
    ]
  },
  {
    id: 'contentStrategy',
    title: '内容策略',
    description: '选择您的内容策略方向',
    multiple: true,
    options: [
      { id: 'emotional-resonance', label: '情感共鸣', description: '通过情感连接打动观众' },
      { id: 'data-driven', label: '数据驱动', description: '基于数据分析制定策略' },
      { id: 'story-driven', label: '故事导向', description: '用故事传达核心信息' },
      { id: 'interactive-engagement', label: '互动参与', description: '鼓励观众参与和互动' },
      { id: 'professional-authority', label: '专业权威', description: '建立专业形象和权威性' }
    ]
  },
  {
    id: 'creativeExperts',
    title: '创意专家',
    description: '选择参与讨论的专家',
    multiple: true,
    options: [
      { id: 'creative-director', label: '创意总监', description: '负责整体创意方向和执行' },
      { id: 'marketing-strategist', label: '营销策略师', description: '制定市场推广和传播策略' },
      { id: 'content-writer', label: '内容编剧', description: '创作文案内容和故事脚本' },
      { id: 'visual-designer', label: '视觉设计师', description: '设计视觉元素和界面交互' },
      { id: 'ux-expert', label: '用户体验专家', description: '优化用户体验和交互流程' }
    ]
  }
];

export const getExpertById = (id: string, translations: Translations['creativeBrainstormingModal']): ExpertProfile | undefined => {
  const profiles = getExpertProfiles(translations);
  return profiles.find(expert => expert.id === id);
};

export const getExpertsByIds = (ids: string[], translations: Translations['creativeBrainstormingModal']): ExpertProfile[] => {
  const profiles = getExpertProfiles(translations);
  return profiles.filter(expert => ids.includes(expert.id));
}; 