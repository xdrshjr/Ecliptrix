/**
 * WelcomeGuide — empty-state welcome screen shown when the chat has no messages.
 *
 * Displays a title, description, and clickable suggestion cards. When a card is
 * clicked, the suggestion text is sent to the onSuggestionClick callback, which
 * typically fills the input textarea.
 *
 * The suggestions are split into two tiers:
 * - "with materials" — shown when hasMaterials is true (project has imported media)
 * - "without materials" — shown when hasMaterials is false (empty project)
 *
 * @module timeline/WelcomeGuide
 */

'use client';

import React, { useCallback } from 'react';
import { motion } from 'framer-motion';
import { nodeVariants } from './animations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WelcomeGuideProps {
  /** Whether the project currently has imported materials (video/audio/images). */
  hasMaterials?: boolean;
  /** Called with the suggestion text when a card is clicked. */
  onSuggestionClick: (text: string) => void;
}

// ---------------------------------------------------------------------------
// Suggestion data
// ---------------------------------------------------------------------------

interface Suggestion {
  text: string;
  icon: React.ReactNode;
}

const SUGGESTIONS_WITH_MATERIALS: Suggestion[] = [
  {
    text: '裁剪第一个视频的前5秒',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
      </svg>
    ),
  },
  {
    text: '添加一段轻快的背景音乐',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
    ),
  },
  {
    text: '为所有片段生成字幕',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
      </svg>
    ),
  },
  {
    text: '把第二个片段的音量调低50%',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
      </svg>
    ),
  },
];

const SUGGESTIONS_WITHOUT_MATERIALS: Suggestion[] = [
  {
    text: '帮我搜索一些自然风光的视频素材',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    text: '生成一段科技感的AI视频',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    text: '创建一个产品展示的视频脚本',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    text: '帮我搜索轻快的背景音乐',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
    ),
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const WelcomeGuide: React.FC<WelcomeGuideProps> = ({
  hasMaterials = false,
  onSuggestionClick,
}) => {
  const suggestions = hasMaterials
    ? SUGGESTIONS_WITH_MATERIALS
    : SUGGESTIONS_WITHOUT_MATERIALS;

  const handleClick = useCallback(
    (text: string) => {
      onSuggestionClick(text);
    },
    [onSuggestionClick],
  );

  return (
    <motion.div
      className="flex-1 flex items-center justify-center min-h-0 px-4 py-8"
      variants={nodeVariants}
      initial="initial"
      animate="animate"
    >
      <div className="text-center max-w-sm w-full">
        {/* Icon */}
        <div className="w-14 h-14 rounded-xl bg-primary/10 dark:bg-primary/15 mx-auto mb-4 flex items-center justify-center">
          <svg
            className="w-7 h-7 text-primary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </div>

        {/* Title */}
        <h3 className="text-base font-semibold text-foreground dark:text-zinc-100 mb-1">
          AI Video Editing Assistant
        </h3>
        <p className="text-xs text-muted-foreground dark:text-zinc-500 mb-5">
          {hasMaterials
            ? '试试下面的操作，或直接输入你的指令'
            : '点击建议开始，或直接输入你想做的事情'}
        </p>

        {/* Suggestion cards */}
        <div className="space-y-2">
          {suggestions.map((suggestion, idx) => (
            <motion.button
              key={suggestion.text}
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border dark:border-zinc-700 bg-card dark:bg-zinc-800/60 hover:bg-accent dark:hover:bg-zinc-700/60 hover:border-primary/30 dark:hover:border-primary/30 transition-colors text-left group"
              onClick={() => handleClick(suggestion.text)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.2,
                delay: 0.05 * (idx + 1),
                ease: [0, 0, 0.2, 1],
              }}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <span className="flex-shrink-0 text-muted-foreground dark:text-zinc-400 group-hover:text-primary transition-colors">
                {suggestion.icon}
              </span>
              <span className="text-sm text-foreground dark:text-zinc-200">
                {suggestion.text}
              </span>
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  );
};

export default WelcomeGuide;
