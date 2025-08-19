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
  header: {
    brandSubtitle: string;
    languageSelector: string;
    english: string;
    chinese: string;
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
  materialsPanel: {
    title: string;
    aiAutoMix: string;
    upload: string;
    filterAll: string;
    filterVideo: string;
    filterAudio: string;
    filterImage: string;
    filterSubtitle: string;
    typeVideo: string;
    typeAudio: string;
    typeImage: string;
    typeSubtitle: string;
    noMaterials: string;
    emptyDescription: string;
    searchVideos: string;
    deleteAll: string;
    materialsCount: string;
    aiAutoMixTooltip: string;
    uploadTooltip: string;
    searchVideosTooltip: string;
    deleteMaterialTooltip: string;
    deleteAllTooltip: string;
    subtitleContentError: string;
    subtitleDownloadError: string;
  };
  videoSearchModal: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    orientationLabel: string;
    orientationMixed: string;
    orientationLandscape: string;
    orientationPortrait: string;
    searchButton: string;
    searching: string;
    searchingVideos: string;
    enterKeywordPrompt: string;
    searchHighQualityPrompt: string;
    foundVideos: string;
    selected: string;
    items: string;
    clickToPreview: string;
    clickToPreviewDesc: string;
    previewUnavailable: string;
    selectedVideos: string;
    noSelection: string;
    noSelectionDesc: string;
    clickToSelect: string;
    author: string;
    durationShort: string;
    reselectButton: string;
    confirmAddButton: string;
    validationErrorTitle: string;
    validationErrorDesc: string;
  };
  videoPlayerPanel: {
    aspectRatios: {
      landscapeStandard: string;
      portraitMobile: string;
      traditionalScreen: string;
      square: string;
      ultrawide: string;
    };
    playback: {
      videoCompositionPlayback: string;
      videoPreviewPlayback: string;
      videosCount: string;
      play: string;
      pause: string;
      compositionPlay: string;
    };
    controls: {
      volume: string;
      playbackSpeed: string;
      fullscreen: string;
    };
    info: {
      title: string;
      resolution: string;
      frameRate: string;
      format: string;
      aspectRatio: string;
      currentAspectRatio: string;
    };
    export: {
      exportVideo: string;
      exporting: string;
      exportingProgress: string;
    };
    placeholders: {
      noMaterialsInTimeline: string;
      clickPlayToPreview: string;
    };
    accessibility: {
      videoCompositionPanel: string;
      exportingVideoWithRatio: string;
      exportVideoWithRatio: string;
      selectAspectRatio: string;
    };
  };
  scriptPanel: {
    header: {
      title: string;
      segmentsCount: string;
      sentencesCount: string;
      generateScript: string;
      convertAllSpeech: string;
      progress: string;
    };
    actions: {
      convertSpeech: string;
      searchOnlineVideos: string;
      completeConversionFirst: string;
      previousVideo: string;
      nextVideo: string;
      editSentence: string;
    };
    progress: {
      conversionProgress: string;
      progressStatus: string;
      completed: string;
      failed: string;
    };
    editing: {
      save: string;
      cancel: string;
      saveHint: string;
      cancelHint: string;
      editHint: string;
    };
    emptyState: {
      noScript: string;
      clickGenerate: string;
      scriptWillAppear: string;
    };
    video: {
      associatedVideos: string;
      loadingFailed: string;
      browserNotSupported: string;
      seconds: string;
      duration: string;
    };
    errors: {
      speechConversionFailed: string;
      batchConversionComplete: string;
      batchConversionPartial: string;
      batchConversionFailed: string;
      audioDownloadFailed: string;
      videoDurationInsufficient: string;
      audioFileNotFound: string;
      segmentTextEmpty: string;
    };
    segments: {
      segmentPrefix: string;
      speechSuffix: string;
      subtitleSuffix: string;
      generatedFrom: string;
      associatedVideo: string;
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
    header: {
      brandSubtitle: 'Where light and shadow collide',
      languageSelector: 'Language',
      english: 'English',
      chinese: 'Chinese',
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
    materialsPanel: {
      title: 'Materials Management',
      aiAutoMix: 'AI Auto Mix',
      upload: 'Upload',
      filterAll: 'All',
      filterVideo: 'Video',
      filterAudio: 'Audio',
      filterImage: 'Image',
      filterSubtitle: 'Subtitle',
      typeVideo: 'Video',
      typeAudio: 'Audio',
      typeImage: 'Image',
      typeSubtitle: 'Subtitle',
      noMaterials: 'No Materials',
      emptyDescription: 'Materials library is empty. Click the \'Search Videos\' button below to add high-quality video materials.',
      searchVideos: 'Search Videos',
      deleteAll: 'Delete All',
      materialsCount: ' materials',
      aiAutoMixTooltip: 'Automatically add all script-converted audio and associated videos to timeline in order',
      uploadTooltip: 'Upload Materials',
      searchVideosTooltip: 'Search Online Videos',
      deleteMaterialTooltip: 'Delete material: {name}',
      deleteAllTooltip: 'Delete all materials in current tab ({count} items)',
      subtitleContentError: 'Cannot get subtitle content',
      subtitleDownloadError: 'Subtitle file download failed',
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
    videoSearchModal: {
      title: 'Search Online Videos',
      subtitle: 'Discover high-quality free video materials',
      searchPlaceholder: 'Enter search keywords, e.g.: nature landscape, business office, portraits...',
      orientationLabel: 'Orientation:',
      orientationMixed: 'Mixed',
      orientationLandscape: 'Landscape',
      orientationPortrait: 'Portrait',
      searchButton: 'Search',
      searching: 'Searching...',
      searchingVideos: 'Searching for videos...',
      enterKeywordPrompt: 'Enter keywords to start searching',
      searchHighQualityPrompt: 'Search for high-quality free video materials',
      foundVideos: 'Found',
      selected: 'selected',
      items: 'videos,',
      clickToPreview: 'Click video to preview',
      clickToPreviewDesc: 'Select a video from the left to view details',
      previewUnavailable: 'No preview video',
      selectedVideos: 'Selected Videos',
      noSelection: 'No selection',
      noSelectionDesc: 'Click videos to select',
      clickToSelect: 'Click to select',
      author: 'Author:',
      durationShort: 'Duration insufficient',
      reselectButton: 'Reselect',
      confirmAddButton: 'Confirm Add',
      validationErrorTitle: 'Video duration insufficient',
      validationErrorDesc: 'Please select more videos or videos with longer duration.',
    },
    videoPlayerPanel: {
      aspectRatios: {
        landscapeStandard: 'Landscape (16:9)',
        portraitMobile: 'Portrait (9:16)',
        traditionalScreen: 'Traditional Screen (4:3)',
        square: 'Square (1:1)',
        ultrawide: 'Ultrawide (21:9)',
      },
      playback: {
        videoCompositionPlayback: 'Play Composition',
        videoPreviewPlayback: 'Play Preview',
        videosCount: 'Videos in Composition',
        play: 'Play',
        pause: 'Pause',
        compositionPlay: 'Composition Play',
      },
      controls: {
        volume: 'Volume',
        playbackSpeed: 'Playback Speed',
        fullscreen: 'Fullscreen',
      },
      info: {
        title: 'Video Info',
        resolution: 'Resolution',
        frameRate: 'Frame Rate',
        format: 'Format',
        aspectRatio: 'Aspect Ratio',
        currentAspectRatio: 'Current Aspect Ratio',
      },
      export: {
        exportVideo: 'Export Video',
        exporting: 'Exporting',
        exportingProgress: 'Exporting ({progress}%)',
      },
             placeholders: {
         noMaterialsInTimeline: 'No video materials in timeline\nPlease add video materials to timeline before playing',
         clickPlayToPreview: 'Click play button to preview video',
       },
      accessibility: {
        videoCompositionPanel: 'Video Composition Panel',
        exportingVideoWithRatio: 'Exporting video with aspect ratio',
        exportVideoWithRatio: 'Export video with aspect ratio',
        selectAspectRatio: 'Select aspect ratio',
      },
    },
         scriptPanel: {
       header: {
         title: 'Text Script',
         segmentsCount: '{count} segments',
         sentencesCount: '{count} sentences',
         generateScript: 'Generate Script',
         convertAllSpeech: 'Convert All Speech',
         progress: 'Progress',
       },
       actions: {
         convertSpeech: 'Convert Speech',
         searchOnlineVideos: 'Search Online Videos',
         completeConversionFirst: 'Please complete speech conversion first',
         previousVideo: 'Previous Video',
         nextVideo: 'Next Video',
         editSentence: 'Edit Sentence',
       },
       progress: {
         conversionProgress: 'Conversion Progress',
         progressStatus: 'Progress: {completed}/{total}',
         completed: 'completed',
         failed: 'failed',
       },
       editing: {
         save: 'Save',
         cancel: 'Cancel',
         saveHint: 'Enter to save · Esc to cancel',
         cancelHint: 'Esc',
         editHint: 'Enter',
       },
       emptyState: {
         noScript: 'No script content',
         clickGenerate: 'Click "Generate Script" button to generate script based on left content',
         scriptWillAppear: 'Text script will be displayed here',
       },
       video: {
         associatedVideos: 'Associated Videos',
         loadingFailed: 'Loading failed',
         browserNotSupported: 'Your browser does not support video playback.',
         seconds: 's',
         duration: 'Duration',
       },
       errors: {
         speechConversionFailed: 'Speech conversion failed',
         batchConversionComplete: 'Batch speech conversion complete! Successfully converted {success} segments',
         batchConversionPartial: 'Batch speech conversion complete! Success: {success}/{total} segments, Failed: {failed} segments',
         batchConversionFailed: 'Batch speech conversion failed! All {total} segments failed to convert',
         audioDownloadFailed: 'Audio download failed',
         videoDurationInsufficient: 'Video total duration ({videoDuration}s) needs to be greater than current audio duration ({audioDuration}s)',
         audioFileNotFound: 'No corresponding audio file found, please ensure speech conversion is completed',
         segmentTextEmpty: 'Segment text is empty',
       },
       segments: {
         segmentPrefix: 'Segment{index}',
         speechSuffix: ' - Speech',
         subtitleSuffix: ' - Subtitle',
         generatedFrom: 'Speech recognition generated subtitle from "Segment{index}"',
         associatedVideo: 'Segment{index} - {videoName}',
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
    header: {
      brandSubtitle: '光影交汇之处',
      languageSelector: '语言',
      english: '英文',
      chinese: '中文',
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
    materialsPanel: {
      title: '素材管理',
      aiAutoMix: 'AI自动混剪',
      upload: '上传',
      filterAll: '全部',
      filterVideo: '视频',
      filterAudio: '音频',
      filterImage: '图片',
      filterSubtitle: '字幕',
      typeVideo: '视频',
      typeAudio: '音频',
      typeImage: '图片',
      typeSubtitle: '字幕',
      noMaterials: '暂无素材',
      emptyDescription: '素材库为空，点击下方「搜索视频」按钮来添加高质量的视频素材',
      searchVideos: '搜索视频',
      deleteAll: '删除全部',
      materialsCount: '个素材',
      aiAutoMixTooltip: '将所有文本脚本转换的音频和关联的视频按顺序自动添加到时间轴',
      uploadTooltip: '上传素材',
      searchVideosTooltip: '搜索在线视频',
      deleteMaterialTooltip: '删除素材: {name}',
      deleteAllTooltip: '删除当前选项卡的所有素材 ({count}个)',
      subtitleContentError: '无法获取字幕内容',
      subtitleDownloadError: '字幕文件下载失败',
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
    videoSearchModal: {
      title: '搜索在线视频',
      subtitle: '发现高质量的免费视频素材',
      searchPlaceholder: '输入搜索关键词，如：自然风景、商务办公、人物肖像...',
      orientationLabel: '方向:',
      orientationMixed: '混合',
      orientationLandscape: '横屏',
      orientationPortrait: '竖屏',
      searchButton: '搜索',
      searching: '搜索中...',
      searchingVideos: '正在搜索视频...',
      enterKeywordPrompt: '输入关键词开始搜索',
      searchHighQualityPrompt: '搜索高质量的免费视频素材',
      foundVideos: '找到',
      selected: '已选择',
      items: '个视频，',
      clickToPreview: '点击视频进行预览',
      clickToPreviewDesc: '在左侧选择一个视频来查看详情',
      previewUnavailable: '无预览视频',
      selectedVideos: '已选择的视频',
      noSelection: '暂无选择',
      noSelectionDesc: '点击视频进行选择',
      clickToSelect: '点击选择',
      author: '作者:',
      durationShort: '视频时长不足',
      reselectButton: '重新选择',
      confirmAddButton: '确认添加',
      validationErrorTitle: '视频时长不足',
      validationErrorDesc: '请选择更多视频或时长更长的视频素材。',
    },
    videoPlayerPanel: {
      aspectRatios: {
        landscapeStandard: '横屏 (16:9)',
        portraitMobile: '竖屏 (9:16)',
        traditionalScreen: '传统屏幕 (4:3)',
        square: '正方形 (1:1)',
        ultrawide: '超宽屏 (21:9)',
      },
      playback: {
        videoCompositionPlayback: '播放组合',
        videoPreviewPlayback: '预览播放',
        videosCount: '组合中视频数量',
        play: '播放',
        pause: '暂停',
        compositionPlay: '组合播放',
      },
      controls: {
        volume: '音量',
        playbackSpeed: '播放速度',
        fullscreen: '全屏',
      },
      info: {
        title: '视频信息',
        resolution: '分辨率',
        frameRate: '帧率',
        format: '格式',
        aspectRatio: '宽高比',
        currentAspectRatio: '当前宽高比',
      },
      export: {
        exportVideo: '导出视频',
        exporting: '导出中',
        exportingProgress: '导出中 ({progress}%)',
      },
             placeholders: {
         noMaterialsInTimeline: '时间轴中没有视频素材\n请在时间轴中添加视频素材后播放',
         clickPlayToPreview: '点击播放按钮预览视频',
       },
      accessibility: {
        videoCompositionPanel: '视频组合面板',
        exportingVideoWithRatio: '导出带宽高比的影片',
        exportVideoWithRatio: '导出带宽高比的影片',
        selectAspectRatio: '选择宽高比',
      },
    },
         scriptPanel: {
       header: {
         title: '文本脚本',
         segmentsCount: '{count} 个片段',
         sentencesCount: '{count} 句话',
         generateScript: '生成脚本',
         convertAllSpeech: '转换全部语音',
         progress: '进度',
       },
       actions: {
         convertSpeech: '转换语音',
         searchOnlineVideos: '搜索在线视频',
         completeConversionFirst: '请先完成语音转换',
         previousVideo: '上一个视频',
         nextVideo: '下一个视频',
         editSentence: '编辑句子',
       },
       progress: {
         conversionProgress: '转换进度',
         progressStatus: '进度: {completed}/{total}',
         completed: '已完成',
         failed: '失败',
       },
       editing: {
         save: '保存',
         cancel: '取消',
         saveHint: 'Enter保存 · Esc取消',
         cancelHint: 'Esc',
         editHint: 'Enter',
       },
       emptyState: {
         noScript: '暂无脚本内容',
         clickGenerate: '点击"生成脚本"按钮根据左侧内容生成脚本',
         scriptWillAppear: '文本脚本将显示在这里',
       },
       video: {
         associatedVideos: '关联视频',
         loadingFailed: '加载失败',
         browserNotSupported: '您的浏览器不支持视频播放。',
         seconds: 's',
         duration: '时长',
       },
       errors: {
         speechConversionFailed: '语音转换失败',
         batchConversionComplete: '批量语音转换完成！成功转换 {success} 个片段',
         batchConversionPartial: '批量语音转换完成！成功: {success}/{total} 个片段，失败: {failed} 个片段',
         batchConversionFailed: '批量语音转换失败！所有 {total} 个片段都转换失败',
         audioDownloadFailed: '音频下载失败',
         videoDurationInsufficient: '视频总时长 ({videoDuration}秒) 需要大于当前音频时长 ({audioDuration}秒)',
         audioFileNotFound: '未找到对应的音频文件，请确保已完成语音转换',
         segmentTextEmpty: '片段文本为空',
       },
       segments: {
         segmentPrefix: '段落{index}',
         speechSuffix: ' - 语音',
         subtitleSuffix: ' - 字幕',
         generatedFrom: '从"段落{index}"语音识别生成的字幕',
         associatedVideo: '段落{index} - {videoName}',
       },
     },
  },
};

export type SupportedLocale = keyof typeof translations;

export const defaultLocale: SupportedLocale = 'en';

export function getTranslations(locale: SupportedLocale = defaultLocale): Translations {
  return translations[locale] || translations[defaultLocale];
} 