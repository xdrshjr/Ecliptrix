'use client';

import React from 'react';
import { Conversation } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { formatDate } from '@/lib/utils/dateFormat';

interface ConversationListProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onNewChatClick: () => void;
}

const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
  onNewChatClick,
}) => {
  const { t } = useLocale();
  const handleDeleteClick = (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    onDeleteConversation(conversationId);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header - Aligned with ChatWindow header */}
      <div className="px-4 py-4 border-b border-border bg-card flex items-center justify-between h-[74px]">
        <h2 className="text-sm font-semibold text-foreground">{t.aiChat.conversationList.heading}</h2>
        <button
          onClick={onNewChatClick}
          className="w-8 h-8 bg-primary text-primary-foreground rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--primary-hover)] group"
          title={t.aiChat.conversationList.newChat}
        >
          <svg className="w-4 h-4 group-hover:rotate-90 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            <div className="w-16 h-16 bg-muted rounded-md flex items-center justify-center mx-auto mb-3">
              <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">{t.aiChat.conversationList.noConversations}</p>
            <p className="text-xs text-muted-foreground mt-1">{t.aiChat.conversationList.startNewChat}</p>
          </div>
        ) : (
          <div className="p-2">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                onClick={() => onSelectConversation(conversation.id)}
                className={`group relative p-3 rounded-md cursor-pointer transition-colors mb-1.5 ${
                  activeConversationId === conversation.id
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-accent border border-transparent'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className={`text-sm font-medium truncate ${
                      activeConversationId === conversation.id
                        ? 'text-foreground'
                        : 'text-foreground'
                    }`}>
                      {conversation.title}
                    </h3>
                    
                    {/* Chat Type Badge */}
                    <div className="flex items-center space-x-1 mt-1">
                      {conversation.chatType === 'chatbot' && (
                        <>
                          <svg className="w-3 h-3 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                          </svg>
                          <span className="text-xs text-primary font-medium">
                            {t.aiChat.conversationList.chatbot}
                          </span>
                        </>
                      )}
                      {conversation.chatType === 'workflow' && conversation.workflowName && (
                        <>
                          <svg className="w-3 h-3 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                          </svg>
                          <span className="text-xs text-primary font-medium truncate">
                            {conversation.workflowName}
                          </span>
                        </>
                      )}
                      {conversation.chatType === 'agent' && (
                        <>
                          <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                          <span className="text-xs text-green-500 font-medium">
                            {t.aiChat.conversationList.aiAgent}
                          </span>
                        </>
                      )}
                      {/* Fallback for old conversations without chatType */}
                      {!conversation.chatType && conversation.workflowName && (
                        <>
                          <svg className="w-3 h-3 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <span className="text-xs text-primary font-medium truncate">
                            {conversation.workflowName}
                          </span>
                        </>
                      )}
                    </div>
                    
                    <div className="flex items-center space-x-2 mt-1">
                      <span className={`text-xs ${
                        activeConversationId === conversation.id
                          ? 'text-primary'
                          : 'text-muted-foreground'
                      }`}>
                        {t.aiChat.conversationList.messages.replace('{count}', String(conversation.messages.length))}
                      </span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(conversation.updatedAt)}
                      </span>
                    </div>
                  </div>
                  
                  <button
                    onClick={(e) => handleDeleteClick(e, conversation.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConversationList; 