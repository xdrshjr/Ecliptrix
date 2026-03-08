export interface PromptTemplate {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

export const CHARACTER_TEMPLATES: PromptTemplate[] = [
  {
    id: 'anime',
    label: '动漫角色',
    description: '日系动漫风格角色设计',
    prompt: 'Anime style character, detailed outfit design, expressive eyes, colorful hair, dynamic pose',
  },
  {
    id: 'realistic',
    label: '写实人物',
    description: '写实风格人物角色',
    prompt: 'Realistic human character, detailed facial features, natural proportions, professional lighting',
  },
  {
    id: 'chibi',
    label: 'Q版角色',
    description: '可爱Q版风格角色',
    prompt: 'Chibi style character, cute proportions, big head small body, adorable expression, vibrant colors',
  },
  {
    id: 'mecha',
    label: '机甲战士',
    description: '科幻机甲风格角色',
    prompt: 'Mecha warrior character, futuristic armor design, mechanical details, glowing energy elements, sci-fi style',
  },
  {
    id: 'fantasy',
    label: '奇幻角色',
    description: '中世纪奇幻风格',
    prompt: 'Fantasy RPG character, medieval armor and weapons, magical aura, epic fantasy style',
  },
  {
    id: 'pixel',
    label: '像素角色',
    description: '复古像素风格角色',
    prompt: 'Pixel art character design, retro game style, clean pixel work, iconic silhouette',
  },
];

export const SCENE_TEMPLATES: PromptTemplate[] = [
  {
    id: 'interior',
    label: '室内场景',
    description: '精致的室内环境设计',
    prompt: 'Interior environment design, detailed furniture and decorations, atmospheric lighting, cozy ambiance',
  },
  {
    id: 'city',
    label: '城市街道',
    description: '现代或复古城市场景',
    prompt: 'Urban city street scene, buildings and storefronts, pedestrians, street lights, atmospheric perspective',
  },
  {
    id: 'nature',
    label: '自然风景',
    description: '壮丽的自然景观',
    prompt: 'Natural landscape, mountains and forests, river or lake, golden hour lighting, majestic scenery',
  },
  {
    id: 'scifi',
    label: '科幻场景',
    description: '未来科幻世界场景',
    prompt: 'Sci-fi environment, futuristic architecture, holographic displays, neon lights, cyberpunk atmosphere',
  },
  {
    id: 'underwater',
    label: '水下世界',
    description: '神秘的海底场景',
    prompt: 'Underwater environment, coral reef, bioluminescent creatures, light rays through water, mysterious deep sea',
  },
  {
    id: 'ancient',
    label: '古风场景',
    description: '中国古风建筑场景',
    prompt: 'Ancient Chinese architecture scene, traditional buildings, cherry blossoms, misty mountains, ink wash painting style',
  },
];
