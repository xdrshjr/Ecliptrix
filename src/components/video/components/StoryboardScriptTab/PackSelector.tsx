'use client';

import React from 'react';
import { StoryboardPack } from '@/types';

interface PackSelectorProps {
  packs: StoryboardPack[];
  selectedPackId: string | null;
  onSelectPack: (packId: string) => void;
  isLoading: boolean;
  onRefresh: () => void;
}

const PackSelector: React.FC<PackSelectorProps> = ({
  packs,
  selectedPackId,
  onSelectPack,
  isLoading,
  onRefresh,
}) => {
  const formatTime = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="flex items-center space-x-2">
      <select
        value={selectedPackId || ''}
        onChange={(e) => {
          if (e.target.value) {
            onSelectPack(e.target.value);
          }
        }}
        disabled={isLoading}
        className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed truncate"
      >
        <option value="">
          {packs.length === 0 ? '暂无分镜包' : '选择分镜包...'}
        </option>
        {packs.map((pack) => (
          <option key={pack.packId} value={pack.packId}>
            {pack.gridSize}分镜 - {formatTime(pack.createdAt)} ({pack.frameCount}帧)
          </option>
        ))}
      </select>

      <button
        onClick={onRefresh}
        disabled={isLoading}
        className="p-1.5 text-muted-foreground hover:text-foreground bg-muted border border-border rounded-md hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        title="刷新分镜包列表"
      >
        <svg
          className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>
    </div>
  );
};

export default PackSelector;
