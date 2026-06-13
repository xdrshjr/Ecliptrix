'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { Modal } from '@/components/ui/Modal';

interface VideoUnderstandingModePlaceholderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 「视频理解生成」占位弹窗（本期只预留外壳，内部功能后续迭代再开发）。
 *
 * 仅展示标题 + Coming soon 插画与说明 + 关闭按钮，无业务逻辑。
 */
const VideoUnderstandingModePlaceholderModal: React.FC<VideoUnderstandingModePlaceholderModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useLocale();

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="video-understanding-placeholder-title"
      describedBy="video-understanding-placeholder-desc"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4"
      contentClassName="w-full max-w-md overflow-hidden rounded-md border border-border bg-card shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-primary/10 px-6 py-4">
        <h3 id="video-understanding-placeholder-title" className="text-lg font-semibold text-foreground">
          {t.videoUnderstandingPlaceholder.title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors hover:bg-accent"
          title={t.videoUnderstandingPlaceholder.close}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <svg className="h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <p className="text-base font-medium text-foreground">{t.videoUnderstandingPlaceholder.comingSoon}</p>
          <p id="video-understanding-placeholder-desc" className="mt-2 text-sm text-muted-foreground">
            {t.videoUnderstandingPlaceholder.description}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end border-t border-border bg-muted px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t.videoUnderstandingPlaceholder.close}
        </button>
      </div>
    </Modal>
  );
};

export default VideoUnderstandingModePlaceholderModal;
