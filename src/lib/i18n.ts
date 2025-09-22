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
    close: string;
  };
  header: {
    brandSubtitle: string;
    languageSelector: string;
    english: string;
    chinese: string;
  };
  auth: {
    login: string;
    register: string;
    loginRegister: string;
    logout: string;
    personalInfo: string;
    accountSettings: string;
    username: string;
    password: string;
    loginButton: string;
    registerButton: string;
    welcomeBack: string;
    welcomeTitle: string;
    welcomeSubtitle: string;
    loginSuccess: string;
    loginFailed: string;
    invalidCredentials: string;
    requiredFields: string;
    loggingIn: string;
  };
  profile: {
    title: string;
    subtitle: string;
    userInfo: string;
    otherSettings: string;
    userInfoDescription: string;
    otherSettingsDescription: string;
    avatar: string;
    avatarUrlPlaceholder: string;
    avatarUrlHelper: string;
    username: string;
    email: string;
    fullName: string;
    usernamePlaceholder: string;
    emailPlaceholder: string;
    fullNamePlaceholder: string;
    save: string;
    saving: string;
    cancel: string;
    saveSuccess: string;
    saveError: string;
    notifications: string;
    emailNotifications: string;
    emailNotificationsDesc: string;
    pushNotifications: string;
    pushNotificationsDesc: string;
    marketingEmails: string;
    marketingEmailsDesc: string;
    privacy: string;
    profileVisible: string;
    profileVisibleDesc: string;
    activityVisible: string;
    activityVisibleDesc: string;
    preferences: string;
    language: string;
    theme: string;
    lightTheme: string;
    darkTheme: string;
    autoTheme: string;
    saveSettings: string;
    settingsSaveSuccess: string;
    settingsSaveError: string;
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
        organizeMaterials: string;
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
      imageTrack: string;
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
    messages: {
      noAudioItems: string;
      noSubtitleTrack: string;
      subtitleExtractionFailed: string;
      subtitleExtractionSuccess: string;
        subtitleExtractionError: string;
        subtitlePrefix: string;
        operationGenerated: string;
        operationReplaced: string;
        organizeMaterialsSuccess: string;
        organizeMaterialsNoItems: string;
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
    searchAudios: string;
    searchAudiosTooltip: string;
    searchImages: string;
    searchImagesTooltip: string;
    materialLibrary: string;
    materialLibraryTooltip: string;
    deleteAll: string;
    materialsCount: string;
    aiAutoMixTooltip: string;
    uploadTooltip: string;
    uploadingProgress: string;
    uploadingMaterial: string;
    searchVideosTooltip: string;
    deleteMaterialTooltip: string;
    addToTimelineTooltip: string;
    deleteAllTooltip: string;
    subtitleContentError: string;
    subtitleDownloadError: string;
    batchAnalyzing: string;
    batchAnalysisTooltip: string;
    downloadingVideo: string;
    downloadFailed: string;
    retryDownload: string;
          aiAnalyzing: string;
      viewAnalysisResult: string;
      aiVideoAnalysis: string;
      preview: string;
      download: string;
      previewMaterial: string;
      downloadMaterial: string;
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
      audioCount: string;
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
      unknown: string;
    };
    export: {
      exportVideo: string;
      exporting: string;
      exportingProgress: string;
    };
    placeholders: {
      noMaterialsInTimeline: string;
      clickPlayToPreview: string;
      currentAspectRatioLabel: string;
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
      deleteSentence: string;
      addSentence: string;
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
    voiceSelector: {
      selectVoice: string;
      voiceType: string;
      retryLoad: string;
      loadingVoices: string;
      loadFailed: string;
      noVoicesAvailable: string;
      categories: {
        '通用场景': string;
        '趣味方言': string;
        '角色扮演': string;
        '播报解说': string;
        '有声阅读': string;
        '其他': string;
      };
    };
  };
  documentPanel: {
    title: string;
    creativeBrainstorming: string;
    creativeBrainstormingAriaLabel: string;
    placeholder: string;
  };
  defaultContent: {
    documentDefault: string;
    scriptSegments: {
      segment1: {
        title: string;
        sentences: string[];
      };
      segment2: {
        title: string;
        sentences: string[];
      };
      segment3: {
        title: string;
        sentences: string[];
      };
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
      close: 'Close',
    },
    header: {
      brandSubtitle: 'Where light and shadow collide',
      languageSelector: 'Language',
      english: 'English',
      chinese: 'Chinese',
    },
    auth: {
      login: 'Login',
      register: 'Register',
      loginRegister: 'Login / Register',
      logout: 'Logout',
      personalInfo: 'Personal Info',
      accountSettings: 'Account Settings',
      username: 'Username',
      password: 'Password',
      loginButton: 'Login',
      registerButton: 'Register',
      welcomeBack: 'Welcome Back',
      welcomeTitle: 'Welcome to Ecliptrix',
      welcomeSubtitle: 'Where light and shadow collide to create extraordinary content',
      loginSuccess: 'Login successful',
      loginFailed: 'Login failed',
      invalidCredentials: 'Invalid username or password',
      requiredFields: 'Username and password are required',
      loggingIn: 'Logging in...',
    },
    profile: {
      title: 'User Profile',
      subtitle: 'Manage your account information and preferences',
      userInfo: 'User Information',
      otherSettings: 'Other Settings',
      userInfoDescription: 'Update your personal information and profile details',
      otherSettingsDescription: 'Configure notifications, privacy, and preferences',
      avatar: 'Avatar',
      avatarUrlPlaceholder: 'Enter avatar image URL',
      avatarUrlHelper: 'Provide a URL to your profile image',
      username: 'Username',
      email: 'Email',
      fullName: 'Full Name',
      usernamePlaceholder: 'Enter your username',
      emailPlaceholder: 'Enter your email address',
      fullNamePlaceholder: 'Enter your full name',
      save: 'Save Changes',
      saving: 'Saving...',
      cancel: 'Cancel',
      saveSuccess: 'Profile updated successfully',
      saveError: 'Failed to update profile',
      notifications: 'Notifications',
      emailNotifications: 'Email Notifications',
      emailNotificationsDesc: 'Receive email updates about your account',
      pushNotifications: 'Push Notifications',
      pushNotificationsDesc: 'Receive browser push notifications',
      marketingEmails: 'Marketing Emails',
      marketingEmailsDesc: 'Receive promotional emails and updates',
      privacy: 'Privacy',
      profileVisible: 'Public Profile',
      profileVisibleDesc: 'Allow others to view your profile',
      activityVisible: 'Activity Visibility',
      activityVisibleDesc: 'Show your activity to other users',
      preferences: 'Preferences',
      language: 'Language',
      theme: 'Theme',
      lightTheme: 'Light',
      darkTheme: 'Dark',
      autoTheme: 'Auto',
      saveSettings: 'Save Settings',
      settingsSaveSuccess: 'Settings saved successfully',
      settingsSaveError: 'Failed to save settings',
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
      searchAudios: 'Search Audios',
      searchAudiosTooltip: 'Search Online Audios',
      searchImages: 'Search Images',
      searchImagesTooltip: 'Search Online Images',
      materialLibrary: 'Material Library',
      materialLibraryTooltip: 'Access material library with videos, audios and images',
      deleteAll: 'Delete All',
      materialsCount: ' materials',
      aiAutoMixTooltip: 'Automatically add all script-converted audio and associated videos to timeline in order',
      uploadTooltip: 'Upload Materials',
      uploadingProgress: 'Uploading...',
      uploadingMaterial: 'Uploading...',
      searchVideosTooltip: 'Search Online Videos',
      deleteMaterialTooltip: 'Delete material: {name}',
      addToTimelineTooltip: 'Add to timeline',
      deleteAllTooltip: 'Delete all materials in current tab ({count} items)',
      subtitleContentError: 'Cannot get subtitle content',
      subtitleDownloadError: 'Subtitle file download failed',
              batchAnalyzing: 'Batch analyzing videos...',
        batchAnalysisTooltip: 'AI analyze all video materials to generate detailed content descriptions',
      downloadingVideo: 'Downloading video...',
      downloadFailed: 'Download failed',
      retryDownload: 'Retry Download',
      aiAnalyzing: 'AI analyzing...',
      viewAnalysisResult: 'View Analysis Result',
      aiVideoAnalysis: 'AI Video Analysis',
      preview: 'Preview',
      download: 'Download',
      previewMaterial: 'Preview Material',
      downloadMaterial: 'Download Material',
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
        organizeMaterials: 'Organize Materials',
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
          imageTrack: 'Image Track',
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
      messages: {
        noAudioItems: 'No audio items found, please add audio to the timeline first.',
        noSubtitleTrack: 'No subtitle track found, please add a subtitle track first.',
        subtitleExtractionFailed: 'Subtitle extraction failed, no subtitle content was generated.',
        subtitleExtractionSuccess: 'Subtitle extraction successful! {operation} {count} subtitle segments.',
        subtitleExtractionError: 'Subtitle extraction error: {error}',
        subtitlePrefix: 'Subtitle',
        operationGenerated: 'Generated',
        operationReplaced: 'Replaced',
        organizeMaterialsSuccess: 'All materials have been successfully aligned to the left',
        organizeMaterialsNoItems: 'No material segments found, alignment failed',
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
        videosCount: 'videos',
        audioCount: 'audios',
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
        unknown: 'Unknown',
      },
      export: {
        exportVideo: 'Export Video',
        exporting: 'Exporting',
        exportingProgress: 'Exporting ({progress}%)',
      },
             placeholders: {
         noMaterialsInTimeline: 'No video materials in timeline\nPlease add video materials to timeline before playing',
         clickPlayToPreview: 'Click play button to preview video',
         currentAspectRatioLabel: 'Current Aspect Ratio',
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
         title: 'Script',
         segmentsCount: '{count} Seg',
         sentencesCount: '{count} Seq',
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
        deleteSentence: 'Delete Sentence',
        addSentence: 'Add Sentence',
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
       voiceSelector: {
         selectVoice: 'Select Voice',
         voiceType: 'Voice Type',
         retryLoad: 'Retry',
         loadingVoices: 'Loading voices...',
         loadFailed: 'Failed to load voice types',
         noVoicesAvailable: 'No voices available',
         categories: {
           '通用场景': 'General Scenes',
           '趣味方言': 'Fun Dialects',
           '角色扮演': 'Role Playing',
           '播报解说': 'Broadcasting',
           '有声阅读': 'Audio Reading',
           '其他': 'Others'
         },
       },
     },
     documentPanel: {
       title: 'Documentation',
       creativeBrainstorming: 'Brainstorming',
       creativeBrainstormingAriaLabel: 'Start creative brainstorming',
       placeholder: 'Start writing your video project documentation...',
     },
     defaultContent: {
       documentDefault: '# Video Editing Project\n\nStart editing your video project documentation here...\n\n## Notes\n- Add your project notes\n- Document your editing workflow\n- Track your progress\n\n## Resources\n- List your video assets\n- Note important timestamps\n- Reference materials',
       scriptSegments: {
         segment1: {
           title: 'Opening Introduction',
           sentences: [
             'Hello everyone, welcome to today\'s video tutorial.',
             'Today we will learn how to use this powerful video editing tool.',
             'This tool can help us quickly create professional-level video content.'
           ]
         },
         segment2: {
           title: 'Feature Demonstration',
           sentences: [
             'First, let\'s take a look at the basic layout of the interface.',
             'On the left is our project document editing area, where project-related information can be recorded.',
             'On the right is the video preview and script display area.',
             'This layout design allows us to handle documents and video content simultaneously.'
           ]
         },
         segment3: {
           title: 'Practical Operation',
           sentences: [
             'Now let\'s start with the practical operation demonstration.',
             'We can input project-related document content in the left editor.',
             'At the same time, the script panel on the right will display the corresponding text content.',
             'This design makes content creation more efficient and intuitive.',
             'Each script segment corresponds to a specific paragraph in the video.'
           ]
         }
       }
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
      close: '关闭',
    },
    header: {
      brandSubtitle: '光影交汇之处',
      languageSelector: '语言',
      english: '英文',
      chinese: '中文',
    },
    auth: {
      login: '登录',
      register: '注册',
      loginRegister: '登录/注册',
      logout: '退出登录',
      personalInfo: '个人信息',
      accountSettings: '账号设置',
      username: '用户名',
      password: '密码',
      loginButton: '登录',
      registerButton: '注册',
      welcomeBack: '欢迎回来',
      welcomeTitle: '欢迎使用 Ecliptrix',
      welcomeSubtitle: '光影交汇之处，创造非凡内容',
      loginSuccess: '登录成功',
      loginFailed: '登录失败',
      invalidCredentials: '用户名或密码错误',
      requiredFields: '用户名和密码为必填项',
      loggingIn: '登录中...',
    },
    profile: {
      title: '用户资料',
      subtitle: '管理您的账户信息和偏好设置',
      userInfo: '用户信息',
      otherSettings: '其他设置',
      userInfoDescription: '更新您的个人信息和资料详情',
      otherSettingsDescription: '配置通知、隐私和偏好设置',
      avatar: '头像',
      avatarUrlPlaceholder: '输入头像图片链接',
      avatarUrlHelper: '提供您的个人资料图片链接',
      username: '用户名',
      email: '邮箱',
      fullName: '姓名',
      usernamePlaceholder: '输入您的用户名',
      emailPlaceholder: '输入您的邮箱地址',
      fullNamePlaceholder: '输入您的姓名',
      save: '保存更改',
      saving: '保存中...',
      cancel: '取消',
      saveSuccess: '资料更新成功',
      saveError: '资料更新失败',
      notifications: '通知设置',
      emailNotifications: '邮件通知',
      emailNotificationsDesc: '接收关于您账户的邮件更新',
      pushNotifications: '推送通知',
      pushNotificationsDesc: '接收浏览器推送通知',
      marketingEmails: '营销邮件',
      marketingEmailsDesc: '接收促销邮件和更新',
      privacy: '隐私设置',
      profileVisible: '公开资料',
      profileVisibleDesc: '允许其他人查看您的资料',
      activityVisible: '活动可见性',
      activityVisibleDesc: '向其他用户显示您的活动',
      preferences: '偏好设置',
      language: '语言',
      theme: '主题',
      lightTheme: '浅色',
      darkTheme: '深色',
      autoTheme: '自动',
      saveSettings: '保存设置',
      settingsSaveSuccess: '设置保存成功',
      settingsSaveError: '设置保存失败',
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
      searchAudios: '搜索音频',
      searchAudiosTooltip: '搜索在线音频',
      searchImages: '图片搜索',
      searchImagesTooltip: '搜索在线图片',
      materialLibrary: '素材库',
      materialLibraryTooltip: '访问包含视频、音频和图片的素材库',
      deleteAll: '删除全部',
      materialsCount: '个素材',
      aiAutoMixTooltip: '将所有文本脚本转换的音频和关联的视频按顺序自动添加到时间轴',
      uploadTooltip: '上传素材',
      uploadingProgress: '上传中...',
      uploadingMaterial: '上传中...',
      searchVideosTooltip: '搜索在线视频',
      deleteMaterialTooltip: '删除素材: {name}',
      addToTimelineTooltip: '添加到轨道中',
      deleteAllTooltip: '删除当前选项卡的所有素材 ({count}个)',
      subtitleContentError: '无法获取字幕内容',
      subtitleDownloadError: '字幕文件下载失败',
              batchAnalyzing: '正在批量解析视频...',
        batchAnalysisTooltip: '对所有视频素材进行AI解析，生成详细的内容描述',
      downloadingVideo: '正在下载视频...',
      downloadFailed: '下载失败',
      retryDownload: '重试下载',
              aiAnalyzing: 'AI解析中...',
        viewAnalysisResult: '查看解析结果',
        aiVideoAnalysis: 'AI视频解析',
        preview: '预览',
        download: '下载',
        previewMaterial: '预览素材',
        downloadMaterial: '下载素材',
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
        organizeMaterials: '整理轨道中素材',
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
          imageTrack: '图片轨道',
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
              messages: {
          noAudioItems: '没有找到音频项目，请先添加音频到时间轴。',
          noSubtitleTrack: '没有找到字幕轨道，请先添加字幕轨道。',
          subtitleExtractionFailed: '字幕提取失败，没有生成任何字幕内容。',
          subtitleExtractionSuccess: '字幕提取成功！{operation}了 {count} 个字幕片段。',
          subtitleExtractionError: '字幕提取错误: {error}',
          subtitlePrefix: '字幕',
          operationGenerated: '生成',
          operationReplaced: '替换',
          organizeMaterialsSuccess: '所有素材已向左对齐成功',
          organizeMaterialsNoItems: '无素材片段，对齐失败',
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
        videosCount: '个视频',
        audioCount: '个音频',
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
        unknown: '未知',
      },
      export: {
        exportVideo: '导出视频',
        exporting: '导出中',
        exportingProgress: '导出中 ({progress}%)',
      },
             placeholders: {
         noMaterialsInTimeline: '时间轴中没有视频素材\n请在时间轴中添加视频素材后播放',
         clickPlayToPreview: '点击播放按钮预览视频',
                   currentAspectRatioLabel: '当前比例',
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
        deleteSentence: '删除句子',
        addSentence: '添加句子',
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
       voiceSelector: {
         selectVoice: '选择音色',
         voiceType: '音色类型',
         retryLoad: '重试',
         loadingVoices: '正在加载音色...',
         loadFailed: '加载音色类型失败',
         noVoicesAvailable: '暂无可用音色',
         categories: {
           '通用场景': '通用场景',
           '趣味方言': '趣味方言',
           '角色扮演': '角色扮演',
           '播报解说': '播报解说',
           '有声阅读': '有声阅读',
           '其他': '其他'
         },
       },
     },
     documentPanel: {
       title: '文档编辑',
       creativeBrainstorming: '创意构思',
       creativeBrainstormingAriaLabel: '开启创意构思',
       placeholder: '开始编写您的视频项目文档...',
     },
     defaultContent: {
       documentDefault: '# 视频编辑项目\n\n开始编辑您的视频项目文档...\n\n## 笔记\n- 添加您的项目笔记\n- 记录您的编辑工作流程\n- 跟踪您的进度\n\n## 资源\n- 列出您的视频素材\n- 记录重要时间戳\n- 参考资料',
       scriptSegments: {
         segment1: {
           title: '开场介绍',
           sentences: [
             '大家好，欢迎来到今天的视频教程。',
             '今天我们要学习如何使用这个强大的视频编辑工具。',
             '这个工具可以帮助我们快速创建专业级的视频内容。'
           ]
         },
         segment2: {
           title: '功能演示',
           sentences: [
             '首先，我们来看看界面的基本布局。',
             '左侧是我们的项目文档编辑区域，可以记录项目相关信息。',
             '右侧是视频预览和脚本显示区域。',
             '这样的布局设计让我们能够同时处理文档和视频内容。'
           ]
         },
         segment3: {
           title: '实际操作',
           sentences: [
             '现在让我们开始实际操作演示。',
             '我们可以在左侧编辑器中输入项目相关的文档内容。',
             '同时，右侧的脚本面板会显示对应的文本内容。',
             '这种设计让内容创作变得更加高效和直观。',
             '每个脚本片段都对应着视频中的一个具体段落。'
           ]
         }
       }
     },
  },
};

export type SupportedLocale = keyof typeof translations;

export const defaultLocale: SupportedLocale = 'en';

export function getTranslations(locale: SupportedLocale = defaultLocale): Translations {
  return translations[locale] || translations[defaultLocale];
} 