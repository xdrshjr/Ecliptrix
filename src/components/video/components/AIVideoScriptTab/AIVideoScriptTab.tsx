'use client';

import React, { useCallback } from 'react';
import { AIVideoScriptSegment, MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useAIVideoScriptGeneration } from '../../hooks/useAIVideoScriptGeneration';
import ImagePickerSlot from './ImagePickerSlot';

export function createAIVideoSegment(title: string, scriptText?: string): AIVideoScriptSegment {
  return {
    id: `ai-video-seg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title,
    scriptText: scriptText || '',
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
}) => {
  const { t } = useLocale();
  const { generateVideo, cancelGeneration } = useAIVideoScriptGeneration(segments, onUpdateSegments, onAddMaterial);

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

  // Empty state
  if (segments.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <svg className="w-12 h-12 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <p className="text-sm text-gray-600">{t.scriptPanel.aiVideoScript.emptyState}</p>
        <p className="text-xs text-gray-400 mt-1">{t.scriptPanel.aiVideoScript.emptyHint}</p>
        <button
          onClick={handleAddSegment}
          className="mt-4 flex items-center space-x-1.5 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg hover:from-purple-600 hover:to-purple-700 transition-all shadow-sm"
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
          className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow duration-200"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-800 flex items-center">
              <span className="w-6 h-6 bg-purple-100 text-purple-600 rounded-full text-xs font-semibold flex items-center justify-center mr-2">
                {index + 1}
              </span>
              {segment.title}
            </h4>
            <button
              onClick={() => handleRemoveSegment(segment.id)}
              className="p-1.5 text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 hover:border-red-300 transition-colors duration-200"
              title={t.scriptPanel.aiVideoScript.removeSegment}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>

          {/* Script textarea */}
          <textarea
            value={segment.scriptText}
            onChange={e => handleUpdateSegment(segment.id, { scriptText: e.target.value })}
            placeholder={t.scriptPanel.aiVideoScript.scriptPlaceholder}
            className="w-full p-2.5 text-sm border border-gray-200 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent min-h-[96px] max-h-[200px]"
            rows={4}
          />

          {/* Image pickers */}
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

          {/* Generate button */}
          <div className="mt-3">
            {segment.generationStatus === 'generating' ? (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-purple-600 font-medium">{t.scriptPanel.aiVideoScript.generating}</span>
                  <span className="text-xs text-gray-500">{segment.generationProgress || 0}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-purple-600 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${segment.generationProgress || 0}%` }}
                  />
                </div>
                <button
                  onClick={() => cancelGeneration(segment.id)}
                  className="mt-2 text-xs text-gray-500 hover:text-red-500 transition-colors"
                >
                  {t.scriptPanel.aiVideoScript.cancelGeneration}
                </button>
              </div>
            ) : segment.generationStatus === 'failed' ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-red-500">
                  {t.scriptPanel.aiVideoScript.generationFailed}: {segment.generationError}
                </span>
                <button
                  onClick={() => generateVideo(segment.id)}
                  className="flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>{t.scriptPanel.aiVideoScript.retry}</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => generateVideo(segment.id)}
                disabled={!segment.scriptText.trim()}
                className="w-full flex items-center justify-center space-x-1.5 py-2 text-xs font-medium text-white bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg hover:from-purple-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
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
            <div className="mt-3 p-2.5 bg-gray-50 rounded-lg border border-gray-200">
              <div className="text-xs font-medium text-gray-600 mb-2">{t.scriptPanel.aiVideoScript.generatedVideo}</div>
              <div className="relative bg-black rounded-md overflow-hidden aspect-video">
                <video
                  src={segment.generatedVideoUrl}
                  poster={segment.generatedVideoThumbnailUrl}
                  controls
                  preload="metadata"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="text-xs text-gray-500 mt-1.5">
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
        className="w-full py-2.5 text-sm text-gray-500 hover:text-purple-600 bg-gray-50 hover:bg-purple-50 border-2 border-dashed border-gray-300 hover:border-purple-300 rounded-lg transition-colors duration-150 flex items-center justify-center space-x-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        <span>{t.scriptPanel.aiVideoScript.addSegment}</span>
      </button>
    </div>
  );
};

export default AIVideoScriptTab;
