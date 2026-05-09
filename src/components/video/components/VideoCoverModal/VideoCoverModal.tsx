'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLocale } from '@/contexts/LocaleContext';
import type { MaterialItem, TimelineItem } from '@/types';

import { applyTemplate, makeDefaultState } from './templates';
import type {
  CoverAspectRatio,
  CoverState,
  CoverTemplateId,
  CoverTextLayer,
  ImageSource,
} from './types';
import { useCoverPersistence } from './hooks/useCoverPersistence';
import { useCoverRender } from './hooks/useCoverRender';
import { useFrameExtraction } from './hooks/useFrameExtraction';
import { CoverPreview } from './components/CoverPreview';
import { TemplatePicker } from './components/TemplatePicker';
import { TextStyleToolbar } from './components/TextStyleToolbar';
import { FrameScrubber } from './components/FrameScrubber';
import { ImageUploadInput } from './components/ImageUploadInput';
import { SourceToggle } from './components/SourceToggle';

interface VideoCoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  /** Used as the download filename's slug source (CJK-safe fallback applied). */
  projectName: string;
  /** Player's currently-selected aspect ratio. */
  aspectRatio: CoverAspectRatio;
  materials: MaterialItem[];
  timelineItems: TimelineItem[];
}

/**
 * Top-level modal for video cover authoring. Wires together the persistence
 * hook, the frame-extraction hook, the render hook, and all sub-components.
 *
 * Layout: a 90vw × 85vh dialog with a 40/60 left-right grid. Esc / overlay
 * click close it (after flushing pending saves). All chrome reads from the
 * existing CSS variables so dark/light theme switches re-theme the modal.
 */
