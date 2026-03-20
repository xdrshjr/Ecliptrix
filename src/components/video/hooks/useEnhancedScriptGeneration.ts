/**
 * useEnhancedScriptGeneration Hook
 *
 * Unified hook for the enhanced video script generation panel. Manages:
 *   - Tab state (AI video vs normal script)
 *   - Chat message toggle and retrieval from conversations
 *   - Custom prompt state with character limit
 *   - Prompt polishing via /api/prompt-polish (with undo support)
 *   - Generation routing: dispatches to the correct API based on tab + video availability
 *   - Loading / progress / error states
 *
 * This hook does NOT duplicate logic that already lives in the existing hooks
 * (useVideoUnderstandingScript, useScriptGeneration) or utilities
 * (chatMessageUtils, polishPrompt client).
 */

import { useState, useCallback, useMemo } from 'react';
import {
  MaterialItem,
  ScriptSegment,
  AIVideoScriptSegment,
  Conversation,
  ChatMessage,
  ScriptGenerationConfig,
} from '@/types';
import { VideoEditingLogger } from '../utils/logger';
import { useNotification } from '@/contexts/NotificationContext';
import {
  VideoUnderstandingScriptMode,
  ScriptGenerationParameters,
  VideoUnderstandingScriptProgress,
} from '../types/videoEditingTypes';
import { polishPrompt as polishPromptAPI } from '@/lib/api/promptPolish';
import {
  truncateChatMessages,
  serializeChatMessages,
} from '@/lib/utils/chatMessageUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScriptTab = 'ai-video' | 'normal';

export interface UseEnhancedScriptGenerationParams {
  taskId: string;

  /** Currently selected videos in the modal */
  selectedVideos: MaterialItem[];

  /** Script generation parameters (language, segmentCount, etc.) */
  scriptParameters: ScriptGenerationParameters;

  /** Script generation config (for normal script via useScriptGeneration path) */
  scriptConfig?: ScriptGenerationConfig;

  /** Reference text from the modal step */
  referenceText?: string;

  /** Video understanding mode (quick / professional) */
  mode?: VideoUnderstandingScriptMode;

  /** All conversations from task content */
  conversations: Conversation[];

  /** Active conversation ID */
  activeConversationId: string | null;

  /** Callback when normal script segments are generated */
  onScriptGenerated?: (segments: ScriptSegment[]) => void;

  /** Callback when AI video script segments are generated */
  onAIVideoScriptGenerated?: (segments: AIVideoScriptSegment[]) => void;

  /** Callback invoked with the enriched referenceText + mode + params for the
   *  video-understanding path (delegates actual API call to parent/hook). */
  onVideoUnderstandingGenerate?: (
    selectedVideos: MaterialItem[],
    referenceText: string,
    parameters: ScriptGenerationParameters,
    mode: VideoUnderstandingScriptMode,
    chatMessages?: ChatMessage[],
    customPrompt?: string,
  ) => void;
}

export interface UseEnhancedScriptGenerationReturn {
  // Tab
  activeTab: ScriptTab;
  setActiveTab: (tab: ScriptTab) => void;

  // Chat toggle
  includeChatMessages: boolean;
  setIncludeChatMessages: (v: boolean) => void;
  chatMessageCount: number;
  hasChatMessages: boolean;

  // Custom prompt
  customPrompt: string;
  handleCustomPromptChange: (value: string) => void;

  // Polish
  polishPrompt: () => Promise<void>;
  isPolishing: boolean;
  canUndo: boolean;
  undoPolish: () => void;

  // Generation
  generate: () => Promise<void>;
  isGenerating: boolean;
  canGenerate: boolean;

