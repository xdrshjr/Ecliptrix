/**
 * TimelineAnimationStyles — injects the timeline CSS @keyframes into the DOM.
 *
 * Rendered once at the root of TimelineChatPanel. Uses a <style> element so the
 * keyframes are scoped to runtime and don't require a separate CSS file import.
 *
 * @module timeline/TimelineAnimationStyles
 */

'use client';

import React from 'react';
import { TIMELINE_ANIMATION_CSS } from './animations';

const TimelineAnimationStyles: React.FC = () => {
  return <style dangerouslySetInnerHTML={{ __html: TIMELINE_ANIMATION_CSS }} />;
};

export default React.memo(TimelineAnimationStyles);
