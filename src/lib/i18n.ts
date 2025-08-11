export interface Translations {
  common: {
    newTask: string;
    dashboard: string;
    projects: string;
    library: string;
    privacy: string;
    terms: string;
    support: string;
    systemStatus: string;
    operational: string;
  };
  tasks: {
    contentCreation: string;
    videoEditing: string;
    brainstorming: string;
    aiChat: string;
  };
  welcome: {
    title: string;
    subtitle: string;
    description: string;
    contentCreationDesc: string;
    videoEditingDesc: string;
    brainstormingDesc: string;
    aiChatDesc: string;
  };
  taskContent: {
    willBeImplemented: string;
    workspaceDescription: string;
  };
}

export const translations: Record<string, Translations> = {
  en: {
    common: {
      newTask: 'New Task',
      dashboard: 'Dashboard',
      projects: 'Projects',
      library: 'Library',
      privacy: 'Privacy',
      terms: 'Terms',
      support: 'Support',
      systemStatus: 'System Status',
      operational: 'Operational',
    },
    tasks: {
      contentCreation: 'Content Creation',
      videoEditing: 'Video Editing',
      brainstorming: 'Brainstorming',
      aiChat: 'AI Chat',
    },
    welcome: {
      title: 'Welcome to Ecliptrix',
      subtitle: 'Where light and shadow collide',
      description: 'Where light and shadow collide to create extraordinary content. Start by creating a new task to begin your creative journey.',
      contentCreationDesc: 'Generate engaging social media content',
      videoEditingDesc: 'Automatic video mixing and editing',
      brainstormingDesc: 'Creative ideation and inspiration',
      aiChatDesc: 'Intelligent conversation and assistance',
    },
    taskContent: {
      willBeImplemented: 'Task content will be implemented here',
      workspaceDescription: 'This is where the {type} workspace will be displayed. The specific functionality for each task type will be implemented in future iterations.',
    },
  },
  'zh-CN': {
    common: {
      newTask: '新建任务',
      dashboard: '仪表板',
      projects: '项目',
      library: '资源库',
      privacy: '隐私',
      terms: '条款',
      support: '支持',
      systemStatus: '系统状态',
      operational: '正常运行',
    },
          tasks: {
        contentCreation: '内容创作',
        videoEditing: '视频编辑',
        brainstorming: '头脑风暴',
        aiChat: 'AI对话',
      },
    welcome: {
      title: '欢迎使用 Ecliptrix',
      subtitle: '光影交汇之处',
      description: '光影交汇之处，创造非凡内容。创建新任务开始您的创意之旅。',
              contentCreationDesc: '生成引人入胜的社交媒体内容',
        videoEditingDesc: '自动视频混剪和编辑',
        brainstormingDesc: '创意构思和灵感',
        aiChatDesc: '智能对话和协助',
    },
    taskContent: {
      willBeImplemented: '任务内容将在此处实现',
      workspaceDescription: '这里将显示{type}工作区。每种任务类型的具体功能将在未来的迭代中实现。',
    },
  },
};

export type SupportedLocale = keyof typeof translations;

export const defaultLocale: SupportedLocale = 'en';

export function getTranslations(locale: SupportedLocale = defaultLocale): Translations {
  return translations[locale] || translations[defaultLocale];
} 