  // Reset (call when modal opens)
  resetState: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CUSTOM_PROMPT_MAX_LENGTH = 500;

// ---------------------------------------------------------------------------
// Helper: build video analysis context from selected videos metadata
// ---------------------------------------------------------------------------

export function buildVideoAnalysisContext(
  selectedVideos: MaterialItem[],
): string | undefined {
  const analyzed = selectedVideos
    .filter((v) => v.metadata?.video_analysis)
    .map((v) => {
      const analysis = v.metadata!.video_analysis;
      // Construct a concise summary from frame analyses
      const frames = analysis.frame_analyses;
      if (frames && Array.isArray(frames) && frames.length > 0) {
        const descriptions = frames
          .map((f: { description?: string }) => f.description)
          .filter(Boolean)
          .join('; ');
        return `Video "${v.name}" (${analysis.video_duration ?? '?'}s): ${descriptions}`;
      }
      return `Video "${v.name}"`;
    });

  return analyzed.length > 0 ? analyzed.join('\n') : undefined;
}

// ---------------------------------------------------------------------------
// Helper: build enriched reference text (merges all optional input sources)
// ---------------------------------------------------------------------------

export function buildEnrichedReferenceText(
  originalRef?: string,
  chatMessages?: ChatMessage[],
  customPrompt?: string,
): string {
  const parts: string[] = [];

  if (originalRef && originalRef.trim()) {
    parts.push(originalRef.trim());
  }

  if (chatMessages && chatMessages.length > 0) {
    const serialized = serializeChatMessages(chatMessages);
    if (serialized) {
      parts.push(`【对话参考】\n${serialized}`);
    }
  }

  if (customPrompt && customPrompt.trim()) {
    parts.push(`【用户需求】\n${customPrompt.trim()}`);
  }

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEnhancedScriptGeneration(
  params: UseEnhancedScriptGenerationParams,
): UseEnhancedScriptGenerationReturn {
  const {
    taskId,
    selectedVideos,
    scriptParameters,
    scriptConfig,
    referenceText,
    mode,
    conversations,
    activeConversationId,
    onScriptGenerated,
    onAIVideoScriptGenerated,
    onVideoUnderstandingGenerate,
  } = params;

  const { showSuccess, showError } = useNotification();

  const logger = useMemo(
    () =>
      new VideoEditingLogger({
        taskId,
        component: 'useEnhancedScriptGeneration',
      }),
    [taskId],
  );

  // --- State ---------------------------------------------------------------

  const [activeTab, setActiveTab] = useState<ScriptTab>('ai-video');
  const [includeChatMessages, setIncludeChatMessages] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [previousPrompt, setPreviousPrompt] = useState<string | null>(null);
  const [isPolishing, setIsPolishing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // --- Derived values ------------------------------------------------------

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );

  const activeChatMessages: ChatMessage[] = useMemo(
    () => activeConversation?.messages ?? [],
    [activeConversation],
  );

  const hasChatMessages = activeChatMessages.length > 0;
  const chatMessageCount = activeChatMessages.length;

  const hasVideoInput = selectedVideos.length > 0;
  const hasChatInput = includeChatMessages && hasChatMessages;
  const hasPromptInput = customPrompt.trim().length > 0;

  // At least one input source must be present
  const canGenerate = hasVideoInput || hasChatInput || hasPromptInput;

  const canUndo = previousPrompt !== null;

  // --- Custom prompt handler (clears undo on manual edit) ------------------

  const handleCustomPromptChange = useCallback(
    (value: string) => {
      if (value.length > CUSTOM_PROMPT_MAX_LENGTH) return;
      setCustomPrompt(value);
      // Clear undo state when user manually edits (not during polish)
      if (!isPolishing) {
        setPreviousPrompt(null);
      }
    },
    [isPolishing],
  );

  // --- Polish prompt -------------------------------------------------------

  const polishPromptHandler = useCallback(async () => {
    if (!customPrompt.trim() || isPolishing) return;

    logger.userAction('点击优化提示词', 'polishPrompt', {
      promptLength: customPrompt.length,
      activeTab,
    });

    // Save current prompt for undo BEFORE starting the async call
    const savedPrompt = customPrompt;
    setPreviousPrompt(savedPrompt);
    setIsPolishing(true);

    try {
      // Prepare optional chat context
      const chatContext =
        includeChatMessages && activeChatMessages.length > 0
          ? truncateChatMessages(activeChatMessages)
          : undefined;

      const videoContext = buildVideoAnalysisContext(selectedVideos);

      const result = await polishPromptAPI({
        prompt: customPrompt,
        chatMessages: chatContext,
        videoAnalysisContext: videoContext,
        targetType: activeTab,
      });

      if (result.success && result.polishedPrompt) {
        // Replace prompt with polished version (enforce max length)
        const polished = result.polishedPrompt.length > CUSTOM_PROMPT_MAX_LENGTH
          ? result.polishedPrompt.slice(0, CUSTOM_PROMPT_MAX_LENGTH)
          : result.polishedPrompt;
        setCustomPrompt(polished);
        // previousPrompt stays set so undo is available
        logger.info('提示词优化成功', {
          originalLength: savedPrompt.length,
          polishedLength: result.polishedPrompt.length,
        });
      } else {
        // Polish failed — clear undo state so button disappears
        setPreviousPrompt(null);
        const msg = result.message || '提示词优化失败';
        showError(msg);
        logger.warn('提示词优化失败', { message: msg });
      }
    } catch (error) {
      // Unexpected error — clear undo state
      setPreviousPrompt(null);
      const msg = error instanceof Error ? error.message : '提示词优化失败';
      showError(msg);
      logger.error('提示词优化异常', { error: msg });
    } finally {
      setIsPolishing(false);
    }
  }, [
    customPrompt,
    isPolishing,
    includeChatMessages,
    activeChatMessages,
    selectedVideos,
    activeTab,
    logger,
    showError,
  ]);

  // --- Undo polish ---------------------------------------------------------

  const undoPolish = useCallback(() => {
    if (previousPrompt !== null) {
      logger.userAction('撤销提示词优化', 'undoPolish', {
        polishedLength: customPrompt.length,
        originalLength: previousPrompt.length,
      });
      setCustomPrompt(previousPrompt);
      setPreviousPrompt(null);
    }
  }, [previousPrompt, customPrompt, logger]);

  // --- Generate (routes to correct API) ------------------------------------

  const generate = useCallback(async () => {
    if (!canGenerate || isGenerating) return;

    setIsGenerating(true);

    // Prepare chat messages (truncated) if enabled
    const chatMsgs: ChatMessage[] | undefined =
      includeChatMessages && activeChatMessages.length > 0
        ? truncateChatMessages(activeChatMessages)
        : undefined;

    const trimmedPrompt = customPrompt.trim() || undefined;

    logger.info('开始生成脚本', {
      activeTab,
      hasVideo: hasVideoInput,
      hasChatMessages: !!chatMsgs,
      chatMessageCount: chatMsgs?.length ?? 0,
      hasCustomPrompt: !!trimmedPrompt,
      selectedVideoCount: selectedVideos.length,
    });

    try {
      if (activeTab === 'ai-video') {
        // ------------------------------------------------------------------
        // AI Video Script — always goes to /api/ai-video-script-generation
        // Works with or without video (videoAnalysisContext is optional)
        // ------------------------------------------------------------------
        const videoContext = buildVideoAnalysisContext(selectedVideos);

        const config: ScriptGenerationConfig = scriptConfig || {
          language: scriptParameters.language || 'chinese',
          consistency: 'moderate',
          segmentCount: scriptParameters.segmentCount || 5,
          customRequirements: '',
        };

        const response = await fetch('/api/ai-video-script-generation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            scriptConfig: config,
            chatMessages: chatMsgs,
            customPrompt: trimmedPrompt,
            videoAnalysisContext: videoContext,
            selectedVideos: selectedVideos.map((v) => ({
              id: v.id,
              title: v.name,
              url: v.url,
              duration: v.duration,
            })),
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(
            errData.error || `HTTP error! status: ${response.status}`,
          );
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || 'AI视频脚本生成失败');
        }

        logger.info('AI视频脚本生成成功', {
          segmentCount: result.segments.length,
        });

        showSuccess('AI视频脚本生成成功！');

        // Convert API segments to AIVideoScriptSegment
        if (onAIVideoScriptGenerated) {
          const segments: AIVideoScriptSegment[] = result.segments.map(
            (seg: { title?: string; scriptText?: string }, index: number) => ({
              id: `ai-video-seg-${Date.now()}-${index}`,
              title: seg.title || `Scene ${index + 1}`,
              scriptText: seg.scriptText || '',
              generationStatus: 'idle' as const,
              generationProgress: 0,
            }),
          );
          onAIVideoScriptGenerated(segments);
        }
      } else {
        // ------------------------------------------------------------------
        // Normal Script — route depends on whether videos are selected
        // ------------------------------------------------------------------
        if (hasVideoInput) {
          // Normal + video → video-understanding-script
          // Delegate to the parent callback which uses useVideoUnderstandingScript
          // The enriched referenceText merges all input sources
          if (onVideoUnderstandingGenerate) {
            // Pass raw referenceText — the downstream pipeline
            // (useVideoUnderstandingScript → /api/video-understanding-script)
            // handles enrichment with chatMessages and customPrompt separately.
            // Do NOT pre-enrich here to avoid double-appending.
            const effectiveMode: VideoUnderstandingScriptMode = mode || {
              type: 'quick',
            };
            onVideoUnderstandingGenerate(
              selectedVideos,
              referenceText || '',
              scriptParameters,
              effectiveMode,
              chatMsgs,
              trimmedPrompt,
            );
            logger.info('委托视频理解脚本生成', {
              videoCount: selectedVideos.length,
              referenceTextLength: (referenceText || '').length,
            });
          } else {
            // Fallback: call the API directly
            // Pass raw referenceText + separate chatMessages/customPrompt
            // The API route's enrichReferenceText will merge them
            const response = await fetch('/api/video-understanding-script', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                selectedVideos,
                referenceText: referenceText || '',
                parameters: scriptParameters,
                taskId,
                chatMessages: chatMsgs,
                customPrompt: trimmedPrompt,
              }),
            });

            if (!response.ok) {
              const errData = await response.json().catch(() => ({}));
              throw new Error(
                errData.error || `HTTP error! status: ${response.status}`,
              );
            }

            const result = await response.json();
            if (!result.success) {
              throw new Error(result.error || '脚本生成失败');
            }

            showSuccess('脚本生成成功！');
            onScriptGenerated?.(result.segments);
          }
        } else {
          // Normal + no video → video-script-generation (text-only)
          const config: ScriptGenerationConfig = scriptConfig || {
            language: scriptParameters.language || 'chinese',
            consistency: 'moderate',
            segmentCount: scriptParameters.segmentCount || 5,
            customRequirements: '',
          };

          // Build markdown content from available sources
          const markdownParts: string[] = [];
          if (referenceText && referenceText.trim()) {
            markdownParts.push(referenceText.trim());
          }

          const response = await fetch('/api/video-script-generation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              markdownContent: markdownParts.join('\n\n'),
              taskId,
              scriptConfig: config,
              chatMessages: chatMsgs,
              customPrompt: trimmedPrompt,
            }),
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(
              errData.error || `HTTP error! status: ${response.status}`,
            );
          }

          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error || '脚本生成失败');
          }

          logger.info('普通脚本生成成功', {
            segmentCount: result.segments.length,
          });

          showSuccess('脚本生成成功！');
          onScriptGenerated?.(result.segments);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '脚本生成失败';
      logger.error('脚本生成失败', { error: msg, activeTab, hasVideoInput });
      showError(`脚本生成失败: ${msg}`);
    } finally {
      setIsGenerating(false);
    }
  }, [
    canGenerate,
    isGenerating,
    activeTab,
    hasVideoInput,
    includeChatMessages,
    activeChatMessages,
    customPrompt,
    selectedVideos,
    scriptParameters,
    scriptConfig,
    referenceText,
    mode,
    taskId,
    logger,
    showSuccess,
    showError,
    onScriptGenerated,
    onAIVideoScriptGenerated,
    onVideoUnderstandingGenerate,
  ]);

  // --- Reset ---------------------------------------------------------------

  const resetState = useCallback(() => {
    setActiveTab('ai-video');
    setIncludeChatMessages(false);
    setCustomPrompt('');
    setPreviousPrompt(null);
    setIsPolishing(false);
    setIsGenerating(false);
  }, []);

  // --- Return --------------------------------------------------------------

  return {
    activeTab,
    setActiveTab,
    includeChatMessages,
    setIncludeChatMessages,
    chatMessageCount,
    hasChatMessages,
    customPrompt,
    handleCustomPromptChange,
    polishPrompt: polishPromptHandler,
    isPolishing,
    canUndo,
    undoPolish,
    generate,
    isGenerating,
    canGenerate,
    resetState,
  };
}
