/**
 * Timeline Chat UI — barrel exports.
 *
 * @module timeline
 */

export { default as TimelineChatPanel } from './TimelineChatPanel';
export { default as TimelineConnector } from './TimelineConnector';
export { default as TimelineNodeIcon } from './TimelineNodeIcon';
export { default as UserMessageNode } from './UserMessageNode';
export { default as AgentThinkingNode } from './AgentThinkingNode';
export { default as AgentExecutionNode } from './AgentExecutionNode';
export { default as AgentResponseNode } from './AgentResponseNode';
export { default as ToolStep } from './ToolStep';
export { default as WelcomeGuide } from './WelcomeGuide';
export { default as ErrorStateCard } from './ErrorStateCard';
export { default as TimelineAnimationStyles } from './TimelineAnimationStyles';

// Types
export type {
  TimelineChatPanelProps,
  TimelineNodeData,
  UserMessageNodeData,
  AgentThinkingNodeData,
  AgentExecutionNodeData,
  AgentResponseNodeData,
  ToolStepData,
  ToolStepStatus,
  ConnectorState,
  EnhancedToolCallRecord,
} from './types';

export type { ErrorCardVariant } from './ErrorStateCard';

// Utils
export {
  mapMessageToNodes,
  messagesToTimelineNodes,
  getToolDisplayName,
  formatElapsedTime,
  formatTimestamp,
  toolCallToStepData,
} from './utils';

// Animation config
export {
  TIMING,
  EASING,
  CSS_ANIMATIONS,
  nodeVariants,
  undoneNodeVariants,
  expandVariants,
  iconScaleInVariants,
  errorSlideInVariants,
  dropdownVariants,
} from './animations';
