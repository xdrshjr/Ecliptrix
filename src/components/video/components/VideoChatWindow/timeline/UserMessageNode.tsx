/**
 * UserMessageNode — renders a user's message on the timeline.
 *
 * Layout: solid circle icon | timestamp + localised author label | message text
 *
 * Uses shared nodeVariants for entrance animation (opacity + translateY).
 *
 * @module timeline/UserMessageNode
 */

'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useLocale } from '@/contexts/LocaleContext';
import type { UserMessageNodeData } from './types';
import { formatTimestamp } from './utils';
import TimelineNodeIcon from './TimelineNodeIcon';
import { nodeVariants } from './animations';

interface UserMessageNodeProps {
  node: UserMessageNodeData;
}

const UserMessageNode: React.FC<UserMessageNodeProps> = ({ node }) => {
  const { t } = useLocale();
  return (
    <motion.div
      className="flex items-start gap-0"
      variants={nodeVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      layout="position"
    >
      {/* Icon column */}
      <TimelineNodeIcon variant="user" />

      {/* Content */}
      <div className="flex-1 min-w-0 pt-1">
        {/* Header: timestamp + label */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-muted-foreground dark:text-zinc-500 tabular-nums">
            {formatTimestamp(node.timestamp)}
          </span>
          <span className="text-xs font-medium text-foreground dark:text-zinc-300">
            {t.agentTimeline.userAuthor}
          </span>
        </div>

        {/* Message body */}
        <div className="text-sm text-foreground dark:text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">
          {node.content}
        </div>
      </div>
    </motion.div>
  );
};

export default UserMessageNode;
