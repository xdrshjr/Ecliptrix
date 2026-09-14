export interface Translations {
  common: {
    newTask: string;
    projects: string;
    library: string;
    privacy: string;
    terms: string;
    support: string;
    systemStatus: string;
    operational: string;
    close: string;
    closePanel: string;
    closeTab: string;
    cancel: string;
    confirm: string;
    colon: string;
    relativeTime: { justNow: string };
  };
  header: {
    languageSelector: string;
    english: string;
    chinese: string;
    switchToLightMode: string;
    switchToDarkMode: string;
  };
  adminSettings: {
    groupApp: string;
    groupAi: string;
    groupMedia: string;
    general: string;
    generalDesc: string;
    language: string;
    theme: string;
    lightTheme: string;
    darkTheme: string;
    autoTheme: string;
    generalAutoSaveNote: string;
    title: string;
    subtitle: string;
    inactive: string;
    edit: string;
    delete: string;
    loading: string;
    cancel: string;
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
    // Model settings quick-start empty states (desktop-config-free-startup)
    modelQuickStartTitle: string;
    modelQuickStartDesc: string;
    modelQuickStartAddProvider: string;
    modelAssignmentsNeedProvider: string;
    modelAssignmentsGoProviders: string;
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
    effectiveConfigErrorBadge: string;
    effectiveConfigErrorDesc: string;
    testConnectionFormat: string;
    modelInfo: string;
    formatUsed: string;
    providerCard: string;
    modelApiKeyRequired: string;
    modelDeleteProviderError: string;
    modelModelsFound: string;
    modelKeyNotSet: string;
    modelRequestFailed: string;
    confirmDelete: string;
    cancelDelete: string;
    deleting: string;
    saving: string;
    save: string;
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
    ttsConcurrencyInvariantError: string;
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
    wmConcurrencyInvalid: string;
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
    videoEditing: string;
    brainstormingComingSoon: string;
    aiChat: string;
    types: { video: string; chat: string };
    defaultPageTitle: string;
  };
  videoProjects: {
    closeUnsavedTitle: string;
    closeUnsavedBody: string;
    closeSaveSlowBody: string;
    keepOpen: string;
    closeAnyway: string;
    timelineRepaired: string;
    timelineUnreadable: string;
    title: string;
    projectActions: string;
    closeMenu: string;
    all: string;
    recent: string;
    uncategorized: string;
    categories: string;
    newProject: string;
    newCategory: string;
    search: string;
    searchPlaceholder: string;
    sortRecent: string;
    sortCreated: string;
    sortName: string;
    rename: string;
    moveToCategory: string;
    delete: string;
    deleteConfirmTitle: string;
    deleteConfirm: string;
    deleteCategoryConfirm: string;
    openProject: string;
    lastOpened: string;
    lastUpdated: string;
    neverOpened: string;
    emptyTitle: string;
    emptyHint: string;
    noResults: string;
    untitled: string;
    save: string;
    cancel: string;
    create: string;
    projectName: string;
    projectNamePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    categoryName: string;
    categoryNamePlaceholder: string;
    backToProjects: string;
    projectCount: string;
    categoryAll: string;
    sidebarHeading: string;
    cardsHeading: string;
    saved: string;
    saving: string;
    saveError: string;
    loadError: string;
    cover: string;
  };
  welcome: {
    title: string;
    subtitle: string;
    description: string;
    videoEditingDesc: string;
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
        motion: string;
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
      motionShortcut: string;
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
      // Round-2 client-preview local-download mask (spec §3.3.7)
      localTranscoding: string;
      localDownloading: string;
      localDownloadFailed: string;
      localWillStream: string;
    };
    messages: {
      externalUpdateRejected: string;
      splitTooCloseToEdge: string;
      incompatibleTrack: string;
      materialNotFound: string;
      noAudioItems: string;
      noSubtitleTrack: string;
      subtitleExtractionFailed: string;
      subtitleExtractionSuccess: string;
      replaceSubtitlesTitle: string;
      replaceSubtitlesBody: string;
      replaceSubtitlesConfirm: string;
      subtitleTrackLocked: string;
      editLockedByAgent: string;
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
        swapHint: string;
    };
    cameraMotion: {
      title: string;
      openPanel: string;
      clipLabel: string;
      multiSelected: string;
      applyToAllSelected: string;
      tab2d: string;
      tab3d: string;
      presetsLabel: string;
      stageTitle: string;
      intensity: string;
      intensityValue: string;
      easing: string;
      easingLinear: string;
      easingEaseIn: string;
      easingEaseOut: string;
      easingEaseInOut: string;
      range: string;
      rangeWholeClip: string;
      rangeCustom: string;
      startOffset: string;
      windowDuration: string;
      seconds: string;
      advanced: string;
      keyframeStart: string;
      keyframeEnd: string;
      fieldScale: string;
      fieldX: string;
      fieldY: string;
      fieldRoll: string;
      fieldRotateX: string;
      fieldRotateY: string;
      fieldDolly: string;
      reverse: string;
      reverseAria: string;
      apply: string;
      cancel: string;
      reset: string;
      discardConfirm: string;
      webglDegraded: string;
      qualityHintCover: string;
      qualityHintRoll: string;
      qualityHintClamped: string;
      disabledNoSelection: string;
      disabledNotVisual: string;
      disabledTrackLocked: string;
      badgeTitle: string;
      degradedBadge: string;
      degradedBadgeDismiss: string;
      stageScrub: string;
      stageScrubValue: string;
      stagePlay: string;
      stagePause: string;
      // 多关键帧曲线与舞台直接取景（camera-motion-keyframe-curves §4.5）
      keyframesLabel: string;
      keyframeStripHint: string;
      keyframeItem: string;
      keyframeItemLocked: string;
      keyframeAdd: string;
      keyframeAddBlockedOutside: string;
      keyframeAddBlockedTooClose: string;
      keyframeAddBlockedLimit: string;
      keyframeRemove: string;
      keyframeRemoveBlocked: string;
      segmentEasingAria: string;
      curveEasingNote: string;
      windowBandLabel: string;
      stageOverlayLabel: string;
      stageOverlayHint: string;
      stageDragHint: string;
      keyframeCounter: string;
      keyframeEditing: string;
      presets: {
        none: string;
        pushIn: string;
        pullOut: string;
        panLeft: string;
        panRight: string;
        panUp: string;
        panDown: string;
        zoomPanDiagonal: string;
        rollSlight: string;
        dollyIn3d: string;
        dollyOut3d: string;
        orbitLeft: string;
        orbitRight: string;
        tiltDown: string;
        tiltUp: string;
        parallaxPush: string;
        sway3d: string;
        custom: string;
      };
    };
    subtitleEditModal: {
      styleSettings: string;
      editingSingle: string;
      editingAll: string;
      applyToAll: string;
      presets: {
        default: string;
        classic: string;
        modern: string;
        elegant: string;
        tech: string;
      };
      fonts: {
        default: string;
        serif: string;
        sansSerif: string;
        monospace: string;
      };
      positions: {
        top: string;
        upper34: string;
        center: string;
        lower34: string;
        bottom: string;
      };
      closeAriaLabel: string;
      discardChangesTitle: string;
      discardChangesBody: string;
      discardChangesConfirm: string;
      noSubtitlesHint: string;
      presetsHeading: string;
      presetSample: string;
      fontFamily: string;
      fontSize: string;
      fontColor: string;
      backgroundColor: string;
      enableBackground: string;
      position: string;
      stylePreview: string;
      stylePreviewSample: string;
      contentHeading: string;
      contentHint: string;
      itemPreviewFallback: string;
      countSummary: string;
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
      durationUnit: string;
    };
  };
  materialsPanel: {
    deleteConfirmTitle: string;
    deleteConfirmBody: string;
    deleteConfirmBodyMany: string;
    deleteInUseBody: string;
    deleteInUseBodyMany: string;
    deleteBlockedLocked: string;
    deleteConfirmAction: string;
    deleteFailedClipsRemoved: string;
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
    empty: {
      allTitle: string;        allDesc: string;
      videoTitle: string;      videoDesc: string;
      audioTitle: string;      audioDesc: string;
      imageTitle: string;      imageDesc: string;
      frameTitle: string;      frameDesc: string;
      characterTitle: string;  characterDesc: string;
      sceneTitle: string;      sceneDesc: string;
      storyboardTitle: string; storyboardDesc: string;
      dragHint: string;
    };
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
    cacheStatus: {
      pending: string;
      downloading: string;
      ready: string;
      failed: string;
      retry: string;
      scrubWaiting: string;
    };
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
    framePack?: string;
    filterCharacterPack?: string;
    filterScenePack?: string;
    filterFramePack?: string;
    deleteCharacterPack?: string;
    deleteCharacterPackConfirm?: string;
    deleteScenePack?: string;
    deleteScenePackConfirm?: string;
    deleteFramePack?: string;
    deleteFramePackConfirm?: string;
    framePackBadge?: string;
    addFramesToPack?: string;
    addFramesToPackDisabledHint?: string;
    addFramesToPackInFlight?: string;
    deleteFrame?: string;
    deleteFrameConfirmTitle?: string;
    deleteFrameConfirmBody?: string;
    frameDeleted?: string;
    framePackUpdated?: string;
    framePackEmptiedRemoved?: string;
    referencePickerFramePack?: string;
    materialLibraryTab?: string;
    materialLibraryEmpty?: string;
    materialLibraryLoading?: string;
    materialLibrarySearchPlaceholder?: string;
    materialLibraryPage?: string;
    materialLibraryLoginRequired?: string;
    materialLibraryError?: string;
    materialLibraryReferenceLabel?: string;
    audioBrokenBlob?: string;
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
    replaceWarningTitle: string;
    replaceWarningBody: string;
    preservedTracks: string;
    undoHint: string;
  };
  aiMixingProgress: {
    errorInternal: string;
    errorBackendUnreachable: string;
    errorInvalidRequest: string;
    errorImportFailed: string;
    analysisIncomplete: string;
    title: string;
    stepAnalyze: string;
    stepPlan: string;
    stepApply: string;
    analyzingVideos: string;
    planningHint: string;
    cancel: string;
    cancelled: string;
    done: string;
    success: string;
    noChanges: string;
    partialWarning: string;
    lockedTracksSkipped: string;
    blockedByAgent: string;
    errorNoMaterials: string;
    errorModelNotConfigured: string;
    errorUpstream: string;
    errorUnparseable: string;
    errorTimeout: string;
    errorInvalidResponse: string;
    errorGeneric: string;
  };
  agentUndo: {
    blockedWhileRunning: string;
    conflict: string;
    notUndoable: string;
  };
  imageOverlay: {
    done: string;
    revert: string;
  };
  agentApply: {
    notApplied: string;
    reasons: {
      clipNotFound: string;
      trackNotFound: string;
      targetTrackMissing: string;
      invalidTime: string;
    };
    finishing: string;
    finishingTimedOut: string;
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
    previewUnavailableHint: string;
    openInBrowser: string;
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
      // Round-2 client-preview readiness gate (spec §3.3.6)
      materialsDownloading: string;
      materialsStreamingNotice: string;
      localMediaOverBudget: string;
    };
    controls: {
      volume: string;
      playbackSpeed: string;
      fullscreen: string;
      seekAriaLabel: string;
      volumeAriaLabel: string;
      previewVolumeAriaLabel: string;
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
      emptyTimeline: string;
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
    errorNoPlayableSource: string;
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
  videoCoverModal: {
    title: string;
    button: string;
    templates: {
      title: string;
      tutorial: string;
      click: string;
      minimal: string;
    };
    source: {
      label: string;
      frame: string;
      upload: string;
      frameDisabledHint: string;
      noFramesAvailable: string;
    };
    scrubber: {
      tooltip: string;
      atTime: string;
      noVideoItems: string;
    };
    textTools: {
      font: string;
      size: string;
      color: string;
      align: string;
      alignLeft: string;
      alignCenter: string;
      alignRight: string;
      bold: string;
      italic: string;
      underline: string;
      colorSwatch: string;
      colorInvalid: string;
      sizeClamped: string;
    };
    upload: {
      hint: string;
      drop: string;
      browse: string;
      tooLarge: string;
      wrongType: string;
    };
    actions: {
      cancel: string;
      download: string;
      downloadFilename: string;
    };
    errors: {
      extractFailed: string;
      saveFailed: string;
      uploadFailed: string;
      renderFailed: string;
    };
    a11y: {
      layerBadge: string;
      layerTitle: string;
      layerSubtitle: string;
      layerEyebrow: string;
      layerCta: string;
      layerGeneric: string;
      frameSlider: string;
    };
  };
  videoExport: {
    nothingVisibleToExport: string;
    missingMaterials: string;
    degradedTitle: string;
    degradedImageOverlay: string;
    degradedSubtitles: string;
    degradedAudioItem: string;
    degradedEmbeddedAudio: string;
    blackTailNotice: string;
    moreItems: string;
    noContentToExport: string;
    noContentToExportDesc: string;
    noContentToExportFull: string;
    exportCompletedButDownloadFailed: string;
    exportTimeout: string;
    exportFailed: string;
    exportFailedWithError: string;
    failedVideos: string;
    recoverySuggestions: string;
    compositionWarningsTitle: string;
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
    tabsLabel: string;
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
      convertAllSpeechDesc: string;
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
      searchPlaceholder: string;
      genderAll: string;
      genderMale: string;
      genderFemale: string;
      noVoicesMatched: string;
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
      sentenceAiVideoButton: string;
      sentenceAiVideoGenerating: string;
      sentenceAiVideoSucceeded: string;
      sentenceAiVideoFailed: string;
      sentenceAiVideoModalSubtitle: string;
      sentenceAiVideoSuccessToast: string;
      sentenceAiVideoFailedToast: string;
      sentenceAiVideoDurationHint: string;
      aiPromptButton: string;
      aiPromptGenerating: string;
      aiPromptRetry: string;
      aiPromptFailedToast: string;
      // 「解说直接生成」专用：AI 视频脚本（画面描述）状态文案。
      // 前缀 videoScript* 以与相邻的 generating/generationFailed/retry（ARK 视频生成）
      // 及 aiPromptGenerating/aiPromptRetry（句级 ARK 提示词）区分，勿混用。
      videoScriptGenerating: string;
      videoScriptFailed: string;
      videoScriptRetry: string;
    };
  };
  videoEditing: {
    autoMix: {
      orphansIgnored: string;
      videoShort: string;
      noMaterials: string;
      noScriptMaterials: string;
      replaceConfirmTitle: string;
      replaceConfirmBody: string;
      applied: string;
      skippedNoAudio: string;
      duplicatesIgnored: string;
      trackLocked: string;
      noTargetTrack: string;
      confirm: string;
      cancel: string;
    };
    agentDock: {
      fabLabel: string;
      panelTitle: string;
      close: string;
      busy: string;
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
    batchCount: string;
    batchCountValue: string;
    batchLabel: string;
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
    /** Tooltip / aria-label on the red stop button shown while the agent is busy. */
    stopAgentTooltip: string;
    /** Label on the secondary ghost stop button inside the busy bar. */
    stopButtonLabel: string;
    /** Busy-bar label while the agent is in the thinking phase. */
    agentBusyThinking: string;
    /** Busy-bar label while the agent is running a tool. `{tool}` is replaced. */
    agentBusyTool: string;
    /** Busy-bar label when the agent has no specific tool / phase signal. */
    agentBusyWorking: string;
    /** Label for tool calls that ended in the `cancelled` status. */
    agentToolCancelled: string;
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
      workflowsAvailableWithEmpty: string;
      emptyWorkflowHint: string;
      idLabel: string;
      updatedAt: string;
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
    frameExtraction?: {
      tab: string;
      selectVideoHeading: string;
      selectVideoEmpty: string;
      ingestProgress: string;
      ingestFailed: string;
      ingestRetry: string;
      ingestCancel: string;
      capture: string;
      previousFrame: string;
      nextFrame: string;
      playPause: string;
      capturedListEmpty: string;
      capturedListTitle: string;
      capturedListCount: string;
      removeFrame: string;
      capReached: string;
      doneNoFrames: string;
      done: string;
      saving: string;
      saveSuccess: string;
      saveFailed: string;
      payloadTooLarge: string;
      seekHint: string;
      loadingDuration: string;
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
    partialBadge: string;
    partialBanner: string;
    partialMissingScenes: string;
    partialErrorPrefix: string;
  };
  mobileWarning: {
    tablet: string;
    mobile: string;
    mobileDevice: string;
    title: string;
    description: string;
    useDesktop: string;
  };
  sceneCountInput: {
    label: string;
    placeholder: string;
    batchesHint: string;
    maxScenesExceededTip: string;
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
    partialFramesNotice: string;
    partialMissingScenes: string;
    emptyFramesNotice: string;
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
    normalChat: string;
    copiedTitle: string;
    copyMessageTitle: string;
    convertToScriptTitle: string;
    generating: string;
    copied: string;
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
  notFound: {
    title: string;
    description: string;
    goHome: string;
    goBack: string;
  };
  setupGuide: {
    title: string;
    description: string;
    stepProviderTitle: string;
    stepProviderDesc: string;
    stepTestTitle: string;
    stepTestDesc: string;
    stepAssignTitle: string;
    stepAssignDesc: string;
    goToSettings: string;
    later: string;
    settingsAttentionHint: string;
  };
  narrationDirectScript: {
    modeNarrationDirect: string;
    modeNarrationDirectDesc: string;
    modeVideoUnderstanding: string;
    modeVideoUnderstandingDesc: string;
    title: string;
    stepComposeLabel: string;
    stepSplitLabel: string;
    draftLabel: string;
    draftPlaceholder: string;
    streamingHint: string;
    chatPanelTitle: string;
    chatPlaceholder: string;
    chatEmptyHint: string;
    roleUser: string;
    roleAssistant: string;
    assistantThinking: string;
    reasoningLabel: string;
    send: string;
    cancel: string;
    splitting: string;
    splitSentencesLabel: string;
    sentenceCount: string;
    sentencePlaceholder: string;
    emptySplitHint: string;
    addSentence: string;
    deleteSentence: string;
    next: string;
    back: string;
    appendButton: string;
    replaceButton: string;
    close: string;
    composeReadyHint: string;
    emptyDraftHint: string;
    splitFooterHint: string;
    defaultSegmentTitle: string;
  };
  videoUnderstandingPlaceholder: {
    title: string;
    comingSoon: string;
    description: string;
    close: string;
  };
}

export const translations: Record<string, Translations> = {
  en: {
    common: {
      newTask: 'New Task',
      projects: 'Projects',
      library: 'Library',
      privacy: 'Privacy',
      terms: 'Terms',
      support: 'Support',
      systemStatus: 'System Status',
      operational: 'Operational',
      close: 'Close',
      closePanel: 'Close panel',
      closeTab: 'Close tab {title}',
      cancel: 'Cancel',
      confirm: 'Confirm',
      colon: ': ',
      relativeTime: { justNow: 'Just now' },
    },
    header: {
      languageSelector: 'Language',
      english: 'English',
      chinese: '中文',
      switchToLightMode: 'Switch to light mode',
      switchToDarkMode: 'Switch to dark mode',
    },
    adminSettings: {
      groupApp: 'Application',
      groupAi: 'AI capabilities',
      groupMedia: 'Media & tools',
      general: 'General',
      generalDesc: 'Language and appearance',
      language: 'Language',
      theme: 'Appearance',
      lightTheme: 'Light',
      darkTheme: 'Dark',
      autoTheme: 'Follow system',
      generalAutoSaveNote: 'Changes take effect immediately and are remembered on this device.',
      title: 'Admin Settings',
      subtitle: 'Manage system settings and users',
      inactive: 'Inactive',
      edit: 'Edit',
      delete: 'Delete',
      loading: 'Loading...',
      cancel: 'Cancel',
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
      // Model settings quick-start empty states (desktop-config-free-startup)
      modelQuickStartTitle: 'Quick Start',
      modelQuickStartDesc: 'Connect an AI model in three steps to unlock chat, mixed editing and visual understanding.',
      modelQuickStartAddProvider: 'Add Provider',
      modelAssignmentsNeedProvider: 'Add a provider first, then assign models to each feature.',
      modelAssignmentsGoProviders: 'Go add a provider',
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
      effectiveConfigErrorBadge: 'Fetch failed',
      effectiveConfigErrorDesc: 'Failed to fetch effective config for this function type. Check backend connection or retry.',
      testConnectionFormat: 'Test Connection Format',
      modelInfo: 'Model Info',
      formatUsed: 'Format Used',
      providerCard: 'Provider Card',
      modelApiKeyRequired: 'API Key is required',
      modelDeleteProviderError: 'Failed to delete provider',
      modelModelsFound: 'models found',
      modelKeyNotSet: 'Not set',
      modelRequestFailed: 'Request failed',
      confirmDelete: 'Delete',
      cancelDelete: 'Cancel',
      deleting: 'Deleting...',
      saving: 'Saving...',
      save: 'Save',
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
      ttsConcurrencyInvariantError: 'Concurrent threads cannot exceed max concurrent threads.',
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
      wmConcurrencyInvalid: 'Concurrent threads cannot exceed max concurrent threads.',
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
      videoEditing: 'Video Editing',
      brainstormingComingSoon: 'Brainstorming is coming soon.',
      aiChat: 'AI Chat',
      types: { video: 'Video Editing', chat: 'AI Chat' },
      defaultPageTitle: 'Ecliptrix — Where light and shadow collide',
    },
    videoProjects: {
      closeUnsavedTitle: "Some changes aren't saved yet",
      closeUnsavedBody: 'Saving the project failed. If you close now, your latest changes may be lost.',
      closeSaveSlowBody: 'The project is still saving. If you close now, your latest changes may be lost.',
      keepOpen: 'Keep open',
      closeAnyway: 'Close anyway',
      timelineRepaired: '{count} clips in this project had invalid data and were repaired',
      timelineUnreadable: "The timeline couldn't be read. A backup of the original data was kept and the project opened with an empty timeline",
      title: 'Video Projects',
      projectActions: 'Project actions',
      closeMenu: 'Close menu',
      all: 'All projects',
      recent: 'Recently opened',
      uncategorized: 'Uncategorized',
      categories: 'Categories',
      newProject: 'New project',
      newCategory: 'New category',
      search: 'Search',
      searchPlaceholder: 'Search projects…',
      sortRecent: 'Recently opened',
      sortCreated: 'Date created',
      sortName: 'Name',
      rename: 'Rename',
      moveToCategory: 'Move to category',
      delete: 'Delete',
      deleteConfirmTitle: 'Delete "{name}"?',
      deleteConfirm: 'You are about to delete project "{name}". This cannot be undone.',
      deleteCategoryConfirm: 'Delete this category? Projects inside will become Uncategorized.',
      openProject: 'Open',
      lastOpened: 'Last opened',
      lastUpdated: 'Last updated',
      neverOpened: 'Not opened yet',
      emptyTitle: 'No projects yet',
      emptyHint: 'Create your first project to start editing videos.',
      noResults: 'No projects match your search.',
      untitled: 'Untitled',
      save: 'Save',
      cancel: 'Cancel',
      create: 'Create',
      projectName: 'Project name',
      projectNamePlaceholder: 'My amazing video',
      descriptionLabel: 'Description (optional)',
      descriptionPlaceholder: 'A short description of this project',
      categoryName: 'Category name',
      categoryNamePlaceholder: 'e.g. Marketing, Travel, Tutorials',
      backToProjects: 'All projects',
      projectCount: '{count} projects',
      categoryAll: 'All',
      sidebarHeading: 'Projects',
      cardsHeading: 'My projects',
      saved: 'Saved',
      saving: 'Saving…',
      saveError: 'Failed to save project',
      loadError: 'Failed to load projects',
      cover: 'Cover',
    },
    welcome: {
      title: 'Welcome to Ecliptrix',
      subtitle: 'Where light and shadow collide',
      description: 'Where light and shadow collide to create extraordinary content. Start by creating a new task to begin your creative journey.',
      videoEditingDesc: 'Automatic video mixing and editing',
      aiChatDesc: 'Intelligent conversation and assistance',
    },
    taskContent: {
      willBeImplemented: 'Task content will be implemented here',
      workspaceDescription: 'This is where the {type} workspace will be displayed. The specific functionality for each task type will be implemented in future iterations.',
    },
    materialsPanel: {
      deleteConfirmTitle: 'Delete material',
      deleteConfirmBody: 'Delete "{name}"? The file can\'t be recovered afterwards.',
      deleteConfirmBodyMany: "Delete these {count} materials? The files can't be recovered afterwards.",
      deleteInUseBody: '{count} clips on the timeline use "{name}". Deleting it also removes those clips. The file can\'t be recovered afterwards.',
      deleteInUseBodyMany: "{count} clips on the timeline use these {materialCount} materials. Deleting them also removes those clips. The files can't be recovered afterwards.",
      deleteBlockedLocked: '{count} clips using this material are on locked tracks. Unlock those tracks first',
      deleteConfirmAction: 'Delete',
      deleteFailedClipsRemoved: "Couldn't delete the material, so the file was kept. Press Ctrl+Z to bring the removed clips back",
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
      empty: {
        allTitle: 'No materials yet',
        allDesc: 'Library is empty. Use "Upload" or "AI Create" to start adding.',
        videoTitle: 'No video materials',
        videoDesc: 'Use "Upload" to add a video, or "Search Videos" to pull one from the library.',
        audioTitle: 'No audio materials',
        audioDesc: 'Use "Upload" to add audio, or "AI Create" to generate TTS.',
        imageTitle: 'No image materials',
        imageDesc: 'Use "Upload" to add images, or "AI Create" to generate one.',
        frameTitle: 'No frame packs',
        frameDesc: 'Use "Video Tools → Frame Extraction" to pull frames from a video.',
        characterTitle: 'No character packs',
        characterDesc: 'Generate one via "AI Character Modeling".',
        sceneTitle: 'No scene packs',
        sceneDesc: 'Generate one via "AI Scene Modeling".',
        storyboardTitle: 'No storyboard packs',
        storyboardDesc: 'Click "AI Image Generation" to create a storyboard pack.',
        dragHint: 'Or drag and drop files here to import locally.',
      },
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
      uploadTooltip: 'Import Materials',
      uploadingProgress: 'Saving locally...',
      uploadingMaterial: 'Saving locally...',
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
      cacheStatus: {
        pending: 'Queued for caching',
        downloading: 'Caching for smooth preview',
        ready: 'Cached locally',
        failed: 'Cache failed',
        retry: 'Click to retry',
        scrubWaiting: 'Caching… preview may briefly pause',
      },
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
      framePack: 'Frame Pack',
      filterCharacterPack: 'Character',
      filterScenePack: 'Scene',
      filterFramePack: 'Frames',
      deleteCharacterPack: 'Delete Character Pack',
      deleteCharacterPackConfirm: 'Are you sure you want to delete this character pack? All frames and related data will be permanently deleted. References to its frames elsewhere will become invalid.',
      deleteScenePack: 'Delete Scene Pack',
      deleteScenePackConfirm: 'Are you sure you want to delete this scene pack? All frames and related data will be permanently deleted. References to its frames elsewhere will become invalid.',
      deleteFramePack: 'Delete Frame Pack',
      deleteFramePackConfirm: 'Are you sure you want to delete this frame pack? All extracted frames will be permanently deleted. References to its frames elsewhere will become invalid.',
      framePackBadge: '{count} frames',
      addFramesToPack: 'Add Frames',
      addFramesToPackDisabledHint: 'Original video is no longer in your library — re-import it first',
      addFramesToPackInFlight: 'Adding frames…',
      deleteFrame: 'Delete frame',
      deleteFrameConfirmTitle: 'Delete frame',
      deleteFrameConfirmBody: 'Delete this frame from the pack? This cannot be undone.',
      frameDeleted: 'Frame deleted',
      framePackUpdated: 'Frames added to pack',
      framePackEmptiedRemoved: 'Last frame removed — pack deleted',
      referencePickerFramePack: 'Frames',
      materialLibraryTab: 'Materials',
      materialLibraryEmpty: 'No materials — please upload in Materials panel first',
      materialLibraryLoading: 'Loading...',
      materialLibrarySearchPlaceholder: 'Search materials',
      materialLibraryPage: 'Page {page}/{total}',
      materialLibraryLoginRequired: 'Please log in to view materials',
      materialLibraryError: 'Load failed — click to retry',
      materialLibraryReferenceLabel: 'Reference image: {name}',
      audioBrokenBlob: 'Audio source unavailable. Please regenerate the speech.',
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
      replaceWarningTitle: 'This will replace part of your timeline',
      replaceWarningBody: '{count} clips on the video, image and audio tracks will be replaced',
      preservedTracks: 'These tracks stay unchanged: {tracks}',
      undoHint: 'You can undo with Ctrl+Z afterwards',
    },
    aiMixingProgress: {
      errorInternal: 'Something went wrong while generating the edit. Try again',
      errorBackendUnreachable: "Can't reach the local service. Restart the app and try again",
      errorInvalidRequest: "Some materials couldn't be sent to the editing model",
      errorImportFailed: "The editing plan couldn't be applied to the timeline",
      analysisIncomplete: "{count} videos couldn't be analyzed, so the plan used only their names and durations",
      title: 'AI Auto Edit',
      stepAnalyze: 'Analyze footage',
      stepPlan: 'Plan the edit',
      stepApply: 'Apply to timeline',
      analyzingVideos: 'Analyzing {count} videos',
      planningHint: 'Usually takes 30–90 seconds',
      cancel: 'Cancel',
      cancelled: 'AI auto edit cancelled; timeline unchanged',
      done: 'Done',
      success: 'AI auto edit applied. Press Ctrl+Z to undo',
      noChanges: 'The AI plan matches the current timeline, so nothing changed',
      partialWarning: '{count} clips were invalid and were skipped or adjusted',
      lockedTracksSkipped: 'Locked target tracks were left unchanged',
      blockedByAgent: 'The agent is editing the timeline. Try again when it finishes',
      errorNoMaterials: 'Add video, audio or image materials first',
      errorModelNotConfigured: 'No model is assigned to video editing. Set one in Settings → Models',
      errorUpstream: 'The editing model request failed. Check your network or model settings and try again',
      errorUnparseable: 'The model returned an unusable plan. Try again or switch models',
      errorTimeout: 'AI auto edit timed out. Try again with fewer materials',
      errorInvalidResponse: 'The editing plan was incomplete',
      errorGeneric: 'AI auto edit failed: {message}',
    },
    agentUndo: {
      blockedWhileRunning: 'The agent is still working. You can undo when it finishes',
      conflict: "The timeline changed after this step, so it can't be undone on its own. Use Ctrl+Z instead",
      notUndoable: 'This step made no timeline change to undo',
    },
    imageOverlay: {
      done: 'Done',
      revert: 'Revert position',
    },
    agentApply: {
      notApplied: "This step couldn't be applied to the timeline",
      reasons: {
        clipNotFound: 'The clip no longer exists',
        trackNotFound: 'The track no longer exists',
        targetTrackMissing: "The target track doesn't exist",
        invalidTime: 'The time value is invalid',
      },
      finishing: 'Applying the last changes to the timeline…',
      finishingTimedOut: 'Some changes took too long to apply. The timeline is unlocked, so check the result',
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
        motion: 'Camera Motion',
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
        motionShortcut: 'M',
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
        localTranscoding: 'Transcoding',
        localDownloading: 'Downloading',
        localDownloadFailed: 'Download failed · Retry',
        localWillStream: 'Will stream',
      },
      messages: {
        externalUpdateRejected: "An external change couldn't be applied. The timeline was left unchanged",
        splitTooCloseToEdge: 'Too close to the clip edge to split. Each part needs at least 0.1 s',
        incompatibleTrack: "This track can't hold this type of material",
        materialNotFound: 'This material is no longer in the library',
        noAudioItems: 'No audio items found, please add audio to the timeline first.',
        noSubtitleTrack: 'No subtitle track found, please add a subtitle track first.',
        subtitleExtractionFailed: 'Subtitle extraction failed, no subtitle content was generated.',
        subtitleExtractionSuccess: 'Subtitle extraction successful! {operation} {count} subtitle segments.',
        replaceSubtitlesTitle: 'Replace existing subtitles?',
        replaceSubtitlesBody: '{count} existing subtitles will be replaced by the transcription. Undo with Ctrl+Z',
        replaceSubtitlesConfirm: 'Replace',
        subtitleTrackLocked: 'The subtitle track is locked',
        editLockedByAgent: 'The agent is editing the timeline. You can edit again when it finishes',
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
        swapHint: 'Drop to swap',
      },
      cameraMotion: {
        title: 'Camera Motion',
        openPanel: 'Camera Motion',
        clipLabel: 'Clip: {name}',
        multiSelected: '{count} clips selected',
        applyToAllSelected: 'Apply to all selected',
        tab2d: '2D Motion',
        tab3d: '3D Motion',
        presetsLabel: 'Motion presets',
        stageTitle: 'Live preview',
        intensity: 'Intensity',
        intensityValue: '{value}x',
        easing: 'Easing',
        easingLinear: 'Linear',
        easingEaseIn: 'Ease In',
        easingEaseOut: 'Ease Out',
        easingEaseInOut: 'Ease In-Out',
        range: 'Range',
        rangeWholeClip: 'Whole clip',
        rangeCustom: 'Custom',
        startOffset: 'Start offset',
        windowDuration: 'Duration',
        seconds: 's',
        advanced: 'Advanced parameters',
        keyframeStart: 'Start',
        keyframeEnd: 'End',
        fieldScale: 'Scale',
        fieldX: 'Center X',
        fieldY: 'Center Y',
        fieldRoll: 'Roll',
        fieldRotateX: 'Tilt',
        fieldRotateY: 'Pan',
        fieldDolly: 'Dolly',
        reverse: 'Reverse',
        reverseAria: 'Reverse motion direction',
        apply: 'Apply',
        cancel: 'Cancel',
        reset: 'Reset',
        discardConfirm: 'Discard unapplied changes?',
        webglDegraded: '3D preview degraded (WebGL unavailable) - export is still full 3D',
        qualityHintCover: 'Wide 3D angle crops more of the frame; sharpness may drop.',
        qualityHintRoll: 'Roll crops the frame for the whole clip; sharpness may drop.',
        qualityHintClamped: 'Some values hit their limit at this intensity - the motion stops early.',
        disabledNoSelection: 'Select a clip first',
        disabledNotVisual: 'Only video and image clips can take a camera motion',
        disabledTrackLocked: 'Track is locked',
        badgeTitle: 'Camera motion: {preset}',
        // Shares the WHY with `webglDegraded` above but drops the attribution:
        // this badge also fires on run-time projection degrades, which have
        // nothing to do with WebGL (D29).
        degradedBadge: '3D camera motion degraded to a 2D preview - export is still full 3D',
        degradedBadgeDismiss: 'Dismiss',
        stageScrub: 'Motion progress',
        stageScrubValue: 'Motion progress {percent}%',
        stagePlay: 'Play preview loop',
        stagePause: 'Pause preview loop',
        keyframesLabel: 'Keyframes',
        keyframeStripHint: 'Add a keyframe at the playhead, drag a diamond to re-time it',
        keyframeItem: 'Keyframe {index} of {count}, at {percent}%',
        keyframeItemLocked: 'Keyframe {index} of {count}, at {percent}% (fixed)',
        keyframeAdd: 'Add a keyframe at the playhead',
        keyframeAddBlockedOutside: 'Move the playhead inside the motion window first',
        keyframeAddBlockedTooClose: 'There is already a keyframe here',
        keyframeAddBlockedLimit: 'A motion can hold at most {max} keyframes',
        keyframeRemove: 'Delete the selected keyframe',
        keyframeRemoveBlocked: 'The first and last keyframes cannot be deleted',
        segmentEasingAria: 'Easing from keyframe {index} to keyframe {next}',
        curveEasingNote: 'Each segment carries its own easing while a curve exists',
        windowBandLabel: 'Motion window',
        stageOverlayLabel:
          'Direct framing. Arrow keys move the framing, + and - zoom, [ and ] roll',
        stageOverlayHint: 'Drag to reframe · scroll to zoom · Shift+drag to roll',
        stageDragHint: 'Drag to reframe · scroll to zoom · Shift+drag to orbit / tilt',
        keyframeCounter: 'Keyframe {index} / {count}',
        keyframeEditing: 'Editing keyframe {index}',
        presets: {
          none: 'None',
          pushIn: 'Push In',
          pullOut: 'Pull Out',
          panLeft: 'Pan Left',
          panRight: 'Pan Right',
          panUp: 'Pan Up',
          panDown: 'Pan Down',
          zoomPanDiagonal: 'Zoom & Drift',
          rollSlight: 'Slight Roll',
          dollyIn3d: '3D Dolly In',
          dollyOut3d: '3D Dolly Out',
          orbitLeft: 'Orbit Left',
          orbitRight: 'Orbit Right',
          tiltDown: 'Tilt Down',
          tiltUp: 'Tilt Up',
          parallaxPush: 'Parallax Push',
          sway3d: '3D Sway',
          custom: 'Custom',
        },
      },
      subtitleEditModal: {
        styleSettings: 'Style',
        editingSingle: 'Editing one subtitle',
        editingAll: 'Editing all subtitles',
        applyToAll: 'Apply to all',
        presets: {
          default: 'Default',
          classic: 'Classic',
          modern: 'Modern',
          elegant: 'Elegant',
          tech: 'Tech',
        },
        fonts: {
          default: 'Default',
          serif: 'Serif',
          sansSerif: 'Sans serif',
          monospace: 'Monospace',
        },
        positions: {
          top: 'Top',
          upper34: 'Upper third',
          center: 'Center',
          lower34: 'Lower third',
          bottom: 'Bottom',
        },
        closeAriaLabel: 'Close',
        discardChangesTitle: 'Discard unsaved changes?',
        discardChangesBody: "Your subtitle changes won't be saved",
        discardChangesConfirm: 'Discard',
        noSubtitlesHint: 'Add subtitles to the timeline first',
        presetsHeading: 'Presets',
        presetSample: 'Sample',
        fontFamily: 'Font',
        fontSize: 'Font size: {size}px',
        fontColor: 'Font color',
        backgroundColor: 'Background',
        enableBackground: 'Show background',
        position: 'Position',
        stylePreview: 'Preview',
        stylePreviewSample: 'This is how subtitles will look',
        contentHeading: 'Subtitle text',
        contentHint: 'Select a subtitle to edit it',
        itemPreviewFallback: 'Subtitle preview',
        countSummary: '{count} subtitles',
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
        durationUnit: 's',
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
      previewUnavailable: 'Preview unavailable',
      previewUnavailableHint: 'This video cannot be previewed here. Check your network/proxy, or open it in your browser.',
      openInBrowser: 'Open in browser',
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
        materialsDownloading: 'Materials downloading, please wait ({ready}/{total} ready)',
        materialsStreamingNotice: '{count} clip(s) will stream',
        localMediaOverBudget: 'Preview media exceeds the memory budget; playback stability may be affected',
      },
      controls: {
        volume: 'Volume',
        playbackSpeed: 'Playback Speed',
        fullscreen: 'Fullscreen',
        seekAriaLabel: 'Seek within video',
        volumeAriaLabel: 'Volume',
        previewVolumeAriaLabel: 'Preview Volume',
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
        emptyTimeline: 'Add video, image, or audio materials to the timeline before exporting',
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
      errorNoPlayableSource: 'Video source not playable. Please re-import the material or check the network.',
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
    videoCoverModal: {
      title: 'Video Cover',
      button: 'Cover',
      templates: {
        title: 'Title',
        tutorial: 'Tutorial',
        click: 'Click-bait',
        minimal: 'Minimal',
      },
      source: {
        label: 'Source',
        frame: 'Frame',
        upload: 'Upload',
        frameDisabledHint: 'Add a video clip to your timeline to pick a frame',
        noFramesAvailable: 'No frames available — upload an image instead.',
      },
      scrubber: {
        tooltip: 'Drag to pick a frame',
        atTime: 'At {time}',
        noVideoItems: 'No video clips on the timeline',
      },
      textTools: {
        font: 'Font',
        size: 'Size',
        color: 'Color',
        align: 'Align',
        alignLeft: 'Left',
        alignCenter: 'Center',
        alignRight: 'Right',
        bold: 'Bold',
        italic: 'Italic',
        underline: 'Underline',
        colorSwatch: 'Color picker',
        colorInvalid: 'Use a hex like #fff or #ffffff',
        sizeClamped: 'Clamped {from} → {to}',
      },
      upload: {
        hint: 'PNG / JPG up to 10 MB',
        drop: 'Drop an image here',
        browse: 'Browse',
        tooLarge: 'File too large (max 10 MB)',
        wrongType: 'Unsupported file type',
      },
      actions: {
        cancel: 'Cancel',
        download: 'Download Cover',
        downloadFilename: '{slug}-cover.png',
      },
      errors: {
        extractFailed: 'Failed to extract frame',
        saveFailed: 'Failed to save cover',
        uploadFailed: 'Failed to upload background image',
        renderFailed: 'Failed to render cover',
      },
      a11y: {
        layerBadge: 'Badge text',
        layerTitle: 'Title text',
        layerSubtitle: 'Subtitle text',
        layerEyebrow: 'Eyebrow text',
        layerCta: 'Call-to-action text',
        layerGeneric: '{key} text',
        frameSlider: 'Drag to pick a frame',
      },
    },
    videoExport: {
      nothingVisibleToExport: "There's nothing visible to export. Add a video or an image first",
      missingMaterials: '{count} clips use deleted materials ({names}). Remove those clips before exporting',
      degradedTitle: 'Export finished, but some content is missing from the video:',
      degradedImageOverlay: 'Images not rendered: {names}',
      degradedSubtitles: "Subtitles couldn't be burned into the video",
      degradedAudioItem: 'Audio not mixed in: {names}',
      degradedEmbeddedAudio: 'Original video sound not mixed in: {names}',
      blackTailNotice: 'The last {seconds} s of the video have no picture and will be black',
      moreItems: 'and {count} more',
      noContentToExport: 'No content to export',
      noContentToExportDesc: 'Please add video materials to the timeline before exporting',
      noContentToExportFull: 'No content to export. Please add video materials to the timeline before exporting.',
      exportCompletedButDownloadFailed: 'Video export completed but download failed. Please refresh the page and try again, or contact support.',
      exportTimeout: 'Video export timed out: processing exceeded the 10-minute limit. Try reducing video duration or complexity, or try again later.',
      exportFailed: 'Video export failed',
      exportFailedWithError: 'Video export failed:',
      failedVideos: 'Failed videos:',
      recoverySuggestions: 'Suggested solutions:',
      compositionWarningsTitle: 'Export finished, but some clips did not render their camera motion as previewed:',
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
       tabsLabel: 'Script type',
       tabs: {
         narrationScript: 'Narration Script',
         aiVideoScript: 'AI Video Script',
       },
       header: {
         title: 'Copy / Script',
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
        convertAllSpeechDesc: 'Run TTS on every segment in order',
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
         scriptWillAppear: 'Copy / Script will appear here',
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
         searchPlaceholder: 'Search voices…',
         genderAll: 'All',
         genderMale: 'Male',
         genderFemale: 'Female',
         noVoicesMatched: 'No voices matched',
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
         sentenceAiVideoButton: 'AI Video',
         sentenceAiVideoGenerating: 'Generating…',
         sentenceAiVideoSucceeded: '\u2713 Generated',
         sentenceAiVideoFailed: 'Failed, retry',
         sentenceAiVideoModalSubtitle: 'Generate AI video for this sentence',
         sentenceAiVideoSuccessToast: 'AI video generated and linked to the sentence',
         sentenceAiVideoFailedToast: 'AI video generation failed: {reason}',
         sentenceAiVideoDurationHint: 'Sentence is {actual}s; nearest bucket is {bucket}s (split if >12s)',
         aiPromptButton: 'AI Prompt',
         aiPromptGenerating: 'Generating…',
         aiPromptRetry: 'Retry',
         aiPromptFailedToast: 'AI prompt generation failed: {reason}',
         videoScriptGenerating: 'Generating AI video script…',
         videoScriptFailed: 'AI video script generation failed',
         videoScriptRetry: 'Regenerate',
        },
     },
   videoEditing: {
     autoMix: {
       orphansIgnored: 'Ignored {count} materials from deleted or replaced script segments',
       videoShort: "Segments {list} don't have enough video to cover their voice-over",
       noMaterials: 'Add video, audio, or image materials before running auto-mix.',
       noScriptMaterials: 'Auto-mix needs audio and video generated from the text-script panel — run TTS and AI video matching first.',
       replaceConfirmTitle: 'Replace existing clips?',
       replaceConfirmBody: '{count} clips on Video 1 and Audio 1 will be replaced. Other tracks stay unchanged. Undo with Ctrl+Z',
       applied: 'Arranged {segments} segments',
       skippedNoAudio: 'Segments {list} have no voice-over yet and were skipped',
       duplicatesIgnored: 'Ignored {count} outdated material versions',
       trackLocked: 'Video 1 or Audio 1 is locked',
       noTargetTrack: 'Add a video track and an audio track before arranging automatically',
       confirm: 'Replace',
       cancel: 'Cancel',
     },
     agentDock: {
       fabLabel: 'AI editing assistant',
       panelTitle: 'AI Editing Assistant',
       close: 'Close',
       busy: 'Agent running…',
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
      selectStoryboardPackHint: 'Select a generated storyboard pack from the dropdown below',
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
      batchCount: 'Batches',
      batchCountValue: '{batches} × 2×2 ({totalCells} cells)',
      batchLabel: 'Batch {index} / {total}',
      aspectRatio: 'Aspect ratio',
      totalFrames: 'Total scenes',
      hint: 'Each batch is one 2×2 Seedream call, chained from the previous batch.',
      ariaLabel: '{aspectRatio} storyboard preview, {batches} chained 2×2 batches containing {frameCount} scenes',
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
      stopAgentTooltip: 'Stop the agent',
      stopButtonLabel: 'Stop',
      agentBusyThinking: 'Agent is thinking…',
      agentBusyTool: 'Agent is running {tool}…',
      agentBusyWorking: 'Agent is working…',
      agentToolCancelled: 'Cancelled',
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
        workflowsAvailableWithEmpty: '{count} workflow(s) available · {empty} empty',
        emptyWorkflowHint: 'Add nodes to this workflow before using it',
        idLabel: 'ID',
        updatedAt: 'Updated {time}',
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
      frameExtraction: {
        tab: 'Frame Extraction',
        selectVideoHeading: 'Select a video to extract frames from',
        selectVideoEmpty: 'No video materials available — upload one first',
        ingestProgress: 'Caching video for frame capture…',
        ingestFailed: 'Failed to cache video',
        ingestRetry: 'Retry',
        ingestCancel: 'Back',
        capture: 'Capture frame',
        previousFrame: 'Previous frame',
        nextFrame: 'Next frame',
        playPause: 'Play / pause',
        capturedListEmpty: 'No frames captured yet — scrub to a moment and click Capture.',
        capturedListTitle: 'Captured frames',
        capturedListCount: '{count} / {max}',
        removeFrame: 'Remove',
        capReached: 'Reached the {max}-frame cap. Remove some frames to capture more.',
        doneNoFrames: 'Capture at least one frame before saving.',
        done: 'Save as pack',
        saving: 'Saving…',
        saveSuccess: 'Frame pack created',
        saveFailed: 'Failed to save frame pack',
        payloadTooLarge: 'Total upload size exceeds the limit. Remove some frames or lower JPEG quality.',
        seekHint: 'Space: play/pause · ←/→: ±1 frame · C: capture',
        loadingDuration: 'Loading…',
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
      partialBadge: 'Partial',
      partialBanner: 'Partial pack: {completed}/{total} frames generated ({batchesDone}/{batchesTotal} batches succeeded). Missing frames are not shown.',
      partialMissingScenes: 'Missing shots: {scenes}',
      partialErrorPrefix: 'Reason: ',
    },
    mobileWarning: {
      tablet: 'Tablet',
      mobile: 'Mobile',
      mobileDevice: 'Mobile Device',
      title: '{device} is not supported yet',
      description: 'For a better experience, please access this app on a computer.',
      useDesktop: 'Recommended: use a computer',
    },
    sceneCountInput: {
      label: 'Scene Count',
      placeholder: 'Enter scene count (1-16)',
      batchesHint:
        'Generates {count} scenes across {batches} chained 2×2 batches ({batchSize} scenes each).',
      maxScenesExceededTip: 'Maximum supported scene count is {max}.',
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
      size1kSquare: '1:1 (1024×1024)',
      size2kSquare: '1:1 (2048×2048)',
      size169Landscape: '16:9 (1280×720)',
      size916Portrait: '9:16 (720×1280)',
      size169Wide: '16:9 (1024×576)',
      size916Wide: '9:16 (576×1024)',
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
      storyboardImageAlt: 'Storyboard frame',
      partialFramesNotice: 'Some batches failed: {completed}/{total} batches succeeded. The missing frames are not shown.',
      partialMissingScenes: 'Missing shots: {scenes}',
      emptyFramesNotice: 'No frames were generated. Please retry.',
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
      normalChat: 'Normal Chat',
      copiedTitle: 'Copied!',
      copyMessageTitle: 'Copy Message',
      convertToScriptTitle: 'Convert to Video Script',
      generating: 'Generating',
      copied: 'Copied',
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
      exportClips: 'Save Clips Locally',
      noClips: 'No clips created yet',
      startBeforeEnd: 'Start time must be before end time',
      minDuration: 'Clip duration must be at least 0.5 seconds',
      clipCreated: 'Clip created: ',
      clipDeleted: 'Clip deleted',
      noClipsToExport: 'No clips to export',
      noMaterial: 'Original material not found',
      clipsExported: 'Saved ',
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
    notFound: {
      title: 'Page not found',
      description: "The page you're looking for doesn't exist or has been moved.",
      goHome: 'Back to home',
      goBack: 'Go back',
    },
    setupGuide: {
      title: 'Welcome to Ecliptrix',
      description: 'AI features need a model API credential before they can run. Browsing and editing your materials works right away — configure a model whenever you are ready.',
      stepProviderTitle: 'Add a model provider',
      stepProviderDesc: 'Enter the API URL and key of your AI provider',
      stepTestTitle: 'Test the connection',
      stepTestDesc: 'Verify the key works with one click',
      stepAssignTitle: 'Assign it to features',
      stepAssignDesc: 'Pick models for chat, mixed editing and vision',
      goToSettings: 'Go to Settings',
      later: 'Maybe later',
      settingsAttentionHint: 'Model credentials need configuration',
    },
    narrationDirectScript: {
      modeNarrationDirect: 'Narration — direct',
      modeNarrationDirectDesc: 'Chat with AI to write & split the narration',
      modeVideoUnderstanding: 'Narration — from video',
      modeVideoUnderstandingDesc: 'Generate narration from video understanding',
      title: 'Narration — direct generate',
      stepComposeLabel: 'Write',
      stepSplitLabel: 'Split & refine',
      draftLabel: 'Narration draft',
      draftPlaceholder: 'Write your narration here, or ask the AI on the right to draft it for you…',
      streamingHint: 'Rewriting — editing locked',
      chatPanelTitle: 'AI assistant',
      chatPlaceholder: 'Describe what you want, e.g. "Write a 30s coffee shop tour narration"',
      chatEmptyHint: 'Tell the AI what narration you need; it rewrites the draft on the left.',
      roleUser: 'You',
      roleAssistant: 'AI',
      assistantThinking: 'Rewriting…',
      reasoningLabel: 'Reasoning',
      send: 'Send',
      cancel: 'Stop',
      splitting: 'Splitting into sentences…',
      splitSentencesLabel: 'Narration sentences',
      sentenceCount: '{count} sentences',
      sentencePlaceholder: 'Sentence text',
      emptySplitHint: 'No sentences yet. Add one below, or go back to rewrite the draft.',
      addSentence: 'Add sentence',
      deleteSentence: 'Delete sentence',
      next: 'Next',
      back: 'Back',
      appendButton: 'Append',
      replaceButton: 'Replace',
      close: 'Close',
      composeReadyHint: 'Ready — click Next to split the narration into sentences.',
      emptyDraftHint: 'Write the narration first, then click Next.',
      splitFooterHint: 'Edit, add or delete sentences, then Append below or Replace the existing narration.',
      defaultSegmentTitle: 'Narration segment',
    },
    videoUnderstandingPlaceholder: {
      title: 'Narration — from video',
      comingSoon: 'Coming soon',
      description: 'Narration generation from video understanding is under development and will arrive in a future update.',
      close: 'Close',
    },
  },
  'zh-CN': {
    common: {
      newTask: '新建任务',
      projects: '项目',
      library: '资源库',
      privacy: '隐私',
      terms: '条款',
      support: '支持',
      systemStatus: '系统状态',
      operational: '正常运行',
      close: '关闭',
      closePanel: '关闭面板',
      closeTab: '关闭标签 {title}',
      cancel: '取消',
      confirm: '确定',
      colon: '：',
      relativeTime: { justNow: '刚刚' },
    },
    header: {
      languageSelector: '语言',
      english: 'English',
      chinese: '中文',
      switchToLightMode: '切换到亮色模式',
      switchToDarkMode: '切换到暗色模式',
    },
    adminSettings: {
      groupApp: '应用',
      groupAi: 'AI 能力',
      groupMedia: '媒体与工具',
      general: '通用',
      generalDesc: '语言与外观',
      language: '语言',
      theme: '外观',
      lightTheme: '浅色',
      darkTheme: '深色',
      autoTheme: '跟随系统',
      generalAutoSaveNote: '修改立即生效，并保存在本机。',
      title: '管理员设置',
      subtitle: '管理系统设置和用户',
      inactive: '未激活',
      edit: '编辑',
      delete: '删除',
      loading: '加载中...',
      cancel: '取消',
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
      // Model settings quick-start empty states (desktop-config-free-startup)
      modelQuickStartTitle: '快速开始',
      modelQuickStartDesc: '三步接入 AI 模型，解锁对话、混剪与视觉理解能力。',
      modelQuickStartAddProvider: '添加服务商',
      modelAssignmentsNeedProvider: '先添加一个服务商，再为各功能分配模型。',
      modelAssignmentsGoProviders: '去添加服务商',
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
      effectiveConfigErrorBadge: '获取失败',
      effectiveConfigErrorDesc: '未能获取该功能类型的实际生效配置，请检查后端连接或刷新重试。',
      testConnectionFormat: '测试连接格式',
      modelInfo: '模型信息',
      formatUsed: '使用的格式',
      providerCard: '供应商卡片',
      modelApiKeyRequired: 'API Key 不能为空',
      modelDeleteProviderError: '删除供应商失败',
      modelModelsFound: '个模型已获取',
      modelKeyNotSet: '未设置',
      modelRequestFailed: '请求失败',
      confirmDelete: '删除',
      cancelDelete: '取消',
      deleting: '删除中...',
      saving: '保存中...',
      save: '保存',
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
      ttsConcurrencyInvariantError: '并发线程数不能超过最大并发线程数。',
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
      wmConcurrencyInvalid: '并发线程数不能超过最大并发线程数。',
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
      videoEditing: '视频编辑',
      brainstormingComingSoon: '头脑风暴功能即将推出',
      aiChat: 'AI对话',
      types: { video: '视频编辑', chat: 'AI 对话' },
      defaultPageTitle: 'Ecliptrix — 光影交汇之处',
    },
    videoProjects: {
      closeUnsavedTitle: '部分修改尚未保存',
      closeUnsavedBody: '保存项目时出错。现在关闭，最近的修改可能会丢失。',
      closeSaveSlowBody: '项目仍在保存。现在关闭，最近的修改可能会丢失。',
      keepOpen: '保持打开',
      closeAnyway: '仍然关闭',
      timelineRepaired: '项目中有 {count} 个片段的数据无效，已自动修复',
      timelineUnreadable: '时间轴数据无法读取，已保留原始数据的备份，并以空时间轴打开',
      title: '视频项目',
      projectActions: '项目操作',
      closeMenu: '关闭菜单',
      all: '全部项目',
      recent: '最近打开',
      uncategorized: '未分类',
      categories: '分类',
      newProject: '新建项目',
      newCategory: '新建分类',
      search: '搜索',
      searchPlaceholder: '搜索项目…',
      sortRecent: '最近打开',
      sortCreated: '创建时间',
      sortName: '名称',
      rename: '重命名',
      moveToCategory: '移动到分类',
      delete: '删除',
      deleteConfirmTitle: '删除 "{name}"？',
      deleteConfirm: '即将删除项目 "{name}"，此操作不可撤销。',
      deleteCategoryConfirm: '确认删除该分类？分类下的项目将变为"未分类"。',
      openProject: '打开',
      lastOpened: '上次打开',
      lastUpdated: '最近修改',
      neverOpened: '尚未打开',
      emptyTitle: '暂无项目',
      emptyHint: '创建第一个项目，开始你的视频剪辑之旅。',
      noResults: '没有匹配的项目。',
      untitled: '未命名',
      save: '保存',
      cancel: '取消',
      create: '创建',
      projectName: '项目名称',
      projectNamePlaceholder: '我的精彩视频',
      descriptionLabel: '简介（可选）',
      descriptionPlaceholder: '关于该项目的简短描述',
      categoryName: '分类名称',
      categoryNamePlaceholder: '例如：营销、旅行、教程',
      backToProjects: '返回项目列表',
      projectCount: '{count} 个项目',
      categoryAll: '全部',
      sidebarHeading: '项目',
      cardsHeading: '我的项目',
      saved: '已保存',
      saving: '保存中…',
      saveError: '保存项目失败',
      loadError: '加载项目失败',
      cover: '封面',
    },
    welcome: {
      title: '欢迎使用 Ecliptrix',
      subtitle: '光与影之交汇',
      description: '光与影之交汇，创造非凡内容。创建新任务开始您的创意之旅。',
      videoEditingDesc: '自动视频混剪和编辑',
      aiChatDesc: '智能对话和协助',
    },
    taskContent: {
      willBeImplemented: '任务内容将在此处实现',
      workspaceDescription: '这里将显示{type}工作区。每种任务类型的具体功能将在未来的迭代中实现。',
    },
    materialsPanel: {
      deleteConfirmTitle: '删除素材',
      deleteConfirmBody: '确定删除素材「{name}」吗？素材文件删除后无法恢复。',
      deleteConfirmBodyMany: '确定删除这 {count} 个素材吗？素材文件删除后无法恢复。',
      deleteInUseBody: '时间轴上有 {count} 个片段使用了「{name}」，删除素材会同时移除这些片段。素材文件删除后无法恢复。',
      deleteInUseBodyMany: '时间轴上有 {count} 个片段使用了这 {materialCount} 个素材，删除会同时移除这些片段。素材文件删除后无法恢复。',
      deleteBlockedLocked: '有 {count} 个使用该素材的片段位于锁定轨道上，请先解锁轨道再删除',
      deleteConfirmAction: '删除',
      deleteFailedClipsRemoved: '素材删除失败，文件仍保留；已移除的片段可按 Ctrl+Z 恢复',
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
      empty: {
        allTitle: '暂无素材',
        allDesc: '素材库为空，使用「上传素材」或「AI 创建」开始添加',
        videoTitle: '暂无视频素材',
        videoDesc: '点击「上传素材」上传视频，或「搜索视频」从素材库添加',
        audioTitle: '暂无音频素材',
        audioDesc: '点击「上传素材」上传音频，或使用「AI 创建」生成 TTS',
        imageTitle: '暂无图片素材',
        imageDesc: '点击「上传素材」上传图片，或「AI 创建」生成图片',
        frameTitle: '暂无帧素材',
        frameDesc: '使用「视频处理 → 视频帧提取」从视频中抽取帧',
        characterTitle: '暂无人物建模包',
        characterDesc: '使用「AI 人物建模」生成',
        sceneTitle: '暂无场景包',
        sceneDesc: '使用「AI 场景建模」生成',
        storyboardTitle: '暂无分镜包',
        storyboardDesc: '点击「AI 图像生成」创建分镜包',
        dragHint: '或者直接拖拽文件到此处本地导入',
      },
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
      uploadTooltip: '导入素材',
      uploadingProgress: '本地保存中...',
      uploadingMaterial: '本地保存中...',
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
      cacheStatus: {
        pending: '已加入缓存队列',
        downloading: '正在缓存以保证流畅预览',
        ready: '已缓存到本地',
        failed: '缓存失败',
        retry: '点击重试',
        scrubWaiting: '正在缓存…预览可能会短暂暂停',
      },
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
      framePack: '视频帧包',
      filterFramePack: '帧',
      deleteFramePack: '删除视频帧包',
      deleteFramePackConfirm: '确定要删除此视频帧包吗？所有提取的视频帧将被永久删除，其他位置对其帧的引用也会失效。',
      framePackBadge: '{count} 帧',
      addFramesToPack: '添加视频帧',
      addFramesToPackDisabledHint: '原视频已不在素材库，请先重新导入',
      addFramesToPackInFlight: '正在添加帧…',
      deleteFrame: '删除帧',
      deleteFrameConfirmTitle: '删除帧',
      deleteFrameConfirmBody: '确定要删除这一帧吗？此操作无法恢复。',
      frameDeleted: '帧已删除',
      framePackUpdated: '已追加到帧包',
      framePackEmptiedRemoved: '已删除最后一帧，帧包同步移除',
      referencePickerFramePack: '帧包',
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
      materialLibraryReferenceLabel: '参考图：{name}',
      audioBrokenBlob: '音频源不可用，请重新生成朗读。',
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
      replaceWarningTitle: '将替换时间轴上的部分内容',
      replaceWarningBody: '视频轨、图片轨与音频轨上的 {count} 个片段将被 AI 方案替换',
      preservedTracks: '以下轨道保持不变：{tracks}',
      undoHint: '完成后可按 Ctrl+Z 撤销',
    },
    aiMixingProgress: {
      errorInternal: '生成剪辑方案时出错，请重试',
      errorBackendUnreachable: '无法连接本地服务，请重启应用后重试',
      errorInvalidRequest: '部分素材信息无效，无法发送给剪辑模型',
      errorImportFailed: '剪辑方案无法应用到时间轴',
      analysisIncomplete: '{count} 个视频未能完成解析，方案仅参考了名称与时长',
      title: 'AI 混剪',
      stepAnalyze: '分析素材',
      stepPlan: '生成剪辑方案',
      stepApply: '应用到时间轴',
      analyzingVideos: '正在分析 {count} 个视频',
      planningHint: '通常需要 30–90 秒',
      cancel: '取消',
      cancelled: '已取消 AI 混剪，时间轴未改动',
      done: '已完成',
      success: 'AI 混剪已完成，可按 Ctrl+Z 撤销',
      noChanges: 'AI 混剪方案与当前时间轴一致，未做改动',
      partialWarning: '有 {count} 个片段无效，已忽略或调整',
      lockedTracksSkipped: '目标轨道已锁定，未被修改',
      blockedByAgent: 'Agent 正在编辑时间轴，请稍后再试',
      errorNoMaterials: '请先添加视频、音频或图片素材',
      errorModelNotConfigured: '尚未为「视频剪辑」指定模型，请在 设置 → 模型设置 中配置',
      errorUpstream: '剪辑模型请求失败，请检查网络或模型配置后重试',
      errorUnparseable: '模型返回的剪辑方案无法使用，请重试或更换模型',
      errorTimeout: 'AI 混剪超时，请减少素材数量后重试',
      errorInvalidResponse: '剪辑方案数据不完整',
      errorGeneric: 'AI 混剪失败：{message}',
    },
    agentUndo: {
      blockedWhileRunning: 'Agent 正在执行，完成后才能撤销',
      conflict: '时间轴在该操作之后已被修改，无法单独撤销，可使用 Ctrl+Z 逐步撤销',
      notUndoable: '该步骤没有可撤销的时间轴改动',
    },
    imageOverlay: {
      done: '完成',
      revert: '还原位置',
    },
    agentApply: {
      notApplied: '该步骤未能应用到时间轴',
      reasons: {
        clipNotFound: '片段不存在',
        trackNotFound: '轨道不存在',
        targetTrackMissing: '目标轨道不存在',
        invalidTime: '时间值无效',
      },
      finishing: '正在把最后的修改应用到时间轴…',
      finishingTimedOut: '部分修改应用超时，时间轴已解锁，请检查结果',
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
        motion: '运镜',
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
        motionShortcut: 'M',
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
        localTranscoding: '转码中',
        localDownloading: '下载中',
        localDownloadFailed: '下载失败 · 点击重试',
        localWillStream: '将以流式预览',
      },
              messages: {
          externalUpdateRejected: '外部修改无法应用，时间轴保持不变',
          splitTooCloseToEdge: '离片段边缘太近，无法切分（每段至少 0.1 秒）',
          incompatibleTrack: '这条轨道不能放置该类型的素材',
          materialNotFound: '素材库中已找不到该素材',
          noAudioItems: '没有找到音频项目，请先添加音频到时间轴。',
          noSubtitleTrack: '没有找到字幕轨道，请先添加字幕轨道。',
          subtitleExtractionFailed: '字幕提取失败，没有生成任何字幕内容。',
          subtitleExtractionSuccess: '字幕提取成功！{operation}了 {count} 个字幕片段。',
          replaceSubtitlesTitle: '替换现有字幕？',
          replaceSubtitlesBody: '将用识别结果替换现有 {count} 条字幕，可按 Ctrl+Z 撤销',
          replaceSubtitlesConfirm: '替换',
          subtitleTrackLocked: '字幕轨已锁定',
          editLockedByAgent: 'Agent 正在编辑时间轴，完成后可继续编辑',
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
          swapHint: '释放以交换位置',
        },
      cameraMotion: {
        title: '运镜',
        openPanel: '运镜',
        clipLabel: '片段：{name}',
        multiSelected: '已选中 {count} 个片段',
        applyToAllSelected: '应用到全部选中',
        tab2d: '2D 运镜',
        tab3d: '3D 运镜',
        presetsLabel: '运镜预设',
        stageTitle: '实时示意',
        intensity: '强度',
        intensityValue: '{value} 倍',
        easing: '缓动',
        easingLinear: '匀速',
        easingEaseIn: '缓入',
        easingEaseOut: '缓出',
        easingEaseInOut: '缓入缓出',
        range: '范围',
        rangeWholeClip: '整个片段',
        rangeCustom: '自定义',
        startOffset: '起始偏移',
        windowDuration: '持续时长',
        seconds: '秒',
        advanced: '高级参数',
        keyframeStart: '起点',
        keyframeEnd: '终点',
        fieldScale: '缩放',
        fieldX: '中心 X',
        fieldY: '中心 Y',
        fieldRoll: '旋转',
        fieldRotateX: '俯仰',
        fieldRotateY: '环绕',
        fieldDolly: '推轨',
        reverse: '反向',
        reverseAria: '反向运镜方向',
        apply: '应用',
        cancel: '取消',
        reset: '重置',
        discardConfirm: '放弃尚未应用的修改？',
        webglDegraded: '3D 预览已降级（WebGL 不可用），导出仍为完整 3D',
        qualityHintCover: '3D 角度较大，裁切较多，画质可能下降。',
        qualityHintRoll: '旋转运镜全程都有裁切，画质可能下降。',
        qualityHintClamped: '当前强度下部分参数已达上限，运镜会提前结束。',
        disabledNoSelection: '请先选中一个片段',
        disabledNotVisual: '仅视频与图片片段可添加运镜',
        disabledTrackLocked: '轨道已锁定',
        badgeTitle: '运镜：{preset}',
        // 与上面的 webglDegraded 共用同一句语义主句，但不重复归因：本角标同样
        // 覆盖运行期投影退化，那与 WebGL 无关（D29）。
        degradedBadge: '3D 运镜已降级为 2D 预览，导出仍为完整 3D',
        degradedBadgeDismiss: '关闭提示',
        stageScrub: '运镜进度',
        stageScrubValue: '运镜进度 {percent}%',
        stagePlay: '播放示意循环',
        stagePause: '暂停示意循环',
        keyframesLabel: '关键帧',
        keyframeStripHint: '在播放头处添加关键帧，拖动菱形可改变时刻',
        keyframeItem: '第 {index} / {count} 个关键帧，位于 {percent}%',
        keyframeItemLocked: '第 {index} / {count} 个关键帧，位于 {percent}%（时刻固定）',
        keyframeAdd: '在播放头处添加关键帧',
        keyframeAddBlockedOutside: '请先把播放头移到运镜窗口内',
        keyframeAddBlockedTooClose: '此处已有关键帧',
        keyframeAddBlockedLimit: '一段运镜最多 {max} 个关键帧',
        keyframeRemove: '删除选中的关键帧',
        keyframeRemoveBlocked: '首尾关键帧不可删除',
        segmentEasingAria: '第 {index} 到第 {next} 个关键帧之间的缓动',
        curveEasingNote: '存在曲线时，每一段各自选择缓动',
        windowBandLabel: '运镜窗口',
        stageOverlayLabel: '直接取景。方向键平移，+ / - 缩放，[ / ] 改变旋转',
        stageOverlayHint: '拖动取景 · 滚轮缩放 · Shift+拖动改旋转',
        stageDragHint: '拖动取景 · 滚轮缩放 · Shift+拖动环绕 / 俯仰',
        keyframeCounter: '关键帧 {index} / {count}',
        keyframeEditing: '正在编辑第 {index} 个关键帧',
        presets: {
          none: '无',
          pushIn: '缓慢推近',
          pullOut: '缓慢拉远',
          panLeft: '左移',
          panRight: '右移',
          panUp: '上移',
          panDown: '下移',
          zoomPanDiagonal: '推近并左移',
          rollSlight: '轻微旋转',
          dollyIn3d: '3D 推轨',
          dollyOut3d: '3D 拉轨',
          orbitLeft: '左环绕',
          orbitRight: '右环绕',
          tiltDown: '俯视下压',
          tiltUp: '仰视上抬',
          parallaxPush: '视差推进',
          sway3d: '3D 轻摆',
          custom: '自定义',
        },
      },
      subtitleEditModal: {
        styleSettings: '样式设置',
        editingSingle: '编辑单条字幕',
        editingAll: '编辑全部字幕',
        applyToAll: '应用到全部',
        presets: {
          default: '默认样式',
          classic: '经典样式',
          modern: '现代样式',
          elegant: '优雅样式',
          tech: '科技样式',
        },
        fonts: {
          default: '默认字体',
          serif: '衬线字体 (Serif)',
          sansSerif: '无衬线字体 (Sans-serif)',
          monospace: '等宽字体 (Monospace)',
        },
        positions: {
          top: '顶部居中',
          upper34: '上3/4高度',
          center: '居中',
          lower34: '下3/4高度',
          bottom: '底部',
        },
        closeAriaLabel: '关闭',
        discardChangesTitle: '放弃未保存的修改？',
        discardChangesBody: '关闭后，本次对字幕的修改不会保存',
        discardChangesConfirm: '放弃修改',
        noSubtitlesHint: '请先在时间轴上添加字幕后再进行编辑',
        presetsHeading: '预设样式',
        presetSample: '示例文字',
        fontFamily: '字体类型',
        fontSize: '字体大小: {size}px',
        fontColor: '字体颜色',
        backgroundColor: '背景颜色',
        enableBackground: '启用背景',
        position: '字幕位置',
        stylePreview: '样式预览',
        stylePreviewSample: '这是字幕预览文字',
        contentHeading: '字幕内容编辑',
        contentHint: '点击字幕片段进行编辑',
        itemPreviewFallback: '字幕预览',
        countSummary: '共 {count} 个字幕片段',
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
        durationUnit: '秒',
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
      previewUnavailable: '预览不可用',
      previewUnavailableHint: '该视频无法在此内联预览。请检查网络/代理，或在浏览器中打开。',
      openInBrowser: '在浏览器中打开',
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
        materialsDownloading: '素材下载中，请稍候（已就绪 {ready}/{total}）',
        materialsStreamingNotice: '{count} 个片段将以流式预览',
        localMediaOverBudget: '预览素材已超出内存预算，可能影响播放稳定性',
      },
      controls: {
        volume: '音量',
        playbackSpeed: '播放速度',
        fullscreen: '全屏',
        seekAriaLabel: '视频进度条',
        volumeAriaLabel: '音量',
        previewVolumeAriaLabel: '预览音量',
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
        emptyTimeline: '请先添加视频/图片/音频素材到时间轴后再导出',
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
      errorNoPlayableSource: '视频源不可播放，请重新导入素材或检查网络。',
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
    videoCoverModal: {
      title: '视频封面',
      button: '封面',
      templates: {
        title: '标题',
        tutorial: '教程',
        click: '吸睛',
        minimal: '极简',
      },
      source: {
        label: '来源',
        frame: '视频帧',
        upload: '上传',
        frameDisabledHint: '请先在时间轴添加视频片段，再选取封面帧',
        noFramesAvailable: '暂无可用帧 —— 请上传一张图片',
      },
      scrubber: {
        tooltip: '拖动选择封面帧',
        atTime: '当前 {time}',
        noVideoItems: '时间轴上没有视频片段',
      },
      textTools: {
        font: '字体',
        size: '字号',
        color: '颜色',
        align: '对齐',
        alignLeft: '左对齐',
        alignCenter: '居中',
        alignRight: '右对齐',
        bold: '加粗',
        italic: '斜体',
        underline: '下划线',
        colorSwatch: '颜色选择器',
        colorInvalid: '请输入十六进制颜色，如 #fff 或 #ffffff',
        sizeClamped: '已自动调整：{from} → {to}',
      },
      upload: {
        hint: 'PNG / JPG，最大 10 MB',
        drop: '拖入图片或点击浏览',
        browse: '浏览',
        tooLarge: '文件过大（上限 10 MB）',
        wrongType: '不支持的文件类型',
      },
      actions: {
        cancel: '取消',
        download: '下载封面',
        downloadFilename: '{slug}-cover.png',
      },
      errors: {
        extractFailed: '抽帧失败',
        saveFailed: '保存封面失败',
        uploadFailed: '上传背景图失败',
        renderFailed: '生成封面失败',
      },
      a11y: {
        layerBadge: '徽章文字',
        layerTitle: '标题文字',
        layerSubtitle: '副标题文字',
        layerEyebrow: '眉头文字',
        layerCta: '行动号召文字',
        layerGeneric: '{key} 文字',
        frameSlider: '拖动以选取一帧',
      },
    },
    videoExport: {
      nothingVisibleToExport: '时间轴上没有可导出的画面，请先添加视频或图片',
      missingMaterials: '有 {count} 个片段的素材已被删除（{names}），请先删除这些片段再导出',
      degradedTitle: '导出已完成，但以下内容未写入视频：',
      degradedImageOverlay: '图片未渲染：{names}',
      degradedSubtitles: '字幕未能烧录到视频中',
      degradedAudioItem: '音频未混入：{names}',
      degradedEmbeddedAudio: '视频原声未混入：{names}',
      blackTailNotice: '视频末尾 {seconds} 秒没有画面，将显示为黑屏',
      moreItems: '等 {count} 个',
      noContentToExport: '没有视频内容可导出',
      noContentToExportDesc: '请先添加视频素材到时间轴',
      noContentToExportFull: '没有视频内容可导出，请先添加视频素材到时间轴',
      exportCompletedButDownloadFailed: '视频导出已完成但下载失败。请刷新页面后重试，或联系技术支持。',
      exportTimeout: '视频导出超时：处理时间超过10分钟限制。请尝试减少视频时长或复杂度，降低输出分辨率，或稍后重试。',
      exportFailed: '视频导出失败',
      exportFailedWithError: '视频导出失败：',
      failedVideos: '失败的视频：',
      recoverySuggestions: '建议解决方案：',
      compositionWarningsTitle: '导出已完成，但部分片段的运镜未能按预览渲染：',
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
       tabsLabel: '脚本类型',
       tabs: {
         narrationScript: '解说脚本',
         aiVideoScript: 'AI视频脚本',
       },
       header: {
         title: '文案/脚本',
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
        convertAllSpeechDesc: '对全部片段依次生成语音',
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
         scriptWillAppear: '文案/脚本将显示在这里',
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
         searchPlaceholder: '搜索声音…',
         genderAll: '全部',
         genderMale: '男声',
         genderFemale: '女声',
         noVoicesMatched: '无匹配声音',
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
         sentenceAiVideoButton: 'AI视频',
         sentenceAiVideoGenerating: '生成中…',
         sentenceAiVideoSucceeded: '\u2713 已生成',
         sentenceAiVideoFailed: '失败，重试',
         sentenceAiVideoModalSubtitle: '为当前句生成 AI 视频',
         sentenceAiVideoSuccessToast: 'AI 视频生成成功并已关联脚本',
         sentenceAiVideoFailedToast: 'AI 视频生成失败：{reason}',
         sentenceAiVideoDurationHint: '当前句 {actual}s，已就近选择 {bucket}s（>12s 建议手动拆句）',
         aiPromptButton: 'AI提示词',
         aiPromptGenerating: '生成中…',
         aiPromptRetry: '重新生成',
         aiPromptFailedToast: 'AI 提示词生成失败：{reason}',
         videoScriptGenerating: 'AI 视频脚本生成中…',
         videoScriptFailed: 'AI 视频脚本生成失败',
         videoScriptRetry: '重新生成',
        },
     },
   videoEditing: {
     autoMix: {
       orphansIgnored: '已忽略 {count} 个来自已删除或旧脚本段落的素材',
       videoShort: '第 {list} 段的视频不足以覆盖配音',
       noMaterials: '请先添加视频、音频或图片素材后再使用自动混剪。',
       noScriptMaterials: '自动混剪需要由文本脚本生成的音频和视频素材，请先在「文本脚本」面板完成 TTS 与 AI 视频匹配。',
       replaceConfirmTitle: '替换现有片段？',
       replaceConfirmBody: '将替换视频轨 1 与音频轨 1 中的 {count} 个片段，其他轨道保持不变，可按 Ctrl+Z 撤销',
       applied: '已按 {segments} 个段落完成排布',
       skippedNoAudio: '第 {list} 段尚未生成配音，已跳过',
       duplicatesIgnored: '已忽略 {count} 个旧版本素材',
       trackLocked: '视频轨 1 或音频轨 1 已锁定',
       noTargetTrack: '时间轴缺少视频轨或音频轨，无法自动排布',
       confirm: '替换',
       cancel: '取消',
     },
     agentDock: {
       fabLabel: 'AI 剪辑助手',
       panelTitle: 'AI 剪辑助手',
       close: '收起',
       busy: 'Agent 执行中…',
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
      selectStoryboardPackHint: '请在下方下拉菜单中选择已生成的分镜包',
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
      batchCount: '批次数',
      batchCountValue: '{batches} 批 × 2×2（共 {totalCells} 格）',
      batchLabel: '第 {index} / {total} 批',
      aspectRatio: '画面比例',
      totalFrames: '总幕数',
      hint: '每一批都是一次 2×2 Seedream 调用，并以上一批的最后两幕作为参考链式生成。',
      ariaLabel: '{aspectRatio} 分镜预览，{batches} 批链式 2×2 共 {frameCount} 幕',
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
      stopAgentTooltip: '停止 Agent',
      stopButtonLabel: '停止',
      agentBusyThinking: 'Agent 思考中…',
      agentBusyTool: 'Agent 正在执行 {tool}…',
      agentBusyWorking: 'Agent 执行中…',
      agentToolCancelled: '已取消',
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
        workflowsAvailableWithEmpty: '{count} 个工作流可用 · {empty} 个为空',
        emptyWorkflowHint: '请先在工作流编辑器中为该工作流添加节点',
        idLabel: '编号',
        updatedAt: '更新于 {time}',
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
      frameExtraction: {
        tab: '视频帧提取',
        selectVideoHeading: '选择要提取帧的视频素材',
        selectVideoEmpty: '暂无视频素材，请先上传',
        ingestProgress: '正在缓存视频以便抓帧…',
        ingestFailed: '视频缓存失败',
        ingestRetry: '重试',
        ingestCancel: '返回',
        capture: '抓取当前帧',
        previousFrame: '上一帧',
        nextFrame: '下一帧',
        playPause: '播放 / 暂停',
        capturedListEmpty: '暂未抓取任何帧 — 拖动进度条到目标时刻后点击抓取。',
        capturedListTitle: '已抓取的帧',
        capturedListCount: '{count} / {max}',
        removeFrame: '移除',
        capReached: '已达 {max} 帧上限，请先移除部分帧再抓取。',
        doneNoFrames: '请至少抓取一帧再保存。',
        done: '保存为帧包',
        saving: '保存中…',
        saveSuccess: '视频帧包已创建',
        saveFailed: '保存视频帧包失败',
        payloadTooLarge: '上传总大小超出限制，请减少帧数或降低 JPEG 质量。',
        seekHint: '空格：播放 / 暂停 · ←/→：上下一帧 · C：抓取',
        loadingDuration: '加载中…',
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
      partialBadge: '不完整',
      partialBanner: '分镜包不完整：仅生成 {completed}/{total} 帧（{batchesDone}/{batchesTotal} 批次成功），缺失的分镜未显示。',
      partialMissingScenes: '缺失的分镜：{scenes}',
      partialErrorPrefix: '原因：',
    },
    mobileWarning: {
      tablet: '平板设备',
      mobile: '手机设备',
      mobileDevice: '移动设备',
      title: '暂不支持{device}',
      description: '为了提供更好的使用体验，请在电脑上访问本应用。',
      useDesktop: '建议使用电脑访问',
    },
    sceneCountInput: {
      label: '幕数',
      placeholder: '输入幕数 (1-16)',
      batchesHint: '共生成 {count} 幕，按 2×2 分镜链式分成 {batches} 批（每批 {batchSize} 幕）。',
      maxScenesExceededTip: '最多支持 {max} 幕分镜。',
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
      size1kSquare: '1:1 (1024×1024)',
      size2kSquare: '1:1 (2048×2048)',
      size169Landscape: '16:9 (1280×720)',
      size916Portrait: '9:16 (720×1280)',
      size169Wide: '16:9 (1024×576)',
      size916Wide: '9:16 (576×1024)',
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
      storyboardImageAlt: '分镜画面',
      partialFramesNotice: '部分批次失败：{completed}/{total} 批次成功，未生成的分镜不会显示。',
      partialMissingScenes: '缺失的分镜：{scenes}',
      emptyFramesNotice: '未生成任何分镜，请重试。',
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
      normalChat: '普通对话',
      copiedTitle: '已复制!',
      copyMessageTitle: '复制消息',
      convertToScriptTitle: '转换视频脚本',
      generating: '生成中',
      copied: '已复制',
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
      exportClips: '保存本地切片',
      noClips: '还没有创建任何切片',
      startBeforeEnd: '开始时间必须小于结束时间',
      minDuration: '切片时长至少需要0.5秒',
      clipCreated: '已创建切片：',
      clipDeleted: '切片已删除',
      noClipsToExport: '没有可导出的切片',
      noMaterial: '原始素材不存在',
      clipsExported: '已保存 ',
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
    notFound: {
      title: '页面未找到',
      description: '您访问的页面不存在或已被移除。',
      goHome: '返回首页',
      goBack: '返回上一页',
    },
    setupGuide: {
      title: '欢迎使用 Ecliptrix',
      description: 'AI 功能需要先配置模型 API 凭证才能使用。素材浏览与剪辑不受影响——您可以随时完成配置。',
      stepProviderTitle: '添加模型服务商',
      stepProviderDesc: '填入 AI 服务商的 API 地址与密钥',
      stepTestTitle: '测试连接',
      stepTestDesc: '一键验证密钥是否可用',
      stepAssignTitle: '分配给功能',
      stepAssignDesc: '为对话、混剪、视觉理解选择模型',
      goToSettings: '前往设置',
      later: '稍后再说',
      settingsAttentionHint: '模型凭证待配置',
    },
    narrationDirectScript: {
      modeNarrationDirect: '解说直接生成',
      modeNarrationDirectDesc: '与 AI 对话撰写并拆分解说文案',
      modeVideoUnderstanding: '视频理解生成',
      modeVideoUnderstandingDesc: '基于视频理解生成解说（开发中）',
      title: '解说直接生成',
      stepComposeLabel: '撰写文案',
      stepSplitLabel: '拆分精修',
      draftLabel: '解说文案',
      draftPlaceholder: '在此撰写解说文案，或在右侧让 AI 帮你撰写…',
      streamingHint: '正在改写文案 · 编辑已锁定',
      chatPanelTitle: 'AI 助手',
      chatPlaceholder: '描述你的需求，例如「写一段 30 秒咖啡探店解说」',
      chatEmptyHint: '告诉 AI 你想要的解说，它会改写左侧文案。',
      roleUser: '用户',
      roleAssistant: 'AI',
      assistantThinking: '正在改写文案…',
      reasoningLabel: '思考过程',
      send: '发送',
      cancel: '中止',
      splitting: '正在逐句拆分…',
      splitSentencesLabel: '解说句子',
      sentenceCount: '{count} 句',
      sentencePlaceholder: '句子内容',
      emptySplitHint: '暂无句子，可在下方新增，或返回上一步重新撰写文案。',
      addSentence: '新增句子',
      deleteSentence: '删除句子',
      next: '下一步',
      back: '上一步',
      appendButton: '追加',
      replaceButton: '替换',
      close: '关闭',
      composeReadyHint: '文案就绪 — 点击「下一步」逐句拆分。',
      emptyDraftHint: '请先撰写解说文案，再点击「下一步」。',
      splitFooterHint: '可编辑 / 新增 / 删除句子，然后「追加」到下方，或「替换」现有解说文案。',
      defaultSegmentTitle: '解说段落',
    },
    videoUnderstandingPlaceholder: {
      title: '视频理解生成',
      comingSoon: '功能开发中',
      description: '基于视频理解的解说生成正在开发中，后续版本将上线，敬请期待。',
      close: '关闭',
    },
  },
};

export type SupportedLocale = keyof typeof translations;

export const defaultLocale: SupportedLocale = 'en';

export function getTranslations(locale: SupportedLocale = defaultLocale): Translations {
  return translations[locale] || translations[defaultLocale];
}
