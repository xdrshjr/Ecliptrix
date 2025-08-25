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
  timeline: {
    toolbar: {
      select: string;
      cut: string;
      copy: string;
      paste: string;
      delete: string;
      undo: string;
      redo: string;
      effects: string;
      transitions: string;
      subtitles: string;
      export: string;
      exporting: string;
      exportingProgress: string;
    };
    shortcuts: {
      selectShortcut: string;
      cutShortcut: string;
      copyShortcut: string;
      pasteShortcut: string;
      deleteShortcut: string;
      undoShortcut: string;
      redoShortcut: string;
      effectsShortcut: string;
      transitionsShortcut: string;
      subtitlesShortcut: string;
      exportShortcut: string;
    };
    status: {
      selectedItems: string;
      currentTool: string;
    };
    trackBar: {
      tracks: string;
      materials: string;
      duration: string;
      addTrack: string;
      addVideoTrack: string;
      addAudioTrack: string;
      addSubtitleTrack: string;
    };
    track: {
      videoTrack: string;
      audioTrack: string;
      subtitleTrack: string;
      mute: string;
      unmute: string;
      lock: string;
      unlock: string;
      show: string;
      hide: string;
      selectAll: string;
      editSubtitles: string;
      dropVideoHere: string;
      dropAudioHere: string;
      dropSubtitleHere: string;
      dropToTrack: string;
    };
    subtitleEditModal: {
      title: string;
      subtitle: string;
      noSubtitles: string;
      subtitleText: string;
      startTime: string;
      duration: string;
      save: string;
      cancel: string;
      placeholder: string;
    };
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
    timeline: {
      toolbar: {
        select: 'Select',
        cut: 'Cut',
        copy: 'Copy',
        paste: 'Paste',
        delete: 'Delete',
        undo: 'Undo',
        redo: 'Redo',
        effects: 'Effects',
        transitions: 'Transitions',
        subtitles: 'Subtitles',
        export: 'Export',
        exporting: 'Exporting',
        exportingProgress: 'Exporting ({progress}%)',
      },
      shortcuts: {
        selectShortcut: 'V',
        cutShortcut: 'Ctrl+X',
        copyShortcut: 'Ctrl+C',
        pasteShortcut: 'Ctrl+V',
        deleteShortcut: 'Del',
        undoShortcut: 'Ctrl+Z',
        redoShortcut: 'Ctrl+Y',
        effectsShortcut: 'E',
        transitionsShortcut: 'T',
        subtitlesShortcut: 'S',
        exportShortcut: 'Ctrl+E',
      },
      status: {
        selectedItems: '{count} items selected',
        currentTool: 'Current tool: {tool}',
      },
      trackBar: {
        tracks: 'Tracks',
        materials: 'Materials',
        duration: 'Duration',
        addTrack: 'Add Track',
        addVideoTrack: 'Add Video Track',
        addAudioTrack: 'Add Audio Track',
        addSubtitleTrack: 'Add Subtitle Track',
      },
      track: {
        videoTrack: 'Video Track',
        audioTrack: 'Audio Track',
        subtitleTrack: 'Subtitle Track',
        mute: 'Mute',
        unmute: 'Unmute',
        lock: 'Lock Track',
        unlock: 'Unlock Track',
        show: 'Show Track',
        hide: 'Hide Track',
        selectAll: 'Select All',
        editSubtitles: 'Edit Subtitles',
        dropVideoHere: 'Drag video/image materials here',
        dropAudioHere: 'Drag audio materials here',
        dropSubtitleHere: 'Drag subtitle materials here',
        dropToTrack: 'Drop to {trackName}',
      },
      subtitleEditModal: {
        title: 'Edit Subtitles',
        subtitle: 'Edit subtitle text for each timeline segment',
        noSubtitles: 'No subtitles found in the subtitle track',
        subtitleText: 'Subtitle Text',
        startTime: 'Start Time',
        duration: 'Duration',
        save: 'Save Changes',
        cancel: 'Cancel',
        placeholder: 'Enter subtitle text...',
      },
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
    timeline: {
      toolbar: {
        select: '选择',
        cut: '剪切',
        copy: '复制',
        paste: '粘贴',
        delete: '删除',
        undo: '撤销',
        redo: '重做',
        effects: '特效',
        transitions: '转场',
        subtitles: '字幕',
        export: '导出',
        exporting: '导出中',
        exportingProgress: '导出中 ({progress}%)',
      },
      shortcuts: {
        selectShortcut: 'V',
        cutShortcut: 'Ctrl+X',
        copyShortcut: 'Ctrl+C',
        pasteShortcut: 'Ctrl+V',
        deleteShortcut: 'Del',
        undoShortcut: 'Ctrl+Z',
        redoShortcut: 'Ctrl+Y',
        effectsShortcut: 'E',
        transitionsShortcut: 'T',
        subtitlesShortcut: 'S',
        exportShortcut: 'Ctrl+E',
      },
      status: {
        selectedItems: '已选中 {count} 个素材',
        currentTool: '当前工具: {tool}',
      },
      trackBar: {
        tracks: '轨道',
        materials: '素材',
        duration: '时长',
        addTrack: '添加轨道',
        addVideoTrack: '添加视频轨道',
        addAudioTrack: '添加音频轨道',
        addSubtitleTrack: '添加字幕轨道',
      },
      track: {
        videoTrack: '视频轨道',
        audioTrack: '音频轨道',
        subtitleTrack: '字幕轨道',
        mute: '静音',
        unmute: '取消静音',
        lock: '锁定轨道',
        unlock: '解锁轨道',
        show: '显示轨道',
        hide: '隐藏轨道',
        selectAll: '全选',
        editSubtitles: '编辑字幕',
        dropVideoHere: '拖拽视频/图片素材到此轨道',
        dropAudioHere: '拖拽音频素材到此轨道',
        dropSubtitleHere: '拖拽字幕素材到此轨道',
        dropToTrack: '放置到 {trackName}',
      },
      subtitleEditModal: {
        title: '编辑字幕',
        subtitle: '编辑时间轴上每个字幕片段的文本内容',
        noSubtitles: '字幕轨道中没有找到字幕',
        subtitleText: '字幕文本',
        startTime: '开始时间',
        duration: '持续时间',
        save: '保存更改',
        cancel: '取消',
        placeholder: '请输入字幕内容...',
      },
    },
  },
};

export type SupportedLocale = keyof typeof translations;

export const defaultLocale: SupportedLocale = 'en';

export function getTranslations(locale: SupportedLocale = defaultLocale): Translations {
  return translations[locale] || translations[defaultLocale];
} 