'use client';

/**
 * MaterialStatusOverlays — the status layers drawn over a material thumbnail
 * (download progress, waiting upload, waiting AI analysis, uploading, AI
 * generating, FLUX generating, download failed + retry).
 *
 * Moved verbatim from the pre-workbench MaterialsPanel card: these are
 * functional states (spec §3.7.1), not decoration, so their markup, copy and
 * conditions are intentionally unchanged.
 */

import React from 'react';
import type { MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';

interface MaterialStatusOverlaysProps {
  material: MaterialItem;
  /** Live queue status is 'waiting' (from getVideoAnalysisStatus). */
  isWaitingAnalysis: boolean;
  onRetryDownload?(material: MaterialItem): void;
}

const MaterialStatusOverlays: React.FC<MaterialStatusOverlaysProps> = ({
  material, isWaitingAnalysis, onRetryDownload,
}) => {
  const { t } = useLocale();
  return (
    <>
        {/* YouTube视频下载状态覆盖层 */}
        {material.downloadStatus === 'downloading' && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex flex-col items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mb-2"></div>
            <span className="text-primary-foreground text-xs font-medium">{t.materialsPanel.downloadingVideo}</span>
            {material.downloadProgress !== undefined && (
              <div className="w-16 bg-accent rounded-full h-1 mt-1">
                <div
                  className="bg-primary h-1 rounded-full transition-all duration-300"
                  style={{ width: `${material.downloadProgress}%` }}
                ></div>
              </div>
            )}
          </div>
        )}

        {/* 素材等待上传状态覆盖层 */}
        {material.uploadStatus === 'waiting' && (
          <div className="absolute inset-0 bg-warning bg-opacity-50 flex flex-col items-center justify-center">
            <svg className="w-8 h-8 text-primary-foreground mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-primary-foreground text-xs font-medium text-center px-1">等待上传...</span>
          </div>
        )}

        {/* 视频AI解析等待状态覆盖层 */}
        {material.type === 'video' && isWaitingAnalysis && (
          <div className="absolute inset-0 bg-warning bg-opacity-50 flex flex-col items-center justify-center">
            <svg className="w-8 h-8 text-primary-foreground mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-primary-foreground text-xs font-medium text-center px-1">等待AI解析...</span>
          </div>
        )}

        {/* 素材上传状态覆盖层 */}
        {material.uploadStatus === 'uploading' && (
          <div className="absolute inset-0 bg-primary bg-opacity-50 flex flex-col items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mb-2"></div>
            <span className="text-primary-foreground text-xs font-medium">{t.materialsPanel.uploadingMaterial}</span>
            {material.uploadProgress !== undefined && (
              <div className="w-16 bg-accent rounded-full h-1 mt-1">
                <div
                  className="bg-primary-foreground h-1 rounded-full transition-all duration-300"
                  style={{ width: `${material.uploadProgress}%` }}
                ></div>
              </div>
            )}
          </div>
        )}

        {/* AI生成状态覆盖层（用于 AI视频/数字人等 downloadStatus='generating' 的素材） */}
        {material.downloadStatus === 'generating' && (
          <div className="absolute inset-0 bg-primary bg-opacity-50 flex flex-col items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mb-2"></div>
            <span className="text-primary-foreground text-xs font-medium text-center px-1">{t.materialsPanel.generating}</span>
            {material.downloadProgress !== undefined && (
              <div className="w-16 bg-accent rounded-full h-1 mt-1">
                <div
                  className="bg-primary-foreground h-1 rounded-full transition-all duration-300"
                  style={{ width: `${material.downloadProgress}%` }}
                ></div>
              </div>
            )}
          </div>
        )}

        {/* FLUX生成状态覆盖层 */}
        {material.metadata?.source === 'flux-generating' && (
          <div className="absolute inset-0 bg-gradient-to-br from-primary to-primary/70 bg-opacity-90 flex flex-col items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mb-2"></div>
            <span className="text-primary-foreground text-xs font-medium text-center px-1">{t.materialsPanel.fluxGenerating}</span>
            <div className="w-16 bg-card bg-opacity-30 rounded-full h-1 mt-1">
              <div className="bg-card h-1 rounded-full animate-pulse"></div>
            </div>
          </div>
        )}

        {/* 下载错误状态覆盖层 */}
        {material.downloadStatus === 'error' && (
          <div className="absolute inset-0 bg-destructive bg-opacity-50 flex flex-col items-center justify-center">
            <svg className="w-6 h-6 text-destructive-foreground mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-destructive-foreground text-xs font-medium text-center px-1">{t.materialsPanel.downloadFailed}</span>
            {material.downloadError && (
              <span className="text-destructive-foreground text-xs opacity-80 text-center px-1 mt-1" title={material.downloadError}>
                {material.downloadError.length > 20 ? `${material.downloadError.substring(0, 20)}...` : material.downloadError}
              </span>
            )}
            {onRetryDownload && (
              <button
                onClick={() => onRetryDownload(material)}
                className="mt-2 px-3 py-1 text-xs font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 transition-colors"
                title={t.materialsPanel.retryDownload}
              >
                {t.materialsPanel.retryDownload}
              </button>
            )}
          </div>
        )}
    </>
  );
};

export default MaterialStatusOverlays;
