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
    cancel: string;
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
  adminSettings: {
    title: string;
    subtitle: string;
    userManagement: string;
    systemSettings: string;
    userManagementDesc: string;
    systemSettingsDesc: string;
    registeredUsers: string;
    totalUsers: string;
    adminUsers: string;
    regularUsers: string;
    premiumUsers: string;
    userId: string;
    role: string;
    status: string;
    createdAt: string;
    lastLogin: string;
    active: string;
    inactive: string;
    actions: string;
    edit: string;
    delete: string;
    loading: string;
    noUsers: string;
    fetchError: string;
    searchPlaceholder: string;
    addUser: string;
    createUser: string;
    createUserTitle: string;
    createUserDesc: string;
    username: string;
    usernamePlaceholder: string;
    usernameRequired: string;
    usernameMinLength: string;
    usernameInvalidChars: string;
    password: string;
    passwordPlaceholder: string;
    passwordRequired: string;
    passwordMinLength: string;
    fullName: string;
    fullNamePlaceholder: string;
    avatarUrl: string;
    avatarUrlPlaceholder: string;
    userRole: string;
    userRoleAdmin: string;
    userRoleRegular: string;
    userRolePremium: string;
    isAdmin: string;
    isAdminDesc: string;
    isActive: string;
    isActiveDesc: string;
    cancel: string;
    creating: string;
    createSuccess: string;
    createError: string;
    usernameExists: string;
    emailExists: string;
    deleteUser: string;
    deleteConfirmTitle: string;
    deleteConfirmMessage: string;
    modelSettings: string;
    modelSettingsDesc: string;
    modelChat: string;
    modelFast: string;
    modelVideoCut: string;
    modelVision: string;
    modelCoding: string;
    // Coding Plan
    codingPlan: string;
    codingPlanDesc: string;
    codingPlanProviders: string;
    codingPlanProvidersDesc: string;
    codingPlanAssignment: string;
    codingPlanAssignmentDesc: string;
    modelPreset: string;
    modelCustom: string;
    modelProvider: string;
    modelName: string;
    modelApiUrl: string;
    modelApiKey: string;
    modelApiKeyPlaceholder: string;
    modelTemperature: string;
    modelMaxTokens: string;
    modelTestConnection: string;
    modelTesting: string;
    modelTestSuccess: string;
    modelTestFailed: string;
    modelSave: string;
    modelSaving: string;
    modelSaveSuccess: string;
    modelSaveError: string;
    modelUsingEnv: string;
    modelUsingDb: string;
    modelDomestic: string;
    modelInternational: string;
    modelResetToDefault: string;
    modelParameters: string;
    modelSelectProvider: string;
    modelSelectModel: string;
    modelApiUrlPlaceholder: string;
    modelNamePlaceholder: string;
    modelFetchModels: string;
    modelFetchingModels: string;
    modelFetchModelsError: string;
    modelNoModelsFound: string;
    modelFetchModelsHint: string;
    modelOrInputManually: string;
    // Two-layer model settings
    modelProviders: string;
    modelProvidersDesc: string;
    modelAddProvider: string;
    modelEditProvider: string;
    modelDeleteProvider: string;
    modelDeleteProviderConfirm: string;
    modelProviderName: string;
    modelProviderNamePlaceholder: string;
    modelProviderType: string;
    modelProviderSaved: string;
    modelProviderDeleted: string;
    modelProviderCreateError: string;
    modelAssignments: string;
    modelAssignmentsDesc: string;
    modelNoProviders: string;
    modelProviderInUse: string;
    modelAssignmentSaved: string;
    modelAssignmentDeleted: string;
    deleteConfirmUsername: string;
    deleteConfirmEmail: string;
    confirmDelete: string;
    cancelDelete: string;
    deleting: string;
    deleteSuccess: string;
    deleteError: string;
    // Role labels
    roleRoot: string;
    roleAdmin: string;
    rolePremium: string;
    roleRegular: string;
    // User management extras
    superAdmin: string;
    resetPassword: string;
    resetPasswordTitle: string;
    resetPasswordDesc: string;
    resetPasswordSuccess: string;
    resetPasswordError: string;
    enableUser: string;
    disableUser: string;
    forceLogout: string;
    forceLogoutSuccess: string;
    forceLogoutError: string;
    onlineUsers: string;
    disabledUsers: string;
    sessionInvalid: string;
    inviteCode: string;
    inviteCodePlaceholder: string;
    loginHistory: string;
    loginTime: string;
    ipAddress: string;
    deviceInfo: string;
    loginResult: string;
    loginSuccess: string;
    loginFailed: string;
    failureReason: string;
    // Enhanced user management UI
    confirmPassword: string;
    passwordMismatch: string;
    emailPlaceholder: string;
    emailInvalid: string;
    editUser: string;
    editUserTitle: string;
    editUserDesc: string;
    editSuccess: string;
    editError: string;
    saving: string;
    save: string;
    allRoles: string;
    allStatus: string;
    enabled: string;
    disabled: string;
    disableConfirmTitle: string;
    disableConfirmMessage: string;
    disableConfirmOnline: string;
    forceLogoutConfirmTitle: string;
    forceLogoutConfirmMessage: string;
    deleteTypeUsername: string;
    toggleStatusSuccess: string;
    toggleStatusError: string;
    autoGenerate: string;
    manualSet: string;
    generatePassword: string;
    generatedPassword: string;
    copyPassword: string;
    copied: string;
    resetPasswordWarning: string;
    newPassword: string;
    newPasswordPlaceholder: string;
    confirmNewPassword: string;
    noLoginHistory: string;
    loginHistoryFor: string;
    close: string;
    previous: string;
    next: string;
    pageOf: string;
    totalRecords: string;
    perPage: string;
    refresh: string;
    user: string;
  };
  tasks: {
    workflow: string;
    videoEditing: string;
    brainstorming: string;
    aiChat: string;
  };
  welcome: {
    title: string;
    subtitle: string;
    description: string;
    workflowDesc: string;
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
        zoomHint: string;
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
    aiMixing: string;
    aiMixingTooltip: string;
    myMaterials: string;
    myMaterialsDescription: string;
    loadingMaterials: string;
    loadError: string;
    retry: string;
    noMaterialsFound: string;
    selectAll: string;
    deselectAll: string;
    selectedCount: string;
    addToMaterialManagement: string;
    totalMaterials: string;
  };
  aiMixingModal: {
    title: string;
    subtitle: string;
    quickMode: string;
    quickModeDesc: string;
    quickModeFeatures: string;
    quickModeFast: string;
    quickModeLowResource: string;
    professionalMode: string;
    professionalModeDesc: string;
    professionalModeFeatures: string;
    professionalModeHighPrecision: string;
    professionalModeBetterResults: string;
    frameIntervalLabel: string;
    frameIntervalUnit: string;
    frameIntervalHint: string;
    cancel: string;
    confirm: string;
  };
  batchAnalysisModal: {
    title: string;
    subtitle: string;
    quickMode: string;
    quickModeDesc: string;
    quickModeFast: string;
    quickModeLowResource: string;
    professionalMode: string;
    professionalModeDesc: string;
    professionalModeHighPrecision: string;
    professionalModeBetterResults: string;
    frameIntervalLabel: string;
    frameIntervalUnit: string;
    frameIntervalHint: string;
    cancel: string;
    confirm: string;
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
  videoExportProgressModal: {
    title: string;
    progressStages: {
      preparing: string;
      processing: string;
      composing: string;
      generating: string;
      almostDone: string;
      completed: string;
    };
    timeElapsed: string;
    pleaseWait: string;
    cancelExport: string;
    exportSuccess: string;
  };
  videoExport: {
    noContentToExport: string;
    noContentToExportDesc: string;
  };
  scriptPanel: {
    tabs: {
      narrationScript: string;
      aiVideoScript: string;
    };
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
    aiVideoScript: {
      addSegment: string;
      removeSegment: string;
      scriptPlaceholder: string;
      characterImage: string;
      sceneImage: string;
      selectImage: string;
      removeImage: string;
      generateVideo: string;
      generating: string;
      generationFailed: string;
      retry: string;
      generatedVideo: string;
      emptyState: string;
      emptyHint: string;
      fromMaterials: string;
      pasteUrl: string;
      segmentTitle: string;
      cancel: string;
      noImagesInMaterials: string;
      cancelGeneration: string;
      aiGenerate: string;
      aiGenerating: string;
      modeDescription: string;
      modeKeyframe: string;
      firstFrameImage: string;
      firstFrameRequired: string;
      lastFrameImage: string;
      lastFrameOptional: string;
      firstFrameMissing: string;
      invalidImageUrl: string;
      durationLabel: string;
      expandScript: string;
      expandingScript: string;
    };
  };
  videoScript: {
    tab: {
      aiVideo: string;
      normal: string;
    };
    chatToggle: {
      label: string;
      count: string;
      empty: string;
    };
    customPrompt: {
      placeholder: string;
      polish: string;
      polishing: string;
      undo: string;
    };
    generate: {
      aiVideo: string;
      normal: string;
    };
    validation: {
      empty: string;
    };
  };
  documentPanel: {
    title: string;
    creativeBrainstorming: string;
    creativeBrainstormingAriaLabel: string;
    polishContent: string;
    polishContentAriaLabel: string;
    generateScript: string;
    generatingScript: string;
    generateScriptAriaLabel: string;
    placeholder: string;
  };
  contentPolishModal: {
    title: string;
    subtitle: string;
    close: string;
    originalContent: string;
    noContent: string;
    selectPolishGoals: string;
    selectedCount: string;
    clear: string;
    loadingConfig: string;
    configLoadError: string;
    startPolish: string;
    polishing: string;
    selectGoals: string;
    polishResults: string;
    emptyStateTitle: string;
    emptyStateSubtitle: string;
    cancel: string;
    confirmApply: string;
    selected: string;
    errors: {
      polishFailed: string;
      allPolishFailed: string;
      intensityPolishFailed: string;
    };
    categoryNames: {
      platform: string;
      engagement: string;
      emotional: string;
      conversion: string;
      narrative: string;
      targeting: string;
      viral: string;
      controversial: string;
      uniqueness: string;
      structure: string;
      emphasis: string;
      memorable: string;
      credibility: string;
      immersive: string;
      innovative: string;
      psychological: string;
      motivation: string;
      practical: string;
      other: string;
    };
    intensityLabels: {
      light: string;
      medium: string;
      strong: string;
      deep: string;
      extreme: string;
    };
    polishGoals: {
      short_video: {
        name: string;
        description: string;
      };
      three_second_hook: {
        name: string;
        description: string;
      };
      engage_comments: {
        name: string;
        description: string;
      };
      reader_resonance: {
        name: string;
        description: string;
      };
      empathy: {
        name: string;
        description: string;
      };
      call_to_action: {
        name: string;
        description: string;
      };
      storytelling: {
        name: string;
        description: string;
      };
      pain_point: {
        name: string;
        description: string;
      };
      viral_potential: {
        name: string;
        description: string;
      };
      curiosity_gap: {
        name: string;
        description: string;
      };
      fan_sb: {
        name: string;
        description: string;
      };
      provoke_debate: {
        name: string;
        description: string;
      };
      differentiation: {
        name: string;
        description: string;
      };
      echo_ending: {
        name: string;
        description: string;
      };
      contrast_strong: {
        name: string;
        description: string;
      };
      golden_sentence: {
        name: string;
        description: string;
      };
      data_support: {
        name: string;
        description: string;
      };
      authority_quote: {
        name: string;
        description: string;
      };
      scenario_immersion: {
        name: string;
        description: string;
      };
      reverse_thinking: {
        name: string;
        description: string;
      };
      anxiety_marketing: {
        name: string;
        description: string;
      };
      benefit_driven: {
        name: string;
        description: string;
      };
      scarcity_urgency: {
        name: string;
        description: string;
      };
      social_proof: {
        name: string;
        description: string;
      };
      emotional_trigger: {
        name: string;
        description: string;
      };
      practical_tips: {
        name: string;
        description: string;
      };
    };
    multiGoalDescription: string;
    operationHint: string;
  };
  scriptGenerationModal: {
    title: string;
    close: string;
    languageLabel: string;
    languageOptions: {
      chinese: {
        label: string;
        description: string;
      };
      english: {
        label: string;
        description: string;
      };
      mixed: {
        label: string;
        description: string;
      };
    };
    consistencyLabel: string;
    consistencyOptions: {
      high: {
        label: string;
        description: string;
      };
      moderate: {
        label: string;
        description: string;
      };
      low: {
        label: string;
        description: string;
      };
    };
    segmentCountLabel: string;
    segmentCountHint: string;
    customRequirementsLabel: string;
    customRequirementsOptional: string;
    customRequirementsPlaceholder: string;
    charCount: string;
    cancelButton: string;
    generateButton: string;
  };
  creativeBrainstormingModal: {
    title: string;
    subtitle: string;
    close: string;
    closeAriaLabel: string;
    configPanel: {
      customCreativeTitle: string;
      customCreativeDescription: string;
      customCreativePlaceholder: string;
      startButton: string;
      startButtonDiscussing: string;
      validationError: string;
    };
    categories: {
      creationType: {
        title: string;
        description: string;
        options: {
          brandMarketing: { label: string; description: string };
          educationalTraining: { label: string; description: string };
          entertainmentContent: { label: string; description: string };
          productShowcase: { label: string; description: string };
          storytelling: { label: string; description: string };
        };
      };
      creationDomain: {
        title: string;
        description: string;
        options: {
          technologyDigital: { label: string; description: string };
          lifestyle: { label: string; description: string };
          businessFinance: { label: string; description: string };
          healthMedical: { label: string; description: string };
          artsCulture: { label: string; description: string };
          travelFood: { label: string; description: string };
        };
      };
      creationGoal: {
        title: string;
        description: string;
        options: {
          brandAwareness: { label: string; description: string };
          userEngagement: { label: string; description: string };
          knowledgeEducation: { label: string; description: string };
          salesPromotion: { label: string; description: string };
          audienceEntertainment: { label: string; description: string };
        };
      };
      contentStrategy: {
        title: string;
        description: string;
        options: {
          emotionalResonance: { label: string; description: string };
          dataDriven: { label: string; description: string };
          storyDriven: { label: string; description: string };
          interactiveEngagement: { label: string; description: string };
          professionalAuthority: { label: string; description: string };
        };
      };
      creativeExperts: {
        title: string;
        description: string;
        options: {
          creativeDirector: { label: string; description: string };
          marketingStrategist: { label: string; description: string };
          contentWriter: { label: string; description: string };
          visualDesigner: { label: string; description: string };
          uxExpert: { label: string; description: string };
        };
      };
    };
    experts: {
      creativeDirector: {
        name: string;
        title: string;
        expertise: string[];
        personality: string;
      };
      marketingStrategist: {
        name: string;
        title: string;
        expertise: string[];
        personality: string;
      };
      contentWriter: {
        name: string;
        title: string;
        expertise: string[];
        personality: string;
      };
      visualDesigner: {
        name: string;
        title: string;
        expertise: string[];
        personality: string;
      };
      uxExpert: {
        name: string;
        title: string;
        expertise: string[];
        personality: string;
      };
    };
    chatInterface: {
      title: string;
      roundLabel: string;
      discussingStatus: string;
      summarizingStatus: string;
      exportButton: string;
      emptyStateTitle: string;
      emptyStateSubtitle: string;
      continueButton: string;
      summaryButton: string;
      userInputPlaceholder: string;
      userInputPlaceholderDiscussing: string;
      userInputPlaceholderSummarizing: string;
    };
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
  videoChatWindow: {
    inputPlaceholder: string;
    creativeBrainstormingTooltip: string;
    polishContentTooltip: string;
    generateScriptTooltip: string;
    generateScriptTooltipGenerating: string;
    clearChatTooltip: string;
    sendMessageTooltip: string;
    clearChatConfirm: string;
    emptyStateTitle: string;
    emptyStateSubtitle: string;
    scriptOptimizationTitle: string;
    scriptOptimizationDesc: string;
    editingSuggestionsTitle: string;
    editingSuggestionsDesc: string;
    startChatTitle: string;
    startChatDesc: string;
    viewWorkflowsTooltip: string;
    agentToggleLabel: string;
    agentInputPlaceholder: string;
    agentWorkingPlaceholder: string;
    agentUndoButton: string;
    agentUndoneLabel: string;
    agentOperations: string;
  };
  workflowConfigModal: {
    title: string;
    subtitle: string;
    workflowListTitle: string;
    workflowConfigTitle: string;
    enabledLabel: string;
    disabledLabel: string;
    toolDescriptionLabel: string;
    toolDescriptionPlaceholder: string;
    modelSelectionLabel: string;
    modelPlaceholder: string;
    noWorkflowSelected: string;
    selectWorkflowPrompt: string;
    noWorkflowsAvailable: string;
    createWorkflowPrompt: string;
    saveButton: string;
    cancelButton: string;
    loadingWorkflows: string;
    workflowCount: string;
    successSave: string;
    errorLoad: string;
    errorSave: string;
  };
  aiChat: {
    welcomePage: {
      title: string;
      subtitle: string;
      creativeAssistantTitle: string;
      creativeAssistantDesc: string;
      knowledgeAssistantTitle: string;
      knowledgeAssistantDesc: string;
    };
    emptyConversation: {
      title: string;
      subtitle: string;
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
      cancel: 'Cancel',
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
    adminSettings: {
      title: 'Admin Settings',
      subtitle: 'Manage system settings and users',
      userManagement: 'User Management',
      systemSettings: 'System Settings',
      userManagementDesc: 'View and manage registered users',
      systemSettingsDesc: 'Configure system-wide settings',
      registeredUsers: 'Registered Users',
      totalUsers: 'Total Users',
      adminUsers: 'Admin Users',
      regularUsers: 'Regular Users',
      premiumUsers: 'Premium Users',
      userId: 'User ID',
      role: 'Role',
      status: 'Status',
      createdAt: 'Created',
      lastLogin: 'Last Login',
      active: 'Active',
      inactive: 'Inactive',
      actions: 'Actions',
      edit: 'Edit',
      delete: 'Delete',
      loading: 'Loading...',
      noUsers: 'No users found',
      fetchError: 'Failed to fetch users',
      searchPlaceholder: 'Search users...',
      addUser: 'Add User',
      createUser: 'Create User',
      createUserTitle: 'Create New User',
      createUserDesc: 'Fill in the form below to create a new user account',
      username: 'Username',
      usernamePlaceholder: 'Enter username (3-50 characters)',
      usernameRequired: 'Username is required',
      usernameMinLength: 'Username must be at least 3 characters',
      usernameInvalidChars: 'Username can only contain letters, numbers, and underscores',
      password: 'Password',
      passwordPlaceholder: 'Enter password (minimum 6 characters)',
      passwordRequired: 'Password is required',
      passwordMinLength: 'Password must be at least 6 characters',
      fullName: 'Full Name',
      fullNamePlaceholder: 'Enter full name (optional)',
      avatarUrl: 'Avatar URL',
      avatarUrlPlaceholder: 'Enter avatar image URL (optional)',
      userRole: 'User Role',
      userRoleAdmin: 'Admin',
      userRoleRegular: 'Regular',
      userRolePremium: 'Premium',
      isAdmin: 'Admin User',
      isAdminDesc: 'Grant administrator privileges',
      isActive: 'Active User',
      isActiveDesc: 'User account is active and can log in',
      cancel: 'Cancel',
      creating: 'Creating...',
      createSuccess: 'User created successfully',
      createError: 'Failed to create user',
      usernameExists: 'Username already exists',
      emailExists: 'Email already exists',
      deleteUser: 'Delete User',
      deleteConfirmTitle: 'Delete User',
      deleteConfirmMessage: 'Are you sure you want to delete user {username}? This action cannot be undone.',
      modelSettings: 'Model Settings',
      modelSettingsDesc: 'Configure AI models for each function',
      modelChat: 'Chat',
      modelFast: 'Fast LLM',
      modelVideoCut: 'Video Cut',
      modelVision: 'Vision',
      modelCoding: 'Coding',
      // Coding Plan
      codingPlan: 'Coding Plan',
      codingPlanDesc: 'Configure coding assistant models (Kimi, Codex, Claude, GLM)',
      codingPlanProviders: 'Coding Providers',
      codingPlanProvidersDesc: 'Add API credentials for coding assistant services',
      codingPlanAssignment: 'Active Coding Model',
      codingPlanAssignmentDesc: 'Select which coding model to use',
      modelPreset: 'Preset Model',
      modelCustom: 'Custom Model',
      modelProvider: 'Provider',
      modelName: 'Model Name',
      modelApiUrl: 'API URL',
      modelApiKey: 'API Key',
      modelApiKeyPlaceholder: 'Enter API Key',
      modelTemperature: 'Temperature',
      modelMaxTokens: 'Max Tokens',
      modelTestConnection: 'Test Connection',
      modelTesting: 'Testing...',
      modelTestSuccess: 'Connection successful',
      modelTestFailed: 'Connection failed',
      modelSave: 'Save',
      modelSaving: 'Saving...',
      modelSaveSuccess: 'Model settings saved',
      modelSaveError: 'Failed to save model settings',
      modelUsingEnv: 'Using default config',
      modelUsingDb: 'Custom config active',
      modelDomestic: 'Domestic',
      modelInternational: 'International',
      modelResetToDefault: 'Reset to Default',
      modelParameters: 'Parameters',
      modelSelectProvider: 'Select provider',
      modelSelectModel: 'Select model',
      modelApiUrlPlaceholder: 'https://api.example.com/v1',
      modelNamePlaceholder: 'Enter model name',
      modelFetchModels: 'Fetch Models',
      modelFetchingModels: 'Fetching...',
      modelFetchModelsError: 'Failed to fetch models',
      modelNoModelsFound: 'No models found',
      modelFetchModelsHint: 'Enter API Key and click Fetch Models',
      modelOrInputManually: 'or input manually',
      // Two-layer model settings
      modelProviders: 'Provider Management',
      modelProvidersDesc: 'Configure API credentials for AI model providers',
      modelAddProvider: 'Add Provider',
      modelEditProvider: 'Edit Provider',
      modelDeleteProvider: 'Delete Provider',
      modelDeleteProviderConfirm: 'Are you sure you want to delete this provider? Associated feature assignments will also be removed.',
      modelProviderName: 'Provider Name',
      modelProviderNamePlaceholder: 'e.g. My DeepSeek Account',
      modelProviderType: 'Provider Type',
      modelProviderSaved: 'Provider saved',
      modelProviderDeleted: 'Provider deleted',
      modelProviderCreateError: 'Failed to save provider',
      modelAssignments: 'Feature Model Assignment',
      modelAssignmentsDesc: 'Select which model to use for each feature',
      modelNoProviders: 'No providers configured yet. Please add one first.',
      modelProviderInUse: 'This provider is used by the following features',
      modelAssignmentSaved: 'Assignment saved',
      modelAssignmentDeleted: 'Assignment deleted',
      deleteConfirmUsername: 'Username',
      deleteConfirmEmail: 'Email',
      confirmDelete: 'Delete',
      cancelDelete: 'Cancel',
      deleting: 'Deleting...',
      deleteSuccess: 'User deleted successfully',
      deleteError: 'Failed to delete user',
      // Role labels
      roleRoot: 'Super Admin',
      roleAdmin: 'Admin',
      rolePremium: 'Premium',
      roleRegular: 'User',
      // User management extras
      superAdmin: 'Super Admin',
      resetPassword: 'Reset Password',
      resetPasswordTitle: 'Reset Password',
      resetPasswordDesc: 'Enter a new password for this user. Leave empty to generate a random password.',
      resetPasswordSuccess: 'Password has been reset',
      resetPasswordError: 'Failed to reset password',
      enableUser: 'Enable',
      disableUser: 'Disable',
      forceLogout: 'Force Logout',
      forceLogoutSuccess: 'User has been logged out',
      forceLogoutError: 'Failed to force logout',
      onlineUsers: 'Online Users',
      disabledUsers: 'Disabled Users',
      sessionInvalid: 'Your session has expired. Please log in again.',
      inviteCode: 'Invite Code',
      inviteCodePlaceholder: 'Enter invite code',
      loginHistory: 'Login History',
      loginTime: 'Login Time',
      ipAddress: 'IP Address',
      deviceInfo: 'Device',
      loginResult: 'Result',
      loginSuccess: 'Success',
      loginFailed: 'Failed',
      failureReason: 'Reason',
      // Enhanced user management UI
      confirmPassword: 'Confirm Password',
      passwordMismatch: 'Passwords do not match',
      emailPlaceholder: 'Enter email (optional)',
      emailInvalid: 'Invalid email format',
      editUser: 'Edit User',
      editUserTitle: 'Edit User',
      editUserDesc: 'Modify user profile information',
      editSuccess: 'User updated successfully',
      editError: 'Failed to update user',
      saving: 'Saving...',
      save: 'Save',
      allRoles: 'All Roles',
      allStatus: 'All Status',
      enabled: 'Enabled',
      disabled: 'Disabled',
      disableConfirmTitle: 'Disable User',
      disableConfirmMessage: 'Are you sure you want to disable user {username}? They will not be able to log in.',
      disableConfirmOnline: 'This user is currently online and will be logged out immediately.',
      forceLogoutConfirmTitle: 'Force Logout',
      forceLogoutConfirmMessage: 'Are you sure you want to force logout user {username}?',
      deleteTypeUsername: 'Type the username to confirm:',
      toggleStatusSuccess: 'User status updated',
      toggleStatusError: 'Failed to update user status',
      autoGenerate: 'Auto Generate',
      manualSet: 'Manual Set',
      generatePassword: 'Generate Password',
      generatedPassword: 'Generated Password',
      copyPassword: 'Copy',
      copied: 'Copied!',
      resetPasswordWarning: 'The user will be forced to log out and must use the new password to log in again.',
      newPassword: 'New Password',
      newPasswordPlaceholder: 'Enter new password (min 6 characters)',
      confirmNewPassword: 'Confirm New Password',
      noLoginHistory: 'No login history found',
      loginHistoryFor: 'Login History for {username}',
      close: 'Close',
      previous: 'Previous',
      next: 'Next',
      pageOf: 'Page {current} of {total}',
      totalRecords: '{count} records total',
      perPage: 'per page',
      refresh: 'Refresh',
      user: 'User',
    },
    tasks: {
      workflow: 'WorkFlow',
      videoEditing: 'Video Editing',
      brainstorming: 'Brainstorming',
      aiChat: 'AI Chat',
    },
    welcome: {
      title: 'Welcome to Ecliptrix',
      subtitle: 'Where light and shadow collide',
      description: 'Where light and shadow collide to create extraordinary content. Start by creating a new task to begin your creative journey.',
      workflowDesc: 'Build AI-powered workflow agents',
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
      aiAutoMixTooltip: 'Auto-mix',
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
      aiMixing: 'AI Mixing',
      aiMixingTooltip: 'Auto-generate editing plan based on current materials, intelligently mix video content',
      myMaterials: 'My Materials',
      myMaterialsDescription: 'Browse and select all materials you have previously uploaded',
      loadingMaterials: 'Loading materials...',
      loadError: 'Loading failed',
      retry: 'Retry',
      noMaterialsFound: 'No materials found',
      selectAll: 'Select All',
      deselectAll: 'Deselect All',
      selectedCount: '{count} selected',
      addToMaterialManagement: 'Add to Material Management',
      totalMaterials: 'Total {count} materials',
    },
    aiMixingModal: {
      title: 'Select AI Mixing Mode',
      subtitle: 'Choose the mixing method that best suits your needs',
      quickMode: 'Quick Mixing',
      quickModeDesc: 'Extract 1 frame per video for AI analysis, quickly generate editing plan. Suitable for previewing or scenarios with low precision requirements.',
      quickModeFeatures: 'Features',
      quickModeFast: 'Fast processing',
      quickModeLowResource: 'Low resource consumption',
      professionalMode: 'Professional Mixing',
      professionalModeDesc: 'Extract multiple frames at specified intervals for deep AI analysis, generate high-quality editing plan. Suitable for professional production or scenarios requiring high quality.',
      professionalModeFeatures: 'Features',
      professionalModeHighPrecision: 'High precision analysis',
      professionalModeBetterResults: 'Better results',
      frameIntervalLabel: 'Video Analysis Frame Interval (seconds)',
      frameIntervalUnit: 'seconds',
      frameIntervalHint: 'Smaller interval means more detailed analysis but longer processing time (Recommended: 3-10 seconds)',
      cancel: 'Cancel',
      confirm: 'Start AI Mixing',
    },
    batchAnalysisModal: {
      title: 'Select Batch Analysis Mode',
      subtitle: 'Choose the analysis method that best suits your needs',
      quickMode: 'Quick Analysis',
      quickModeDesc: 'Use video thumbnails directly for AI analysis, quickly generate content descriptions. Suitable for quick previews or scenarios with low precision requirements.',
      quickModeFast: 'Fast processing',
      quickModeLowResource: 'Low resource consumption',
      professionalMode: 'Professional Analysis',
      professionalModeDesc: 'Extract multiple frames at specified intervals for deep AI analysis, generate detailed content descriptions. Suitable for professional production or scenarios requiring high quality.',
      professionalModeHighPrecision: 'High precision analysis',
      professionalModeBetterResults: 'Better results',
      frameIntervalLabel: 'Video Analysis Frame Interval (seconds)',
      frameIntervalUnit: 'seconds',
      frameIntervalHint: 'Smaller interval means more detailed analysis but longer processing time (Recommended: 3-10 seconds)',
      cancel: 'Cancel',
      confirm: 'Start Analysis',
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
        zoomHint: 'Hold Ctrl + Scroll to zoom timeline',
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
    videoExportProgressModal: {
      title: 'Export Video',
      progressStages: {
        preparing: 'Preparing export...',
        processing: 'Processing video...',
        composing: 'Composing...',
        generating: 'Generating file...',
        almostDone: 'Almost done...',
        completed: 'Export completed',
      },
      timeElapsed: 'Time Elapsed',
      pleaseWait: 'Please wait, do not close this page during export',
      cancelExport: 'Cancel Export',
      exportSuccess: 'Export successful',
    },
    videoExport: {
      noContentToExport: 'No content to export',
      noContentToExportDesc: 'Please add video materials to the timeline before exporting',
    },
         scriptPanel: {
       tabs: {
         narrationScript: 'Narration Script',
         aiVideoScript: 'AI Video Script',
       },
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
       aiVideoScript: {
         addSegment: 'Add Scene',
         removeSegment: 'Remove Scene',
         scriptPlaceholder: 'Enter video script description for this scene...',
         characterImage: 'Character Image',
         sceneImage: 'Scene Image',
         selectImage: 'Select Image',
         removeImage: 'Remove',
         generateVideo: 'Generate AI Video',
         generating: 'Generating...',
         generationFailed: 'Generation Failed',
         retry: 'Retry',
         generatedVideo: 'Generated Video',
         emptyState: 'No AI video script segments',
         emptyHint: 'Click "Add Scene" button above to start creating',
         fromMaterials: 'From Materials',
         pasteUrl: 'Paste URL',
         segmentTitle: 'Scene {index}',
         cancel: 'Cancel',
         noImagesInMaterials: 'No images in materials',
         cancelGeneration: 'Cancel',
         aiGenerate: 'AI Generate',
         aiGenerating: 'Generating...',
         modeDescription: 'Description Mode',
         modeKeyframe: 'Keyframe Mode',
         firstFrameImage: 'First Frame',
         firstFrameRequired: '*Required',
         lastFrameImage: 'Last Frame',
         lastFrameOptional: '(Optional)',
         firstFrameMissing: 'Please upload a first frame image first',
         invalidImageUrl: 'Please enter a valid HTTP/HTTPS URL',
         durationLabel: 'Duration:',
         expandScript: 'AI Expand',
         expandingScript: 'Expanding...',
       },
     },
   videoScript: {
     tab: {
       aiVideo: 'AI Video Script',
       normal: 'Normal Script',
     },
     chatToggle: {
       label: 'Include chat content',
       count: '{count} messages in current chat',
       empty: 'No chat content available',
     },
     customPrompt: {
       placeholder: 'Enter your generation requirements...',
       polish: 'Polish',
       polishing: 'Polishing...',
       undo: 'Undo',
     },
     generate: {
       aiVideo: 'Generate AI Video Script',
       normal: 'Generate Script',
     },
     validation: {
       empty: 'Please select at least one input source',
     },
   },
   documentPanel: {
     title: 'Documentation',
     creativeBrainstorming: 'Brainstorming',
     creativeBrainstormingAriaLabel: 'Start creative brainstorming',
     polishContent: 'Polish current document content with AI',
     polishContentAriaLabel: 'Polish document content',
     generateScript: 'Generate video script from current document',
     generatingScript: 'Generating script...',
     generateScriptAriaLabel: 'Generate script',
     placeholder: 'Start writing your video project documentation...',
   },
   contentPolishModal: {
     title: 'Smart Polish',
     subtitle: 'Let AI optimize your content and enhance expression effectiveness',
     close: 'Close',
     originalContent: 'Original Content',
     noContent: 'No content',
     selectPolishGoals: 'Select Polish Goals',
     selectedCount: 'Selected {count}',
     clear: 'Clear',
     loadingConfig: 'Loading configuration...',
     configLoadError: 'Configuration loading failed: {error}',
     startPolish: 'Start Polish ({count} goals)',
     polishing: 'Polishing...',
     selectGoals: 'Please select goals',
     polishResults: 'Polish Results',
     emptyStateTitle: 'Select polish goals, then click "Start Polish" to generate optimization suggestions',
     emptyStateSubtitle: 'Multiple selections supported, generating specialized polish plans for each goal',
     cancel: 'Cancel',
     confirmApply: 'Confirm Apply',
     selected: 'Selected',
     errors: {
       polishFailed: 'Polish failed: {error}',
       allPolishFailed: 'All polish attempts failed, please try again',
       intensityPolishFailed: 'Intensity {intensity} polish generation failed'
     },
     categoryNames: {
       platform: 'Platform Adaptation',
       engagement: 'Engagement',
       emotional: 'Emotional Resonance',
       conversion: 'Conversion Drive',
       narrative: 'Narrative Expression',
       targeting: 'Precise Targeting',
       viral: 'Viral Optimization',
       controversial: 'Controversial Topics',
       uniqueness: 'Differentiation',
       structure: 'Structure Optimization',
       emphasis: 'Key Emphasis',
       memorable: 'Memorable',
       credibility: 'Credibility',
       immersive: 'Immersive Experience',
       innovative: 'Innovative Thinking',
       psychological: 'Psychological Drive',
       motivation: 'Motivation Activation',
       practical: 'Practical Value',
       other: 'Other'
     },
     intensityLabels: {
       light: 'Light Polish',
       medium: 'Medium Polish',
       strong: 'Strong Polish',
       deep: 'Deep Polish',
       extreme: 'Extreme Polish'
     },
     polishGoals: {
       short_video: {
         name: 'Short Video Copy',
         description: 'Copy style suitable for short video platforms like TikTok and Kwai'
       },
       three_second_hook: {
         name: '3-Second Hook',
         description: 'Grab audience attention within 3 seconds at the beginning'
       },
       engage_comments: {
         name: 'Engage Comments',
         description: 'Guide user interaction and discussion'
       },
       reader_resonance: {
         name: 'Reader Resonance',
         description: 'Create strong emotional resonance with readers'
       },
       empathy: {
         name: 'Evoke Empathy',
         description: 'Touch readers\' emotions and create empathy'
       },
       call_to_action: {
         name: 'Call to Action',
         description: 'Guide readers to take specific actions'
       },
       storytelling: {
         name: 'Storytelling',
         description: 'Tell content in a narrative way'
       },
       pain_point: {
         name: 'Pain Point Entry',
         description: 'Directly address user pain points to attract attention'
       },
       viral_potential: {
         name: 'Viral Potential',
         description: 'Content that is easy to share and spread'
       },
       curiosity_gap: {
         name: 'Curiosity Gap',
         description: 'Create suspense and arouse curiosity'
       },
       fan_sb: {
         name: 'Deliberate Errors',
         description: 'Intentionally make minor errors to trigger user correction and comments'
       },
       provoke_debate: {
         name: 'Provoke Debate',
         description: 'Use professional techniques to create controversial viewpoints and stimulate discussion'
       },
       differentiation: {
         name: 'Differentiation',
         description: 'Adopt unique perspectives and innovative expressions to stand out'
       },
       echo_ending: {
         name: 'Echo Ending',
         description: 'Create coherence between ending and beginning to enhance integrity'
       },
       contrast_strong: {
         name: 'Strong Contrast',
         description: 'Highlight key points through striking contrasts'
       },
       golden_sentence: {
         name: 'Golden Sentences',
         description: 'Include classic sentences that are easy to quote'
       },
       data_support: {
         name: 'Data Support',
         description: 'Enhance persuasiveness with specific data'
       },
       authority_quote: {
         name: 'Authority Quote',
         description: 'Quote expert or celebrity opinions to increase credibility'
       },
       scenario_immersion: {
         name: 'Scenario Immersion',
         description: 'Let readers feel immersed and enhance experience'
       },
       reverse_thinking: {
         name: 'Reverse Thinking',
         description: 'Contrary to conventional thinking, create surprises'
       },
       anxiety_marketing: {
         name: 'Anxiety Marketing',
         description: 'Reasonably utilize anxiety psychology to drive action'
       },
       benefit_driven: {
         name: 'Benefit Driven',
         description: 'Clearly state the benefits readers can gain'
       },
       scarcity_urgency: {
         name: 'Scarcity & Urgency',
         description: 'Create sense of scarcity and urgency'
       },
       social_proof: {
         name: 'Social Proof',
         description: 'Use herd mentality to enhance persuasiveness'
       },
       emotional_trigger: {
         name: 'Emotional Trigger',
         description: 'Trigger strong emotional responses'
       },
       practical_tips: {
         name: 'Practical Tips',
         description: 'Provide specific and actionable methods and techniques'
       }
     },
     multiGoalDescription: 'Simultaneously meets {count} polish goals: {goals}',
     operationHint: '{count} polish goals selected, click to start polishing'
   },
   scriptGenerationModal: {
      title: 'Script Generation Configuration',
      close: 'Close',
      languageLabel: 'Script Language',
      languageOptions: {
        chinese: {
          label: 'Chinese',
          description: 'Generate Chinese video script'
        },
        english: {
          label: 'English',
          description: 'Generate English video script'
        },
        mixed: {
          label: 'Mixed',
          description: 'Intelligently select language based on content'
        }
      },
      consistencyLabel: 'Original Content Consistency',
      consistencyOptions: {
        high: {
          label: 'High Consistency',
          description: 'Preserve original expression as much as possible'
        },
        moderate: {
          label: 'Moderate Modification',
          description: 'Moderate adjustment to suit video presentation'
        },
        low: {
          label: 'Significant Modification',
          description: 'Significantly optimize to enhance video effectiveness'
        }
      },
      segmentCountLabel: 'Number of Segments',
      segmentCountHint: 'Recommend choosing an appropriate number based on content length',
      customRequirementsLabel: 'Custom Requirements',
      customRequirementsOptional: '(Optional)',
      customRequirementsPlaceholder: 'Describe your special requirements for the script, such as: style, tone, emphasis...',
      charCount: '{current}/{max}',
      cancelButton: 'Cancel',
      generateButton: 'Generate'
    },
    creativeBrainstormingModal: {
      title: 'Creative Brainstorming Assistant',
      subtitle: 'Multi-expert collaboration, inspire creative ideas',
      close: 'Close',
      closeAriaLabel: 'Close modal',
      configPanel: {
        customCreativeTitle: 'Custom Ideas',
        customCreativeDescription: 'Enter your creative ideas as the basis for expert discussion',
        customCreativePlaceholder: 'Please enter your creative ideas, special requirements or desired direction...',
        startButton: 'Start Brainstorming',
        startButtonDiscussing: 'Discussion in Progress...',
        validationError: 'Please select at least one creation type and one creative expert'
      },
      categories: {
        creationType: {
          title: 'Creation Type',
          description: 'Select your video content type',
          options: {
            brandMarketing: { label: 'Brand Marketing', description: 'Enhance brand awareness and influence' },
            educationalTraining: { label: 'Educational Training', description: 'Knowledge transfer and skill training' },
            entertainmentContent: { label: 'Entertainment Content', description: 'Entertain audience, provide relaxing experience' },
            productShowcase: { label: 'Product Showcase', description: 'Display product features and advantages' },
            storytelling: { label: 'Storytelling', description: 'Convey values through stories' }
          }
        },
        creationDomain: {
          title: 'Creation Domain',
          description: 'Select your professional domain',
          options: {
            technologyDigital: { label: 'Technology & Digital', description: 'Cutting-edge technology and digital products' },
            lifestyle: { label: 'Lifestyle', description: 'Daily life and personal growth' },
            businessFinance: { label: 'Business & Finance', description: 'Business strategy and financial knowledge' },
            healthMedical: { label: 'Health & Medical', description: 'Health wellness and medical science' },
            artsCulture: { label: 'Arts & Culture', description: 'Artistic creation and cultural heritage' },
            travelFood: { label: 'Travel & Food', description: 'Travel experiences and food sharing' }
          }
        },
        creationGoal: {
          title: 'Creation Goal',
          description: 'Define your core objective',
          options: {
            brandAwareness: { label: 'Increase Brand Awareness', description: 'Increase brand exposure and recognition' },
            userEngagement: { label: 'Increase User Engagement', description: 'Improve interaction and user stickiness' },
            knowledgeEducation: { label: 'Educate and Spread Knowledge', description: 'Disseminate knowledge and skills' },
            salesPromotion: { label: 'Promote Product Sales', description: 'Drive conversion and sales growth' },
            audienceEntertainment: { label: 'Entertain Audience', description: 'Provide entertainment value and pleasant experience' }
          }
        },
        contentStrategy: {
          title: 'Content Strategy',
          description: 'Select your content strategy direction',
          options: {
            emotionalResonance: { label: 'Emotional Resonance', description: 'Touch audience through emotional connection' },
            dataDriven: { label: 'Data-Driven', description: 'Formulate strategies based on data analysis' },
            storyDriven: { label: 'Story-Driven', description: 'Convey core messages through stories' },
            interactiveEngagement: { label: 'Interactive Engagement', description: 'Encourage audience participation and interaction' },
            professionalAuthority: { label: 'Professional Authority', description: 'Establish professional image and authority' }
          }
        },
        creativeExperts: {
          title: 'Creative Experts',
          description: 'Select experts to participate in discussion',
          options: {
            creativeDirector: { label: 'Creative Director', description: 'Responsible for overall creative direction and execution' },
            marketingStrategist: { label: 'Marketing Strategist', description: 'Develop market promotion and communication strategy' },
            contentWriter: { label: 'Content Writer', description: 'Create copy content and story scripts' },
            visualDesigner: { label: 'Visual Designer', description: 'Design visual elements and interface interaction' },
            uxExpert: { label: 'UX Expert', description: 'Optimize user experience and interaction flow' }
          }
        }
      },
      experts: {
        creativeDirector: {
          name: 'Creative Lee',
          title: 'Creative Director',
          expertise: ['Creative Strategy', 'Brand Positioning', 'Visual Concept', 'Creative Execution'],
          personality: 'Full of imagination, good at thinking from different angles, focuses on creativity uniqueness and execution feasibility'
        },
        marketingStrategist: {
          name: 'Strategy Wang',
          title: 'Marketing Strategist',
          expertise: ['Market Analysis', 'User Insights', 'Communication Strategy', 'Effect Evaluation'],
          personality: 'Data-driven, good at analyzing market trends and user behavior, focuses on business value of strategy'
        },
        contentWriter: {
          name: 'Writer Zhang',
          title: 'Content Writer',
          expertise: ['Story Structure', 'Copywriting', 'Emotional Expression', 'Narrative Techniques'],
          personality: 'Literary talent, skilled at touching hearts with words, focuses on emotional resonance and communication power'
        },
        visualDesigner: {
          name: 'Visual Chen',
          title: 'Visual Designer',
          expertise: ['Visual Design', 'Color Matching', 'Interface Interaction', 'User Experience'],
          personality: 'Pursues balance of aesthetics and function, good at conveying information with visual language, focuses on design practicality'
        },
        uxExpert: {
          name: 'UX Liu',
          title: 'UX Expert',
          expertise: ['User Research', 'Interaction Design', 'Usability Testing', 'Experience Optimization'],
          personality: 'User-centered, good at discovering and solving user pain points, focuses on product usability and satisfaction'
        }
      },
      chatInterface: {
        title: 'Creative Discussion',
        roundLabel: 'Round {round}',
        discussingStatus: ' - Experts discussing...',
        summarizingStatus: ' - Summarizing...',
        exportButton: 'Export Content',
        emptyStateTitle: 'Waiting to Start Discussion',
        emptyStateSubtitle: 'After configuration is complete, experts will begin creative brainstorming',
        continueButton: 'Continue Discussion',
        summaryButton: 'Start Summary',
        userInputPlaceholder: 'Enter your thoughts or questions...',
        userInputPlaceholderDiscussing: 'Experts discussing, please wait...',
        userInputPlaceholderSummarizing: 'Summarizing, please wait...'
      }
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
    videoChatWindow: {
      inputPlaceholder: 'Enter message... (Shift+Enter for new line)',
      creativeBrainstormingTooltip: 'Creative Brainstorming',
      polishContentTooltip: 'Polish current document content with AI',
      generateScriptTooltip: 'Generate video script from current document',
      generateScriptTooltipGenerating: 'Generating script...',
      clearChatTooltip: 'Clear chat history',
      sendMessageTooltip: 'Send message',
      clearChatConfirm: 'Are you sure you want to clear all chat history? This action cannot be undone.',
      emptyStateTitle: 'Video Editing AI Assistant',
      emptyStateSubtitle: 'Start chatting with AI to get video editing suggestions, script optimization, and creative inspiration.',
      scriptOptimizationTitle: 'Script Optimization',
      scriptOptimizationDesc: 'Let AI help you improve your video script and creative direction',
      editingSuggestionsTitle: 'Editing Suggestions',
      editingSuggestionsDesc: 'Get professional video editing and material usage suggestions',
      startChatTitle: 'Start chatting with AI',
      startChatDesc: 'Enter your question or requirement, AI will help you',
      viewWorkflowsTooltip: 'View Workflows',
      agentToggleLabel: 'Agent',
      agentInputPlaceholder: 'Tell the agent what to edit...',
      agentWorkingPlaceholder: 'Agent is working...',
      agentUndoButton: 'Undo',
      agentUndoneLabel: 'Operations undone',
      agentOperations: 'operations',
    },
    workflowConfigModal: {
      title: 'Workflow Configuration',
      subtitle: 'Select and configure workflows for video editing tasks',
      workflowListTitle: 'Available Workflows',
      workflowConfigTitle: 'Workflow Settings',
      enabledLabel: 'Enabled',
      disabledLabel: 'Disabled',
      toolDescriptionLabel: 'Tool Description',
      toolDescriptionPlaceholder: 'Describe what this workflow tool does for the AI assistant...',
      modelSelectionLabel: 'Model Selection',
      modelPlaceholder: 'Select a model...',
      noWorkflowSelected: 'No Workflow Selected',
      selectWorkflowPrompt: 'Please select a workflow from the left panel to configure',
      noWorkflowsAvailable: 'No Workflows Available',
      createWorkflowPrompt: 'Create workflows in the Workflows task first',
      saveButton: 'Save Configuration',
      cancelButton: 'Cancel',
      loadingWorkflows: 'Loading workflows...',
      workflowCount: '{count} workflow(s)',
      successSave: 'Workflow configuration saved successfully',
      errorLoad: 'Failed to load workflows',
      errorSave: 'Failed to save configuration',
    },
    aiChat: {
      welcomePage: {
        title: 'Start Conversation',
        subtitle: 'Create a new chat session to start an AI conversation. Ask questions, get help, or have a friendly chat.',
        creativeAssistantTitle: 'Creative Assistant',
        creativeAssistantDesc: 'Assist with writing, brainstorming, and creative projects',
        knowledgeAssistantTitle: 'Knowledge Assistant',
        knowledgeAssistantDesc: 'Ask questions and get detailed explanations on any topic',
      },
      emptyConversation: {
        title: 'Ready to Chat',
        subtitle: 'Send a message to start the conversation',
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
      close: '关闭',
      cancel: '取消',
    },
    header: {
      brandSubtitle: '光与影之交汇',
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
      welcomeSubtitle: '光与影之交汇，创造非凡内容',
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
    adminSettings: {
      title: '管理员设置',
      subtitle: '管理系统设置和用户',
      userManagement: '用户管理',
      systemSettings: '系统设置',
      userManagementDesc: '查看和管理注册用户',
      systemSettingsDesc: '配置系统级设置',
      registeredUsers: '注册用户信息',
      totalUsers: '总用户数',
      adminUsers: '管理员用户',
      regularUsers: '普通用户',
      premiumUsers: '高级用户',
      userId: '用户ID',
      role: '角色',
      status: '状态',
      createdAt: '创建时间',
      lastLogin: '最后登录',
      active: '激活',
      inactive: '未激活',
      actions: '操作',
      edit: '编辑',
      delete: '删除',
      loading: '加载中...',
      noUsers: '暂无用户',
      fetchError: '获取用户列表失败',
      searchPlaceholder: '搜索用户...',
      addUser: '添加用户',
      createUser: '创建用户',
      createUserTitle: '创建新用户',
      createUserDesc: '填写下方表单以创建新用户账户',
      username: '用户名',
      usernamePlaceholder: '输入用户名（3-50个字符）',
      usernameRequired: '用户名为必填项',
      usernameMinLength: '用户名至少需要3个字符',
      usernameInvalidChars: '用户名只能包含字母、数字和下划线',
      password: '密码',
      passwordPlaceholder: '输入密码（至少6个字符）',
      passwordRequired: '密码为必填项',
      passwordMinLength: '密码至少需要6个字符',
      fullName: '姓名',
      fullNamePlaceholder: '输入姓名（可选）',
      avatarUrl: '头像链接',
      avatarUrlPlaceholder: '输入头像图片链接（可选）',
      userRole: '用户角色',
      userRoleAdmin: '管理员',
      userRoleRegular: '普通用户',
      userRolePremium: '高级用户',
      isAdmin: '管理员用户',
      isAdminDesc: '授予管理员权限',
      isActive: '激活用户',
      isActiveDesc: '用户账户已激活且可以登录',
      cancel: '取消',
      creating: '创建中...',
      createSuccess: '用户创建成功',
      createError: '用户创建失败',
      usernameExists: '用户名已存在',
      emailExists: '邮箱已存在',
      deleteUser: '删除用户',
      deleteConfirmTitle: '删除用户',
      deleteConfirmMessage: '确定要删除用户 {username} 吗？此操作无法撤销。',
      modelSettings: '模型设置',
      modelSettingsDesc: '为每个功能配置AI模型',
      modelChat: '主聊天',
      modelFast: '快速LLM',
      modelVideoCut: '视频剪辑',
      modelVision: '视觉',
      modelCoding: '编程',
      // Coding Plan
      codingPlan: '编程计划',
      codingPlanDesc: '配置编程助手模型 (Kimi, Codex, Claude, GLM)',
      codingPlanProviders: '编程供应商',
      codingPlanProvidersDesc: '添加编程助手服务的 API 凭证',
      codingPlanAssignment: '当前编程模型',
      codingPlanAssignmentDesc: '选择要使用的编程模型',
      modelPreset: '预设模型',
      modelCustom: '自定义模型',
      modelProvider: '供应商',
      modelName: '模型名称',
      modelApiUrl: 'API 地址',
      modelApiKey: 'API 密钥',
      modelApiKeyPlaceholder: '输入API密钥',
      modelTemperature: '温度',
      modelMaxTokens: '最大Token数',
      modelTestConnection: '测试连接',
      modelTesting: '测试中...',
      modelTestSuccess: '连接成功',
      modelTestFailed: '连接失败',
      modelSave: '保存',
      modelSaving: '保存中...',
      modelSaveSuccess: '模型设置已保存',
      modelSaveError: '保存模型设置失败',
      modelUsingEnv: '使用默认配置',
      modelUsingDb: '已自定义配置',
      modelDomestic: '国内',
      modelInternational: '国际',
      modelResetToDefault: '恢复默认',
      modelParameters: '参数',
      modelSelectProvider: '选择供应商',
      modelSelectModel: '选择模型',
      modelApiUrlPlaceholder: 'https://api.example.com/v1',
      modelNamePlaceholder: '输入模型名称',
      modelFetchModels: '获取模型列表',
      modelFetchingModels: '获取中...',
      modelFetchModelsError: '获取模型列表失败',
      modelNoModelsFound: '未找到模型',
      modelFetchModelsHint: '输入API密钥后点击获取模型列表',
      modelOrInputManually: '或手动输入',
      // Two-layer model settings
      modelProviders: '供应商管理',
      modelProvidersDesc: '配置 AI 模型供应商的 API 凭证',
      modelAddProvider: '添加供应商',
      modelEditProvider: '编辑供应商',
      modelDeleteProvider: '删除供应商',
      modelDeleteProviderConfirm: '确定删除此供应商？关联的功能配置也会被移除。',
      modelProviderName: '供应商名称',
      modelProviderNamePlaceholder: '例如：我的 DeepSeek 账号',
      modelProviderType: '供应商类型',
      modelProviderSaved: '供应商已保存',
      modelProviderDeleted: '供应商已删除',
      modelProviderCreateError: '保存供应商失败',
      modelAssignments: '功能模型分配',
      modelAssignmentsDesc: '为不同功能选择要使用的模型',
      modelNoProviders: '尚未配置供应商，请先添加',
      modelProviderInUse: '此供应商正被以下功能使用',
      modelAssignmentSaved: '分配已保存',
      modelAssignmentDeleted: '分配已删除',
      deleteConfirmUsername: '用户名',
      deleteConfirmEmail: '邮箱',
      confirmDelete: '删除',
      cancelDelete: '取消',
      deleting: '删除中...',
      deleteSuccess: '用户删除成功',
      deleteError: '用户删除失败',
      // Role labels
      roleRoot: '超级管理员',
      roleAdmin: '管理员',
      rolePremium: '高级用户',
      roleRegular: '普通用户',
      // User management extras
      superAdmin: '超级管理员',
      resetPassword: '重置密码',
      resetPasswordTitle: '重置密码',
      resetPasswordDesc: '输入新密码。留空将生成随机密码。',
      resetPasswordSuccess: '密码已重置',
      resetPasswordError: '重置密码失败',
      enableUser: '启用',
      disableUser: '禁用',
      forceLogout: '强制下线',
      forceLogoutSuccess: '用户已下线',
      forceLogoutError: '强制下线失败',
      onlineUsers: '在线用户',
      disabledUsers: '已禁用用户',
      sessionInvalid: '您的会话已失效，请重新登录',
      inviteCode: '邀请码',
      inviteCodePlaceholder: '输入邀请码',
      loginHistory: '登录历史',
      loginTime: '登录时间',
      ipAddress: 'IP地址',
      deviceInfo: '设备信息',
      loginResult: '结果',
      loginSuccess: '成功',
      loginFailed: '失败',
      failureReason: '原因',
      // Enhanced user management UI
      confirmPassword: '确认密码',
      passwordMismatch: '两次输入的密码不一致',
      emailPlaceholder: '输入邮箱（可选）',
      emailInvalid: '邮箱格式不正确',
      editUser: '编辑用户',
      editUserTitle: '编辑用户',
      editUserDesc: '修改用户资料信息',
      editSuccess: '用户更新成功',
      editError: '更新用户失败',
      saving: '保存中...',
      save: '保存',
      allRoles: '全部角色',
      allStatus: '全部状态',
      enabled: '已启用',
      disabled: '已禁用',
      disableConfirmTitle: '禁用用户',
      disableConfirmMessage: '确定要禁用用户 {username} 吗？该用户将无法登录。',
      disableConfirmOnline: '该用户当前在线，禁用后将被立即下线。',
      forceLogoutConfirmTitle: '强制下线',
      forceLogoutConfirmMessage: '确定要强制下线用户 {username} 吗？',
      deleteTypeUsername: '请输入用户名以确认：',
      toggleStatusSuccess: '用户状态已更新',
      toggleStatusError: '更新用户状态失败',
      autoGenerate: '自动生成',
      manualSet: '手动设置',
      generatePassword: '生成密码',
      generatedPassword: '生成的密码',
      copyPassword: '复制',
      copied: '已复制！',
      resetPasswordWarning: '用户将被强制登出，需要使用新密码重新登录。',
      newPassword: '新密码',
      newPasswordPlaceholder: '输入新密码（至少6位）',
      confirmNewPassword: '确认新密码',
      noLoginHistory: '暂无登录历史',
      loginHistoryFor: '{username} 的登录历史',
      close: '关闭',
      previous: '上一页',
      next: '下一页',
      pageOf: '第 {current}/{total} 页',
      totalRecords: '共 {count} 条',
      perPage: '每页',
      refresh: '刷新',
      user: '用户',
    },
    tasks: {
      workflow: '工作流',
      videoEditing: '视频编辑',
      brainstorming: '头脑风暴',
      aiChat: 'AI对话',
    },
    welcome: {
      title: '欢迎使用 Ecliptrix',
      subtitle: '光与影之交汇',
      description: '光与影之交汇，创造非凡内容。创建新任务开始您的创意之旅。',
      workflowDesc: '构建AI驱动的工作流代理',
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
      aiAutoMixTooltip: '自动混剪',
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
      aiMixing: 'AI混剪',
      aiMixingTooltip: '基于当前素材自动生成剪辑方案，智能混剪视频内容',
      myMaterials: '我的素材',
      myMaterialsDescription: '浏览和选择您之前上传的所有素材',
      loadingMaterials: '正在加载素材...',
      loadError: '加载失败',
      retry: '重试',
      noMaterialsFound: '未找到素材',
      selectAll: '全选',
      deselectAll: '取消全选',
      selectedCount: '已选择 {count} 个',
      addToMaterialManagement: '添加到素材管理',
      totalMaterials: '共 {count} 个素材',
    },
    aiMixingModal: {
      title: '选择AI混剪模式',
      subtitle: '选择最适合您需求的混剪方式',
      quickMode: '快速混剪',
      quickModeDesc: '每个视频提取1帧进行AI分析，快速生成剪辑方案。适合预览效果或对精度要求不高的场景。',
      quickModeFeatures: '特点',
      quickModeFast: '处理速度快',
      quickModeLowResource: '资源消耗低',
      professionalMode: '专业混剪',
      professionalModeDesc: '按指定时间间隔提取多帧进行深度AI分析，生成高质量剪辑方案。适合专业制作或对效果要求较高的场景。',
      professionalModeFeatures: '特点',
      professionalModeHighPrecision: '分析精度高',
      professionalModeBetterResults: '效果更佳',
      frameIntervalLabel: '视频解析帧间隔（秒）',
      frameIntervalUnit: '秒',
      frameIntervalHint: '间隔越小，分析越详细，但处理时间越长（推荐：3-10秒）',
      cancel: '取消',
      confirm: '开始AI混剪',
    },
    batchAnalysisModal: {
      title: '选择批量解析模式',
      subtitle: '选择最适合您需求的解析方式',
      quickMode: '快速解析',
      quickModeDesc: '直接使用视频缩略图进行AI解析，快速生成内容描述。适合快速预览或对精度要求不高的场景。',
      quickModeFast: '处理速度快',
      quickModeLowResource: '资源消耗低',
      professionalMode: '专业解析',
      professionalModeDesc: '按指定时间间隔提取多帧进行深度AI分析，生成详细的内容描述。适合专业制作或对效果要求较高的场景。',
      professionalModeHighPrecision: '分析精度高',
      professionalModeBetterResults: '效果更佳',
      frameIntervalLabel: '视频解析帧间隔（秒）',
      frameIntervalUnit: '秒',
      frameIntervalHint: '间隔越小，分析越详细，但处理时间越长（推荐：3-10秒）',
      cancel: '取消',
      confirm: '开始解析',
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
        zoomHint: '按住 Ctrl + 滚轮可缩放时间轴',
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
    videoExportProgressModal: {
      title: '导出视频',
      progressStages: {
        preparing: '准备导出...',
        processing: '处理视频...',
        composing: '合成中...',
        generating: '生成文件...',
        almostDone: '即将完成...',
        completed: '导出完成',
      },
      timeElapsed: '已用时',
      pleaseWait: '请耐心等待，导出过程中请勿关闭页面',
      cancelExport: '取消导出',
      exportSuccess: '导出成功',
    },
    videoExport: {
      noContentToExport: '没有视频内容可导出',
      noContentToExportDesc: '请先添加视频素材到时间轴',
    },
         scriptPanel: {
       tabs: {
         narrationScript: '解说脚本',
         aiVideoScript: 'AI视频脚本',
       },
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
       aiVideoScript: {
         addSegment: '添加场景',
         removeSegment: '删除场景',
         scriptPlaceholder: '输入这个场景的视频脚本描述...',
         characterImage: '场景人物图',
         sceneImage: '场景图',
         selectImage: '选择图片',
         removeImage: '移除',
         generateVideo: '生成AI视频',
         generating: '生成中...',
         generationFailed: '生成失败',
         retry: '重试',
         generatedVideo: '已生成视频',
         emptyState: '暂无AI视频脚本片段',
         emptyHint: '点击上方"添加场景"按钮开始创作',
         fromMaterials: '从素材选择',
         pasteUrl: '粘贴URL',
         segmentTitle: '场景 {index}',
         cancel: '取消',
         noImagesInMaterials: '素材中暂无图片',
         cancelGeneration: '取消',
         aiGenerate: 'AI 生成',
         aiGenerating: '生成中...',
         modeDescription: '描述生成',
         modeKeyframe: '关键帧生成',
         firstFrameImage: '首帧图片',
         firstFrameRequired: '*必填',
         lastFrameImage: '尾帧图片',
         lastFrameOptional: '(可选)',
         firstFrameMissing: '请先上传首帧图片',
         invalidImageUrl: '请输入有效的 HTTP/HTTPS 链接',
         durationLabel: '时长:',
         expandScript: 'AI 扩写',
         expandingScript: '扩写中...',
       },
     },
   videoScript: {
     tab: {
       aiVideo: 'AI视频脚本',
       normal: '普通脚本',
     },
     chatToggle: {
       label: '包含对话内容',
       count: '当前对话 {count} 条消息',
       empty: '暂无对话内容',
     },
     customPrompt: {
       placeholder: '输入你的生成需求描述...',
       polish: '优化',
       polishing: '优化中...',
       undo: '撤销',
     },
     generate: {
       aiVideo: '生成AI视频脚本',
       normal: '生成脚本',
     },
     validation: {
       empty: '请至少选择一种输入来源',
     },
   },
   documentPanel: {
     title: '文档编辑',
     creativeBrainstorming: '创意构思',
     creativeBrainstormingAriaLabel: '开启创意构思',
     polishContent: '智能润色当前文档内容',
     polishContentAriaLabel: '润色文档内容',
     generateScript: '根据当前文档内容生成视频脚本',
     generatingScript: '脚本生成中...',
     generateScriptAriaLabel: '生成脚本',
     placeholder: '开始编写您的视频项目文档...',
   },
   contentPolishModal: {
     title: '智能润色',
     subtitle: '让AI帮您优化内容，提升表达效果',
     close: '关闭',
     originalContent: '原始内容',
     noContent: '无内容',
     selectPolishGoals: '选择润色目标',
     selectedCount: '已选择 {count} 个',
     clear: '清空',
     loadingConfig: '加载配置中...',
     configLoadError: '配置加载失败：{error}',
     startPolish: '开始润色 ({count}种目标)',
     polishing: '润色中...',
     selectGoals: '请选择目标',
     polishResults: '润色结果',
     emptyStateTitle: '选择润色目标后，点击"开始润色"生成优化建议',
     emptyStateSubtitle: '支持多选，为每个目标生成专门的润色方案',
     cancel: '取消',
     confirmApply: '确认应用',
     selected: '已选择',
     errors: {
       polishFailed: '润色失败: {error}',
       allPolishFailed: '所有润色尝试都失败了，请重试',
       intensityPolishFailed: '强度{intensity}润色生成失败'
     },
     categoryNames: {
       platform: '平台适配',
       engagement: '互动引导',
       emotional: '情感共鸣',
       conversion: '转化驱动',
       narrative: '叙事表达',
       targeting: '精准定位',
       viral: '传播优化',
       controversial: '争议话题',
       uniqueness: '差异化',
       structure: '结构优化',
       emphasis: '重点突出',
       memorable: '记忆深刻',
       credibility: '可信度',
       immersive: '沉浸体验',
       innovative: '创新思维',
       psychological: '心理驱动',
       motivation: '动机激发',
       practical: '实用价值',
       other: '其他'
     },
     intensityLabels: {
       light: '轻度润色',
       medium: '中度润色',
       strong: '强度润色',
       deep: '深度润色',
       extreme: '极度润色'
     },
     polishGoals: {
       short_video: {
         name: '短视频文案',
         description: '适合抖音、快手等短视频平台的文案风格'
       },
       three_second_hook: {
         name: '三秒钩子',
         description: '开头3秒内抓住观众注意力'
       },
       engage_comments: {
         name: '激发用户评论',
         description: '引导用户互动和留言讨论'
       },
       reader_resonance: {
         name: '激发读者共鸣',
         description: '让读者产生强烈的情感共鸣'
       },
       empathy: {
         name: '激发共情',
         description: '触动读者的情感，产生同理心'
       },
       call_to_action: {
         name: '行动号召',
         description: '引导读者采取具体行动'
       },
       storytelling: {
         name: '故事化表达',
         description: '用故事的方式讲述内容'
       },
       pain_point: {
         name: '痛点切入',
         description: '直击用户痛点，引起关注'
       },
       viral_potential: {
         name: '传播性强',
         description: '容易被分享和传播的内容'
       },
       curiosity_gap: {
         name: '好奇心缺口',
         description: '制造悬念，激发好奇心'
       },
       fan_sb: {
         name: '犯SB',
         description: '故意犯一些小错误，引发用户纠正和评论'
       },
       provoke_debate: {
         name: '故意引战',
         description: '使用专业引战技巧，制造争议性观点激发讨论和辩论'
       },
       differentiation: {
         name: '差异化',
         description: '采用独特视角和创新表达，让内容脱颖而出'
       },
       echo_ending: {
         name: '收尾呼应',
         description: '结尾与开头形成呼应，增强整体性'
       },
       contrast_strong: {
         name: '强烈对比',
         description: '通过鲜明对比突出重点'
       },
       golden_sentence: {
         name: '金句输出',
         description: '包含容易被引用的经典语句'
       },
       data_support: {
         name: '数据支撑',
         description: '用具体数据增强说服力'
       },
       authority_quote: {
         name: '权威引用',
         description: '引用专家或名人观点增加可信度'
       },
       scenario_immersion: {
         name: '场景代入',
         description: '让读者身临其境，增强体验感'
       },
       reverse_thinking: {
         name: '反向思维',
         description: '与常规思路相反，制造惊喜'
       },
       anxiety_marketing: {
         name: '焦虑营销',
         description: '合理利用焦虑心理驱动行动'
       },
       benefit_driven: {
         name: '利益驱动',
         description: '明确指出读者能获得的好处'
       },
       scarcity_urgency: {
         name: '稀缺紧迫',
         description: '营造稀缺感和紧迫感'
       },
       social_proof: {
         name: '社会认同',
         description: '利用从众心理增强说服力'
       },
       emotional_trigger: {
         name: '情绪触发',
         description: '激发强烈的情绪反应'
       },
       practical_tips: {
         name: '实用干货',
         description: '提供具体可执行的方法技巧'
       }
     },
     multiGoalDescription: '同时满足{count}个润色目标：{goals}',
     operationHint: '已选择 {count} 个润色目标，点击开始润色'
   },
   scriptGenerationModal: {
      title: '生成脚本配置',
      close: '关闭',
      languageLabel: '脚本语言',
      languageOptions: {
        chinese: {
          label: '中文',
          description: '生成中文视频脚本'
        },
        english: {
          label: '英语',
          description: '生成英文视频脚本'
        },
        mixed: {
          label: '中英混杂',
          description: '根据内容智能选择语言'
        }
      },
      consistencyLabel: '原文保持程度',
      consistencyOptions: {
        high: {
          label: '高度一致',
          description: '尽可能保持原文表达方式'
        },
        moderate: {
          label: '略微修改',
          description: '适度调整以适合视频表达'
        },
        low: {
          label: '大幅修改',
          description: '大幅优化以提升视频效果'
        }
      },
      segmentCountLabel: '生成段落数',
      segmentCountHint: '建议根据内容长度选择适当的段落数量',
      customRequirementsLabel: '自定义要求',
      customRequirementsOptional: '(可选)',
      customRequirementsPlaceholder: '请描述您对脚本的特殊要求，例如：风格、语调、重点等...',
      charCount: '{current}/{max}',
      cancelButton: '取消',
      generateButton: '开始生成'
    },
    creativeBrainstormingModal: {
      title: '创意构思助手',
      subtitle: '多专家协作，激发创意灵感',
      close: '关闭',
      closeAriaLabel: '关闭弹窗',
      configPanel: {
        customCreativeTitle: '自定义创意',
        customCreativeDescription: '输入您的创意想法，作为专家讨论的依据',
        customCreativePlaceholder: '请输入您的创意想法、特殊要求或期望方向...',
        startButton: '开始构思',
        startButtonDiscussing: '讨论进行中...',
        validationError: '请至少选择一个创作类型和一位创意专家'
      },
      categories: {
        creationType: {
          title: '创作类型',
          description: '选择您的视频内容类型',
          options: {
            brandMarketing: { label: '品牌营销', description: '提升品牌知名度和影响力' },
            educationalTraining: { label: '教育培训', description: '知识传授和技能培训' },
            entertainmentContent: { label: '娱乐内容', description: '娱乐观众，提供轻松体验' },
            productShowcase: { label: '产品展示', description: '展示产品特性和优势' },
            storytelling: { label: '故事叙述', description: '通过故事传达价值观念' }
          }
        },
        creationDomain: {
          title: '创作领域',
          description: '选择您的专业领域',
          options: {
            technologyDigital: { label: '科技数码', description: '前沿科技和数码产品' },
            lifestyle: { label: '生活方式', description: '日常生活和个人成长' },
            businessFinance: { label: '商业金融', description: '商业策略和金融知识' },
            healthMedical: { label: '健康医疗', description: '健康养生和医疗科普' },
            artsCulture: { label: '艺术文化', description: '艺术创作和文化传承' },
            travelFood: { label: '旅游美食', description: '旅行体验和美食分享' }
          }
        },
        creationGoal: {
          title: '创作目标',
          description: '明确您的核心目标',
          options: {
            brandAwareness: { label: '提升品牌知名度', description: '增加品牌曝光和认知度' },
            userEngagement: { label: '增加用户参与度', description: '提高互动和用户黏性' },
            knowledgeEducation: { label: '教育普及知识', description: '传播知识和技能' },
            salesPromotion: { label: '促进产品销售', description: '推动转化和销售增长' },
            audienceEntertainment: { label: '娱乐观众', description: '提供娱乐价值和愉悦体验' }
          }
        },
        contentStrategy: {
          title: '内容策略',
          description: '选择您的内容策略方向',
          options: {
            emotionalResonance: { label: '情感共鸣', description: '通过情感连接打动观众' },
            dataDriven: { label: '数据驱动', description: '基于数据分析制定策略' },
            storyDriven: { label: '故事导向', description: '用故事传达核心信息' },
            interactiveEngagement: { label: '互动参与', description: '鼓励观众参与和互动' },
            professionalAuthority: { label: '专业权威', description: '建立专业形象和权威性' }
          }
        },
        creativeExperts: {
          title: '创意专家',
          description: '选择参与讨论的专家',
          options: {
            creativeDirector: { label: '创意总监', description: '负责整体创意方向和执行' },
            marketingStrategist: { label: '营销策略师', description: '制定市场推广和传播策略' },
            contentWriter: { label: '内容编剧', description: '创作文案内容和故事脚本' },
            visualDesigner: { label: '视觉设计师', description: '设计视觉元素和界面交互' },
            uxExpert: { label: '用户体验专家', description: '优化用户体验和交互流程' }
          }
        }
      },
      experts: {
        creativeDirector: {
          name: '李创意',
          title: '创意总监',
          expertise: ['创意策略', '品牌定位', '视觉概念', '创意执行'],
          personality: '充满想象力，善于从不同角度思考问题，注重创意的独特性和执行可行性'
        },
        marketingStrategist: {
          name: '王策略',
          title: '营销策略师',
          expertise: ['市场分析', '用户洞察', '传播策略', '效果评估'],
          personality: '数据驱动，善于分析市场趋势和用户行为，注重策略的商业价值'
        },
        contentWriter: {
          name: '张文案',
          title: '内容编剧',
          expertise: ['故事结构', '文案创作', '情感表达', '叙事技巧'],
          personality: '富有文采，擅长用文字打动人心，注重内容的情感共鸣和传播力'
        },
        visualDesigner: {
          name: '陈视觉',
          title: '视觉设计师',
          expertise: ['视觉设计', '色彩搭配', '界面交互', '用户体验'],
          personality: '追求美感和功能的平衡，善于用视觉语言传达信息，注重设计的实用性'
        },
        uxExpert: {
          name: '刘体验',
          title: '用户体验专家',
          expertise: ['用户研究', '交互设计', '可用性测试', '体验优化'],
          personality: '以用户为中心，善于发现和解决用户痛点，注重产品的易用性和满意度'
        }
      },
      chatInterface: {
        title: '创意讨论',
        roundLabel: '第 {round} 轮讨论',
        discussingStatus: ' - 专家讨论中...',
        summarizingStatus: ' - 正在总结...',
        exportButton: '导出文案',
        emptyStateTitle: '等待开始讨论',
        emptyStateSubtitle: '配置完成后，专家们将开始创意构思',
        continueButton: '继续讨论',
        summaryButton: '开始总结',
        userInputPlaceholder: '输入您的想法或问题...',
        userInputPlaceholderDiscussing: '专家讨论中，请稍后...',
        userInputPlaceholderSummarizing: '正在总结中，请稍后...'
      }
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
    videoChatWindow: {
      inputPlaceholder: '输入消息... (Shift+Enter 换行)',
      creativeBrainstormingTooltip: '创意构思',
      polishContentTooltip: '智能润色当前文档内容',
      generateScriptTooltip: '根据当前文档内容生成视频脚本',
      generateScriptTooltipGenerating: '正在生成脚本...',
      clearChatTooltip: '清空聊天记录',
      sendMessageTooltip: '发送消息',
      clearChatConfirm: '确定要清空所有聊天记录吗？此操作无法撤销。',
      emptyStateTitle: '视频编辑 AI 助手',
      emptyStateSubtitle: '开始与 AI 对话，获取视频编辑建议、脚本优化和创意灵感。',
      scriptOptimizationTitle: '脚本优化',
      scriptOptimizationDesc: '让 AI 帮你改进视频脚本和创意方向',
      editingSuggestionsTitle: '剪辑建议',
      editingSuggestionsDesc: '获取专业的视频剪辑和素材使用建议',
      startChatTitle: '开始与 AI 对话',
      startChatDesc: '输入你的问题或需求，AI 将为你提供帮助',
      viewWorkflowsTooltip: '查看工作流',
      agentToggleLabel: 'Agent',
      agentInputPlaceholder: '告诉 Agent 你要编辑什么...',
      agentWorkingPlaceholder: 'Agent 正在执行...',
      agentUndoButton: '撤销',
      agentUndoneLabel: '操作已撤销',
      agentOperations: '个操作',
    },
    workflowConfigModal: {
      title: '工作流配置',
      subtitle: '选择并配置用于视频编辑任务的工作流',
      workflowListTitle: '可用工作流',
      workflowConfigTitle: '工作流设置',
      enabledLabel: '已启用',
      disabledLabel: '未启用',
      toolDescriptionLabel: '工具描述',
      toolDescriptionPlaceholder: '描述此工作流工具为 AI 助手提供什么功能...',
      modelSelectionLabel: '模型选择',
      modelPlaceholder: '选择模型...',
      noWorkflowSelected: '未选择工作流',
      selectWorkflowPrompt: '请从左侧面板选择一个工作流进行配置',
      noWorkflowsAvailable: '暂无可用工作流',
      createWorkflowPrompt: '请先在工作流任务中创建工作流',
      saveButton: '保存配置',
      cancelButton: '取消',
      loadingWorkflows: '加载工作流中...',
      workflowCount: '{count} 个工作流',
      successSave: '工作流配置已成功保存',
      errorLoad: '加载工作流失败',
      errorSave: '保存配置失败',
    },
    aiChat: {
      welcomePage: {
        title: '开始对话',
        subtitle: '创建新的聊天会话开始 AI 对话。提问、获取帮助或进行友好的交流。',
        creativeAssistantTitle: '创意助手',
        creativeAssistantDesc: '协助写作、头脑风暴和创意项目',
        knowledgeAssistantTitle: '知识助手',
        knowledgeAssistantDesc: '提问并获取任何主题的详细解释',
      },
      emptyConversation: {
        title: '准备开始聊天',
        subtitle: '发送消息以开始对话',
      },
    },
  },
};

export type SupportedLocale = keyof typeof translations;

export const defaultLocale: SupportedLocale = 'en';

export function getTranslations(locale: SupportedLocale = defaultLocale): Translations {
  return translations[locale] || translations[defaultLocale];
} 