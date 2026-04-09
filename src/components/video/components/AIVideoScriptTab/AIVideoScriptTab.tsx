'use client';

import React, { useCallback, useState } from 'react';
import { AIVideoScriptSegment, MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { useAIVideoScriptGeneration } from '../../hooks/useAIVideoScriptGeneration';
import ImagePickerSlot from './ImagePickerSlot';
import { http, ApiError } from '@/lib/api/http-client';

export function createAIVideoSegment(title: string, scriptText?: string, narrationText?: string): AIVideoScriptSegment {
  return {
    id: `ai-video-seg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title,
    scriptText: scriptText || '',
    narrationText,
    generationMode: 'description',
    duration: 5,
    generationStatus: 'idle',
  };
}

interface AIVideoScriptTabProps {
  segments: AIVideoScriptSegment[];
  onUpdateSegments: (segments: AIVideoScriptSegment[]) => void;
  onAddMaterial?: (material: MaterialItem) => void;
  materials?: MaterialItem[];
  taskId?: string;
}

const AIVideoScriptTab: React.FC<AIVideoScriptTabProps> = ({
  segments,
  onUpdateSegments,
  onAddMaterial,
  materials = [],
  taskId,
}) => {
  const { t } = useLocale();
  const { showWarning } = useNotification();
  const { generateVideo, cancelGeneration } = useAIVideoScriptGeneration(segments, onUpdateSegments, onAddMaterial);
  const [expandingSegmentId, setExpandingSegmentId] = useState<string | null>(null);
  const [expandDialogSegmentId, setExpandDialogSegmentId] = useState<string | null>(null);
  const [expandGoal, setExpandGoal] = useState('');

  const handleAddSegment = useCallback(() => {
    const title = t.scriptPanel.aiVideoScript.segmentTitle.replace('{index}', String(segments.length + 1));
    onUpdateSegments([...segments, createAIVideoSegment(title)]);
  }, [segments, onUpdateSegments, t]);

  const handleRemoveSegment = useCallback((segmentId: string) => {
    cancelGeneration(segmentId);
    onUpdateSegments(segments.filter(s => s.id !== segmentId));
  }, [segments, onUpdateSegments, cancelGeneration]);

  const handleUpdateSegment = useCallback((segmentId: string, updates: Partial<AIVideoScriptSegment>) => {
    onUpdateSegments(segments.map(s => s.id === segmentId ? { ...s, ...updates } : s));
  }, [segments, onUpdateSegments]);

  const handleGenerate = useCallback((segmentId: string) => {
    const segIndex = segments.findIndex(s => s.id === segmentId);
    const seg = segments[segIndex];
    if (!seg) return;

    if (seg.autoTransition && segIndex > 0) {
      const prevSeg = segments[segIndex - 1];
      if (!prevSeg || prevSeg.generationStatus !== 'succeeded' || !prevSeg.generatedVideoUrl) {
        showWarning(t.scriptPanel.aiVideoScript.previousVideoNotGenerated);
        return;
      }
    }

    generateVideo(segmentId);
  }, [segments, generateVideo, showWarning, t]);

  const handleExpandScript = useCallback(async (segmentId: string, goal?: string) => {
    const segmentIndex = segments.findIndex(s => s.id === segmentId);
    const segment = segments[segmentIndex];
    if (!segment) return;

    setExpandingSegmentId(segmentId);
    try {
      const otherSegments = segments
        .map((s, i) => ({
          index: i,
          title: s.title,
          scriptText: s.scriptText.length > 200 ? s.scriptText.slice(0, 200) : s.scriptText,
        }))
        .filter((_, i) => i !== segmentIndex);

      let data: any;
      try {
        data = await http.post<any>('/api/ai-video-script-expand', {
          taskId: taskId || 'unknown',
          segmentIndex,
          segmentTitle: segment.title,
          segmentText: segment.scriptText,
          otherSegments,
          expandGoal: goal || '',
        }, { timeoutMs: 300_000 });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          data = { success: false, error: httpError.message };
        } else {
          throw httpError;
        }
      }
      if (data.success && data.expandedText) {
        handleUpdateSegment(segmentId, { scriptText: data.expandedText });
      }
    } catch (error) {
      console.error('Failed to expand script:', error);
    } finally {
      setExpandingSegmentId(null);
    }
  }, [segments, taskId, handleUpdateSegment]);

  // Empty state
  if (segments.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <svg className="w-12 h-12 text-muted-foreground mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <p className="text-sm text-muted-foreground">{t.scriptPanel.aiVideoScript.emptyState}</p>
        <p className="text-xs text-muted-foreground mt-1">{t.scriptPanel.aiVideoScript.emptyHint}</p>
        <button
          onClick={handleAddSegment}
          className="mt-4 flex items-center space-x-1.5 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-purple-600 rounded-md hover:from-purple-600 hover:to-purple-700 transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <span>{t.scriptPanel.aiVideoScript.addSegment}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-3">
      {segments.map((segment, index) => (
        <div
          key={segment.id}
          className="bg-card border border-border rounded-md p-3 transition-shadow duration-200"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-foreground flex items-center">
              <span className="w-6 h-6 bg-purple-100 text-purple-600 rounded-full text-xs font-semibold flex items-center justify-center mr-2">
                {index + 1}
              </span>
              {segment.title}
            </h4>
            <button
              onClick={() => handleRemoveSegment(segment.id)}
              className="p-1.5 text-destructive bg-destructive/10 border border-destructive/20 rounded hover:bg-destructive/20 hover:border-destructive/30 transition-colors duration-200"
              title={t.scriptPanel.aiVideoScript.removeSegment}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>

          {/* AI expand button */}
          <div className="flex justify-end mb-1">
            <button
              onClick={() => { setExpandGoal(''); setExpandDialogSegmentId(segment.id); }}
              disabled={expandingSegmentId === segment.id || segment.generationStatus === 'generating'}
              className="flex items-center space-x-1 px-2 py-1 text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:text-purple-400 dark:hover:text-purple-300 dark:hover:bg-purple-900/20 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={segment.scriptText.trim() ? t.scriptPanel.aiVideoScript.expandScript : t.scriptPanel.aiVideoScript.generateScript}
            >
              {expandingSegmentId === segment.id ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>{t.scriptPanel.aiVideoScript.expandingScript}</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  <span>{segment.scriptText.trim() ? t.scriptPanel.aiVideoScript.expandScript : t.scriptPanel.aiVideoScript.generateScript}</span>
                </>
              )}
            </button>
          </div>

          {/* Script textarea */}
          <textarea
            value={segment.scriptText}
            onChange={e => handleUpdateSegment(segment.id, { scriptText: e.target.value })}
            disabled={expandingSegmentId === segment.id}
            placeholder={t.scriptPanel.aiVideoScript.scriptPlaceholder}
            className="w-full p-2.5 text-sm border border-border rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent min-h-[96px] max-h-[200px] disabled:opacity-60 disabled:cursor-not-allowed"
            rows={4}
          />

          {/* Auto transition toggle — only for non-first segments */}
          {index > 0 && (
            <div className="flex items-center justify-between mt-3 px-1">
              <div className="flex items-center gap-2">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!segment.autoTransition}
                    onChange={e => {
                      handleUpdateSegment(segment.id, { autoTransition: e.target.checked });
                    }}
                    disabled={segment.generationStatus === 'generating'}
                    className="sr-only peer"
                  />
                  <div className={`w-8 h-4 bg-muted rounded-full peer peer-checked:bg-purple-500 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-transform peer-checked:after:translate-x-4 ${segment.generationStatus === 'generating' ? 'opacity-50' : ''}`} />
                </label>
                <span className="text-xs font-medium text-foreground">{t.scriptPanel.aiVideoScript.autoTransition}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{t.scriptPanel.aiVideoScript.autoTransitionHint}</span>
            </div>
          )}

          {/* Mode switcher — greyed out when autoTransition is on */}
          <div className={`flex rounded-md border border-border overflow-hidden mt-2 ${segment.autoTransition ? 'opacity-50 pointer-events-none' : ''}`}>
            <button
              onClick={() => segment.generationStatus !== 'generating' && handleUpdateSegment(segment.id, { generationMode: 'keyframe' })}
              disabled={segment.generationStatus === 'generating'}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                segment.generationMode === 'keyframe'
                  ? 'bg-purple-500 text-white dark:bg-purple-600'
                  : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-accent dark:bg-muted dark:text-muted-foreground'
              } disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {t.scriptPanel.aiVideoScript.modeKeyframe}
            </button>
            <button
              onClick={() => segment.generationStatus !== 'generating' && handleUpdateSegment(segment.id, { generationMode: 'reference' })}
              disabled={segment.generationStatus === 'generating'}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors border-l border-border ${
                segment.generationMode === 'reference'
                  ? 'bg-purple-500 text-white dark:bg-purple-600'
                  : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-accent dark:bg-muted dark:text-muted-foreground'
              } disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {t.scriptPanel.aiVideoScript.modeReference}
            </button>
            <button
              onClick={() => segment.generationStatus !== 'generating' && handleUpdateSegment(segment.id, { generationMode: 'description' })}
              disabled={segment.generationStatus === 'generating'}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors border-l border-border ${
                (segment.generationMode || 'description') === 'description'
                  ? 'bg-purple-500 text-white dark:bg-purple-600'
                  : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-accent dark:bg-muted dark:text-muted-foreground'
              } disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {t.scriptPanel.aiVideoScript.modeDescription}
            </button>
          </div>

          {/* Image pickers or auto transition hint */}
          {segment.autoTransition ? (
            <div className="mt-3 p-2.5 bg-purple-50 dark:bg-purple-900/20 rounded-md border border-purple-200 dark:border-purple-800">
              <div className="flex items-center gap-2 text-xs text-purple-600 dark:text-purple-400">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="font-medium">{t.scriptPanel.aiVideoScript.autoTransitionMode}</span>
              </div>
              <p className="text-[10px] text-purple-500 dark:text-purple-400 mt-1">{t.scriptPanel.aiVideoScript.autoTransitionHint}</p>
            </div>
          ) : segment.generationMode === 'keyframe' ? (
            <div className="flex space-x-3 mt-3">
              <ImagePickerSlot
                label={`${t.scriptPanel.aiVideoScript.firstFrameImage} ${t.scriptPanel.aiVideoScript.firstFrameRequired}`}
                imageUrl={segment.firstFrameUrl}
                imageName={segment.firstFrameName}
                onSelect={(url, name) => handleUpdateSegment(segment.id, { firstFrameUrl: url, firstFrameName: name })}
                onRemove={() => handleUpdateSegment(segment.id, { firstFrameUrl: undefined, firstFrameName: undefined })}
                materials={materials}
              />
              <ImagePickerSlot
                label={`${t.scriptPanel.aiVideoScript.lastFrameImage} ${t.scriptPanel.aiVideoScript.lastFrameOptional}`}
                imageUrl={segment.lastFrameUrl}
                imageName={segment.lastFrameName}
                onSelect={(url, name) => handleUpdateSegment(segment.id, { lastFrameUrl: url, lastFrameName: name })}
                onRemove={() => handleUpdateSegment(segment.id, { lastFrameUrl: undefined, lastFrameName: undefined })}
                materials={materials}
              />
            </div>
          ) : segment.generationMode === 'reference' ? (
            <div className="flex space-x-3 mt-3">
              <ImagePickerSlot
                label={`${t.scriptPanel.aiVideoScript.referenceImage1} ${t.scriptPanel.aiVideoScript.firstFrameRequired}`}
                imageUrl={segment.referenceImageUrl}
                imageName={segment.referenceImageName}
                onSelect={(url, name) => handleUpdateSegment(segment.id, { referenceImageUrl: url, referenceImageName: name })}
                onRemove={() => handleUpdateSegment(segment.id, { referenceImageUrl: undefined, referenceImageName: undefined })}
                materials={materials}
              />
              <ImagePickerSlot
                label={`${t.scriptPanel.aiVideoScript.referenceImage2} ${t.scriptPanel.aiVideoScript.lastFrameOptional}`}
                imageUrl={segment.referenceImage2Url}
                imageName={segment.referenceImage2Name}
                onSelect={(url, name) => handleUpdateSegment(segment.id, { referenceImage2Url: url, referenceImage2Name: name })}
                onRemove={() => handleUpdateSegment(segment.id, { referenceImage2Url: undefined, referenceImage2Name: undefined })}
                materials={materials}
              />
            </div>
          ) : (
            <div className="flex space-x-3 mt-3">
              <ImagePickerSlot
                label={t.scriptPanel.aiVideoScript.characterImage}
                imageUrl={segment.characterImageUrl}
                imageName={segment.characterImageName}
                onSelect={(url, name) => handleUpdateSegment(segment.id, { characterImageUrl: url, characterImageName: name })}
                onRemove={() => handleUpdateSegment(segment.id, { characterImageUrl: undefined, characterImageName: undefined })}
                materials={materials}
              />
              <ImagePickerSlot
                label={t.scriptPanel.aiVideoScript.sceneImage}
                imageUrl={segment.sceneImageUrl}
                imageName={segment.sceneImageName}
                onSelect={(url, name) => handleUpdateSegment(segment.id, { sceneImageUrl: url, sceneImageName: name })}
                onRemove={() => handleUpdateSegment(segment.id, { sceneImageUrl: undefined, sceneImageName: undefined })}
                materials={materials}
              />
            </div>
          )}

          {/* Duration selector */}
          <div className="flex items-center gap-1.5 mt-3">
            <span className="text-xs text-muted-foreground shrink-0">{t.scriptPanel.aiVideoScript.durationLabel}</span>
            <div className="flex gap-1">
              {[5, 7, 10, 12].map((d) => (
                <button
                  key={d}
                  onClick={() => segment.generationStatus !== 'generating' && handleUpdateSegment(segment.id, { duration: d })}
                  disabled={segment.generationStatus === 'generating'}
                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                    (segment.duration || 5) === d
                      ? 'bg-purple-500 text-white border-purple-500 dark:bg-purple-600 dark:border-purple-600'
                      : 'bg-muted text-muted-foreground border-border hover:text-foreground hover:bg-accent'
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  {d}s
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <div className="mt-3">
            {segment.generationStatus === 'generating' ? (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-purple-600 font-medium">{t.scriptPanel.aiVideoScript.generating}</span>
                  <span className="text-xs text-muted-foreground">{segment.generationProgress || 0}%</span>
                </div>
                <div className="w-full bg-accent rounded-full h-1.5">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-purple-600 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${segment.generationProgress || 0}%` }}
                  />
                </div>
                <button
                  onClick={() => cancelGeneration(segment.id)}
                  className="mt-2 text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  {t.scriptPanel.aiVideoScript.cancelGeneration}
                </button>
              </div>
            ) : segment.generationStatus === 'failed' ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-destructive">
                  {t.scriptPanel.aiVideoScript.generationFailed}: {segment.generationError}
                </span>
                <button
                  onClick={() => handleGenerate(segment.id)}
                  className="flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-white bg-destructive rounded-md hover:bg-destructive/90 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>{t.scriptPanel.aiVideoScript.retry}</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleGenerate(segment.id)}
                disabled={!segment.scriptText.trim() || (!segment.autoTransition && segment.generationMode === 'keyframe' && !segment.firstFrameUrl) || (!segment.autoTransition && segment.generationMode === 'reference' && !segment.referenceImageUrl)}
                title={!segment.autoTransition && segment.generationMode === 'keyframe' && !segment.firstFrameUrl ? t.scriptPanel.aiVideoScript.firstFrameMissing : !segment.autoTransition && segment.generationMode === 'reference' && !segment.referenceImageUrl ? t.scriptPanel.aiVideoScript.referenceImageMissing : undefined}
                className="w-full flex items-center justify-center space-x-1.5 py-2 text-xs font-medium text-white bg-gradient-to-r from-purple-500 to-purple-600 rounded-md hover:from-purple-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>{t.scriptPanel.aiVideoScript.generateVideo}</span>
              </button>
            )}
          </div>

          {/* Generated video preview */}
          {segment.generationStatus === 'succeeded' && segment.generatedVideoUrl && (
            <div className="mt-3 p-2.5 bg-muted rounded-md border border-border">
              <div className="text-xs font-medium text-muted-foreground mb-2">{t.scriptPanel.aiVideoScript.generatedVideo}</div>
              <div className="relative bg-black rounded-md overflow-hidden aspect-video">
                <video
                  src={segment.generatedVideoUrl}
                  poster={segment.generatedVideoThumbnailUrl}
                  controls
                  preload="metadata"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="text-xs text-muted-foreground mt-1.5">
                {segment.generatedVideoDuration && `${segment.generatedVideoDuration}s`}
                {segment.generatedVideoWidth && segment.generatedVideoHeight && ` · ${segment.generatedVideoWidth}x${segment.generatedVideoHeight}`}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Add segment button at the bottom */}
      <button
        onClick={handleAddSegment}
        className="w-full py-2.5 text-sm text-muted-foreground hover:text-purple-600 bg-muted hover:bg-purple-50 border-2 border-dashed border-border hover:border-purple-300 rounded-md transition-colors duration-150 flex items-center justify-center space-x-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        <span>{t.scriptPanel.aiVideoScript.addSegment}</span>
      </button>

      {/* Expand goal dialog */}
      {expandDialogSegmentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setExpandDialogSegmentId(null)}>
          <div className="bg-card border border-border rounded-lg p-5 shadow-xl max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-3">
              {t.storyboardScriptTab.expandTitle}
            </h3>
            <textarea
              value={expandGoal}
              onChange={(e) => setExpandGoal(e.target.value)}
              placeholder={t.storyboardScriptTab.expandGoalPlaceholder}
              className="w-full p-2.5 text-sm border border-border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent min-h-[80px]"
              rows={3}
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-2 mb-4">
              {t.storyboardScriptTab.expandGoalHint}
            </p>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setExpandDialogSegmentId(null)}
                className="px-3 py-1.5 text-xs text-muted-foreground bg-muted border border-border rounded-md hover:bg-accent transition-colors"
              >
                {t.storyboardScriptTab.expandCancel}
              </button>
              <button
                onClick={() => {
                  const segId = expandDialogSegmentId;
                  const goal = expandGoal.trim() || undefined;
                  setExpandDialogSegmentId(null);
                  handleExpandScript(segId, goal);
                }}
                className="px-3 py-1.5 text-xs text-white bg-gradient-to-r from-purple-500 to-purple-600 rounded-md hover:from-purple-600 hover:to-purple-700 transition-colors"
              >
                {t.storyboardScriptTab.expandStart}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIVideoScriptTab;
