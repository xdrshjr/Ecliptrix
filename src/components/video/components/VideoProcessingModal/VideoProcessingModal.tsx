'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { MaterialItem } from '@/types';
import SilenceRemovalTab from './SilenceRemovalTab';
import type { SilenceRemoveResult } from './ProcessingProgress';
import { useLocale } from '@/contexts/LocaleContext';

export interface VideoProcessingModalProps {
  isOpen: boolean;
  onClose: () => void;
  materials: MaterialItem[];
  onSilenceRemoved?: (processedVideoUrl: string, result: SilenceRemoveResult, originalMaterial: MaterialItem) => void;
  onMinimize?: (taskId: string, videoName: string) => void;
  taskId: string;
  onSelectMaterialForWatermark?: (material: MaterialItem) => void;
}

type TabId = 'silence-removal' | 'watermark-removal';

interface TabDef {
  id: TabId;
  labelKey: 'silenceRemoval' | 'watermarkRemoval';
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  {
    id: 'silence-removal',
    labelKey: 'silenceRemoval',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"
        />
      </svg>
    ),
  },
  {
    id: 'watermark-removal',
    labelKey: 'watermarkRemoval',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
      </svg>
    ),
  },
];

// ---- Component ----

const VideoProcessingModal: React.FC<VideoProcessingModalProps> = ({
  isOpen,
  onClose,
  materials,
  onSilenceRemoved,
  onMinimize,
  taskId,
  onSelectMaterialForWatermark,
}) => {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<TabId>('silence-removal');

  // Track whether the modal has ever been opened. Once opened, we keep it mounted
  // (CSS hidden) so that SilenceRemovalTab state is preserved across minimize/restore.
  const [hasEverOpened, setHasEverOpened] = useState(false);
  useEffect(() => {
    if (isOpen && !hasEverOpened) setHasEverOpened(true);
  }, [isOpen, hasEverOpened]);

  // Track whether SilenceRemovalTab is actively processing (for auto-minimize on close)
  const processingInfoRef = useRef<{ taskId: string; videoName: string } | null>(null);

  // Material update proxy — forwards to onSilenceRemoved with original material
  // Retained for backward compatibility if SilenceRemovalTab calls onMaterialUpdate directly
  const handleMaterialUpdate = useCallback(
    (id: string, newData: Partial<MaterialItem>) => {
      const original = materials.find((m) => m.id === id);
      if (original && onSilenceRemoved && newData.url) {
        // Legacy path: construct a minimal result
        onSilenceRemoved(newData.url, {
          video_url: newData.url,
          original_duration: original.duration || 0,
          new_duration: newData.duration || original.duration || 0,
          removed_count: 0,
          time_saved: 0,
        }, original);
      }
    },
    [materials, onSilenceRemoved]
  );

  // Direct silence-removed callback from SilenceRemovalTab
  const handleSilenceRemoved = useCallback(
    (processedVideoUrl: string, result: SilenceRemoveResult, originalMaterial: MaterialItem) => {
      processingInfoRef.current = null;
      if (onSilenceRemoved) {
        onSilenceRemoved(processedVideoUrl, result, originalMaterial);
      }
      onClose();
    },
    [onSilenceRemoved, onClose]
  );

  // Minimize handler — propagates to MaterialsPanel
  const handleMinimize = useCallback(
    (taskIdStr: string, videoName: string) => {
      processingInfoRef.current = null;
      if (onMinimize) {
        onMinimize(taskIdStr, videoName);
      }
      onClose();
    },
    [onMinimize, onClose]
  );

  // Called by SilenceRemovalTab when processing state changes
  const handleProcessingStateChange = useCallback(
    (isProcessing: boolean, taskIdStr?: string, videoName?: string) => {
      if (isProcessing && taskIdStr && videoName) {
        processingInfoRef.current = { taskId: taskIdStr, videoName };
      } else {
        processingInfoRef.current = null;
      }
    },
    []
  );

  // Close handler: auto-minimize if processing is active (spec requirement)
  const handleClose = useCallback(() => {
    if (processingInfoRef.current && onMinimize) {
      // Auto-minimize instead of closing when processing is in progress
      onMinimize(processingInfoRef.current.taskId, processingInfoRef.current.videoName);
      processingInfoRef.current = null;
    }
    onClose();
  }, [onClose, onMinimize]);

  // Don't render until the modal has been opened at least once.
  // After first open, keep it mounted (CSS hidden) so that SilenceRemovalTab state
  // (phase, processingTaskId, etc.) is preserved across minimize/restore cycles.
  if (!hasEverOpened) return null;

  return (
    <div
      className={`fixed top-14 inset-x-0 bottom-0 bg-black/30 flex items-center justify-center z-[200] p-4 ${
        !isOpen ? 'hidden' : ''
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="bg-card rounded-lg shadow-xl flex flex-col overflow-hidden"
        style={{ width: 900, maxHeight: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary/10 rounded-md flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-foreground">{t.materialsPanel.videoProcessing}</h2>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors"
            title={t.videoProcessing.buttons.close}
          >
            <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="px-5 pt-2 border-b border-border flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-md border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              {tab.icon}
              {tab.labelKey === 'silenceRemoval' ? t.videoProcessing.tab : t.materialsPanel.watermarkRemovalTab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {activeTab === 'silence-removal' && (
            <SilenceRemovalTab
              materials={materials}
              onMaterialUpdate={handleMaterialUpdate}
              onSilenceRemoved={handleSilenceRemoved}
              onMinimize={handleMinimize}
              onProcessingStateChange={handleProcessingStateChange}
              isModalVisible={isOpen}
            />
          )}
          {activeTab === 'watermark-removal' && (
            <div className="p-4 overflow-y-auto">
              <p className="text-sm text-muted-foreground mb-3">
                {t.materialsPanel.selectVideoForWatermark}
              </p>
              {materials.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8">
                  {t.materialsPanel.noVideoMaterials}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {materials.map(material => (
                    <button
                      key={material.id}
                      type="button"
                      onClick={() => onSelectMaterialForWatermark?.(material)}
                      className="flex flex-col items-center p-2 rounded-md border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left"
                    >
                      {material.thumbnailUrl ? (
                        <img
                          src={material.thumbnailUrl}
                          alt={material.name}
                          className="w-full aspect-video object-cover rounded mb-1.5"
                        />
                      ) : (
                        <div className="w-full aspect-video bg-muted rounded mb-1.5 flex items-center justify-center">
                          <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      <span className="text-xs text-foreground truncate w-full">{material.name}</span>
                      {material.duration != null && (
                        <span className="text-xs text-muted-foreground">{material.duration.toFixed(1)}s</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoProcessingModal;
