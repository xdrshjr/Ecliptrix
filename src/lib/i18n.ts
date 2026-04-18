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
    confirm: string;
    underDevelopment: string;
  };
  header: {
    brandSubtitle: string;
    languageSelector: string;
    english: string;
    chinese: string;
    returnToHomepage: string;
    switchToLightMode: string;
    switchToDarkMode: string;
  };
  landing: {
    description: string;
    heroDescription: string;
    startCreating: string;
    loading: string;
    exploreWorkflows: string;
    videoEditingDesc: string;
    workflowDesc: string;
    aiChatDesc: string;
    brainstormingDesc: string;
    aiModels: string;
    workflowTemplates: string;
    creativePossibilities: string;
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
    passwordPlaceholder: string;
    loginButton: string;
    registerButton: string;
    welcomeBack: string;
    welcomeBackMessage: string;
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
    autoSaveNote: string;
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
    authRequiredError: string;
    sessionExpiredError: string;
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
    // Tab layout & provider enhancements
    tabProviders: string;
    tabAssignments: string;
    tabAdvanced: string;
    apiFormat: string;
    apiFormatAuto: string;
    apiFormatOpenai: string;
    apiFormatAnthropic: string;
    defaultModels: string;
    effectiveConfig: string;
    configSource: string;
    configFromDb: string;
    configFromEnv: string;
    envFallbackDesc: string;
    envFallbackTitle: string;
    envVarFunctionType: string;
    envVarPrefix: string;
    envVarUrlKey: string;
    envVarApiKeyKey: string;
    envVarModelKey: string;
    envVarDescription: string;
    envVarChatDesc: string;
    envVarFastDesc: string;
    envVarVideoCutDesc: string;
    envVarVisionDesc: string;
    envVarCodingDesc: string;
    effectiveConfigDesc: string;
    effectiveConfigRefresh: string;
    effectiveConfigLoading: string;
    effectiveConfigUrl: string;
    effectiveConfigModel: string;
    effectiveConfigSource: string;
    effectiveConfigNotConfigured: string;
    testConnectionFormat: string;
    modelInfo: string;
    formatUsed: string;
    providerCard: string;
    modelApiKeyRequired: string;
    modelDeleteProviderError: string;
    modelModelsFound: string;
    modelKeyNotSet: string;
    modelRequestFailed: string;
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
    // Settings panels - shared
    settingsUnsaved: string;
    settingsSaveSuccess: string;
    settingsSaveError: string;
    settingsResetSuccess: string;
    settingsResetError: string;
    settingsRestoreDefaults: string;
    settingsResetting: string;
    settingsResetConfirmTitle: string;
    settingsResetConfirmMessage: string;
    settingsLogging: string;
    settingsVerboseLog: string;
    settingsProgressInterval: string;
    settingsLogLevel: string;
    // TTS Settings
    ttsSettings: string;
    ttsSettingsDesc: string;
    ttsConcurrency: string;
    ttsConcurrencyDesc: string;
    ttsConcurrentThreads: string;
    ttsMaxConcurrentThreads: string;
    ttsRequestTimeout: string;
    ttsBatchTimeout: string;
    ttsRetry: string;
    ttsRetryDesc: string;
    ttsMaxRetries: string;
    ttsRetryDelay: string;
    ttsBackoffFactor: string;
    ttsLimits: string;
    ttsLimitsDesc: string;
    ttsMaxSegments: string;
    ttsMaxCharsPerSegment: string;
    ttsMaxTotalChars: string;
    ttsVoices: string;
    ttsVoicesDesc: string;
    // Voice list editor
    voiceSearch: string;
    voiceAllCategories: string;
    voiceAllGenders: string;
    voiceMale: string;
    voiceFemale: string;
    voiceAdd: string;
    voiceEdit: string;
    voiceDelete: string;
    voiceTotal: string;
    voiceNoResults: string;
    voiceValue: string;
    voiceLabel: string;
    voiceCategory: string;
    voiceGender: string;
    voiceLanguage: string;
    voiceDescription: string;
    voiceCatGeneral: string;
    voiceCatDialect: string;
    voiceCatRoleplay: string;
    voiceCatNarration: string;
    voiceCatAudiobook: string;
    // YouTube Settings
    youtubeSettings: string;
    youtubeSettingsDesc: string;
    ytDownload: string;
    ytDownloadDesc: string;
    ytMaxConcurrent: string;
    ytTimeout: string;
    ytMaxRetries: string;
    ytRetryDelay: string;
    ytUpload: string;
    ytUploadDesc: string;
    ytUploadTimeout: string;
    ytQuality: string;
    ytQualityDesc: string;
    ytVideoQuality: string;
    ytAudioQuality: string;
    ytOutputFormat: string;
    ytFileManagement: string;
    ytFileManagementDesc: string;
    ytAutoCleanup: string;
    ytRetentionHours: string;
    ytGenerateThumbnail: string;
    ytLogProgress: string;
    ytProgressInterval: string;
    // Upload Settings
    uploadSettings: string;
    uploadSettingsDesc: string;
    uploadConcurrent: string;
    uploadConcurrentDesc: string;
    uploadMaxConcurrent: string;
    uploadQueueMaxLength: string;
    uploadTimeout: string;
    uploadEnableQueue: string;
    uploadFileLimits: string;
    uploadFileLimitsDesc: string;
    uploadVideoMax: string;
    uploadAudioMax: string;
    uploadImageMax: string;
    uploadRetry: string;
    uploadMaxRetries: string;
    uploadRetryDelay: string;
    uploadExponentialBackoff: string;
    uploadThumbnail: string;
    uploadThumbnailDesc: string;
    uploadAutoThumbnail: string;
    uploadThumbnailQuality: string;
    uploadThumbnailMaxWidth: string;
    uploadThumbnailMaxHeight: string;
    uploadTempFiles: string;
    uploadAutoCleanup: string;
    uploadRetentionHours: string;
    uploadTempDir: string;
    // Watermark Settings
    watermarkSettings: string;
    watermarkSettingsDesc: string;
    wmRemoval: string;
    wmRemovalDesc: string;
    wmConcurrentThreads: string;
    wmMaxConcurrentThreads: string;
    wmBatchFrames: string;
    wmBatchTimeout: string;
    wmProgressIntervalFrames: string;
    wmThreadLogging: string;
    // Video Analysis Settings
    videoAnalysisSettings: string;
    videoAnalysisSettingsDesc: string;
    vaQueueManagement: string;
    vaQueueManagementDesc: string;
    vaMaxConcurrentAnalyses: string;
    vaEnableSingleVideoQueue: string;
    vaVlmProcessing: string;
    vaVlmProcessingDesc: string;
    vaConcurrentThreads: string;
    vaApiTimeout: string;
    vaMaxRetries: string;
    vaFrameExtraction: string;
    vaFrameExtractionDesc: string;
    vaDefaultFrameInterval: string;
    vaMaxFramesPerVideo: string;
    vaSupportedFormats: string;
    vaDurationStrategy: string;
    vaShortVideos: string;
    vaMediumVideos: string;
    vaLongVideos: string;
    vaMaxDuration: string;
    vaFrameInterval: string;
    vaMaxFrames: string;
    vaPerformance: string;
    vaPerformanceDesc: string;
    vaEnablePerfLog: string;
    vaLogConcurrencyStats: string;
    vaMaxVideoDuration: string;
    vaTempFiles: string;
    vaVideoDownloadDir: string;
    vaFrameExtractPrefix: string;
    vaAutoCleanup: string;
    vaCleanupTimeout: string;
    vaLogAnalysisContent: string;
    vaLogFrameProcessingTime: string;
  };
  tasks: {
    workflow: string;
    videoEditing: string;
    brainstorming: string;
    aiChat: string;
  };
  workflowInterface: {
    chatInterfaceTab: string;
    workflowInterfaceTab: string;
    sidebar: {
      heading: string;
      addNew: string;
      subtitle: string;
      emptyState: string;
      editDetails: string;
      confirmDelete: string;
      deleteWorkflow: string;
      workflowCount: string;
      active: string;
    };
    canvas: {
      contextMenu: {
        addStartNode: string;
        addEndNode: string;
        addChatLLM: string;
        addTextInput: string;
        addPexelsVideoSearch: string;
        addTavilySearch: string;
        addVolcanoTTS: string;
        addToArray: string;
        addResultsCombine: string;
        addAIVideoGenerate: string;
        addVideoExport: string;
      };
      nodeDefaults: {
        start: string;
        end: string;
        chatLLM: string;
        textInput: string;
        pexelsSearch: string;
        tavilySearch: string;
        volcanoTTS: string;
        toArray: string;
        resultsCombine: string;
        aiVideoGenerate: string;
        videoExport: string;
      };
      emptyState: {
        title: string;
        description: string;
      };
      toolbar: {
        zoomOut: string;
        zoomIn: string;
        panMode: string;
        exitPanMode: string;
        resetView: string;
      };
      infoBar: {
        nodes: string;
        connections: string;
        nodeSelected: string;
        connectionSelected: string;
      };
    };
    editor: {
      save: string;
      saving: string;
      run: string;
      stop: string;
      loading: string;
      noWorkflowSelected: string;
      selectWorkflowPrompt: string;
      description: string;
      viewDescription: string;
    };
    notifications: {
      loadedWorkflows: string;
      failedToLoad: string;
      pleaseLoginToCreate: string;
      newWorkflowDefaultName: string;
      workflowCreated: string;
      workflowCreatedSaveFailed: string;
      pleaseLoginToRename: string;
      workflowRenamed: string;
      workflowRenamedSaveFailed: string;
      pleaseLoginToSaveChanges: string;
      workflowNotFound: string;
      workflowUpdated: string;
      workflowUpdatedSaveFailed: string;
      pleaseLoginToDelete: string;
      cannotDeleteLast: string;
      workflowDeleted: string;
      failedToDelete: string;
      pleaseLoginToSave: string;
      noActiveWorkflow: string;
      workflowSaved: string;
      workflowSaveFailed: string;
    };
    logPanel: {
      title: string;
      collapse: string;
      expand: string;
      running: string;
      current: string;
      noLogs: string;
      clickRunToStart: string;
      input: string;
      output: string;
      viewDetails: string;
      totalLogs: string;
      errors: string;
      warnings: string;
      success: string;
    };
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
        importProject: string;
        exportJson: string;
        exportingJson: string;
        extractingSubtitles: string;
        invalidJsonFile: string;
        volumeControl: string;
        trackVolumeControl: string;
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
      addImageTrack: string;
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
      selectAllEmptyHint: string;
      editSubtitles: string;
      editSubtitlesHint: string;
      trackLocked: string;
      selected: string;
      removeTrack: string;
      removeTrackConfirm: string;
      removeTrackLast: string;
      removeTrackLastOfGroup: string;
      dropVideoHere: string;
      dropImageHere: string;
      dropAudioHere: string;
      dropSubtitleHere: string;
      dropToTrack: string;
      copyOf: string;
      noTracks: string;
      noTracksDescription: string;
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
        featureComingSoon: string;
        effectsRequireSelection: string;
        transitionsRequireSelection: string;
        exportJsonSuccess: string;
        exportJsonError: string;
        exportInvalidTimelineState: string;
        exportInvalidMaterials: string;
        exportUnknownError: string;
        organizeMaterialsDescription: string;
        importProjectSuccess: string;
        importProjectError: string;
        importProjectInvalidData: string;
        batchTranscriptionRequestFailed: string;
        batchTranscriptionFailed: string;
        subtitleExtractionUnknownError: string;
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
    ruler: {
      zoomIn: string;
      zoomOut: string;
      resetZoom: string;
      timelineTooltip: string;
      playing: string;
      scrubAriaLabel: string;
      resetZoomAriaLabel: string;
    };
    sentenceSegment: {
      sentence: string;
      timeLabel: string;
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
    aiImageTitle: string;
    aiImage: string;
    aiVideoTitle: string;
    aiVideo: string;
    aiAudioTitle: string;
    aiAudio: string;
    aiAudioText: string;
    aiAudioTextPlaceholder: string;
    aiAudioSpeed: string;
    aiAudioSelectVoice: string;
    aiAudioLoadingVoices: string;
    aiAudioCancel: string;
    aiAudioStartSynthesis: string;
    aiAudioSuccess: string;
    aiAudioFailed: string;
    videoProcessingTitle: string;
    videoProcessing: string;
    watermarkRemovalTab: string;
    selectVideoForWatermark: string;
    noVideoMaterials: string;
    deleteStoryboardPack: string;
    deleteStoryboardPackConfirm: string;
    storyboardPack: string;
    characterPack?: string;
    scenePack?: string;
    filterCharacterPack?: string;
    filterScenePack?: string;
    deleteCharacterPack?: string;
    deleteCharacterPackConfirm?: string;
    deleteScenePack?: string;
    deleteScenePackConfirm?: string;
    materialLibraryTab?: string;
    materialLibraryEmpty?: string;
    materialLibraryLoading?: string;
    materialLibrarySearchPlaceholder?: string;
    materialLibraryPage?: string;
    materialLibraryLoginRequired?: string;
    materialLibraryError?: string;
    referencePickerLocalUpload?: string;
    referencePickerStoryboardPack?: string;
    referencePickerCharacterPack?: string;
    referencePickerScenePack?: string;
    referencePickerLoading?: string;
    referencePickerEmpty?: string;
    referencePickerLoadFailed?: string;
    referencePickerSelectPackHint?: string;
    referencePickerClear?: string;
    mentionSelectImage?: string;
    mentionRefImages?: string;
    mentionAddRef?: string;
    gridPackOriginal?: string;
    gridPackCroppedFrames?: string;
    frames: string;
    generating: string;
    fluxGenerating: string;
    aiVideoGeneration: string;
    kenBurnsZoomIn: string;
    kenBurnsZoomInDesc: string;
    kenBurnsZoomOut: string;
    kenBurnsZoomOutDesc: string;
    menuMaterialManagement: string;
    clearAllMaterials: string;
    clearAllConfirmTitle: string;
    clearAllConfirmMessage: string;
    clearAllSuccess: string;
    noMaterialsToClear: string;
    clearAllPartialFail: string;
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
    officialLibrary: string;
    youtubeLibrary: string;
    youtubeSearchPlaceholder: string;
    durationLabel: string;
    durationUnder1: string;
    durationUnder3: string;
    durationUnder5: string;
    durationUnder10: string;
    durationCustom: string;
    durationMinPlaceholder: string;
    durationMaxPlaceholder: string;
    seconds: string;
    videoPreview: string;
    channel: string;
    searchResults: string;
    resultsInfo: string;
    pageInfo: string;
    searchingLibrary: string;
    startSearchLibrary: string;
    searchHint: string;
    added: string;
    addToComposition: string;
    prevPage: string;
    nextPage: string;
    noPreview: string;
    itemsUnit: string;
    noSelectionHint: string;
    validationErrorHint: string;
    views: string;
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
      seekAriaLabel: string;
      volumeAriaLabel: string;
      mute: string;
      unmute: string;
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
      selected: string;
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
    noContentToExportFull: string;
    videoTrackTooShort: string;
    videoTrackDuration: string;
    audioTrackDuration: string;
    needToAdd: string;
    exportCompletedButDownloadFailed: string;
    exportTimeout: string;
    exportFailed: string;
    exportFailedWithError: string;
    failedVideos: string;
    recoverySuggestions: string;
  };
  videoSearch: {
    enterKeyword: string;
    searchFailed: string;
    networkError: string;
    selectVideoFirst: string;
    selectYoutubeVideoFirst: string;
    videoDurationValidationFailed: string;
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
      aiGenerate: string;
      generating: string;
      selectStoryboardPack: string;
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
      deleteSegment: string;
      convertAllSpeech: string;
      aiStoryboard: string;
      aiMatchVideo: string;
      aiMatching: string;
      aiMatchNotConfigured: string;
      noAvailableAnalyzedVideos: string;
    };
    narration: {
      label: string;
      editTooltip: string;
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
      loading: string;
      checkNetwork: string;
      retry: string;
      multipleVideos: string;
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
      sentenceDeleteFailed: string;
      sentenceAddFailed: string;
      speechConvertFailed: string;
      subtitleRecognitionFailed: string;
    };
    messages: {
      segmentDeleted: string;
      sentenceDeleted: string;
      sentenceAdded: string;
      speechConvertComplete: string;
      confirmDeleteSegment: string;
      newSentencePlaceholder: string;
      confirmDelete: string;
      cancelDelete: string;
      speechConvertDescription: string;
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
      modeReference: string;
      firstFrameImage: string;
      firstFrameRequired: string;
      lastFrameImage: string;
      lastFrameOptional: string;
      firstFrameMissing: string;
      referenceImage1: string;
      referenceImage2: string;
      referenceImage3: string;
      referenceImage4: string;
      referenceImageMissing: string;
      invalidImageUrl: string;
      durationLabel: string;
      expandScript: string;
      expandingScript: string;
      generateScript: string;
      autoTransition: string;
      autoTransitionHint: string;
      previousVideoNotGenerated: string;
      extractingFrame: string;
      autoTransitionMode: string;
      modalTitle: string;
      modalSubtitle: string;
      promptLabel: string;
      promptPlaceholder: string;
      durationSeconds: string;
      aspectRatioLabel: string;
      landscape: string;
      portrait: string;
      square: string;
      advancedOptions: string;
      fixedCamera: string;
      fixedCameraDesc: string;
      addWatermark: string;
      addWatermarkDesc: string;
      resolutionLabel: string;
      startGenerate: string;
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
    storyboardScriptTab: {
    selectStoryboardPack: string;
    selectStoryboardPackHint: string;
    generateSingleVideo: string;
    generateMultiple: string;
    selectVideo: string;
    candidates: string;
    batchGenerateMultiple: string;
    videoCount: string;
    candidateGenerating: string;
    candidateSucceeded: string;
    candidateFailed: string;
    expandTitle: string;
    expandGoalPlaceholder: string;
    expandGoalHint: string;
    expandStart: string;
    expandCancel: string;
    queued: string;
    queuedPosition: string;
    generationTimeout: string;
    noPacks: string;
    selectPackPlaceholder: string;
    packInfoFrames: string;
    packInfoSeparator: string;
    refreshPackList: string;
    segmentLabel: string;
    describingTitle: string;
    describeAllTitle: string;
    describing: string;
    describeAll: string;
    generatingInProgress: string;
    allVideosGenerated: string;
    batchGenerateAll: string;
    batchGenerate: string;
    generateAllVideosFirst: string;
    composing: string;
    composeAllVideos: string;
    composeVideo: string;
    loadingPack: string;
    describingFrames: string;
    composeFailed: string;
    retry: string;
    addFrame: string;
    generatedStatus: string;
    estimatedDuration: string;
    confirmDelete: string;
    deleteConfirmMessage: string;
    cancel: string;
    delete: string;
  };
  storyboardPreviewPanel: {
    title: string;
    gridSize: string;
    aspectRatio: string;
    totalFrames: string;
    hint: string;
    ariaLabel: string;
  };
  welcomeGuide: {
    title: string;
    descriptionWithMaterials: string;
    descriptionWithoutMaterials: string;
    trimFirst: string;
    addMusic: string;
    generateSubtitles: string;
    adjustVolume: string;
    searchNature: string;
    generateAiVideo: string;
    createScript: string;
    searchMusic: string;
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
    inputAriaLabel: string;
    agentWorkingPlaceholder: string;
    agentUndoButton: string;
    agentUndoneLabel: string;
    agentOperations: string;
    thinkingInProgress: string;
    thinkingComplete: string;
    aiAnalyzingLabel: string;
  };
  workflowChat: {
    title: string;
    subtitle: string;
    inputPlaceholder: string;
    send: string;
    stop: string;
    clearChat: string;
    clearChatConfirm: string;
    clearContext: string;
    clearContextConfirm: string;
    clearContextTooltip: string;
    startConversation: string;
    startConversationDesc: string;
    running: string;
    finalResult: string;
    exportMaterials: string;
    exportMaterialsHint: string;
    goToVideoResult: string;
    workflowExecuting: string;
    inputHint: string;
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
    messagesLabel: string;
    replying: string;
    clearChatTooltip: string;
    sendMessageTooltip: string;
    aiReplying: string;
    enterToSendHint: string;
    conversationList: {
      heading: string;
      newChat: string;
      noConversations: string;
      startNewChat: string;
      chatbot: string;
      aiAgent: string;
      messages: string;
    };
    chatTypeModal: {
      title: string;
      subtitle: string;
      chatbotTab: string;
      workflowTab: string;
      agentTab: string;
      basicChatbot: string;
      chatbotDesc: string;
      startChatbot: string;
      fastResponse: string;
      quickAnswers: string;
      naturalChat: string;
      conversational: string;
      easyToUse: string;
      noSetupNeeded: string;
      loadingWorkflows: string;
      failedToLoadWorkflows: string;
      retry: string;
      noWorkflows: string;
      createWorkflowFirst: string;
      active: string;
      nodes: string;
      aiAgentTitle: string;
      agentDesc: string;
      comingSoon: string;
      taskPlanning: string;
      multiStepTasks: string;
      webSearch: string;
      realtimeInfo: string;
      codeExecution: string;
      runCodeSafely: string;
      cancel: string;
      workflowsAvailable: string;
    };
  };
  videoProcessing: {
    tab: string;
    buttons: {
      close: string;
      next: string;
      back: string;
      done: string;
      return: string;
      minimize: string;
      cancel: string;
      retry: string;
      startProcessing: string;
      redetect: string;
      restored: string;
    };
    presets: {
      loose: string;
      standard: string;
      aggressive: string;
      custom: string;
    };
    selectVideo: {
      heading: string;
      description: string;
      noVideos: string;
      noVideosHint: string;
      tooLong: string;
    };
    params: {
      detectionPreset: string;
      volumeThreshold: string;
      volumeThresholdHint: string;
      minSilenceDuration: string;
      minSilenceHint: string;
      preservedGap: string;
      preservedGapHint: string;
    };
    stats: {
      originalDuration: string;
      newDuration: string;
      removedSegments: string;
      segments: string;
      savedTime: string;
      saved: string;
      estimatedNewDuration: string;
    };
    progress: {
      preparing: string;
      processing: string;
      completed: string;
      failed: string;
      detecting: string;
      detectSilence: string;
      networkError: string;
      networkErrorMsg: string;
      timeout: string;
      timeoutMsg: string;
      estimatedRemaining: string;
    };
    errors: {
      detectionFailed: string;
      detectionFailedShort: string;
      detectionError: string;
      processFailed: string;
      processFailedShort: string;
      submitFailed: string;
      unknownError: string;
      queryFailed: string;
      queryFailedShort: string;
    };
    segments: {
      empty: string;
      total: string;
      segmentsUnit: string;
      selected: string;
      canSave: string;
      selectAll: string;
      deselectAll: string;
      invertSelection: string;
      playContext: string;
    };
    waveform: {
      pause: string;
      play: string;
      previewEffect: string;
      stopPreview: string;
      preview: string;
      zoomHint: string;
    };
    duration: {
      minutes: string;
      seconds: string;
    };
  };
  workflowNodes: {
    ports: {
      input: string;
      output: string;
      keywords: string;
      results: string;
      arrayInput: string;
      combined: string;
      array: string;
      videos: string;
      materials: string;
      textInput: string;
      audioOutput: string;
      timeline: string;
      copy: string;
      video: string;
      audio: string;
      image: string;
    };
    tooltips: {
      configured: string;
      deleteNode: string;
      inputPort: string;
      outputPort: string;
    };
    status: {
      configured: string;
      notSet: string;
      notSelected: string;
      ready: string;
      success: string;
      failed: string;
      notConfigured: string;
      noContent: string;
      doubleClickToConfigure: string;
      doubleClickForFullContent: string;
      model: string;
      temperature: string;
      systemPrompt: string;
      keywords: string;
      count: string;
      voice: string;
      text: string;
      content: string;
      format: string;
      statusLabel: string;
      videoUrls: string;
      moreCount: string;
      exportToMaterials: string;
      exportVideos: string;
      inputType: string;
      arrayBadge: string;
      schema: string;
      schemaDefined: string;
      combinesStandardizes: string;
      combinesResults: string;
      transformPrompt: string;
      conversionPrompt: string;
      fields: string;
      fieldsCount: string;
      outputsArray: string;
      typeLabel: string;
      workflowStartPoint: string;
      workflowEndPoint: string;
    };
    aiVideo: {
      inputs: string;
      status: string;
      lastRun: string;
      error: string;
      prompt: string;
      notConfigured: string;
      doubleClickConfigure: string;
    };
    execution: {
      title: string;
      progress: string;
      noNodes: string;
      waiting: string;
      executing: string;
      completed: string;
      failed: string;
      executionTime: string;
      systemPrompt: string;
      userInput: string;
      modelReply: string;
      input: string;
      output: string;
      error: string;
    };
    editor: {
      noWorkflowSelected: string;
      selectWorkflowPrompt: string;
      newWorkflowDefaultName: string;
      newWorkflowDescription: string;
    };
    configPanels: {
      volcanoTTS: {
        title: string;
        nodeId: string;
        dataFormat: string;
        inputFormat: string;
        outputFormat: string;
        inputFormatHelp: string;
        outputFormatHelp: string;
        language: string;
        chinese: string;
        english: string;
        voiceType: string;
        loadingVoices: string;
        speedRatio: string;
        slower: string;
        normal: string;
        faster: string;
        textContent: string;
        clear: string;
        placeholder: string;
        characters: string;
        words: string;
        hasContent: string;
        empty: string;
        audioPreview: string;
        pause: string;
        playAudio: string;
        download: string;
        downloadAudio: string;
        howToUse: string;
        howToUseSteps: string[];
        cancel: string;
        save: string;
        saving: string;
      };
      aiVideoGenerate: {
        title: string;
        subtitle: string;
        inputConfiguration: string;
        llmSettings: string;
        executionResults: string;
        inputConfigDesc: string;
        textInput: string;
        videoInput: string;
        audioInput: string;
        imageInput: string;
        enterTextPlaceholder: string;
        enterVideoPlaceholder: string;
        enterAudioPlaceholder: string;
        enterImagePlaceholder: string;
        stringFormat: string;
        jsonFormat: string;
        arrayFormat: string;
        llmConfigDesc: string;
        systemPrompt: string;
        systemPromptPlaceholder: string;
        temperature: string;
        temperatureHint: string;
        maxTokens: string;
        llmInfoTitle: string;
        llmInfoDesc: string;
        executionSuccessful: string;
        executionFailed: string;
        lastExecuted: string;
        errorMessage: string;
        executionResult: string;
        noResultsYet: string;
        cancel: string;
        saveConfiguration: string;
      };
    };
  };
  mediaPreview: {
    zoomOut: string;
    zoomIn: string;
    reset: string;
    pause: string;
    play: string;
    close: string;
    imageShortcuts: string;
    imageShortcutsZoom: string;
    imageShortcutsReset: string;
    imageShortcutsClose: string;
    imageMouseWheel: string;
    imageMouseDrag: string;
    mediaShortcutsSpace: string;
    mediaShortcutsClose: string;
    imageShortcutsLine1: string;
    imageShortcutsLine2: string;
    mediaShortcutsLine: string;
  };
  storyboardPack: {
    defaultTitle: string;
    frames: string;
    close: string;
    originalImage: string;
    noFrames: string;
    frame: string;
    position: string;
    row: string;
    column: string;
    noDescription: string;
    deletePack: string;
    addToMaterials: string;
    useInScript: string;
    materials: string;
    prompt: string;
    gridSizeLabel: string;
    frameCountLabel: string;
    gridWillGenerate: string;
    gridWillUse: string;
  };
  mobileWarning: {
    tablet: string;
    mobile: string;
    mobileDevice: string;
    title: string;
    description: string;
    useDesktop: string;
  };
  gridSizeSelector: {
    frameCount: string;
    gridLabel: string;
    custom: string;
    placeholder: string;
    willGenerate: string;
    willUse: string;
  };
  creativeBrainstorming: {
    inputPlaceholder: string;
    sendHint: string;
  };
  audioSearchModal: {
    title: string;
    searchPlaceholder: string;
    searchButton: string;
    searching: string;
    audioTypeLabel: string;
    audioTypeAll: string;
    audioTypeMusic: string;
    audioTypeSoundEffect: string;
    audioTypeSpeech: string;
    audioTypeAmbient: string;
    audioTypeNature: string;
    sortByLabel: string;
    sortByScore: string;
    sortByDownloads: string;
    sortByRating: string;
    sortByDurationDesc: string;
    sortByDurationAsc: string;
    sortByCreatedDesc: string;
    sortByCreatedAsc: string;
    durationFilterLabel: string;
    durationMinPlaceholder: string;
    durationMaxPlaceholder: string;
    durationTo: string;
    resultsTitle: string;
    resultsCount: string;
    selectedCount: string;
    clearSelection: string;
    noResults: string;
    noResultsHint: string;
    noQueryTitle: string;
    noQueryHint: string;
    previewTitle: string;
    descriptionLabel: string;
    audioInfoLabel: string;
    durationLabel: string;
    licenseLabel: string;
    sizeLabel: string;
    formatLabel: string;
    channelsLabel: string;
    sampleRateLabel: string;
    tagsLabel: string;
    addingAudios: string;
    addedCount: string;
    cancelButton: string;
    addingButton: string;
    addSelectedButton: string;
  };
  imageSearchModal: {
    title: string;
    searchPlaceholder: string;
    searchButton: string;
    searching: string;
    orientationLabel: string;
    orientationAll: string;
    orientationLandscape: string;
    orientationPortrait: string;
    orientationSquarish: string;
    colorLabel: string;
    colorAll: string;
    colorBlackAndWhite: string;
    colorBlack: string;
    colorWhite: string;
    colorYellow: string;
    colorOrange: string;
    colorRed: string;
    colorPurple: string;
    colorMagenta: string;
    colorGreen: string;
    colorTeal: string;
    colorBlue: string;
    orderByLabel: string;
    orderByRelevant: string;
    orderByLatest: string;
    orderByPopular: string;
    selectedCount: string;
    clearSelection: string;
    addingImages: string;
    addSelectedButton: string;
    deselect: string;
    select: string;
    addToMaterials: string;
    noDescription: string;
    noResultsTitle: string;
    noResultsHint: string;
    imagePreview: string;
    prevPage: string;
    nextPage: string;
    pageInfo: string;
  };
  aiImageModal: {
    title: string;
    subtitle: string;
    tabBasic: string;
    tabCharacter: string;
    tabScene: string;
    tabStoryboard: string;
    cancelButton: string;
    generatingButton: string;
    generateButton: string;
  };
  basicGenerationTab: {
    promptLabel: string;
    promptPlaceholder: string;
    sizeLabel: string;
    size1kSquare: string;
    size2kSquare: string;
    size169Landscape: string;
    size916Portrait: string;
    size169Wide: string;
    size916Wide: string;
    countLabel: string;
    countUnit: string;
    watermarkLabel: string;
    watermarkDesc: string;
  };
  storyboardTab: {
    aspectRatioLabel: string;
    aspectRatio11: string;
    aspectRatio169: string;
    aspectRatio916: string;
    aspectRatio43: string;
    aspectRatio34: string;
    promptLabel: string;
    promptPlaceholder: string;
    settingsTitle: string;
    settingsLocked: string;
    scriptPreviewLabel: string;
    languageLabel: string;
    backToInput: string;
    shotNumber: string;
    shotPlaceholder: string;
    emptyScript: string;
    chatTitle: string;
    chatYou: string;
    chatAI: string;
    chatPlaceholder: string;
    chatSend: string;
    confirmGenerate: string;
    scriptMinLengthHint: string;
    nextStepGenerate: string;
    generatingScript: string;
    scriptInfo: string;
    advancedOptions: string;
    skipScript: string;
    generatingFrames: string;
    generatingFramesDesc: string;
    croppedFrames: string;
    gridLabel: string;
    generateNew: string;
    retryButton: string;
    scriptGenerateFailed: string;
    scriptReviseFailed: string;
    scriptUpdated: string;
    backConfirm: string;
    generateFailed: string;
    storyboardImageAlt: string;
  };
  gridSizeSelectorTab: {
    frameCountLabel: string;
    gridUnit: string;
    custom: string;
    placeholder: string;
    willGenerate: string;
    willUse: string;
  };
  videoAnalysisModal: {
    title: string;
    subtitle: string;
    closeTooltip: string;
    videoDuration: string;
    framesExtracted: string;
    processingTime: string;
    analysisTime: string;
    frameAnalysisTitle: string;
    frameLabel: string;
    timePoint: string;
    summaryTitle: string;
    errorTitle: string;
    errorDefaultMessage: string;
    closeButton: string;
    loadingTitle: string;
    loadingDesc: string;
    videoLabel: string;
    secondsUnit: string;
    framesUnit: string;
  };
  videoScriptProgressModal: {
    titleWithVideo: string;
    titleWithoutVideo: string;
    stepPreparing: string;
    stepAnalyzing: string;
    stepGenerating: string;
    stepProcessing: string;
    descAnalyzing: string;
    descGeneratingWithVideo: string;
    descGeneratingWithoutVideo: string;
    descPleaseWait: string;
    analyzingVideo: string;
    statCompleted: string;
    statProcessing: string;
    statFailed: string;
    errorTitle: string;
    cancelButton: string;
  };
  videoCacheIndicator: {
    loading: string;
    loaded: string;
    error: string;
    notCached: string;
  };
  chatMessageBubble: {
    thinking: string;
    thoughtProcess: string;
    analyzingIntent: string;
    detectingWorkflow: string;
    willCallWorkflow: string;
    normalChat: string;
    copiedTitle: string;
    copyMessageTitle: string;
    convertToScriptTitle: string;
    generating: string;
    copied: string;
  };
  chatWorkflowExecution: {
    finalResult: string;
    copiedTitle: string;
    copyTitle: string;
    convertToScriptTitle: string;
    exportClip: string;
    exportClipHint: string;
    executing: string;
  };
  chatWorkflowSelection: {
    title: string;
    subtitle: string;
    loading: string;
    errorTitle: string;
    retryButton: string;
    emptyTitle: string;
    emptyHint: string;
    activeBadge: string;
    nodesLabel: string;
    totalWorkflows: string;
    cancelButton: string;
  };
  videoCut: {
    title: string;
    timelineControl: string;
    selectRange: string;
    dragGreenStart: string;
    dragRedEnd: string;
    blueCurrentPos: string;
    setStart: string;
    setEnd: string;
    createClip: string;
    preview: string;
    selectToPreview: string;
    clipList: string;
    clip: string;
    clipCount: string;
    exportClips: string;
    noClips: string;
    startBeforeEnd: string;
    minDuration: string;
    clipCreated: string;
    clipDeleted: string;
    noClipsToExport: string;
    noMaterial: string;
    clipsExported: string;
    exportUnavailable: string;
    startTimeLabel: string;
    endTimeLabel: string;
  };
  convertToScript: {
    title: string;
    subtitle: string;
    parameterSettings: string;
    scriptLanguage: string;
    chinese: string;
    english: string;
    mixed: string;
    segmentCount: string;
    segments: string;
    analysisDepth: string;
    basic: string;
    quickGen: string;
    detailed: string;
    balancedQuality: string;
    comprehensive: string;
    deepAnalysis: string;
    additionalOptions: string;
    includeVisual: string;
    visualDesc: string;
    includeAudio: string;
    audioDesc: string;
    videoUnderstanding: string;
    enabledDesc: string;
    disabledDesc: string;
    analysisMode: string;
    quickAnalysis: string;
    coverOnly: string;
    proAnalysis: string;
    multiFrame: string;
    selectVideoDesc: string;
    videoStatsPrefix: string;
    videoStatsTotal: string;
    videoStatsAnalyzed: string;
    videoStatsPending: string;
    selectedUnanalyzedPrefix: string;
    selectedUnanalyzed: string;
    noVideos: string;
    pleaseUpload: string;
    selectedCountPrefix: string;
    selectedCount: string;
    selectAll: string;
    deselectAll: string;
    analyzed: string;
    pending: string;
    unknownDuration: string;
    chatPreview: string;
    footerWithVideo: string;
    footerWithAnalysis: string;
    footerNoVideo: string;
    generating: string;
    startGenerate: string;
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
      confirm: 'Confirm',
      underDevelopment: 'Feature under development...',
    },
    header: {
      brandSubtitle: 'Where light and shadow collide',
      languageSelector: 'Language',
      english: 'English',
      chinese: '中文',
      returnToHomepage: 'Return to homepage',
      switchToLightMode: 'Switch to light mode',
      switchToDarkMode: 'Switch to dark mode',
    },
    landing: {
      description: 'AI-Powered Creative Platform',
      heroDescription: 'Where creativity meets AI. Create stunning videos, build intelligent workflows, and unleash your creative potential with our powerful suite of tools.',
      startCreating: 'Start Creating',
      loading: 'Loading...',
      exploreWorkflows: 'Explore Workflows',
      videoEditingDesc: 'Professional video editing with AI-powered tools and intuitive timeline interface',
      workflowDesc: 'Build powerful AI workflows with visual node-based editor',
      aiChatDesc: 'Intelligent AI conversations for content creation and assistance',
      brainstormingDesc: 'Generate creative ideas and concepts for your projects',
      aiModels: 'AI Models',
      workflowTemplates: 'Workflow Templates',
      creativePossibilities: 'Creative Possibilities',
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
      passwordPlaceholder: 'Enter password (minimum 6 characters)',
      loginButton: 'Login',
      registerButton: 'Register',
      welcomeBack: 'Welcome Back',
      welcomeBackMessage: 'Welcome Back, {username}! ({role})',
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
      autoSaveNote: 'Changes are saved automatically.',
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
      regularUsers: 'Users',
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
      userRoleRegular: 'User',
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
      authRequiredError: 'Please log in to access Model Settings.',
      sessionExpiredError: 'Your session has expired. Please log in again.',
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
      // Tab layout & provider enhancements
      tabProviders: 'Provider Management',
      tabAssignments: 'Model Assignment',
      tabAdvanced: 'Advanced Settings',
      apiFormat: 'API Format',
      apiFormatAuto: 'Auto Detect',
      apiFormatOpenai: 'OpenAI Format',
      apiFormatAnthropic: 'Anthropic Format',
      defaultModels: 'Default Models',
      effectiveConfig: 'Effective Configuration',
      configSource: 'Config Source',
      configFromDb: 'Database',
      configFromEnv: 'Environment',
      envFallbackDesc: 'When no DB assignment configured, system falls back to environment variables.',
      envFallbackTitle: 'Environment Variable Fallback Reference',
      envVarFunctionType: 'Function Type',
      envVarPrefix: 'Env Prefix',
      envVarUrlKey: 'URL Variable',
      envVarApiKeyKey: 'API Key Variable',
      envVarModelKey: 'Model Variable',
      envVarDescription: 'Description',
      envVarChatDesc: 'Main chat model',
      envVarFastDesc: 'Quick operations model',
      envVarVideoCutDesc: 'Video editing model',
      envVarVisionDesc: 'Vision-language model',
      envVarCodingDesc: 'Coding assistant model',
      effectiveConfigDesc: 'Shows the currently active configuration for each function type, resolved from DB assignments or environment variable fallbacks.',
      effectiveConfigRefresh: 'Refresh',
      effectiveConfigLoading: 'Loading configuration...',
      effectiveConfigUrl: 'Provider / URL',
      effectiveConfigModel: 'Model',
      effectiveConfigSource: 'Source',
      effectiveConfigNotConfigured: 'Not configured',
      testConnectionFormat: 'Test Connection Format',
      modelInfo: 'Model Info',
      formatUsed: 'Format Used',
      providerCard: 'Provider Card',
      modelApiKeyRequired: 'API Key is required',
      modelDeleteProviderError: 'Failed to delete provider',
      modelModelsFound: 'models found',
      modelKeyNotSet: 'Not set',
      modelRequestFailed: 'Request failed',
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
      // Settings panels - shared
      settingsUnsaved: 'Unsaved changes',
      settingsSaveSuccess: 'Settings saved successfully',
      settingsSaveError: 'Failed to save settings',
      settingsResetSuccess: 'Settings restored to defaults',
      settingsResetError: 'Failed to restore defaults',
      settingsRestoreDefaults: 'Restore Defaults',
      settingsResetting: 'Resetting...',
      settingsResetConfirmTitle: 'Restore Defaults',
      settingsResetConfirmMessage: 'Are you sure you want to restore all settings in this category to their default values? This action cannot be undone.',
      settingsLogging: 'Logging',
      settingsVerboseLog: 'Enable verbose logging',
      settingsProgressInterval: 'Progress log interval',
      settingsLogLevel: 'Log level',
      // TTS Settings
      ttsSettings: 'TTS Settings',
      ttsSettingsDesc: 'Configure text-to-speech concurrency, retry, limits, and voice list',
      ttsConcurrency: 'Concurrency & Timeout',
      ttsConcurrencyDesc: 'Control concurrent thread count and timeout settings',
      ttsConcurrentThreads: 'Concurrent threads',
      ttsMaxConcurrentThreads: 'Max concurrent threads',
      ttsRequestTimeout: 'Request timeout (s)',
      ttsBatchTimeout: 'Batch timeout (s)',
      ttsRetry: 'Retry Configuration',
      ttsRetryDesc: 'Control retry behavior for failed TTS requests',
      ttsMaxRetries: 'Max retries',
      ttsRetryDelay: 'Retry delay (s)',
      ttsBackoffFactor: 'Backoff factor',
      ttsLimits: 'Resource Limits',
      ttsLimitsDesc: 'Set maximum values for batch processing',
      ttsMaxSegments: 'Max segments per batch',
      ttsMaxCharsPerSegment: 'Max chars per segment',
      ttsMaxTotalChars: 'Max total chars',
      ttsVoices: 'Voice List',
      ttsVoicesDesc: 'Manage available TTS voices by category',
      // Voice list editor
      voiceSearch: 'Search voices...',
      voiceAllCategories: 'All Categories',
      voiceAllGenders: 'All Genders',
      voiceMale: 'Male',
      voiceFemale: 'Female',
      voiceAdd: 'Add Voice',
      voiceEdit: 'Edit Voice',
      voiceDelete: 'Delete',
      voiceTotal: 'Total',
      voiceNoResults: 'No voices found matching your filters',
      voiceValue: 'Voice ID',
      voiceLabel: 'Display Name',
      voiceCategory: 'Category',
      voiceGender: 'Gender',
      voiceLanguage: 'Language',
      voiceDescription: 'Description',
      voiceCatGeneral: 'General',
      voiceCatDialect: 'Dialect',
      voiceCatRoleplay: 'Roleplay',
      voiceCatNarration: 'Narration',
      voiceCatAudiobook: 'Audiobook',
      // YouTube Settings
      youtubeSettings: 'YouTube Settings',
      youtubeSettingsDesc: 'Configure YouTube download, upload, quality, and file management',
      ytDownload: 'Download',
      ytDownloadDesc: 'Configure download concurrency and timeouts',
      ytMaxConcurrent: 'Max concurrent downloads',
      ytTimeout: 'Download timeout (s)',
      ytMaxRetries: 'Max retries',
      ytRetryDelay: 'Retry delay (s)',
      ytUpload: 'Upload',
      ytUploadDesc: 'Configure upload timeouts and retries',
      ytUploadTimeout: 'Upload timeout (s)',
      ytQuality: 'Video Quality',
      ytQualityDesc: 'Default quality settings for downloads',
      ytVideoQuality: 'Default video quality',
      ytAudioQuality: 'Default audio quality',
      ytOutputFormat: 'Default output format',
      ytFileManagement: 'File Management',
      ytFileManagementDesc: 'Configure temporary file cleanup and thumbnails',
      ytAutoCleanup: 'Auto cleanup temp files',
      ytRetentionHours: 'Retention time (hours)',
      ytGenerateThumbnail: 'Generate thumbnails',
      ytLogProgress: 'Log download progress',
      ytProgressInterval: 'Progress log interval (s)',
      // Upload Settings
      uploadSettings: 'Upload Settings',
      uploadSettingsDesc: 'Configure file upload concurrency, size limits, and temporary file management',
      uploadConcurrent: 'Concurrent Upload',
      uploadConcurrentDesc: 'Control upload concurrency and queue settings',
      uploadMaxConcurrent: 'Max concurrent uploads',
      uploadQueueMaxLength: 'Queue max length (0=unlimited)',
      uploadTimeout: 'Upload timeout (s)',
      uploadEnableQueue: 'Enable upload queue',
      uploadFileLimits: 'File Size Limits',
      uploadFileLimitsDesc: 'Maximum file size by type (MB)',
      uploadVideoMax: 'Video max size (MB)',
      uploadAudioMax: 'Audio max size (MB)',
      uploadImageMax: 'Image max size (MB)',
      uploadRetry: 'Retry Configuration',
      uploadMaxRetries: 'Max retries',
      uploadRetryDelay: 'Retry delay (s)',
      uploadExponentialBackoff: 'Exponential backoff',
      uploadThumbnail: 'Thumbnail Generation',
      uploadThumbnailDesc: 'Auto-generate thumbnails for uploaded videos',
      uploadAutoThumbnail: 'Auto generate thumbnails',
      uploadThumbnailQuality: 'Thumbnail quality (1-31)',
      uploadThumbnailMaxWidth: 'Max width (px)',
      uploadThumbnailMaxHeight: 'Max height (px)',
      uploadTempFiles: 'Temporary Files',
      uploadAutoCleanup: 'Auto cleanup',
      uploadRetentionHours: 'Retention time (hours)',
      uploadTempDir: 'Temp directory',
      // Watermark Settings
      watermarkSettings: 'Watermark Removal',
      watermarkSettingsDesc: 'Configure watermark removal processing parameters',
      wmRemoval: 'Processing Configuration',
      wmRemovalDesc: 'Thread and batch settings for watermark removal',
      wmConcurrentThreads: 'Concurrent threads',
      wmMaxConcurrentThreads: 'Max concurrent threads',
      wmBatchFrames: 'Batch frame count',
      wmBatchTimeout: 'Batch timeout (s)',
      wmProgressIntervalFrames: 'Progress interval (frames)',
      wmThreadLogging: 'Enable thread logging',
      // Video Analysis Settings
      videoAnalysisSettings: 'Video Analysis',
      videoAnalysisSettingsDesc: 'Configure video analysis queue, VLM processing, and frame extraction',
      vaQueueManagement: 'Queue Management',
      vaQueueManagementDesc: 'Control concurrent analysis and queue behavior',
      vaMaxConcurrentAnalyses: 'Max concurrent analyses',
      vaEnableSingleVideoQueue: 'Enable single video queue',
      vaVlmProcessing: 'VLM Processing',
      vaVlmProcessingDesc: 'Configure vision-language model API settings',
      vaConcurrentThreads: 'Concurrent threads',
      vaApiTimeout: 'API timeout (s)',
      vaMaxRetries: 'Max retries',
      vaFrameExtraction: 'Frame Extraction',
      vaFrameExtractionDesc: 'Configure how frames are extracted from videos for analysis',
      vaDefaultFrameInterval: 'Default frame interval (s)',
      vaMaxFramesPerVideo: 'Max frames per video',
      vaSupportedFormats: 'Supported formats',
      vaDurationStrategy: 'Duration-based Strategy',
      vaShortVideos: 'Short Videos',
      vaMediumVideos: 'Medium Videos',
      vaLongVideos: 'Long Videos',
      vaMaxDuration: 'Max duration (s)',
      vaFrameInterval: 'Frame interval (s)',
      vaMaxFrames: 'Max frames',
      vaPerformance: 'Performance',
      vaPerformanceDesc: 'Performance monitoring and limits',
      vaEnablePerfLog: 'Enable performance logging',
      vaLogConcurrencyStats: 'Log concurrency statistics',
      vaMaxVideoDuration: 'Max video duration (s)',
      vaTempFiles: 'Temporary Files',
      vaVideoDownloadDir: 'Video download directory',
      vaFrameExtractPrefix: 'Frame extract prefix',
      vaAutoCleanup: 'Auto cleanup',
      vaCleanupTimeout: 'Cleanup timeout (s)',
      vaLogAnalysisContent: 'Log analysis content',
      vaLogFrameProcessingTime: 'Log frame processing time',
    },
    tasks: {
      workflow: 'WorkFlow',
      videoEditing: 'Video Editing',
      brainstorming: 'Brainstorming',
      aiChat: 'AI Chat',
    },
    workflowInterface: {
      chatInterfaceTab: 'Chat Interface',
      workflowInterfaceTab: 'Workflow Interface',
      sidebar: {
        heading: 'Workflows',
        addNew: 'Add New Workflow',
        subtitle: 'Select or create a workflow',
        emptyState: 'No workflows yet',
        editDetails: 'Edit Workflow Details',
        confirmDelete: 'Confirm Delete',
        deleteWorkflow: 'Delete Workflow',
        workflowCount: '{count} workflow(s)',
        active: 'Active',
      },
      canvas: {
        contextMenu: {
          addStartNode: 'Add Start Node',
          addEndNode: 'Add End Node',
          addChatLLM: 'Add Chat LLM',
          addTextInput: 'Add Text Input',
          addPexelsVideoSearch: 'Add Pexels Video Search',
          addTavilySearch: 'Add Tavily Search',
          addVolcanoTTS: 'Add Volcano TTS',
          addToArray: 'Add To Array',
          addResultsCombine: 'Add Results Combine',
          addAIVideoGenerate: 'Add AI Video Generate',
          addVideoExport: 'Add Video Export',
        },
        nodeDefaults: {
          start: 'Start',
          end: 'End',
          chatLLM: 'Chat LLM',
          textInput: 'Text Input',
          pexelsSearch: 'Pexels Video Search',
          tavilySearch: 'Tavily Search',
          volcanoTTS: 'Volcano TTS',
          toArray: 'To Array',
          resultsCombine: 'Results Combine',
          aiVideoGenerate: 'AI Video Generate',
          videoExport: 'Video Export',
        },
        emptyState: {
          title: 'Start Building Your Workflow',
          description: 'Right-click anywhere on the canvas to add your first node',
        },
        toolbar: {
          zoomOut: 'Zoom Out',
          zoomIn: 'Zoom In',
          panMode: 'Enter Pan Mode (Drag Canvas)',
          exitPanMode: 'Exit Pan Mode (Switch to Node Drag Mode)',
          resetView: 'Reset View',
        },
        infoBar: {
          nodes: 'Nodes',
          connections: 'Connections',
          nodeSelected: 'Node Selected',
          connectionSelected: 'Connection Selected',
        },
      },
      editor: {
        save: 'Save',
        saving: 'Saving...',
        run: 'Run',
        stop: 'Stop',
        loading: 'Loading workflow...',
        noWorkflowSelected: 'No Workflow Selected',
        selectWorkflowPrompt: 'Select a workflow from the sidebar to start editing',
        description: 'Description',
        viewDescription: 'View description',
      },
      notifications: {
        loadedWorkflows: 'Loaded {count} workflow(s)',
        failedToLoad: 'Failed to load workflows',
        pleaseLoginToCreate: 'Please login to create workflows',
        newWorkflowDefaultName: 'New Workflow',
        workflowCreated: 'Workflow "{name}" created successfully',
        workflowCreatedSaveFailed: 'Workflow created but failed to save. Please save it manually.',
        pleaseLoginToRename: 'Please login to rename workflows',
        workflowRenamed: 'Workflow renamed to "{name}"',
        workflowRenamedSaveFailed: 'Workflow renamed but failed to save. Please save it manually.',
        pleaseLoginToSaveChanges: 'Please login to save workflow changes',
        workflowNotFound: 'Workflow not found',
        workflowUpdated: 'Workflow "{name}" updated successfully',
        workflowUpdatedSaveFailed: 'Workflow updated locally but failed to save to database. Please save it manually.',
        pleaseLoginToDelete: 'Please login to delete workflows',
        cannotDeleteLast: 'Cannot delete the last workflow',
        workflowDeleted: 'Workflow "{name}" deleted successfully',
        failedToDelete: 'Failed to delete workflow',
        pleaseLoginToSave: 'Please login to save workflows',
        noActiveWorkflow: 'No active workflow to save',
        workflowSaved: 'Workflow "{name}" saved successfully (v{version})',
        workflowSaveFailed: 'Failed to save workflow',
      },
      logPanel: {
        title: 'Execution Logs',
        collapse: 'Collapse',
        expand: 'Expand',
        running: 'Running',
        current: 'Current',
        noLogs: 'No logs yet',
        clickRunToStart: 'Click Run to start workflow execution',
        input: 'Input',
        output: 'Output',
        viewDetails: 'View details',
        totalLogs: 'Total logs: {count}',
        errors: '{count} errors',
        warnings: '{count} warnings',
        success: '{count} success',
      },
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
      aiImageTitle: 'AI Image Generation (Seedream)',
      aiImage: 'AI Image',
      aiVideoTitle: 'AI Video Generation (Seedance)',
      aiVideo: 'AI Video',
      aiAudioTitle: 'AI Audio Generation',
      aiAudio: 'AI Audio',
      aiAudioText: 'Text to convert',
      aiAudioTextPlaceholder: 'Enter text to convert to audio...',
      aiAudioSpeed: 'Speed',
      aiAudioSelectVoice: 'Select Voice',
      aiAudioLoadingVoices: 'Loading voices...',
      aiAudioCancel: 'Cancel',
      aiAudioStartSynthesis: 'Start Synthesis',
      aiAudioSuccess: 'AI audio generated successfully',
      aiAudioFailed: 'AI audio generation failed',
      videoProcessingTitle: 'Video Processing (cut silences, etc.)',
      videoProcessing: 'Video Processing',
      watermarkRemovalTab: 'Watermark Removal',
      selectVideoForWatermark: 'Select a video to remove watermark',
      noVideoMaterials: 'No video materials available',
      deleteStoryboardPack: 'Delete Storyboard Pack',
      deleteStoryboardPackConfirm: 'Are you sure you want to delete this storyboard pack? All frames and related data will be permanently deleted.',
      storyboardPack: 'Storyboard Pack',
      characterPack: 'Character Pack',
      scenePack: 'Scene Pack',
      filterCharacterPack: 'Character',
      filterScenePack: 'Scene',
      deleteCharacterPack: 'Delete Character Pack',
      deleteCharacterPackConfirm: 'Are you sure you want to delete this character pack? All frames and related data will be permanently deleted. References to its frames elsewhere will become invalid.',
      deleteScenePack: 'Delete Scene Pack',
      deleteScenePackConfirm: 'Are you sure you want to delete this scene pack? All frames and related data will be permanently deleted. References to its frames elsewhere will become invalid.',
      materialLibraryTab: 'Materials',
      materialLibraryEmpty: 'No materials — please upload in Materials panel first',
      materialLibraryLoading: 'Loading...',
      materialLibrarySearchPlaceholder: 'Search materials',
      materialLibraryPage: 'Page {page}/{total}',
      materialLibraryLoginRequired: 'Please log in to view materials',
      materialLibraryError: 'Load failed — click to retry',
      referencePickerLocalUpload: 'Local upload',
      referencePickerStoryboardPack: 'Storyboard',
      referencePickerCharacterPack: 'Character',
      referencePickerScenePack: 'Scene',
      referencePickerLoading: 'Loading…',
      referencePickerEmpty: 'No packs available',
      referencePickerLoadFailed: 'Failed to load',
      referencePickerSelectPackHint: 'Select a pack to view its frames',
      referencePickerClear: 'Clear',
      mentionSelectImage: 'Select image to link',
      mentionRefImages: 'Reference images',
      mentionAddRef: 'Add more',
      gridPackOriginal: 'Original (3×3 composite)',
      gridPackCroppedFrames: 'Cropped frames',
      frames: 'frames',
      generating: 'Generating...',
      fluxGenerating: 'FLUX Generating...',
      aiVideoGeneration: 'AI Video Generation',
      kenBurnsZoomIn: 'Ken Burns - Zoom In',
      kenBurnsZoomInDesc: 'Gradually zoom in to the set focal position (smooth gradient effect)',
      kenBurnsZoomOut: 'Ken Burns - Zoom Out',
      kenBurnsZoomOutDesc: 'Zoom out from zoomed state to normal size (smooth gradient effect)',
      menuMaterialManagement: 'Material Management',
      clearAllMaterials: 'Clear All Materials',
      clearAllConfirmTitle: 'Clear All Materials',
      clearAllConfirmMessage: 'Are you sure you want to clear all {count} materials? This action cannot be undone.',
      clearAllSuccess: 'All materials cleared',
      noMaterialsToClear: 'No materials to clear',
      clearAllPartialFail: 'Failed to delete {failed} pack(s). Please retry.',
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
        importProject: 'Import Project File',
        exportJson: 'Export as JSON',
        exportingJson: 'Exporting...',
        extractingSubtitles: 'Extracting Subtitles...',
        invalidJsonFile: 'Please select a JSON format project file',
        volumeControl: 'Volume Control',
        trackVolumeControl: '{type} Volume Control ({volume}%)',
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
        addImageTrack: 'Add Image Track',
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
        selectAllEmptyHint: 'Track is empty.',
        editSubtitles: 'Edit Subtitles',
        editSubtitlesHint: 'Add subtitle items to this track to enable editing.',
        trackLocked: 'Track is locked',
        selected: 'Selected',
        removeTrack: 'Remove Track',
        removeTrackConfirm: 'This track has items. Are you sure you want to remove it? All items will be deleted.',
        removeTrackLast: 'Cannot remove the last track.',
        removeTrackLastOfGroup: 'Cannot remove the last {group}.',
        dropVideoHere: 'Drag video materials here',
        dropImageHere: 'Drag image materials here',
        dropAudioHere: 'Drag audio materials here',
        dropSubtitleHere: 'Drag subtitle materials here',
        dropToTrack: 'Drop to {trackName}',
        copyOf: '{name} (Copy)',
        noTracks: 'No tracks yet',
        noTracksDescription: 'Start creating your first track by adding video, audio, or subtitle materials',
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
        organizeMaterialsNoItems: 'Nothing to organize yet.',
        featureComingSoon: 'This feature is coming soon',
        effectsRequireSelection: 'Select a clip on the timeline first to add effects. (Feature coming soon)',
        transitionsRequireSelection: 'Select two adjacent clips first to add a transition. (Feature coming soon)',
        exportJsonSuccess: 'Timeline data successfully exported to JSON file: {filename}',
        exportJsonError: 'Failed to export timeline data: {error}',
        exportInvalidTimelineState: 'Invalid timeline state data',
        exportInvalidMaterials: 'Invalid materials data',
        exportUnknownError: 'Unknown error',
        organizeMaterialsDescription: 'Organize track materials, remove gaps',
        importProjectSuccess: 'Project file imported successfully! Imported {trackCount} tracks and {materialCount} materials.',
        importProjectError: 'Project import failed: {error}',
        importProjectInvalidData: 'Imported data format is invalid',
        batchTranscriptionRequestFailed: 'Batch transcription request failed: {status}',
        batchTranscriptionFailed: 'Batch transcription failed: {error}',
        subtitleExtractionUnknownError: 'Unknown error',
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
      ruler: {
        zoomIn: 'Zoom In',
        zoomOut: 'Zoom Out',
        resetZoom: 'Reset Zoom',
        timelineTooltip: 'Timeline',
        playing: 'Playing',
        scrubAriaLabel: 'Timeline playhead scrubber',
        resetZoomAriaLabel: 'Reset zoom, current {percent}%',
      },
      sentenceSegment: {
        sentence: 'Sentence {order}',
        timeLabel: 'Time: ',
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
      officialLibrary: 'Official Library',
      youtubeLibrary: 'YouTube Library',
      youtubeSearchPlaceholder: 'Search YouTube videos, e.g.: nature landscape, city night, timelapse...',
      durationLabel: 'Duration:',
      durationUnder1: 'Under 1 min',
      durationUnder3: 'Under 3 min',
      durationUnder5: 'Under 5 min',
      durationUnder10: 'Under 10 min',
      durationCustom: 'Custom',
      durationMinPlaceholder: 'Min seconds',
      durationMaxPlaceholder: 'Max seconds',
      seconds: 'sec',
      videoPreview: 'Video Preview',
      channel: 'Channel:',
      searchResults: 'Search Results',
      resultsInfo: 'Found {count} {libraryType} videos, {selected} selected',
      pageInfo: 'Page {current} / {total}',
      searchingLibrary: 'Searching {libraryType} videos...',
      startSearchLibrary: 'Start searching {libraryType} videos',
      searchHint: 'Enter keywords and click search',
      added: 'Added',
      addToComposition: 'Add',
      prevPage: 'Previous',
      nextPage: 'Next',
      noPreview: 'No preview available',
      itemsUnit: 'items',
      noSelectionHint: 'Click "Add" button to select videos',
      validationErrorHint: 'Please select more videos or videos with longer duration.',
      views: 'views',
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
        seekAriaLabel: 'Seek within video',
        volumeAriaLabel: 'Volume',
        mute: 'Mute',
        unmute: 'Unmute',
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
        selected: 'selected',
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
      noContentToExportFull: 'No content to export. Please add video materials to the timeline before exporting.',
      videoTrackTooShort: 'Video track is too short!',
      videoTrackDuration: 'Video track duration:',
      audioTrackDuration: 'Audio track duration:',
      needToAdd: 'Need to add more video content.',
      exportCompletedButDownloadFailed: 'Video export completed but download failed. Please refresh the page and try again, or contact support.',
      exportTimeout: 'Video export timed out: processing exceeded the 10-minute limit. Try reducing video duration or complexity, or try again later.',
      exportFailed: 'Video export failed',
      exportFailedWithError: 'Video export failed:',
      failedVideos: 'Failed videos:',
      recoverySuggestions: 'Suggested solutions:',
    },
    videoSearch: {
      enterKeyword: 'Please enter a search keyword',
      searchFailed: 'Search failed, please try again later',
      networkError: 'Search failed, please check your network connection',
      selectVideoFirst: 'Please select videos to add first',
      selectYoutubeVideoFirst: 'Please select YouTube videos to add first',
      videoDurationValidationFailed: 'Total video duration must exceed the voice segment duration. Please add more videos.',
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
         aiGenerate: 'AI Generate',
         generating: 'Generating...',
         selectStoryboardPack: 'Please select a storyboard pack to start',
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
        deleteSegment: 'Delete Segment',
        convertAllSpeech: 'Convert All Speech',
        aiStoryboard: 'AI Storyboard',
        aiMatchVideo: 'AI Match Video',
        aiMatching: 'AI Matching...',
        aiMatchNotConfigured: 'AI match not configured',
        noAvailableAnalyzedVideos: 'No available analyzed videos (may be used by other segments)',
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
       narration: {
         label: 'Narration',
         editTooltip: 'Edit Narration',
       },
       video: {
         associatedVideos: 'Associated Videos',
         loadingFailed: 'Loading failed',
         browserNotSupported: 'Your browser does not support video playback.',
         seconds: 's',
         duration: 'Duration',
         loading: 'Loading...',
         checkNetwork: 'Check network connection or video URL',
         retry: 'Retry',
         multipleVideos: 'Multiple',
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
         sentenceDeleteFailed: 'Failed to delete sentence',
         sentenceAddFailed: 'Failed to add sentence',
         speechConvertFailed: 'Speech conversion failed: {error}',
         subtitleRecognitionFailed: 'Subtitle recognition failed',
       },
       messages: {
         segmentDeleted: 'Segment "{title}" has been deleted',
         sentenceDeleted: 'Sentence deleted',
         sentenceAdded: 'Sentence added',
         speechConvertComplete: 'Speech conversion complete! Successfully converted {success}/{total} sentences, total duration {duration}s',
         confirmDeleteSegment: 'Are you sure you want to delete segment "{title}"? This action cannot be undone.',
         newSentencePlaceholder: 'Enter new sentence content...',
         confirmDelete: 'Delete',
         cancelDelete: 'Cancel',
         speechConvertDescription: 'Speech generated from Segment{index} "{title}" — {count} sentences converted and concatenated',
       },
       segments: {
         segmentPrefix: 'Segment {index}',
         speechSuffix: ' - Speech',
         subtitleSuffix: ' - Subtitle',
         generatedFrom: 'Speech recognition generated subtitle from "Segment {index}"',
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
          modeKeyframe: 'First/Last Frame',
          modeReference: 'Reference Image',
          firstFrameImage: 'First Frame',
          firstFrameRequired: '*Required',
          lastFrameImage: 'Last Frame',
          lastFrameOptional: '(Optional)',
          firstFrameMissing: 'Please upload a first frame image first',
          invalidImageUrl: 'Please enter a valid HTTP/HTTPS URL',
           referenceImage1: 'Reference Image 1',
           referenceImage2: 'Reference Image 2',
           referenceImage3: 'Reference Image 3',
           referenceImage4: 'Reference Image 4',
           referenceImageMissing: 'Please upload a reference image first',
         durationLabel: 'Duration:',
         expandScript: 'AI Expand',
         expandingScript: 'Expanding...',
         generateScript: 'AI Generate',
         autoTransition: 'Auto Transition',
         autoTransitionHint: 'Automatically use the last frames from previous video as the first frame',
         previousVideoNotGenerated: 'Please generate the previous scene video first',
         extractingFrame: 'Extracting frame...',
         autoTransitionMode: 'Auto Transition',
         modalTitle: 'AI Video Generation',
         modalSubtitle: 'Seedance \u00b7 ByteDance Ark Platform',
         promptLabel: 'Prompt',
         promptPlaceholder: 'Describe the video content you want to generate, e.g.: A cat playing in the sunlight, camera slowly moving...',
         durationSeconds: 'sec',
         aspectRatioLabel: 'Aspect Ratio',
         landscape: 'Landscape',
         portrait: 'Portrait',
         square: 'Square',
         advancedOptions: 'Advanced Options',
         fixedCamera: 'Fixed Camera',
         fixedCameraDesc: 'Lock camera position to reduce camera movement',
         addWatermark: 'Add Watermark',
         addWatermarkDesc: 'Add platform watermark on generated video',
         resolutionLabel: 'Resolution',
         startGenerate: 'Start Generating',
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
    storyboardScriptTab: {
      selectStoryboardPack: 'Please select a storyboard pack to start',
      selectStoryboardPackHint: 'Select a generated storyboard pack from the dropdown above',
      generateSingleVideo: 'Generate Video',
      generateMultiple: 'Generate {count} Candidates',
      selectVideo: 'Select this video',
      candidates: 'Candidates',
      batchGenerateMultiple: 'Batch Multi-Generate',
      videoCount: 'Count',
      candidateGenerating: 'Generating',
      candidateSucceeded: 'Completed',
      candidateFailed: 'Failed',
      expandTitle: 'AI Expand Description',
      expandGoalPlaceholder: 'Enter expansion goal (optional)...',
      expandGoalHint: 'Leave empty for default expansion, or specify a direction such as: add more environmental details, emphasize character emotions, etc.',
      expandStart: 'Start Expand',
      expandCancel: 'Cancel',
      queued: 'Queued',
      queuedPosition: 'position',
      generationTimeout: 'Generation timed out',
      noPacks: 'No storyboard packs',
      selectPackPlaceholder: 'Select storyboard pack...',
      packInfoFrames: '{frames} frames',
      packInfoSeparator: ' - ',
      refreshPackList: 'Refresh storyboard pack list',
      segmentLabel: 'Segment #',
      describingTitle: 'Generating descriptions...',
      describeAllTitle: 'Generate AI descriptions for all storyboard frames',
      describing: 'Generating...',
      describeAll: 'Generate Descriptions',
      generatingInProgress: 'Videos are currently being generated',
      allVideosGenerated: 'All videos have been generated',
      batchGenerateAll: 'Batch generate all ungenerated videos',
      batchGenerate: 'Batch Generate',
      generateAllVideosFirst: 'Please generate all storyboard videos first',
      composing: 'Composing...',
      composeAllVideos: 'Compose all storyboard videos',
      composeVideo: 'Compose Video',
      loadingPack: 'Loading storyboard pack...',
      describingFrames: 'Generating descriptions for storyboard frames...',
      composeFailed: 'Composition failed: ',
      retry: 'Retry',
      addFrame: 'Add Frame',
      generatedStatus: 'Generated {completed}/{total} videos',
      estimatedDuration: 'Estimated total duration: {duration}s',
      confirmDelete: 'Confirm Delete',
      deleteConfirmMessage: 'Are you sure you want to delete this storyboard frame? Generated videos will not be removed from the materials panel.',
      cancel: 'Cancel',
      delete: 'Delete',
    },
    storyboardPreviewPanel: {
      title: 'Storyboard Preview',
      gridSize: 'Grid size',
      aspectRatio: 'Aspect ratio',
      totalFrames: 'Total frames',
      hint: 'Click "Next" to generate a script for each frame.',
      ariaLabel: '{aspectRatio} storyboard preview, {rows}×{cols} grid with {frameCount} frames',
    },
   welcomeGuide: {
     title: 'AI Video Editing Assistant',
     descriptionWithMaterials: 'Try the operations below, or type your instructions directly',
     descriptionWithoutMaterials: 'Click a suggestion to start, or type what you want to do',
     trimFirst: 'Trim the first 5 seconds of the first video',
     addMusic: 'Add upbeat background music',
     generateSubtitles: 'Generate subtitles for all clips',
     adjustVolume: 'Lower the volume of the second clip by 50%',
     searchNature: 'Search for nature landscape video clips',
     generateAiVideo: 'Generate a tech-style AI video',
     createScript: 'Create a product showcase video script',
     searchMusic: 'Search for upbeat background music',
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
      inputAriaLabel: 'Video editing chat input',
      agentWorkingPlaceholder: 'Agent is working...',
      agentUndoButton: 'Undo',
      agentUndoneLabel: 'Operations undone',
      agentOperations: 'operations',
      thinkingInProgress: 'Thinking...',
      thinkingComplete: 'Thought Process',
      aiAnalyzingLabel: 'AI Analyzing...',
    },
    workflowChat: {
      title: 'Workflow Assistant',
      subtitle: 'Interact with workflows in real-time',
      inputPlaceholder: 'Enter a message to start a workflow... (Shift+Enter for new line)',
      send: 'Send',
      stop: 'Stop',
      clearChat: 'Clear Chat History',
      clearChatConfirm: 'Are you sure you want to clear all chat history? This cannot be undone.',
      clearContext: 'Clear Context',
      clearContextConfirm: 'Are you sure you want to clear the workflow context? Chat history will be preserved.',
      clearContextTooltip: 'Clear context, keep chat history',
      startConversation: 'Start Conversation',
      startConversationDesc: 'Send a message to start a workflow. Execution progress and results will be displayed in real-time.',
      running: 'Running',
      finalResult: 'Final Result',
      exportMaterials: 'Export Clips ({count} video materials)',
      exportMaterialsHint: 'Click to import video materials into the Video Editing task materials panel',
      goToVideoResult: 'Go to Video Editing to view results',
      workflowExecuting: 'Workflow is executing...',
      inputHint: 'Press Enter to send, Shift + Enter for new line',
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
      messagesLabel: 'messages',
      replying: 'Replying...',
      clearChatTooltip: 'Clear chat history',
      sendMessageTooltip: 'Send message',
      aiReplying: 'AI is replying...',
      enterToSendHint: 'Press Enter to send, Shift + Enter for new line',
      conversationList: {
        heading: 'Conversations',
        newChat: 'New Chat',
        noConversations: 'No conversations yet',
        startNewChat: 'Start a new chat to begin',
        chatbot: 'Chatbot',
        aiAgent: 'AI Agent',
        messages: '{count} message(s)',
      },
      chatTypeModal: {
        title: 'New Chat',
        subtitle: 'Choose a chat type to begin',
        chatbotTab: 'Chatbot',
        workflowTab: 'Workflow',
        agentTab: 'Agent',
        basicChatbot: 'Basic Chatbot',
        chatbotDesc: 'Start a conversation with a basic AI chatbot. Perfect for quick questions and general discussions.',
        startChatbot: 'Start Chatbot Conversation',
        fastResponse: 'Fast Response',
        quickAnswers: 'Quick answers',
        naturalChat: 'Natural Chat',
        conversational: 'Conversational',
        easyToUse: 'Easy to Use',
        noSetupNeeded: 'No setup needed',
        loadingWorkflows: 'Loading workflows...',
        failedToLoadWorkflows: 'Failed to load workflows',
        retry: 'Retry',
        noWorkflows: 'No workflows available',
        createWorkflowFirst: 'Create a workflow in the Workflow task first, then start a new conversation',
        active: 'Active',
        nodes: 'nodes',
        aiAgentTitle: 'AI Agent',
        agentDesc: 'Intelligent agents with advanced capabilities. This feature is coming soon.',
        comingSoon: 'Coming Soon',
        taskPlanning: 'Task Planning',
        multiStepTasks: 'Multi-step tasks',
        webSearch: 'Web Search',
        realtimeInfo: 'Real-time info',
        codeExecution: 'Code Execution',
        runCodeSafely: 'Run code safely',
        cancel: 'Cancel',
        workflowsAvailable: '{count} workflow(s) available',
      },
    },
    videoProcessing: {
      tab: 'Cut Silence',
      buttons: {
        close: 'Close',
        next: 'Next',
        back: 'Back',
        done: 'Done',
        return: 'Return',
        minimize: 'Minimize',
        cancel: 'Cancel',
        retry: 'Retry',
        startProcessing: 'Start Processing',
        redetect: 'Re-detect',
        restored: 'Click to restore',
      },
      presets: {
        loose: 'Loose',
        standard: 'Standard',
        aggressive: 'Aggressive',
        custom: 'Custom',
      },
      selectVideo: {
        heading: 'Select Video',
        description: 'Select a video to process (max 30 minutes)',
        noVideos: 'No video materials',
        noVideosHint: 'Please upload video materials first',
        tooLong: 'Over 30 minutes',
      },
      params: {
        detectionPreset: 'Detection Preset',
        volumeThreshold: 'Volume Threshold: {value} dB',
        volumeThresholdHint: 'Below this value is considered silence',
        minSilenceDuration: 'Min Silence Duration: {value} ms',
        minSilenceHint: 'Short pauses below this value will be ignored',
        preservedGap: 'Preserved Gap: {value} ms',
        preservedGapHint: 'Transition gap preserved at the beginning and end of each silence segment',
      },
      stats: {
        originalDuration: 'Original Duration',
        newDuration: 'New Duration',
        removedSegments: 'Removed Segments',
        segments: 'segments',
        savedTime: 'Time Saved',
        saved: 'saved',
        estimatedNewDuration: 'Est. New Duration',
      },
      progress: {
        preparing: 'Preparing...',
        processing: 'Processing...',
        completed: 'Processing Complete',
        failed: 'Processing Failed',
        detecting: 'Detecting...',
        detectSilence: 'Detect Silence',
        networkError: 'Network Error',
        networkErrorMsg: 'Cannot connect to server, please check your network and retry',
        timeout: 'Processing Timeout',
        timeoutMsg: 'Waited over 30 minutes. The backend task may still be running. Please check the materials panel later.',
        estimatedRemaining: 'Est. Remaining',
      },
      errors: {
        detectionFailed: 'Detection failed ({status})',
        detectionFailedShort: 'Detection failed',
        detectionError: 'Failed to detect silence segments',
        processFailed: 'Process failed ({status})',
        processFailedShort: 'Process failed',
        submitFailed: 'Failed to submit processing request',
        unknownError: 'Unknown error',
        queryFailed: 'Query progress failed ({status})',
        queryFailedShort: 'Query progress failed',
      },
      segments: {
        empty: 'No silence segments detected',
        total: 'Total {count} segments',
        segmentsUnit: 'segments',
        selected: 'Selected {count}',
        canSave: 'Can save {time}s',
        selectAll: 'Select All',
        deselectAll: 'Deselect All',
        invertSelection: 'Invert',
        playContext: 'Play context before and after this segment',
      },
      waveform: {
        pause: 'Pause',
        play: 'Play',
        previewEffect: 'Preview overall effect (skip selected silence segments)',
        stopPreview: 'Stop Preview',
        preview: 'Preview Effect',
        zoomHint: 'Ctrl+Scroll to zoom, double-click to fit',
      },
      duration: {
        minutes: 'min',
        seconds: 'sec',
      },
    },
    workflowNodes: {
      ports: {
        input: 'Input',
        output: 'Output',
        keywords: 'Keywords',
        results: 'Results',
        arrayInput: 'Array Input',
        combined: 'Combined',
        array: 'Array',
        videos: 'Videos',
        materials: 'Materials',
        textInput: 'Text Input',
        audioOutput: 'Audio Output',
        timeline: 'Timeline',
        copy: 'Copy',
        video: 'Video',
        audio: 'Audio',
        image: 'Image',
      },
      tooltips: {
        configured: 'Configured',
        deleteNode: 'Delete node',
        inputPort: 'Input Port',
        outputPort: 'Output Port',
      },
      status: {
        configured: 'Configured',
        notSet: 'Not set',
        notSelected: 'Not selected',
        ready: 'Ready',
        success: 'Success',
        failed: 'Failed',
        notConfigured: 'Not configured',
        noContent: 'No content',
        doubleClickToConfigure: 'Double click to configure',
        doubleClickForFullContent: 'Double click for full content',
        model: 'Model',
        temperature: 'Temp',
        systemPrompt: 'System Prompt',
        keywords: 'Keywords',
        count: 'Count',
        voice: 'Voice',
        text: 'Text',
        content: 'Content',
        format: 'Format',
        statusLabel: 'Status',
        videoUrls: 'Video URLs',
        moreCount: 'more...',
        exportToMaterials: 'Export to Materials',
        exportVideos: 'Export Videos',
        inputType: 'Input Type',
        arrayBadge: 'Array[]',
        schema: 'Schema',
        schemaDefined: 'Defined',
        combinesStandardizes: 'Combines & Standardizes',
        combinesResults: 'Combines Results',
        transformPrompt: 'Transform Prompt',
        conversionPrompt: 'Conversion Prompt',
        fields: 'Fields',
        fieldsCount: '{count} field(s)',
        outputsArray: 'Outputs Array',
        typeLabel: 'Type',
        workflowStartPoint: 'Workflow Start Point',
        workflowEndPoint: 'Workflow End Point',
      },
      aiVideo: {
        inputs: 'Inputs',
        status: 'Status',
        lastRun: 'Last Run',
        error: 'Error',
        prompt: 'Prompt',
        notConfigured: 'Not configured',
        doubleClickConfigure: 'Double click to configure',
      },
      execution: {
        title: 'Execution Process',
        progress: 'Progress',
        noNodes: 'No execution nodes',
        waiting: 'Waiting',
        executing: 'Executing',
        completed: 'Completed',
        failed: 'Failed',
        executionTime: 'Execution Time',
        systemPrompt: 'System Prompt',
        userInput: 'Prompt (User Input)',
        modelReply: 'Model Reply',
        input: 'Input',
        output: 'Output',
        error: 'Error',
      },
      editor: {
        noWorkflowSelected: 'No Workflow Selected',
        selectWorkflowPrompt: 'Select a workflow from the sidebar to start editing',
        newWorkflowDefaultName: 'Search Chat Agent',
        newWorkflowDescription: 'AI agent for searching and chatting',
      },
      configPanels: {
        volcanoTTS: {
          title: 'Volcano TTS Configuration',
          nodeId: 'Node ID',
          dataFormat: 'Data Format',
          inputFormat: 'Input Format',
          outputFormat: 'Output Format',
          inputFormatHelp: 'Format of data received from the previous node.',
          outputFormatHelp: 'Format of data sent to the next node.',
          language: 'Language',
          chinese: 'Chinese',
          english: 'English',
          voiceType: 'Voice Type',
          loadingVoices: 'Loading voices...',
          speedRatio: 'Speed Ratio',
          slower: '0.5x (Slower)',
          normal: '1.0x (Normal)',
          faster: '2.0x (Faster)',
          textContent: 'Text Content',
          clear: 'Clear',
          placeholder: 'Enter the text you want to convert to speech...',
          characters: 'characters',
          words: 'words',
          hasContent: 'Has content',
          empty: 'Empty',
          audioPreview: 'Audio Preview',
          pause: 'Pause',
          playAudio: 'Play Audio',
          download: 'Download',
          downloadAudio: 'Download Audio',
          howToUse: 'How to use',
          howToUseSteps: [
            'Select your preferred voice type from the list',
            'Enter the text you want to convert to speech',
            'Adjust the speed ratio if needed (0.5x - 2.0x)',
            'Use the Test & Debug panel to preview the audio',
            'Connect the output to other nodes to use the generated audio',
          ],
          cancel: 'Cancel',
          save: 'Save Configuration',
          saving: 'Saving...',
        },
        aiVideoGenerate: {
          title: 'AI Video Generate Configuration',
          subtitle: 'Configure inputs and parameters',
          inputConfiguration: 'Input Configuration',
          llmSettings: 'LLM Settings',
          executionResults: 'Execution Results',
          inputConfigDesc: 'Configure optional inputs. Each input supports string, JSON, or array format.',
          textInput: 'Text Input',
          videoInput: 'Video Input',
          audioInput: 'Audio Input',
          imageInput: 'Image Input',
          enterTextPlaceholder: 'Enter text content, JSON object, or array...',
          enterVideoPlaceholder: 'Enter video URL, JSON object, or array...',
          enterAudioPlaceholder: 'Enter audio URL, JSON object, or array...',
          enterImagePlaceholder: 'Enter image URL, JSON object, or array...',
          stringFormat: 'String',
          jsonFormat: 'JSON',
          arrayFormat: 'Array',
          llmConfigDesc: 'Configure LLM parameters. Uses VIDEO_CUT_LLM from backend environment.',
          systemPrompt: 'System Prompt (Optional)',
          systemPromptPlaceholder: 'Override default system prompt for video timeline generation...',
          temperature: 'Temperature',
          temperatureHint: 'Lower values make output more focused and deterministic',
          maxTokens: 'Max Tokens',
          llmInfoTitle: 'LLM Configuration',
          llmInfoDesc: 'This node uses the VIDEO_CUT_LLM configured in the backend environment. The LLM will merge all inputs and generate a timeline JSON in the Video Editing format.',
          executionSuccessful: 'Execution Successful',
          executionFailed: 'Execution Failed',
          lastExecuted: 'Last executed',
          errorMessage: 'Error Message',
          executionResult: 'Execution Result (Timeline JSON)',
          noResultsYet: 'No execution results yet. Run the workflow to see results.',
          cancel: 'Cancel',
          saveConfiguration: 'Save Configuration',
        },
      },
    },
    mediaPreview: {
      zoomOut: 'Zoom out (-)',
      zoomIn: 'Zoom in (+)',
      reset: 'Reset (0)',
      pause: 'Pause (Space)',
      play: 'Play (Space)',
      close: 'Close (ESC)',
      imageShortcuts: 'Shortcuts:',
      imageShortcutsZoom: '+/-',
      imageShortcutsReset: '0',
      imageShortcutsClose: 'ESC',
      imageMouseWheel: 'Scroll',
      imageMouseDrag: 'Drag',
      mediaShortcutsSpace: 'Space',
      mediaShortcutsClose: 'ESC',
      imageShortcutsLine1: 'Shortcuts: +/- zoom | 0 reset | ESC close',
      imageShortcutsLine2: 'Mouse: scroll zoom | drag to pan',
      mediaShortcutsLine: 'Shortcuts: Space play/pause | ESC close',
    },
    storyboardPack: {
      defaultTitle: 'Storyboard Pack',
      frames: 'frames',
      close: 'Close',
      originalImage: 'Original Storyboard Image',
      noFrames: 'No frame data yet',
      frame: 'Frame',
      position: 'Position',
      row: 'Row',
      column: 'Column',
      noDescription: 'No description generated',
      deletePack: 'Delete Pack',
      addToMaterials: 'Add All to Materials',
      useInScript: 'Use in Script',
      materials: 'Materials',
      prompt: 'Prompt',
      gridSizeLabel: 'Grid Size',
      frameCountLabel: 'Frames',
      gridWillGenerate: 'Will generate {rows}x{cols} = {total} frame grid',
      gridWillUse: 'Will generate {rows}x{cols} = {total} grid, using first {value} frames',
    },
    mobileWarning: {
      tablet: 'Tablet',
      mobile: 'Mobile',
      mobileDevice: 'Mobile Device',
      title: '{device} is not supported yet',
      description: 'For a better experience, please access this app on a computer.',
      useDesktop: 'Recommended: use a computer',
    },
    gridSizeSelector: {
      frameCount: 'Storyboard Count',
      gridLabel: 'grid',
      custom: 'Custom',
      placeholder: 'Enter storyboard count (1-64)',
      willGenerate: 'Will generate {rows}x{cols} = {total} frame grid',
      willUse: 'Will generate {rows}x{cols} = {total} grid, using first {value} frames',
    },
    creativeBrainstorming: {
      inputPlaceholder: 'Enter your thoughts or questions...',
      sendHint: 'Press Enter to send, Shift+Enter for new line',
    },
    audioSearchModal: {
      title: 'Search Audio',
      searchPlaceholder: 'Enter audio search keywords, e.g.: ambient music, nature sounds...',
      searchButton: 'Search',
      searching: 'Searching...',
      audioTypeLabel: 'Audio Type:',
      audioTypeAll: 'All',
      audioTypeMusic: 'Music',
      audioTypeSoundEffect: 'Sound Effect',
      audioTypeSpeech: 'Speech',
      audioTypeAmbient: 'Ambient',
      audioTypeNature: 'Nature',
      sortByLabel: 'Sort By:',
      sortByScore: 'Relevance',
      sortByDownloads: 'Popularity (Downloads)',
      sortByRating: 'Rating',
      sortByDurationDesc: 'Duration (Long to Short)',
      sortByDurationAsc: 'Duration (Short to Long)',
      sortByCreatedDesc: 'Newest',
      sortByCreatedAsc: 'Oldest',
      durationFilterLabel: 'Duration Filter:',
      durationMinPlaceholder: 'Min (sec)',
      durationMaxPlaceholder: 'Max (sec)',
      durationTo: 'to',
      resultsTitle: 'Search Results',
      resultsCount: '({count} audios)',
      selectedCount: 'Selected: {count}',
      clearSelection: 'Clear Selection',
      noResults: 'No audio found',
      noResultsHint: 'Try different keywords or adjust filters',
      noQueryTitle: 'Enter keywords to search audio',
      noQueryHint: 'Search ambient sounds, sound effects, music and more',
      previewTitle: 'Audio Preview',
      descriptionLabel: 'Description',
      audioInfoLabel: 'Audio Info',
      durationLabel: 'Duration:',
      licenseLabel: 'License:',
      sizeLabel: 'Size:',
      formatLabel: 'Format:',
      channelsLabel: 'Channels',
      sampleRateLabel: 'Sample Rate:',
      tagsLabel: 'Tags',
      addingAudios: 'Adding {count} audios, please wait...',
      addedCount: '{count} audios selected',
      cancelButton: 'Cancel',
      addingButton: 'Adding...',
      addSelectedButton: 'Add Selected Audio ({count})',
    },
    imageSearchModal: {
      title: 'Search Images',
      searchPlaceholder: 'Enter search keywords, e.g.: landscape, portrait, architecture...',
      searchButton: 'Search',
      searching: 'Searching...',
      orientationLabel: 'Orientation:',
      orientationAll: 'All',
      orientationLandscape: 'Landscape',
      orientationPortrait: 'Portrait',
      orientationSquarish: 'Square',
      colorLabel: 'Color:',
      colorAll: 'All',
      colorBlackAndWhite: 'Black & White',
      colorBlack: 'Black',
      colorWhite: 'White',
      colorYellow: 'Yellow',
      colorOrange: 'Orange',
      colorRed: 'Red',
      colorPurple: 'Purple',
      colorMagenta: 'Magenta',
      colorGreen: 'Green',
      colorTeal: 'Teal',
      colorBlue: 'Blue',
      orderByLabel: 'Sort:',
      orderByRelevant: 'Relevance',
      orderByLatest: 'Latest',
      orderByPopular: 'Popular',
      selectedCount: '{count} images selected',
      clearSelection: 'Clear Selection',
      addingImages: 'Adding...',
      addSelectedButton: 'Add Selected Images ({count})',
      deselect: 'Deselect',
      select: 'Select',
      addToMaterials: 'Add to Materials',
      noDescription: 'No description',
      noResultsTitle: 'No search results',
      noResultsHint: 'Enter keywords to search images',
      imagePreview: 'Image Preview',
      prevPage: 'Previous',
      nextPage: 'Next',
      pageInfo: 'Page {current} of {total}',
    },
    aiImageModal: {
      title: 'AI Image Generation',
      subtitle: 'Seedream · ByteDance Ark Platform',
      tabBasic: 'Basic Generation',
      tabCharacter: 'Character Modeling',
      tabScene: 'Scene Modeling',
      tabStoryboard: 'Storyboard',
      cancelButton: 'Cancel',
      generatingButton: 'Generating...',
      generateButton: 'Start Generating',
    },
    basicGenerationTab: {
      promptLabel: 'Prompt',
      promptPlaceholder: 'Describe the image you want to generate... Select reference images from the right panel, or type @[image name] to reference',
      sizeLabel: 'Image Size',
      size1kSquare: '1K Square',
      size2kSquare: '2K Square',
      size169Landscape: '16:9 Landscape',
      size916Portrait: '9:16 Portrait',
      size169Wide: '16:9 Wide',
      size916Wide: '9:16 Wide',
      countLabel: 'Generation Count',
      countUnit: 'images',
      watermarkLabel: 'Add Watermark',
      watermarkDesc: 'Add platform watermark to generated images',
    },
    storyboardTab: {
      aspectRatioLabel: 'Aspect Ratio',
      aspectRatio11: '1:1 Square',
      aspectRatio169: '16:9 Landscape',
      aspectRatio916: '9:16 Portrait',
      aspectRatio43: '4:3 Landscape',
      aspectRatio34: '3:4 Portrait',
      promptLabel: 'Prompt',
      promptPlaceholder: 'Describe the storyboard content... Type @ to link reference images',
      settingsTitle: 'Storyboard Settings',
      settingsLocked: 'Locked',
      scriptPreviewLabel: 'Script Preview ({count} shots)',
      languageLabel: '{lang}',
      backToInput: '← Back to input',
      shotNumber: 'Shot {number}',
      shotPlaceholder: 'Shot {number} script...',
      emptyScript: 'Script is empty, please go back to regenerate',
      chatTitle: 'Chat with AI to modify script',
      chatYou: 'You:',
      chatAI: 'AI:',
      chatPlaceholder: 'e.g.: Change shot 3 to rainy night',
      chatSend: 'Send',
      confirmGenerate: 'Confirm & Generate Storyboard',
      scriptMinLengthHint: 'Please ensure all scripts have at least 5 characters',
      nextStepGenerate: 'Next: Generate Storyboard Script',
      generatingScript: 'Generating script...',
      scriptInfo: 'Will generate {count} shot scripts for confirmation, aspect ratio {ratio} (Language: {lang})',
      advancedOptions: 'Advanced Options',
      skipScript: 'Skip script, generate storyboard directly (legacy)',
      generatingFrames: 'Generating {count} storyboard frames...',
      generatingFramesDesc: 'AI is drawing and auto-cropping based on the script',
      croppedFrames: 'Cropped to {count} storyboard frames with script binding',
      gridLabel: 'Grid:',
      generateNew: 'Generate New Storyboard',
      retryButton: 'Retry',
      scriptGenerateFailed: 'Script generation failed',
      scriptReviseFailed: 'Script revision failed',
      scriptUpdated: 'Script updated ({count} shots).',
      backConfirm: 'Going back will clear the current script draft. Continue?',
      generateFailed: 'Storyboard generation failed, please retry',
      storyboardImageAlt: 'Storyboard full image',
    },
    gridSizeSelectorTab: {
      frameCountLabel: 'Storyboard Count',
      gridUnit: 'grid',
      custom: 'Custom',
      placeholder: 'Enter storyboard count (1-64)',
      willGenerate: 'Will generate {rows}x{cols} = {total} frame grid',
      willUse: 'Will generate {rows}x{cols} = {total} grid, using first {value} frames',
    },
    videoAnalysisModal: {
      title: 'AI Video Analysis Result',
      subtitle: 'Intelligent video content analysis',
      closeTooltip: 'Close',
      videoDuration: 'Video Duration',
      framesExtracted: 'Frames Extracted',
      processingTime: 'Processing Time',
      analysisTime: 'Analysis Time',
      frameAnalysisTitle: 'Frame-by-Frame Analysis',
      frameLabel: 'Frame {number}',
      timePoint: 'Time Point',
      summaryTitle: 'Analysis Summary',
      errorTitle: 'Analysis Failed',
      errorDefaultMessage: 'An error occurred during video analysis',
      closeButton: 'Close',
      loadingTitle: 'Loading Analysis Results',
      loadingDesc: 'Please wait...',
      videoLabel: 'Video:',
      secondsUnit: 's',
      framesUnit: 'frames',
    },
    videoScriptProgressModal: {
      titleWithVideo: 'Video Understanding Script Generation',
      titleWithoutVideo: 'Script Generation',
      stepPreparing: 'Preparing...',
      stepAnalyzing: 'Analyzing video content...',
      stepGenerating: 'Generating script...',
      stepProcessing: 'Processing...',
      descAnalyzing: 'Analyzing video ({analyzed}/{total})',
      descGeneratingWithVideo: 'Generating script based on video analysis',
      descGeneratingWithoutVideo: 'Generating script based on conversation',
      descPleaseWait: 'Please wait...',
      analyzingVideo: 'Analyzing: {name}',
      statCompleted: 'Completed',
      statProcessing: 'Processing',
      statFailed: 'Failed',
      errorTitle: 'Issues encountered during processing',
      cancelButton: 'Cancel',
    },
    videoCacheIndicator: {
      loading: 'Preloading...',
      loaded: 'Cached',
      error: 'Load Failed',
      notCached: 'Not Cached',
    },
    chatMessageBubble: {
      thinking: 'Thinking...',
      thoughtProcess: 'Thought Process',
      analyzingIntent: 'Analyzing Intent',
      detectingWorkflow: 'Detecting if your question requires workflow...',
      willCallWorkflow: 'Will call workflow: {name}',
      normalChat: 'Normal Chat',
      copiedTitle: 'Copied!',
      copyMessageTitle: 'Copy Message',
      convertToScriptTitle: 'Convert to Video Script',
      generating: 'Generating',
      copied: 'Copied',
    },
    chatWorkflowExecution: {
      finalResult: 'Final Result',
      copiedTitle: 'Copied!',
      copyTitle: 'Copy Final Result',
      convertToScriptTitle: 'Convert to Video Script',
      exportClip: 'Export Clips ({count} video materials)',
      exportClipHint: 'Click to import video materials into the Video Editing materials panel',
      executing: 'Workflow executing...',
    },
    chatWorkflowSelection: {
      title: 'Select Workflow',
      subtitle: 'Select a workflow to start a new conversation',
      loading: 'Loading workflows...',
      errorTitle: 'Loading Failed',
      retryButton: 'Retry',
      emptyTitle: 'No Workflows',
      emptyHint: 'Please create a workflow in the "Workflows" task first, then start a new conversation',
      activeBadge: 'Active',
      nodesLabel: '{count} nodes',
      totalWorkflows: '{count} workflows available',
      cancelButton: 'Cancel',
    },
    videoCut: {
      title: 'Cut Material',
      timelineControl: 'Timeline Control',
      selectRange: 'Select Range:',
      dragGreenStart: 'Drag the green control bar to adjust start time',
      dragRedEnd: 'Drag the red control bar to adjust end time',
      blueCurrentPos: 'The blue line indicates current playback position',
      setStart: 'Set Start',
      setEnd: 'Set End',
      createClip: 'Create Clip',
      preview: 'Preview:',
      selectToPreview: 'Select a clip to preview',
      clipList: 'Clip List',
      clip: 'Clip',
      clipCount: 'clips',
      exportClips: 'Export Clips',
      noClips: 'No clips created yet',
      startBeforeEnd: 'Start time must be before end time',
      minDuration: 'Clip duration must be at least 0.5 seconds',
      clipCreated: 'Clip created: ',
      clipDeleted: 'Clip deleted',
      noClipsToExport: 'No clips to export',
      noMaterial: 'Original material not found',
      clipsExported: ' clips exported to material panel',
      exportUnavailable: 'Export function is not available',
      startTimeLabel: 'Start Time:',
      endTimeLabel: 'End Time:',
    },
    convertToScript: {
      title: 'Generate Script',
      subtitle: 'Convert conversation content to video script',
      parameterSettings: 'Parameter Settings',
      scriptLanguage: 'Script Language',
      chinese: 'Chinese',
      english: 'English',
      mixed: 'Mixed (Chinese & English)',
      segmentCount: 'Script Segment Count:',
      segments: 'segments',
      analysisDepth: 'Analysis Depth',
      basic: 'Basic',
      quickGen: 'Quick Generation',
      detailed: 'Detailed',
      balancedQuality: 'Balanced Quality',
      comprehensive: 'Comprehensive',
      deepAnalysis: 'Deep Analysis',
      additionalOptions: 'Additional Options',
      includeVisual: 'Include Visual Element Analysis',
      visualDesc: 'Analyze scenes, objects, people and other visual info in the video',
      includeAudio: 'Include Audio Analysis',
      audioDesc: 'Analyze speech, music, sound effects and other audio info in the video',
      videoUnderstanding: 'Video Understanding',
      enabledDesc: 'Video understanding enabled. Selected videos will be automatically analyzed to generate scripts.',
      disabledDesc: 'Video understanding is off. Scripts will be generated from conversation content only.',
      analysisMode: 'Analysis Mode',
      quickAnalysis: 'Quick Analysis',
      coverOnly: 'Cover Only',
      proAnalysis: 'Professional Analysis',
      multiFrame: 'Multi-frame Deep Analysis',
      selectVideoDesc: 'Select video materials to participate in script generation',
      videoStatsPrefix: 'Total ',
      videoStatsTotal: ' videos, ',
      videoStatsAnalyzed: ' analyzed, ',
      videoStatsPending: ' pending',
      selectedUnanalyzedPrefix: '',
      selectedUnanalyzed: ' unanalyzed videos selected — will be analyzed during generation',
      noVideos: 'No video materials available',
      pleaseUpload: 'Please upload or search for video materials first',
      selectedCountPrefix: 'Selected ',
      selectedCount: ' videos',
      selectAll: 'Select All',
      deselectAll: 'Deselect All',
      analyzed: 'Analyzed',
      pending: 'Pending',
      unknownDuration: 'Unknown duration',
      chatPreview: 'Chat Content Preview:',
      footerWithVideo: 'Will use {count} videos to generate script',
      footerWithAnalysis: ' ({count} need analysis first)',
      footerNoVideo: 'Will generate script from conversation content',
      generating: 'Generating...',
      startGenerate: 'Start Generating',
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
      confirm: '确定',
      underDevelopment: '功能开发中...',
    },
    header: {
      brandSubtitle: '光与影之交汇',
      languageSelector: '语言',
      english: 'English',
      chinese: '中文',
      returnToHomepage: '返回首页',
      switchToLightMode: '切换到亮色模式',
      switchToDarkMode: '切换到暗色模式',
    },
    landing: {
      description: 'AI驱动的创意平台',
      heroDescription: '创意与AI的交汇。创作精彩视频，构建智能工作流，用我们强大的工具套件释放您的创造潜力。',
      startCreating: '开始创作',
      loading: '加载中...',
      exploreWorkflows: '探索工作流',
      videoEditingDesc: 'AI驱动的专业视频编辑工具与直观时间线界面',
      workflowDesc: '可视化节点编辑器构建强大AI工作流',
      aiChatDesc: '智能AI对话助力内容创作与辅助',
      brainstormingDesc: '为您的项目生成创意想法和概念',
      aiModels: 'AI模型',
      workflowTemplates: '工作流模板',
      creativePossibilities: '创意无限可能',
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
      passwordPlaceholder: '输入密码（至少6个字符）',
      loginButton: '登录',
      registerButton: '注册',
      welcomeBack: '欢迎回来',
      welcomeBackMessage: '欢迎回来，{username}！({role})',
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
      autoSaveNote: '更改会自动保存。',
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
      authRequiredError: '请登录后访问模型设置。',
      sessionExpiredError: '会话已过期，请重新登录。',
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
      // Tab layout & provider enhancements
      tabProviders: '供应商管理',
      tabAssignments: '模型分配',
      tabAdvanced: '高级设置',
      apiFormat: 'API 格式',
      apiFormatAuto: '自动检测',
      apiFormatOpenai: 'OpenAI 格式',
      apiFormatAnthropic: 'Anthropic 格式',
      defaultModels: '预置模型',
      effectiveConfig: '当前生效配置',
      configSource: '配置来源',
      configFromDb: '数据库',
      configFromEnv: '环境变量',
      envFallbackDesc: '未配置数据库分配时，系统使用环境变量作为回退。',
      envFallbackTitle: '环境变量回退参考',
      envVarFunctionType: '功能类型',
      envVarPrefix: '环境变量前缀',
      envVarUrlKey: 'URL 变量',
      envVarApiKeyKey: 'API Key 变量',
      envVarModelKey: '模型变量',
      envVarDescription: '说明',
      envVarChatDesc: '主聊天模型',
      envVarFastDesc: '快速操作模型',
      envVarVideoCutDesc: '视频剪辑模型',
      envVarVisionDesc: '视觉语言模型',
      envVarCodingDesc: '编程助手模型',
      effectiveConfigDesc: '展示每个功能类型当前生效的配置，来源于数据库分配或环境变量回退。',
      effectiveConfigRefresh: '刷新',
      effectiveConfigLoading: '加载配置中...',
      effectiveConfigUrl: '供应商 / URL',
      effectiveConfigModel: '模型',
      effectiveConfigSource: '来源',
      effectiveConfigNotConfigured: '未配置',
      testConnectionFormat: '测试连接格式',
      modelInfo: '模型信息',
      formatUsed: '使用的格式',
      providerCard: '供应商卡片',
      modelApiKeyRequired: 'API Key 不能为空',
      modelDeleteProviderError: '删除供应商失败',
      modelModelsFound: '个模型已获取',
      modelKeyNotSet: '未设置',
      modelRequestFailed: '请求失败',
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
      // Settings panels - shared
      settingsUnsaved: '有未保存的更改',
      settingsSaveSuccess: '设置保存成功',
      settingsSaveError: '保存设置失败',
      settingsResetSuccess: '设置已恢复为默认值',
      settingsResetError: '恢复默认值失败',
      settingsRestoreDefaults: '恢复默认值',
      settingsResetting: '恢复中...',
      settingsResetConfirmTitle: '恢复默认值',
      settingsResetConfirmMessage: '确定要将此类别的所有设置恢复为默认值吗？此操作无法撤销。',
      settingsLogging: '日志配置',
      settingsVerboseLog: '启用详细日志',
      settingsProgressInterval: '进度记录间隔',
      settingsLogLevel: '日志级别',
      // TTS Settings
      ttsSettings: 'TTS 设置',
      ttsSettingsDesc: '配置文本转语音的并发、重试、限制和声音列表',
      ttsConcurrency: '并发与超时',
      ttsConcurrencyDesc: '控制并发线程数和超时设置',
      ttsConcurrentThreads: '并发线程数',
      ttsMaxConcurrentThreads: '最大并发线程数',
      ttsRequestTimeout: '单请求超时（秒）',
      ttsBatchTimeout: '批处理总超时（秒）',
      ttsRetry: '重试配置',
      ttsRetryDesc: '控制失败 TTS 请求的重试行为',
      ttsMaxRetries: '最大重试次数',
      ttsRetryDelay: '重试间隔（秒）',
      ttsBackoffFactor: '退避因子',
      ttsLimits: '资源限制',
      ttsLimitsDesc: '设置批处理的最大值',
      ttsMaxSegments: '每批最大段数',
      ttsMaxCharsPerSegment: '每段最大字符数',
      ttsMaxTotalChars: '总最大字符数',
      ttsVoices: '声音列表',
      ttsVoicesDesc: '按分类管理可用的 TTS 声音',
      // Voice list editor
      voiceSearch: '搜索声音...',
      voiceAllCategories: '全部分类',
      voiceAllGenders: '全部性别',
      voiceMale: '男声',
      voiceFemale: '女声',
      voiceAdd: '添加声音',
      voiceEdit: '编辑声音',
      voiceDelete: '删除',
      voiceTotal: '总计',
      voiceNoResults: '没有找到匹配的声音',
      voiceValue: '声音 ID',
      voiceLabel: '显示名称',
      voiceCategory: '分类',
      voiceGender: '性别',
      voiceLanguage: '语言',
      voiceDescription: '描述',
      voiceCatGeneral: '通用场景',
      voiceCatDialect: '方言',
      voiceCatRoleplay: '角色扮演',
      voiceCatNarration: '旁白',
      voiceCatAudiobook: '有声书',
      // YouTube Settings
      youtubeSettings: 'YouTube 设置',
      youtubeSettingsDesc: '配置 YouTube 下载、上传、质量和文件管理',
      ytDownload: '下载配置',
      ytDownloadDesc: '配置下载并发数和超时',
      ytMaxConcurrent: '最大并发下载数',
      ytTimeout: '下载超时（秒）',
      ytMaxRetries: '最大重试次数',
      ytRetryDelay: '重试间隔（秒）',
      ytUpload: '上传配置',
      ytUploadDesc: '配置上传超时和重试',
      ytUploadTimeout: '上传超时（秒）',
      ytQuality: '视频质量',
      ytQualityDesc: '下载的默认质量设置',
      ytVideoQuality: '默认视频质量',
      ytAudioQuality: '默认音频质量',
      ytOutputFormat: '默认输出格式',
      ytFileManagement: '文件管理',
      ytFileManagementDesc: '配置临时文件清理和缩略图生成',
      ytAutoCleanup: '自动清理临时文件',
      ytRetentionHours: '保留时间（小时）',
      ytGenerateThumbnail: '生成缩略图',
      ytLogProgress: '记录下载进度',
      ytProgressInterval: '进度日志间隔（秒）',
      // Upload Settings
      uploadSettings: '上传设置',
      uploadSettingsDesc: '配置文件上传并发、大小限制和临时文件管理',
      uploadConcurrent: '并发上传',
      uploadConcurrentDesc: '控制上传并发和队列设置',
      uploadMaxConcurrent: '最大并发上传数',
      uploadQueueMaxLength: '队列最大长度（0=无限）',
      uploadTimeout: '上传超时（秒）',
      uploadEnableQueue: '启用上传队列',
      uploadFileLimits: '文件大小限制',
      uploadFileLimitsDesc: '按类型设置最大文件大小（MB）',
      uploadVideoMax: '视频最大大小（MB）',
      uploadAudioMax: '音频最大大小（MB）',
      uploadImageMax: '图片最大大小（MB）',
      uploadRetry: '重试配置',
      uploadMaxRetries: '最大重试次数',
      uploadRetryDelay: '重试间隔（秒）',
      uploadExponentialBackoff: '指数退避',
      uploadThumbnail: '缩略图生成',
      uploadThumbnailDesc: '自动为上传的视频生成缩略图',
      uploadAutoThumbnail: '自动生成缩略图',
      uploadThumbnailQuality: '缩略图质量（1-31）',
      uploadThumbnailMaxWidth: '最大宽度（px）',
      uploadThumbnailMaxHeight: '最大高度（px）',
      uploadTempFiles: '临时文件',
      uploadAutoCleanup: '自动清理',
      uploadRetentionHours: '保留时间（小时）',
      uploadTempDir: '临时文件目录',
      // Watermark Settings
      watermarkSettings: '水印移除设置',
      watermarkSettingsDesc: '配置水印移除处理参数',
      wmRemoval: '处理配置',
      wmRemovalDesc: '水印移除的线程和批处理设置',
      wmConcurrentThreads: '并发线程数',
      wmMaxConcurrentThreads: '最大并发线程数',
      wmBatchFrames: '批处理帧数',
      wmBatchTimeout: '批处理超时（秒）',
      wmProgressIntervalFrames: '进度记录间隔（帧）',
      wmThreadLogging: '启用线程日志',
      // Video Analysis Settings
      videoAnalysisSettings: '视频分析设置',
      videoAnalysisSettingsDesc: '配置视频分析队列、VLM 处理和帧提取',
      vaQueueManagement: '队列管理',
      vaQueueManagementDesc: '控制并发分析和队列行为',
      vaMaxConcurrentAnalyses: '最大并发分析数',
      vaEnableSingleVideoQueue: '启用单视频队列',
      vaVlmProcessing: 'VLM 处理',
      vaVlmProcessingDesc: '配置视觉语言模型 API 设置',
      vaConcurrentThreads: '并发线程数',
      vaApiTimeout: 'API 超时（秒）',
      vaMaxRetries: '最大重试次数',
      vaFrameExtraction: '帧提取',
      vaFrameExtractionDesc: '配置如何从视频中提取帧用于分析',
      vaDefaultFrameInterval: '默认帧间隔（秒）',
      vaMaxFramesPerVideo: '每视频最大帧数',
      vaSupportedFormats: '支持的格式',
      vaDurationStrategy: '基于时长的策略',
      vaShortVideos: '短视频',
      vaMediumVideos: '中等视频',
      vaLongVideos: '长视频',
      vaMaxDuration: '最大时长（秒）',
      vaFrameInterval: '帧间隔（秒）',
      vaMaxFrames: '最大帧数',
      vaPerformance: '性能',
      vaPerformanceDesc: '性能监控和限制',
      vaEnablePerfLog: '启用性能日志',
      vaLogConcurrencyStats: '记录并发统计',
      vaMaxVideoDuration: '最大视频时长（秒）',
      vaTempFiles: '临时文件',
      vaVideoDownloadDir: '视频下载目录',
      vaFrameExtractPrefix: '帧提取目录前缀',
      vaAutoCleanup: '自动清理',
      vaCleanupTimeout: '清理超时（秒）',
      vaLogAnalysisContent: '记录分析内容',
      vaLogFrameProcessingTime: '记录帧处理时间',
    },
    tasks: {
      workflow: '工作流',
      videoEditing: '视频编辑',
      brainstorming: '头脑风暴',
      aiChat: 'AI对话',
    },
    workflowInterface: {
      chatInterfaceTab: '聊天界面',
      workflowInterfaceTab: '工作流界面',
      sidebar: {
        heading: '工作流',
        addNew: '添加新工作流',
        subtitle: '选择或创建一个工作流',
        emptyState: '暂无工作流',
        editDetails: '编辑工作流详情',
        confirmDelete: '确认删除',
        deleteWorkflow: '删除工作流',
        workflowCount: '{count} 个工作流',
        active: '活跃',
      },
      canvas: {
        contextMenu: {
          addStartNode: '添加开始节点',
          addEndNode: '添加结束节点',
          addChatLLM: '添加聊天 LLM',
          addTextInput: '添加文本输入',
          addPexelsVideoSearch: '添加 Pexels 视频搜索',
          addTavilySearch: '添加 Tavily 搜索',
          addVolcanoTTS: '添加火山 TTS',
          addToArray: '添加转换为数组',
          addResultsCombine: '添加结果合并',
          addAIVideoGenerate: '添加 AI 视频生成',
          addVideoExport: '添加视频导出',
        },
        nodeDefaults: {
          start: '开始',
          end: '结束',
          chatLLM: '聊天 LLM',
          textInput: '文本输入',
          pexelsSearch: 'Pexels 视频搜索',
          tavilySearch: 'Tavily 搜索',
          volcanoTTS: '火山 TTS',
          toArray: '转换为数组',
          resultsCombine: '结果合并',
          aiVideoGenerate: 'AI 视频生成',
          videoExport: '视频导出',
        },
        emptyState: {
          title: '开始构建您的工作流',
          description: '右键点击画布任意位置添加您的第一个节点',
        },
        toolbar: {
          zoomOut: '缩小',
          zoomIn: '放大',
          panMode: '平移模式（拖拽画布）',
          exitPanMode: '退出平移模式（切换到节点拖拽）',
          resetView: '重置视图',
        },
        infoBar: {
          nodes: '节点',
          connections: '连接',
          nodeSelected: '已选中节点',
          connectionSelected: '已选中连接',
        },
      },
      editor: {
        save: '保存',
        saving: '保存中...',
        run: '运行',
        stop: '停止',
        loading: '加载工作流...',
        noWorkflowSelected: '未选择工作流',
        selectWorkflowPrompt: '从侧边栏选择一个工作流开始编辑',
        description: '描述',
        viewDescription: '查看描述',
      },
      notifications: {
        loadedWorkflows: '已加载 {count} 个工作流',
        failedToLoad: '加载工作流失败',
        pleaseLoginToCreate: '请先登录以创建工作流',
        newWorkflowDefaultName: '新工作流',
        workflowCreated: '工作流 "{name}" 创建成功',
        workflowCreatedSaveFailed: '工作流已创建但保存失败，请手动保存。',
        pleaseLoginToRename: '请先登录以重命名工作流',
        workflowRenamed: '工作流已重命名为 "{name}"',
        workflowRenamedSaveFailed: '工作流已重命名但保存失败，请手动保存。',
        pleaseLoginToSaveChanges: '请先登录以保存工作流更改',
        workflowNotFound: '未找到工作流',
        workflowUpdated: '工作流 "{name}" 更新成功',
        workflowUpdatedSaveFailed: '工作流已在本地更新但保存到数据库失败，请手动保存。',
        pleaseLoginToDelete: '请先登录以删除工作流',
        cannotDeleteLast: '无法删除最后一个工作流',
        workflowDeleted: '工作流 "{name}" 已成功删除',
        failedToDelete: '删除工作流失败',
        pleaseLoginToSave: '请先登录以保存工作流',
        noActiveWorkflow: '没有活跃的工作流可保存',
        workflowSaved: '工作流 "{name}" 已成功保存 (v{version})',
        workflowSaveFailed: '保存工作流失败',
      },
      logPanel: {
        title: '执行日志',
        collapse: '收起',
        expand: '展开',
        running: '运行中',
        current: '当前',
        noLogs: '暂无日志',
        clickRunToStart: '点击运行按钮开始执行工作流',
        input: '输入',
        output: '输出',
        viewDetails: '查看详情',
        totalLogs: '总计日志: {count}',
        errors: '{count} 个错误',
        warnings: '{count} 个警告',
        success: '{count} 个成功',
      },
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
      aiImageTitle: 'AI 图像生成（Seedream）',
      aiImage: 'AI图像',
      aiVideoTitle: 'AI 视频生成（Seedance）',
      aiVideo: 'AI视频',
      aiAudioTitle: 'AI 音频生成',
      aiAudio: 'AI音频',
      aiAudioText: '转换文本',
      aiAudioTextPlaceholder: '请输入需要转换为音频的文本...',
      aiAudioSpeed: '语速',
      aiAudioSelectVoice: '选择音色',
      aiAudioLoadingVoices: '加载音色列表...',
      aiAudioCancel: '取消',
      aiAudioStartSynthesis: '开始合成',
      aiAudioSuccess: 'AI音频生成成功',
      aiAudioFailed: 'AI音频生成失败',
      videoProcessingTitle: '视频处理（切气口等）',
      videoProcessing: '视频处理',
      watermarkRemovalTab: '去除水印',
      selectVideoForWatermark: '选择视频进行去除水印操作',
      noVideoMaterials: '暂无视频素材',
      deleteStoryboardPack: '删除分镜包',
      deleteStoryboardPackConfirm: '确定要删除此分镜包吗？所有帧和相关数据将被永久删除。',
      storyboardPack: '分镜包',
      characterPack: '人物建模包',
      scenePack: '场景建模包',
      filterCharacterPack: '人物包',
      filterScenePack: '场景包',
      deleteCharacterPack: '删除人物建模包',
      deleteCharacterPackConfirm: '确定要删除此人物建模包吗？所有帧和相关数据将被永久删除，其他地方对这些帧的引用将失效。',
      deleteScenePack: '删除场景建模包',
      deleteScenePackConfirm: '确定要删除此场景建模包吗？所有帧和相关数据将被永久删除，其他地方对这些帧的引用将失效。',
      materialLibraryTab: '素材库',
      materialLibraryEmpty: '暂无素材，请前往素材管理上传',
      materialLibraryLoading: '加载中...',
      materialLibrarySearchPlaceholder: '搜索素材名称',
      materialLibraryPage: '第 {page}/{total} 页',
      materialLibraryLoginRequired: '请先登录以查看素材库',
      materialLibraryError: '加载失败，点击重试',
      referencePickerStoryboardPack: '分镜包',
      referencePickerCharacterPack: '人物包',
      referencePickerLocalUpload: '本地上传',
      referencePickerScenePack: '场景包',
      referencePickerLoading: '加载中…',
      referencePickerEmpty: '暂无可用包',
      referencePickerLoadFailed: '加载失败',
      referencePickerSelectPackHint: '选择一个包查看帧',
      referencePickerClear: '清除',
      mentionSelectImage: '选择参考图关联',
      mentionRefImages: '参考图',
      mentionAddRef: '添加更多',
      gridPackOriginal: '原图（3×3 合成）',
      gridPackCroppedFrames: '裁切帧',
      frames: '帧',
      generating: '生成中...',
      fluxGenerating: 'FLUX生成中...',
      aiVideoGeneration: 'AI视频生成',
      kenBurnsZoomIn: 'Ken Burns - 放大',
      kenBurnsZoomInDesc: '逐渐放大到设置的聚焦位置（稳定渐变效果）',
      kenBurnsZoomOut: 'Ken Burns - 缩小',
      kenBurnsZoomOutDesc: '从放大状态缩小到正常大小（稳定渐变效果）',
      menuMaterialManagement: '素材管理',
      clearAllMaterials: '清除所有素材',
      clearAllConfirmTitle: '清除所有素材',
      clearAllConfirmMessage: '确定要清除所有 {count} 个素材吗？此操作不可撤销。',
      clearAllSuccess: '已清除所有素材',
      noMaterialsToClear: '没有可清除的素材',
      clearAllPartialFail: '部分素材包删除失败（{failed} 项），请稍后重试',
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
        importProject: '导入项目文件',
        exportJson: '导出为JSON',
        exportingJson: '导出中...',
        extractingSubtitles: '提取字幕中...',
        invalidJsonFile: '请选择JSON格式的项目文件',
        volumeControl: '音量控制',
        trackVolumeControl: '{type}音量控制 ({volume}%)',
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
        addImageTrack: '添加图片轨道',
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
        selectAllEmptyHint: '轨道为空。',
        editSubtitles: '编辑字幕',
        editSubtitlesHint: '请先在该轨道上添加字幕素材。',
        trackLocked: '轨道已锁定',
        selected: '已选中',
        removeTrack: '删除轨道',
        removeTrackConfirm: '该轨道中存在素材，确定要删除吗？所有素材将被一并删除。',
        removeTrackLast: '无法删除最后一条轨道。',
        removeTrackLastOfGroup: '无法删除最后一条{group}。',
        dropVideoHere: '拖拽视频素材到此轨道',
        dropImageHere: '拖拽图片素材到此轨道',
        dropAudioHere: '拖拽音频素材到此轨道',
        dropSubtitleHere: '拖拽字幕素材到此轨道',
        dropToTrack: '放置到 {trackName}',
        copyOf: '{name} (副本)',
        noTracks: '暂无轨道',
        noTracksDescription: '开始创建您的第一个轨道，添加视频、音频或字幕素材',
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
          organizeMaterialsNoItems: '暂无素材可整理',
          featureComingSoon: '该功能即将推出',
          effectsRequireSelection: '请先在时间轴上选中片段，再添加特效。（功能开发中）',
          transitionsRequireSelection: '请先选中两段相邻片段，再添加转场。（功能开发中）',
          exportJsonSuccess: '时间轴数据已成功导出为JSON文件: {filename}',
          exportJsonError: '时间轴数据导出失败: {error}',
          exportInvalidTimelineState: '无效的时间轴状态数据',
          exportInvalidMaterials: '无效的素材数据',
          exportUnknownError: '未知错误',
          organizeMaterialsDescription: '整理轨道中素材，去除间隙',
          importProjectSuccess: '项目文件导入成功！导入了 {trackCount} 个轨道和 {materialCount} 个素材。',
          importProjectError: '项目导入失败: {error}',
          importProjectInvalidData: '导入数据格式不正确',
          batchTranscriptionRequestFailed: '批量转录请求失败: {status}',
          batchTranscriptionFailed: '批量转录失败: {error}',
          subtitleExtractionUnknownError: '未知错误',
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
      ruler: {
        zoomIn: '放大',
        zoomOut: '缩小',
        resetZoom: '重置缩放',
        timelineTooltip: '时间轴',
        playing: '播放中',
        scrubAriaLabel: '时间轴播放头滑块',
        resetZoomAriaLabel: '重置缩放，当前 {percent}%',
      },
      sentenceSegment: {
        sentence: '句子 {order}',
        timeLabel: '时间: ',
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
      officialLibrary: '官方视频库',
      youtubeLibrary: 'Youtube视频库',
      youtubeSearchPlaceholder: '搜索Youtube视频，如：自然风景、城市夜景、延时摄影...',
      durationLabel: '时长:',
      durationUnder1: '1分钟内',
      durationUnder3: '3分钟内',
      durationUnder5: '5分钟内',
      durationUnder10: '10分钟内',
      durationCustom: '自定义',
      durationMinPlaceholder: '最小秒数',
      durationMaxPlaceholder: '最大秒数',
      seconds: '秒',
      videoPreview: '视频预览',
      channel: '频道:',
      searchResults: '搜索结果',
      resultsInfo: '找到 {count} 个{libraryType}视频，已选择 {selected} 个',
      pageInfo: '第 {current} / {total} 页',
      searchingLibrary: '正在搜索{libraryType}视频...',
      startSearchLibrary: '开始搜索{libraryType}视频',
      searchHint: '输入关键词并点击搜索按钮',
      added: '已添加',
      addToComposition: '添加合成',
      prevPage: '上一页',
      nextPage: '下一页',
      noPreview: '无预览视频',
      itemsUnit: '个',
      noSelectionHint: '点击"添加合成"按钮选择视频',
      validationErrorHint: '请选择更多视频或时长更长的视频素材。',
      views: '次观看',
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
        seekAriaLabel: '视频进度条',
        volumeAriaLabel: '音量',
        mute: '静音',
        unmute: '取消静音',
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
        selected: '已选中',
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
      noContentToExportFull: '没有视频内容可导出，请先添加视频素材到时间轴',
      videoTrackTooShort: '视频轨道长度不足！',
      videoTrackDuration: '视频轨道时长',
      audioTrackDuration: '音频轨道时长',
      needToAdd: '需要增加的视频内容。',
      exportCompletedButDownloadFailed: '视频导出已完成但下载失败。请刷新页面后重试，或联系技术支持。',
      exportTimeout: '视频导出超时：处理时间超过10分钟限制。请尝试减少视频时长或复杂度，降低输出分辨率，或稍后重试。',
      exportFailed: '视频导出失败',
      exportFailedWithError: '视频导出失败：',
      failedVideos: '失败的视频：',
      recoverySuggestions: '建议解决方案：',
    },
    videoSearch: {
      enterKeyword: '请输入搜索关键词',
      searchFailed: '搜索失败，请稍后重试',
      networkError: '搜索失败，请检查网络连接',
      selectVideoFirst: '请先选择要添加的视频',
      selectYoutubeVideoFirst: '请先选择要添加的Youtube视频',
      videoDurationValidationFailed: '当前所有添加的视频总长度必须大于语音段落的时间长度，请继续添加视频',
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
         aiGenerate: 'AI 生成',
         generating: '生成中...',
         selectStoryboardPack: '请选择一个分镜包开始',
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
        deleteSegment: '删除段落',
        convertAllSpeech: '统一转换所有语音',
        aiStoryboard: 'AI分镜',
        aiMatchVideo: 'AI匹配视频',
        aiMatching: 'AI匹配中...',
        aiMatchNotConfigured: 'AI匹配功能未配置',
        noAvailableAnalyzedVideos: '没有可用的已解析视频（可能已被其他段落使用）',
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
       narration: {
         label: '解说文案',
         editTooltip: '编辑解说文案',
       },
       video: {
         associatedVideos: '关联视频',
         loadingFailed: '加载失败',
         browserNotSupported: '您的浏览器不支持视频播放。',
         seconds: 's',
         duration: '时长',
         loading: '加载中...',
         checkNetwork: '请检查网络连接或视频URL',
         retry: '重试',
         multipleVideos: '多个',
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
         sentenceDeleteFailed: '删除句子失败',
         sentenceAddFailed: '添加句子失败',
         speechConvertFailed: '语音转换失败: {error}',
         subtitleRecognitionFailed: '字幕识别失败',
       },
       messages: {
         segmentDeleted: '段落"{title}"已删除',
         sentenceDeleted: '句子删除成功',
         sentenceAdded: '句子添加成功',
         speechConvertComplete: '语音转换完成！成功转换 {success}/{total} 个句子，总时长 {duration}秒',
         confirmDeleteSegment: '确定要删除段落"{title}"吗？此操作不可撤销。',
         newSentencePlaceholder: '请输入新的句子内容...',
         confirmDelete: '删除',
         cancelDelete: '取消',
         speechConvertDescription: '由段落{index}"{title}"的{count}个句子并发转换并拼接生成的语音',
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
          modeKeyframe: '首尾帧生成',
          modeReference: '参考图生成',
          firstFrameImage: '首帧图片',
          firstFrameRequired: '*必填',
          lastFrameImage: '尾帧图片',
          lastFrameOptional: '(可选)',
          firstFrameMissing: '请先上传首帧图片',
          invalidImageUrl: '请输入有效的 HTTP/HTTPS 链接',
           referenceImage1: '参考图1',
           referenceImage2: '参考图2',
           referenceImage3: '参考图3',
           referenceImage4: '参考图4',
           referenceImageMissing: '请先上传参考图片',
         durationLabel: '时长:',
         expandScript: 'AI 扩写',
         expandingScript: '扩写中...',
         generateScript: 'AI 生成',
         autoTransition: '自动衔接',
         autoTransitionHint: '自动使用上一个视频的末尾帧作为当前视频的首帧',
         previousVideoNotGenerated: '请先生成前一个场景的视频',
         extractingFrame: '正在提取帧...',
         autoTransitionMode: '自动衔接',
         modalTitle: 'AI 视频生成',
         modalSubtitle: 'Seedance \u00b7 字节跳动 Ark 平台',
         promptLabel: '提示词',
         promptPlaceholder: '描述你想要生成的视频内容，例如：一只猫咪在阳光下玩耍，镜头缓缓移动...',
         durationSeconds: '秒',
         aspectRatioLabel: '视频比例',
         landscape: '横屏',
         portrait: '竖屏',
         square: '方形',
         advancedOptions: '高级选项',
         fixedCamera: '固定镜头',
         fixedCameraDesc: '锁定镜头位置，减少镜头移动',
         addWatermark: '添加水印',
         addWatermarkDesc: '在生成视频上添加平台水印',
         resolutionLabel: '分辨率',
         startGenerate: '开始生成',
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
    storyboardScriptTab: {
      selectStoryboardPack: '请选择一个分镜包开始',
      selectStoryboardPackHint: '在上方下拉菜单中选择已生成的分镜包',
      generateSingleVideo: '生成视频',
      generateMultiple: '生成 {count} 个候选视频',
      selectVideo: '选择此视频',
      candidates: '候选视频',
      batchGenerateMultiple: '批量多视频生成',
      videoCount: '数量',
      candidateGenerating: '生成中',
      candidateSucceeded: '已完成',
      candidateFailed: '失败',
      expandTitle: 'AI 扩展描述',
      expandGoalPlaceholder: '输入扩展目标（可选）...',
      expandGoalHint: '留空则默认扩展，也可以指定方向，如：增加环境细节描写、强调人物情绪等。',
      expandStart: '开始扩展',
      expandCancel: '取消',
      queued: '排队中',
      queuedPosition: '位置',
      generationTimeout: '生成超时',
      noPacks: '暂无分镜包',
      selectPackPlaceholder: '选择分镜包...',
      packInfoFrames: '{frames}帧',
      packInfoSeparator: ' - ',
      refreshPackList: '刷新分镜包列表',
      segmentLabel: '分镜 #',
      describingTitle: '正在生成描述...',
      describeAllTitle: '为所有分镜帧生成AI描述',
      describing: '生成中...',
      describeAll: '生成描述',
      generatingInProgress: '有视频正在生成中',
      allVideosGenerated: '所有视频已生成',
      batchGenerateAll: '一键批量生成所有未生成的视频',
      batchGenerate: '一键批量生成',
      generateAllVideosFirst: '请先生成所有分镜视频',
      composing: '正在合成...',
      composeAllVideos: '一键合成所有分镜视频',
      composeVideo: '一键合成视频',
      loadingPack: '正在加载分镜包...',
      describingFrames: '正在为分镜帧生成描述...',
      composeFailed: '合成失败: ',
      retry: '重试',
      addFrame: '添加帧',
      generatedStatus: '已生成 {completed}/{total} 个视频',
      estimatedDuration: '预计总时长: {duration}s',
      confirmDelete: '确认删除',
      deleteConfirmMessage: '确定要删除此分镜帧吗？已生成的视频不会从素材面板中移除。',
      cancel: '取消',
      delete: '删除',
    },
    storyboardPreviewPanel: {
      title: '分镜预览',
      gridSize: '宫格尺寸',
      aspectRatio: '画面比例',
      totalFrames: '总帧数',
      hint: '点击"下一步"为每一格生成剧本。',
      ariaLabel: '{aspectRatio} 分镜预览，{rows}×{cols} 共 {frameCount} 格',
    },
   welcomeGuide: {
     title: 'AI视频编辑助手',
     descriptionWithMaterials: '试试下面的操作，或直接输入你的指令',
     descriptionWithoutMaterials: '点击建议开始，或直接输入你想做的事情',
     trimFirst: '裁剪第一个视频的前5秒',
     addMusic: '添加一段轻快的背景音乐',
     generateSubtitles: '为所有片段生成字幕',
     adjustVolume: '把第二个片段的音量调低50%',
     searchNature: '帮我搜索一些自然风光的视频素材',
     generateAiVideo: '生成一段科技感的AI视频',
     createScript: '创建一个产品展示的视频脚本',
     searchMusic: '帮我搜索轻快的背景音乐',
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
      inputAriaLabel: '视频编辑对话输入框',
      agentWorkingPlaceholder: 'Agent 正在执行...',
      agentUndoButton: '撤销',
      agentUndoneLabel: '操作已撤销',
      agentOperations: '个操作',
      thinkingInProgress: '思考中...',
      thinkingComplete: '思考过程',
      aiAnalyzingLabel: 'AI 分析中...',
    },
    workflowChat: {
      title: '工作流助手',
      subtitle: '与工作流实时交互',
      inputPlaceholder: '输入消息以启动工作流... (Shift+Enter 换行)',
      send: '发送',
      stop: '停止',
      clearChat: '清空聊天记录',
      clearChatConfirm: '确定要清空所有聊天记录吗？此操作不可撤销。',
      clearContext: '清空上下文',
      clearContextConfirm: '确定要清空当前工作流的上下文吗？聊天记录将保留。',
      clearContextTooltip: '清空上下文，保留聊天记录',
      startConversation: '开始对话',
      startConversationDesc: '发送消息以启动工作流，我会实时显示执行过程和结果',
      running: '执行中',
      finalResult: '最终结果',
      exportMaterials: '导出剪辑 ({count} 个视频素材)',
      exportMaterialsHint: '点击将视频素材导入到 Video Editing 任务的素材管理面板',
      goToVideoResult: '前往Video Editing查看结果',
      workflowExecuting: '工作流正在执行中...',
      inputHint: '按 Enter 发送，Shift + Enter 换行',
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
      messagesLabel: '条消息',
      replying: '回复中',
      clearChatTooltip: '清空聊天记录',
      sendMessageTooltip: '发送消息',
      aiReplying: 'AI 正在回复中...',
      enterToSendHint: '按 Enter 发送，Shift + Enter 换行',
      conversationList: {
        heading: '对话列表',
        newChat: '新对话',
        noConversations: '暂无对话',
        startNewChat: '开始新对话',
        chatbot: '聊天机器人',
        aiAgent: 'AI 代理',
        messages: '{count} 条消息',
      },
      chatTypeModal: {
        title: '新对话',
        subtitle: '选择聊天类型开始',
        chatbotTab: '聊天机器人',
        workflowTab: '工作流',
        agentTab: '智能体',
        basicChatbot: '基础聊天机器人',
        chatbotDesc: '与基础AI聊天机器人对话。适合快速提问和日常讨论。',
        startChatbot: '开始聊天机器人对话',
        fastResponse: '快速响应',
        quickAnswers: '快速回答',
        naturalChat: '自然对话',
        conversational: '对话式交流',
        easyToUse: '简单易用',
        noSetupNeeded: '无需设置',
        loadingWorkflows: '加载工作流中...',
        failedToLoadWorkflows: '加载工作流失败',
        retry: '重试',
        noWorkflows: '暂无可用工作流',
        createWorkflowFirst: '请先在工作流任务中创建工作流，然后开始新对话',
        active: '活跃',
        nodes: '个节点',
        aiAgentTitle: 'AI 智能体',
        agentDesc: '具有高级功能的智能代理。此功能即将推出。',
        comingSoon: '即将推出',
        taskPlanning: '任务规划',
        multiStepTasks: '多步骤任务',
        webSearch: '网页搜索',
        realtimeInfo: '实时信息',
        codeExecution: '代码执行',
        runCodeSafely: '安全运行代码',
        cancel: '取消',
        workflowsAvailable: '{count} 个工作流可用',
      },
    },
    videoProcessing: {
      tab: '切气口',
      buttons: {
        close: '关闭',
        next: '下一步',
        back: '上一步',
        done: '完成',
        return: '返回',
        minimize: '最小化',
        cancel: '取消',
        retry: '重试',
        startProcessing: '开始处理',
        redetect: '重新检测',
        restored: '点击恢复弹窗',
      },
      presets: {
        loose: '宽松',
        standard: '标准',
        aggressive: '激进',
        custom: '自定义',
      },
      selectVideo: {
        heading: '选择视频',
        description: '选择一个需要处理的口播视频（最长30分钟）',
        noVideos: '暂无视频素材',
        noVideosHint: '请先上传视频素材到素材面板',
        tooLong: '超过30分钟',
      },
      params: {
        detectionPreset: '检测预设',
        volumeThreshold: '音量阈值: {value} dB',
        volumeThresholdHint: '低于此值视为静音',
        minSilenceDuration: '最小静音时长: {value} ms',
        minSilenceHint: '低于此值的短暂停顿将被忽略',
        preservedGap: '保留间隔: {value} ms',
        preservedGapHint: '每个静音段首尾保留的过渡间隔',
      },
      stats: {
        originalDuration: '原时长',
        newDuration: '新时长',
        removedSegments: '移除静音段',
        segments: '段',
        savedTime: '节省时间',
        saved: '节省',
        estimatedNewDuration: '预计新时长',
      },
      progress: {
        preparing: '准备中...',
        processing: '处理中...',
        completed: '处理完成',
        failed: '处理失败',
        detecting: '检测中...',
        detectSilence: '检测静音段',
        networkError: '网络异常',
        networkErrorMsg: '无法连接服务器，请检查网络后重试',
        timeout: '处理超时',
        timeoutMsg: '已等待超过30分钟，后端任务可能仍在运行。请稍后检查素材面板。',
        estimatedRemaining: '预计剩余',
      },
      errors: {
        detectionFailed: '检测失败 ({status})',
        detectionFailedShort: '检测失败',
        detectionError: '检测静音段失败',
        processFailed: '处理请求失败 ({status})',
        processFailedShort: '处理请求失败',
        submitFailed: '提交处理请求失败',
        unknownError: '未知错误',
        queryFailed: '查询进度失败 ({status})',
        queryFailedShort: '查询进度失败',
      },
      segments: {
        empty: '未检测到静音段',
        total: '共 {count} 个静音段',
        segmentsUnit: '段',
        selected: '已选 {count} 个',
        canSave: '可节省 {time} 秒',
        selectAll: '全选',
        deselectAll: '全不选',
        invertSelection: '反选',
        playContext: '试听该段前后上下文',
      },
      waveform: {
        pause: '暂停',
        play: '播放',
        previewEffect: '试听整体效果（跳过已选静音段）',
        stopPreview: '停止预览',
        preview: '试听效果',
        zoomHint: 'Ctrl+滚轮缩放，双击区域自适应缩放',
      },
      duration: {
        minutes: '分',
        seconds: '秒',
      },
    },
    workflowNodes: {
      ports: {
        input: '输入',
        output: '输出',
        keywords: '关键词',
        results: '结果',
        arrayInput: '数组输入',
        combined: '合并结果',
        array: '数组',
        videos: '视频',
        materials: '素材',
        textInput: '文本输入',
        audioOutput: '音频输出',
        timeline: '时间线',
        copy: '文案',
        video: '视频',
        audio: '音频',
        image: '图片',
      },
      tooltips: {
        configured: '已配置',
        deleteNode: '删除节点',
        inputPort: '输入端口',
        outputPort: '输出端口',
      },
      status: {
        configured: '已配置',
        notSet: '未设置',
        notSelected: '未选择',
        ready: '就绪',
        success: '成功',
        failed: '失败',
        notConfigured: '未配置',
        noContent: '暂无内容',
        doubleClickToConfigure: '双击以配置',
        doubleClickForFullContent: '双击查看完整内容',
        model: '模型',
        temperature: '温度',
        systemPrompt: '系统提示词',
        keywords: '关键词',
        count: '数量',
        voice: '音色',
        text: '文本',
        content: '内容',
        format: '格式',
        statusLabel: '状态',
        videoUrls: '视频链接',
        moreCount: '更多...',
        exportToMaterials: '导出到素材',
        exportVideos: '导出视频',
        inputType: '输入类型',
        arrayBadge: '数组[]',
        schema: '结构',
        schemaDefined: '已定义',
        combinesStandardizes: '合并与标准化',
        combinesResults: '合并结果',
        transformPrompt: '转换提示词',
        conversionPrompt: '转换提示词',
        fields: '字段',
        fieldsCount: '{count} 个字段',
        outputsArray: '输出数组',
        typeLabel: '类型',
        workflowStartPoint: '工作流起点',
        workflowEndPoint: '工作流终点',
      },
      aiVideo: {
        inputs: '输入',
        status: '状态',
        lastRun: '上次运行',
        error: '错误',
        prompt: '提示词',
        notConfigured: '未配置',
        doubleClickConfigure: '双击进行配置',
      },
      execution: {
        title: '执行过程',
        progress: '进度',
        noNodes: '暂无执行节点',
        waiting: '等待中',
        executing: '执行中',
        completed: '已完成',
        failed: '失败',
        executionTime: '执行时间',
        systemPrompt: '系统提示词',
        userInput: 'Prompt（用户输入）',
        modelReply: '模型回复',
        input: '输入',
        output: '输出',
        error: '错误',
      },
      editor: {
        noWorkflowSelected: '未选择工作流',
        selectWorkflowPrompt: '从侧边栏选择一个工作流开始编辑',
        newWorkflowDefaultName: '搜索聊天代理',
        newWorkflowDescription: '用于搜索和聊天的AI代理',
      },
      configPanels: {
        volcanoTTS: {
          title: '火山TTS配置',
          nodeId: '节点ID',
          dataFormat: '数据格式',
          inputFormat: '输入格式',
          outputFormat: '输出格式',
          inputFormatHelp: '从前一个节点接收的数据格式。',
          outputFormatHelp: '发送到下一个节点的数据格式。',
          language: '语言',
          chinese: '中文',
          english: '英文',
          voiceType: '音色类型',
          loadingVoices: '正在加载音色...',
          speedRatio: '语速',
          slower: '0.5x (较慢)',
          normal: '1.0x (正常)',
          faster: '2.0x (较快)',
          textContent: '文本内容',
          clear: '清空',
          placeholder: '输入要转换为语音的文本...',
          characters: '字符',
          words: '词',
          hasContent: '已有内容',
          empty: '空',
          audioPreview: '音频预览',
          pause: '暂停',
          playAudio: '播放音频',
          download: '下载',
          downloadAudio: '下载音频',
          howToUse: '使用说明',
          howToUseSteps: [
            '从列表中选择您喜欢的音色',
            '输入要转换为语音的文本',
            '如需调整语速 (0.5x - 2.0x)',
            '使用测试面板预览音频',
            '将输出连接到其他节点以使用生成的音频',
          ],
          cancel: '取消',
          save: '保存配置',
          saving: '保存中...',
        },
        aiVideoGenerate: {
          title: 'AI视频生成配置',
          subtitle: '配置输入和参数',
          inputConfiguration: '输入配置',
          llmSettings: 'LLM设置',
          executionResults: '执行结果',
          inputConfigDesc: '配置可选输入。每个输入支持字符串、JSON或数组格式。',
          textInput: '文案输入',
          videoInput: '视频输入',
          audioInput: '音频输入',
          imageInput: '图片输入',
          enterTextPlaceholder: '输入文本内容、JSON对象或数组...',
          enterVideoPlaceholder: '输入视频URL、JSON对象或数组...',
          enterAudioPlaceholder: '输入音频URL、JSON对象或数组...',
          enterImagePlaceholder: '输入图片URL、JSON对象或数组...',
          stringFormat: '字符串',
          jsonFormat: 'JSON',
          arrayFormat: '数组',
          llmConfigDesc: '配置LLM参数。使用后端环境的VIDEO_CUT_LLM。',
          systemPrompt: '系统提示词（可选）',
          systemPromptPlaceholder: '覆盖默认的视频时间轴生成系统提示词...',
          temperature: '温度',
          temperatureHint: '较低的值使输出更加集中和确定',
          maxTokens: '最大令牌数',
          llmInfoTitle: 'LLM配置',
          llmInfoDesc: '此节点使用后端环境配置的VIDEO_CUT_LLM（与AI混剪相同）。LLM将合并所有输入并生成视频编辑格式的时间轴JSON。',
          executionSuccessful: '执行成功',
          executionFailed: '执行失败',
          lastExecuted: '上次执行',
          errorMessage: '错误信息',
          executionResult: '执行结果（时间轴JSON）',
          noResultsYet: '暂无执行结果。运行工作流以查看结果。',
          cancel: '取消',
          saveConfiguration: '保存配置',
        },
      },
    },
    mediaPreview: {
      zoomOut: '缩小 (-)',
      zoomIn: '放大 (+)',
      reset: '重置 (0)',
      pause: '暂停 (空格)',
      play: '播放 (空格)',
      close: '关闭 (ESC)',
      imageShortcuts: '快捷键:',
      imageShortcutsZoom: '+/-',
      imageShortcutsReset: '0',
      imageShortcutsClose: 'ESC',
      imageMouseWheel: '滚轮',
      imageMouseDrag: '拖拽',
      mediaShortcutsSpace: '空格',
      mediaShortcutsClose: 'ESC',
      imageShortcutsLine1: '快捷键: +/- 缩放 | 0 重置 | ESC 关闭',
      imageShortcutsLine2: '鼠标: 滚轮 缩放 | 拖拽 移动图片',
      mediaShortcutsLine: '快捷键: 空格 播放/暂停 | ESC 关闭',
    },
    storyboardPack: {
      defaultTitle: '分镜包',
      frames: '帧',
      close: '关闭',
      originalImage: '原始分镜大图',
      noFrames: '暂无帧数据',
      frame: '帧',
      position: '位置',
      row: '行',
      column: '列',
      noDescription: '未生成描述',
      deletePack: '删除分镜包',
      addToMaterials: '全部添加到素材',
      useInScript: '在分镜脚本中使用',
      materials: '素材',
      prompt: '提示词',
      gridSizeLabel: '宫格规格',
      frameCountLabel: '帧数',
      gridWillGenerate: '将生成 {rows}x{cols} = {total} 格分镜',
      gridWillUse: '将生成 {rows}x{cols} = {total} 格，使用前 {value} 帧',
    },
    mobileWarning: {
      tablet: '平板设备',
      mobile: '手机设备',
      mobileDevice: '移动设备',
      title: '暂不支持{device}',
      description: '为了提供更好的使用体验，请在电脑上访问本应用。',
      useDesktop: '建议使用电脑访问',
    },
    gridSizeSelector: {
      frameCount: '分镜数量',
      gridLabel: '格',
      custom: '自定义',
      placeholder: '输入分镜数量 (1-64)',
      willGenerate: '将生成 {rows}x{cols} = {total} 格分镜',
      willUse: '将生成 {rows}x{cols} = {total} 格，使用前 {value} 帧',
    },
    creativeBrainstorming: {
      inputPlaceholder: '输入您的想法或问题...',
      sendHint: '按 Enter 发送，Shift+Enter 换行',
    },
    audioSearchModal: {
      title: '搜索音频',
      searchPlaceholder: '输入音频搜索关键词，如：ambient music, nature sounds...',
      searchButton: '搜索',
      searching: '搜索中...',
      audioTypeLabel: '音频类型：',
      audioTypeAll: '全部',
      audioTypeMusic: '音乐',
      audioTypeSoundEffect: '音效',
      audioTypeSpeech: '语音',
      audioTypeAmbient: '环境音',
      audioTypeNature: '自然音',
      sortByLabel: '排序方式：',
      sortByScore: '相关度',
      sortByDownloads: '热度(下载量)',
      sortByRating: '评分',
      sortByDurationDesc: '时长(长到短)',
      sortByDurationAsc: '时长(短到长)',
      sortByCreatedDesc: '最新',
      sortByCreatedAsc: '最早',
      durationFilterLabel: '时长过滤：',
      durationMinPlaceholder: '最小(秒)',
      durationMaxPlaceholder: '最大(秒)',
      durationTo: '至',
      resultsTitle: '搜索结果',
      resultsCount: '({count} 个音频)',
      selectedCount: '已选择: {count}',
      clearSelection: '清空选择',
      noResults: '未找到相关音频',
      noResultsHint: '尝试使用不同的关键词或调整过滤器',
      noQueryTitle: '输入关键词开始搜索音频',
      noQueryHint: '支持搜索环境音、音效、音乐等各类音频',
      previewTitle: '音频预览',
      descriptionLabel: '描述',
      audioInfoLabel: '音频信息',
      durationLabel: '时长:',
      licenseLabel: '许可证:',
      sizeLabel: '大小:',
      formatLabel: '格式:',
      channelsLabel: '声道',
      sampleRateLabel: '采样率:',
      tagsLabel: '标签',
      addingAudios: '正在添加 {count} 个音频，请稍候...',
      addedCount: '已选择 {count} 个音频',
      cancelButton: '取消',
      addingButton: '正在添加...',
      addSelectedButton: '添加选中音频 ({count})',
    },
    imageSearchModal: {
      title: '搜索图片',
      searchPlaceholder: '输入搜索关键词，如：风景、人物、建筑...',
      searchButton: '搜索',
      searching: '搜索中...',
      orientationLabel: '方向:',
      orientationAll: '全部',
      orientationLandscape: '横向',
      orientationPortrait: '纵向',
      orientationSquarish: '方形',
      colorLabel: '颜色:',
      colorAll: '全部',
      colorBlackAndWhite: '黑白',
      colorBlack: '黑色',
      colorWhite: '白色',
      colorYellow: '黄色',
      colorOrange: '橙色',
      colorRed: '红色',
      colorPurple: '紫色',
      colorMagenta: '洋红',
      colorGreen: '绿色',
      colorTeal: '青色',
      colorBlue: '蓝色',
      orderByLabel: '排序:',
      orderByRelevant: '相关度',
      orderByLatest: '最新',
      orderByPopular: '热门',
      selectedCount: '已选择 {count} 张图片',
      clearSelection: '清空选择',
      addingImages: '添加中...',
      addSelectedButton: '添加选中图片 ({count})',
      deselect: '取消选择',
      select: '选择',
      addToMaterials: '添加到素材',
      noDescription: '无描述',
      noResultsTitle: '暂无搜索结果',
      noResultsHint: '输入关键词开始搜索图片',
      imagePreview: '图片预览',
      prevPage: '上一页',
      nextPage: '下一页',
      pageInfo: '第 {current} 页，共 {total} 页',
    },
    aiImageModal: {
      title: 'AI 图像生成',
      subtitle: 'Seedream · 字节跳动 Ark 平台',
      tabBasic: '基础生成',
      tabCharacter: '人物建模',
      tabScene: '场景建模',
      tabStoryboard: '分镜生成',
      cancelButton: '取消',
      generatingButton: '生成中...',
      generateButton: '开始生成',
    },
    basicGenerationTab: {
      promptLabel: '提示词',
      promptPlaceholder: '描述你想要生成的图片内容... 从右侧选择参考图，或直接在提示词中输入 @[图片名] 引用',
      sizeLabel: '图片尺寸',
      size1kSquare: '1K 方形',
      size2kSquare: '2K 方形',
      size169Landscape: '16:9 横屏',
      size916Portrait: '9:16 竖屏',
      size169Wide: '16:9 宽屏',
      size916Wide: '9:16 竖屏宽',
      countLabel: '生成数量',
      countUnit: '张',
      watermarkLabel: '添加水印',
      watermarkDesc: '在生成图片上添加平台水印',
    },
    storyboardTab: {
      aspectRatioLabel: '画面比例',
      aspectRatio11: '1:1 方形',
      aspectRatio169: '16:9 横屏',
      aspectRatio916: '9:16 竖屏',
      aspectRatio43: '4:3 横屏',
      aspectRatio34: '3:4 竖屏',
      promptLabel: '提示词',
      promptPlaceholder: '描述您想要生成的分镜内容... 输入 @ 关联参考图',
      settingsTitle: '分镜设置',
      settingsLocked: '已锁定',
      scriptPreviewLabel: '剧本预览（共 {count} 幕）',
      languageLabel: '{lang}',
      backToInput: '← 返回修改输入',
      shotNumber: '第 {number} 幕',
      shotPlaceholder: '第 {number} 幕剧本...',
      emptyScript: '剧本为空，请返回上一步重新生成',
      chatTitle: '与 AI 对话修改剧本',
      chatYou: '你：',
      chatAI: 'AI：',
      chatPlaceholder: '例如：把第 3 幕改为夜晚雨天',
      chatSend: '发送',
      confirmGenerate: '确认并生成分镜',
      scriptMinLengthHint: '请确保所有剧本不少于 5 个字符',
      nextStepGenerate: '下一步：生成分镜剧本',
      generatingScript: '正在生成剧本...',
      scriptInfo: '将先生成 {count} 幕剧本供确认，画面比例 {ratio}（语言：{lang}）',
      advancedOptions: '高级选项',
      skipScript: '跳过剧本，直接生成分镜（旧流程）',
      generatingFrames: '正在生成 {count} 格分镜...',
      generatingFramesDesc: 'AI 正在根据剧本绘制并自动裁剪',
      croppedFrames: '已裁剪为 {count} 张分镜，并绑定剧本',
      gridLabel: '宫格:',
      generateNew: '继续生成新分镜',
      retryButton: '重试',
      scriptGenerateFailed: '剧本生成失败',
      scriptReviseFailed: '剧本修改失败',
      scriptUpdated: '已更新剧本（{count} 幕）。',
      backConfirm: '返回修改输入将清空当前剧本草稿，是否继续？',
      generateFailed: '分镜生成失败，请重试',
      storyboardImageAlt: '分镜大图',
    },
    gridSizeSelectorTab: {
      frameCountLabel: '分镜数量',
      gridUnit: '格',
      custom: '自定义',
      placeholder: '输入分镜数量 (1-64)',
      willGenerate: '将生成 {rows}x{cols} = {total} 格分镜',
      willUse: '将生成 {rows}x{cols} = {total} 格，使用前 {value} 帧',
    },
    videoAnalysisModal: {
      title: 'AI视频解析结果',
      subtitle: '智能分析视频内容',
      closeTooltip: '关闭',
      videoDuration: '视频时长',
      framesExtracted: '提取帧数',
      processingTime: '处理时间',
      analysisTime: '分析时间',
      frameAnalysisTitle: '逐帧分析结果',
      frameLabel: '第{number}帧',
      timePoint: '时间点',
      summaryTitle: '分析总结',
      errorTitle: '解析失败',
      errorDefaultMessage: '视频解析过程中出现错误',
      closeButton: '关闭',
      loadingTitle: '正在加载解析结果',
      loadingDesc: '请稍候...',
      videoLabel: '视频:',
      secondsUnit: '秒',
      framesUnit: '帧',
    },
    videoScriptProgressModal: {
      titleWithVideo: '视频理解生成脚本',
      titleWithoutVideo: '生成脚本',
      stepPreparing: '准备中...',
      stepAnalyzing: '正在分析视频内容...',
      stepGenerating: '正在生成脚本...',
      stepProcessing: '处理中...',
      descAnalyzing: '正在分析视频 ({analyzed}/{total})',
      descGeneratingWithVideo: '基于视频分析结果生成脚本内容',
      descGeneratingWithoutVideo: '基于对话内容生成脚本',
      descPleaseWait: '请稍候...',
      analyzingVideo: '正在分析: {name}',
      statCompleted: '已完成',
      statProcessing: '处理中',
      statFailed: '失败',
      errorTitle: '处理过程中遇到问题',
      cancelButton: '取消',
    },
    videoCacheIndicator: {
      loading: '预加载中...',
      loaded: '已缓存',
      error: '加载失败',
      notCached: '未缓存',
    },
    chatMessageBubble: {
      thinking: '思考中...',
      thoughtProcess: '思考过程',
      analyzingIntent: '正在分析意图',
      detectingWorkflow: '检测您的问题是否需要调用工作流...',
      willCallWorkflow: '将调用工作流: {name}',
      normalChat: '普通对话',
      copiedTitle: '已复制!',
      copyMessageTitle: '复制消息',
      convertToScriptTitle: '转换视频脚本',
      generating: '生成中',
      copied: '已复制',
    },
    chatWorkflowExecution: {
      finalResult: '最终结果',
      copiedTitle: '已复制!',
      copyTitle: '复制最终结果',
      convertToScriptTitle: '转换视频脚本',
      exportClip: '导出剪辑 ({count} 个视频素材)',
      exportClipHint: '点击将视频素材导入到 Video Editing 任务的素材管理面板',
      executing: '工作流执行中...',
    },
    chatWorkflowSelection: {
      title: '选择工作流',
      subtitle: '选择一个工作流来开始新的对话',
      loading: '加载工作流中...',
      errorTitle: '加载失败',
      retryButton: '重试',
      emptyTitle: '暂无工作流',
      emptyHint: '请先在"工作流"任务中创建工作流，然后再开始新的对话',
      activeBadge: '活跃',
      nodesLabel: '{count} 节点',
      totalWorkflows: '共 {count} 个工作流可用',
      cancelButton: '取消',
    },
    videoCut: {
      title: '剪切素材',
      timelineControl: '时间轴控制',
      selectRange: '选择范围:',
      dragGreenStart: '拖拽绿色控制条调整开始时间',
      dragRedEnd: '拖拽红色控制条调整结束时间',
      blueCurrentPos: '蓝色线条表示当前播放位置',
      setStart: '设为开始',
      setEnd: '设为结束',
      createClip: '创建切片',
      preview: '预览:',
      selectToPreview: '选择切片进行预览',
      clipList: '切片列表',
      clip: '切片',
      clipCount: '个切片',
      exportClips: '导出切片',
      noClips: '还没有创建任何切片',
      startBeforeEnd: '开始时间必须小于结束时间',
      minDuration: '切片时长至少需要0.5秒',
      clipCreated: '已创建切片：',
      clipDeleted: '切片已删除',
      noClipsToExport: '没有可导出的切片',
      noMaterial: '原始素材不存在',
      clipsExported: '已导出 ',
      exportUnavailable: '导出功能不可用',
      startTimeLabel: '开始时间:',
      endTimeLabel: '结束时间:',
    },
    convertToScript: {
      title: '生成脚本',
      subtitle: '将对话内容转换为视频脚本',
      parameterSettings: '参数设置',
      scriptLanguage: '脚本语言',
      chinese: '中文',
      english: '英文',
      mixed: '中英混合',
      segmentCount: '脚本段落数量:',
      segments: '段',
      analysisDepth: '分析深度',
      basic: '基础',
      quickGen: '快速生成',
      detailed: '详细',
      balancedQuality: '平衡质量',
      comprehensive: '全面',
      deepAnalysis: '深度分析',
      additionalOptions: '附加选项',
      includeVisual: '包含视觉元素分析',
      visualDesc: '分析视频中的场景、物体、人物等视觉信息',
      includeAudio: '包含音频分析',
      audioDesc: '分析视频中的语音、音乐、音效等音频信息',
      videoUnderstanding: '视频理解',
      enabledDesc: '已启用视频理解，选择视频后将自动分析并生成脚本',
      disabledDesc: '视频理解已关闭，将仅根据对话内容生成脚本',
      analysisMode: '分析模式',
      quickAnalysis: '快速分析',
      coverOnly: '仅分析封面',
      proAnalysis: '专业分析',
      multiFrame: '多帧深度分析',
      selectVideoDesc: '选择视频素材参与脚本生成',
      videoStatsPrefix: '共 ',
      videoStatsTotal: ' 个视频，其中 ',
      videoStatsAnalyzed: ' 个已解析，',
      videoStatsPending: ' 个待解析',
      selectedUnanalyzedPrefix: '已选中 ',
      selectedUnanalyzed: ' 个待解析视频，生成时将自动进行分析',
      noVideos: '暂无可用的视频素材',
      pleaseUpload: '请先上传或搜索视频素材',
      selectedCountPrefix: '已选 ',
      selectedCount: ' 个视频',
      selectAll: '全选',
      deselectAll: '取消全选',
      analyzed: '已解析',
      pending: '待解析',
      unknownDuration: '未知时长',
      chatPreview: '对话内容预览：',
      footerWithVideo: '将使用 {count} 个视频生成脚本',
      footerWithAnalysis: '（{count} 个需先分析）',
      footerNoVideo: '将根据对话内容生成脚本',
      generating: '生成中...',
      startGenerate: '开始生成',
    },
  },
};

export type SupportedLocale = keyof typeof translations;

export const defaultLocale: SupportedLocale = 'en';

export function getTranslations(locale: SupportedLocale = defaultLocale): Translations {
  return translations[locale] || translations[defaultLocale];
} 