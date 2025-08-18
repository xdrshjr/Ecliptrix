export interface CreativeBrainstormingConfig {
  creationType: string[];
  creationDomain: string[];
  creationGoal: string[];
  contentStrategy: string[];
  creativeExperts: string[];
}

export interface ExpertProfile {
  id: string;
  name: string;
  title: string;
  expertise: string[];
  personality: string;
  color: string;
  avatar: string;
}

export interface ChatMessage {
  id: string;
  type: 'expert' | 'user' | 'moderator';
  expertId?: string;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface BrainstormingSession {
  id: string;
  config: CreativeBrainstormingConfig;
  messages: ChatMessage[];
  currentRound: number;
  isDiscussing: boolean;
  isSummarizing: boolean;
  finalSummary?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConfigOption {
  id: string;
  label: string;
  description: string;
}

export interface ConfigCategory {
  id: keyof CreativeBrainstormingConfig;
  title: string;
  description: string;
  options: ConfigOption[];
  multiple: boolean;
}

export type BrainstormingPhase = 'config' | 'discussion' | 'summary' | 'export'; 