export const VideoCoverModal: React.FC<VideoCoverModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectName,
  aspectRatio,
  materials,
  timelineItems,
}) => {
  const { t } = useLocale();
  const persistence = useCoverPersistence(projectId);
  const frameExtraction = useFrameExtraction(materials, timelineItems);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const [state, setState] = useState<CoverState | null>(null);
  const [editingLayerKey, setEditingLayerKey] = useState<string | null>(null);
  const [selectedLayerKey, setSelectedLayerKey] = useState<string | null>(null);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Derive a stable seed for the very first paint when no saved state exists.
  const defaultState = useMemo<CoverState>(
    () => makeDefaultState({ aspectRatio }),
    [aspectRatio],
  );

  const renderHook = useCoverRender(previewRef, state?.aspectRatio ?? aspectRatio);

  // Hydrate state once persistence finishes loading
  useEffect(() => {
    if (!isOpen) return;
    if (persistence.isLoading) return;
    if (state !== null) return;
    setState(persistence.initialState ?? defaultState);
  }, [isOpen, persistence.isLoading, persistence.initialState, defaultState, state]);

  // Reset editing/selection when the modal closes
  useEffect(() => {
    if (!isOpen) {
      setEditingLayerKey(null);
      setSelectedLayerKey(null);
    }
  }, [isOpen]);

  // Esc closes the modal
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingLayerKey) {
          // Let the editable layer handle Esc itself (commit + blur). Don't
          // close the modal in the same keystroke.
          return;
        }
        e.preventDefault();
        void handleClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Initial background frame on first paint
  useEffect(() => {
    if (!isOpen) return;
    if (!state) return;
    if (state.imageSource === 'upload') {
      // When a saved upload exists, paint it. When the user just switched to
      // upload-mode without an uploaded image yet, INTENTIONALLY leave the
      // current backgroundUrl untouched so the previously-extracted frame
      // remains as a "ghost" behind the empty drop zone (Bug #7).
      if (state.uploadedImageUrl) {
        setBackgroundUrl(state.uploadedImageUrl);
      }
      return;
    }
    const ms = state.frameVirtualTimeMs ?? 0;
    void frameExtraction
      .extractAt(ms / 1000)
      .then((dataUrl) => setBackgroundUrl(dataUrl ?? null))
      .catch(() => {
        /* swallow — empty timeline will simply leave the background null */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, state?.frameVirtualTimeMs, state?.imageSource, state?.uploadedImageUrl]);

  // If timeline has no video items, force-flip source to upload
  useEffect(() => {
    if (!state) return;
    if (state.imageSource !== 'frame') return;
    if (frameExtraction.totalVirtualDurationSec > 0) return;
    setState((prev) => (prev ? { ...prev, imageSource: 'upload', frameVirtualTimeMs: null } : prev));
  }, [state, frameExtraction.totalVirtualDurationSec]);

  // Auto-save on state changes (debounced inside the hook)
  useEffect(() => {
    if (!state) return;
    if (persistence.isLoading) return;
    persistence.save(state);
  }, [state, persistence]);

  const updateState = useCallback((patch: Partial<CoverState>) => {
    setState((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const handleSelectTemplate = useCallback((id: CoverTemplateId) => {
    setState((prev) => (prev ? applyTemplate(id, prev) : prev));
    setEditingLayerKey(null);
  }, []);

  const handleUpdateLayer = useCallback(
    (key: string, patch: Partial<CoverTextLayer>) => {
      setState((prev) => {
        if (!prev) return prev;
        const layers = prev.coverConfig.textLayers.map((l) =>
          l.key === key ? { ...l, ...patch } : l,
        );
        return { ...prev, coverConfig: { ...prev.coverConfig, textLayers: layers } };
      });
    },
    [],
  );

  const handleCommitText = useCallback(
    (key: string, next: string) => {
      handleUpdateLayer(key, { text: next });
      setEditingLayerKey(null);
    },
    [handleUpdateLayer],
  );

  const handleSourceChange = useCallback((source: ImageSource) => {
    setState((prev) => {
      if (!prev) return prev;
      if (source === 'frame') {
        return {
          ...prev,
          imageSource: 'frame',
          uploadedImageUrl: null,
          frameVirtualTimeMs: prev.frameVirtualTimeMs ?? 0,
        };
      }
      return { ...prev, imageSource: 'upload', frameVirtualTimeMs: null };
    });
    // Critical: do NOT clear backgroundUrl here (Bug #7). The effect above
    // owns the background and intentionally preserves the previously
    // extracted frame as a "ghost" behind the empty upload drop zone.
  }, []);

  const handleScrubCommit = useCallback(
    async (sec: number) => {
      updateState({ frameVirtualTimeMs: Math.round(sec * 1000) });
      try {
        const dataUrl = await frameExtraction.extractAt(sec);
        setBackgroundUrl(dataUrl ?? null);
      } catch {
        setErrorMsg(t.videoCoverModal?.errors?.extractFailed ?? 'Frame extraction failed');
      }
    },
    [frameExtraction, updateState, t.videoCoverModal?.errors?.extractFailed],
  );

  const handleUploaded = useCallback(
    (url: string) => {
      updateState({ uploadedImageUrl: url, imageSource: 'upload' });
      setBackgroundUrl(url);
    },
    [updateState],
  );

  const activeLayer = useMemo(() => {
    if (!state) return null;
    const key = editingLayerKey ?? selectedLayerKey;
    if (!key) return null;
    return state.coverConfig.textLayers.find((l) => l.key === key) ?? null;
  }, [state, editingLayerKey, selectedLayerKey]);

  const downloadFilename = useMemo(() => {
    const slug = slugify(projectName);
    if (slug.length === 0) {
      return `cover-${projectId}.png`;
    }
    const base = t.videoCoverModal?.actions?.downloadFilename ?? '{slug}-cover.png';
    return base.replace('{slug}', slug);
  }, [projectName, projectId, t.videoCoverModal?.actions?.downloadFilename]);

  const handleClose = useCallback(async () => {
    try {
      await persistence.flush();
    } catch {
      /* swallow — closing should still succeed even if save lost */
    }
    onClose();
  }, [persistence, onClose]);

  const handleDownload = useCallback(async () => {
    if (!state) return;
    try {
      const { blob } = await renderHook.render();
      // Trigger browser save
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = downloadFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Tear down the object URL after a tick so the click had time to bind.
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);

      // Upload to backend in parallel — failure here does NOT affect the
      // download, just the project-card thumbnail caching.
      try {
        await persistence.uploadPng(blob);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[VideoCoverModal] cover PNG upload failed', err);
      }
    } catch (err) {
      setErrorMsg(
        t.videoCoverModal?.errors?.renderFailed ??
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }, [state, renderHook, downloadFilename, persistence, t.videoCoverModal?.errors?.renderFailed]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.videoCoverModal?.title ?? 'Video Cover'}
      className="fixed inset-0 z-modal flex items-center justify-center"
      onClick={() => void handleClose()}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="relative bg-background text-foreground border border-border rounded-lg shadow-xl flex flex-col overflow-hidden"
        style={{ width: '90vw', height: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-2 border-b border-border">
          <h2 className="text-sm font-semibold">{t.videoCoverModal?.title ?? 'Video Cover'}</h2>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t.common?.close ?? 'Close'}
            onClick={() => void handleClose()}
          >
            ✕
          </button>
        </header>

        <div className="flex-1 grid grid-cols-[40%_60%] min-h-0">
          {/* LEFT: Templates + Style toolbar */}
          <aside className="border-r border-border overflow-auto p-3 space-y-3">
            <section>
              <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                {t.videoCoverModal?.title ?? 'Templates'}
              </h3>
              <TemplatePicker
                selectedId={state?.templateId ?? defaultState.templateId}
                onSelect={handleSelectTemplate}
              />
            </section>

            <section>
              <TextStyleToolbar
                layer={activeLayer}
                onChange={(patch) => {
                  if (!activeLayer) return;
                  handleUpdateLayer(activeLayer.key, patch);
                }}
              />
            </section>
          </aside>

          {/* RIGHT: Preview + scrubber/upload */}
          <section className="flex flex-col min-h-0">
            <div className="flex-1 p-3 flex items-center justify-center bg-muted/20 min-h-0 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <div
                  className="max-w-full max-h-full"
                  style={{ width: 'min(100%, calc(100% - 1rem))' }}
                >
                  {state && (
                    <CoverPreview
                      ref={previewRef}
                      aspectRatio={state.aspectRatio}
                      config={state.coverConfig}
                      backgroundUrl={backgroundUrl}
                      editingLayerKey={editingLayerKey}
                      selectedLayerKey={selectedLayerKey}
                      onSelectLayer={setSelectedLayerKey}
                      onStartEditLayer={(k) => {
                        setEditingLayerKey(k);
                        setSelectedLayerKey(k);
                      }}
                      onUpdateLayer={handleUpdateLayer}
                      onCommitText={handleCommitText}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-border p-3 space-y-2">
              <SourceToggle
                value={state?.imageSource ?? 'frame'}
                onChange={handleSourceChange}
                frameDisabled={frameExtraction.totalVirtualDurationSec <= 0}
              />
              {frameExtraction.totalVirtualDurationSec <= 0 && (
                <p className="text-xs text-muted-foreground italic">
                  {t.videoCoverModal?.source?.noFramesAvailable ??
                    'No frames available — upload an image instead.'}
                </p>
              )}
              {state?.imageSource === 'frame' ? (
                <FrameScrubber
                  totalDurationSec={frameExtraction.totalVirtualDurationSec}
                  valueSec={(state.frameVirtualTimeMs ?? 0) / 1000}
                  onChange={(sec) => updateState({ frameVirtualTimeMs: Math.round(sec * 1000) })}
                  onCommit={(sec) => void handleScrubCommit(sec)}
                />
              ) : (
                <ImageUploadInput
                  projectId={projectId}
                  currentUrl={state?.uploadedImageUrl ?? null}
                  onUploaded={handleUploaded}
                  onError={(msg) => setErrorMsg(msg)}
                />
              )}
            </div>

            <footer className="border-t border-border px-3 py-2 flex items-center justify-end gap-2">
              {errorMsg && (
                <span className="text-xs text-destructive mr-auto" role="alert">
                  {errorMsg}
                </span>
              )}
              <button
                type="button"
                className="px-3 py-1 text-xs rounded-sm border border-border bg-background hover:border-primary/60"
                onClick={() => void handleClose()}
              >
                {t.videoCoverModal?.actions?.cancel ?? t.common?.cancel ?? 'Cancel'}
              </button>
              <button
                type="button"
                className="px-3 py-1 text-xs rounded-sm bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                onClick={() => void handleDownload()}
                disabled={!state || renderHook.isRendering}
              >
                {renderHook.isRendering
                  ? '…'
                  : t.videoCoverModal?.actions?.download ?? 'Download'}
              </button>
            </footer>
          </section>
        </div>
      </div>
    </div>
  );
};

/**
 * Slugify a project name for the download filename. Strips non-ASCII so the
 * resulting filename is portable across browsers / OSes; the parent falls
 * back to ``cover-{projectId}.png`` when the result is empty (P2-5).
 */
function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

export default VideoCoverModal;
