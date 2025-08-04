'use client';

import React, { useState, useCallback } from 'react';
import { Conversation, ChatMessage, ChatTaskContent } from '@/types';
import ConversationList from './ConversationList';
import ChatWindow from './ChatWindow';

interface ChatInterfaceProps {
  taskId: string;
  content: ChatTaskContent | null;
  onUpdateContent: (content: ChatTaskContent) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  taskId,
  content,
  onUpdateContent,
}) => {
  const [isLoading, setIsLoading] = useState(false);

  // Initialize content if null
  const chatContent: ChatTaskContent = content || {
    conversations: [],
    activeConversationId: null,
  };

  const handleCreateConversation = useCallback(() => {
    const now = new Date();
    const conversationId = `conv-${Date.now()}`;
    
    const newConversation: Conversation = {
      id: conversationId,
      title: 'New Chat',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    const updatedContent: ChatTaskContent = {
      conversations: [...chatContent.conversations, newConversation],
      activeConversationId: conversationId,
    };

    onUpdateContent(updatedContent);
    console.log(`Created new conversation: ${conversationId}`);
  }, [chatContent, onUpdateContent]);

  const handleSelectConversation = useCallback((conversationId: string) => {
    const updatedContent: ChatTaskContent = {
      ...chatContent,
      activeConversationId: conversationId,
    };
    onUpdateContent(updatedContent);
    console.log(`Selected conversation: ${conversationId}`);
  }, [chatContent, onUpdateContent]);

  const handleDeleteConversation = useCallback((conversationId: string) => {
    const updatedConversations = chatContent.conversations.filter(
      conv => conv.id !== conversationId
    );
    
    let newActiveId = chatContent.activeConversationId;
    if (chatContent.activeConversationId === conversationId) {
      newActiveId = updatedConversations.length > 0 ? updatedConversations[0].id : null;
    }

    const updatedContent: ChatTaskContent = {
      conversations: updatedConversations,
      activeConversationId: newActiveId,
    };

    onUpdateContent(updatedContent);
    console.log(`Deleted conversation: ${conversationId}`);
  }, [chatContent, onUpdateContent]);

  const updateConversationMessages = useCallback((conversationId: string, messages: ChatMessage[]) => {
    console.log(`[Chat] Updating messages for conversation ${conversationId}, message count: ${messages.length}`);
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      console.log(`[Chat] Last message - role: ${lastMessage.role}, content length: ${lastMessage.content.length}, isStreaming: ${lastMessage.isStreaming}`);
    }
    
    const updatedConversations = chatContent.conversations.map(conv => {
      if (conv.id === conversationId) {
        return {
          ...conv,
          messages,
          updatedAt: new Date(),
        };
      }
      return conv;
    });

    const updatedContent: ChatTaskContent = {
      ...chatContent,
      conversations: updatedConversations,
    };

    onUpdateContent(updatedContent);
  }, [chatContent, onUpdateContent]);

  const handleSendMessage = useCallback(async (message: string) => {
    if (!chatContent.activeConversationId || isLoading) return;

    const activeConversation = chatContent.conversations.find(
      conv => conv.id === chatContent.activeConversationId
    );
    
    if (!activeConversation) return;

    setIsLoading(true);
    
    try {
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      };

      // Update conversation title if it's the first message
      const updatedTitle = activeConversation.messages.length === 0 
        ? message.slice(0, 30) + (message.length > 30 ? '...' : '')
        : activeConversation.title;

      // Add user message
      const messagesWithUser = [...activeConversation.messages, userMessage];
      
      // Update conversation with user message
      const updatedConversations = chatContent.conversations.map(conv => {
        if (conv.id === chatContent.activeConversationId) {
          return {
            ...conv,
            title: updatedTitle,
            messages: messagesWithUser,
            updatedAt: new Date(),
          };
        }
        return conv;
      });

      onUpdateContent({
        ...chatContent,
        conversations: updatedConversations,
      });

      // Create assistant message placeholder
      const assistantMessageId = `msg-${Date.now()}-assistant`;
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      };

      // Add assistant message placeholder
      const messagesWithAssistant = [...messagesWithUser, assistantMessage];
      updateConversationMessages(chatContent.activeConversationId, messagesWithAssistant);

      // Call API for streaming response
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messagesWithUser,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
      }

      let accumulatedContent = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              break;
            }
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                accumulatedContent += parsed.content;
                
                // Update the assistant message with accumulated content
                const updatedMessages = [...messagesWithUser, {
                  ...assistantMessage,
                  content: accumulatedContent,
                  isStreaming: true
                }];
                
                console.log(`[Chat] Streaming update - accumulated content length: ${accumulatedContent.length}`);
                updateConversationMessages(chatContent.activeConversationId!, updatedMessages);
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }

      // Mark streaming as complete
      const finalMessages = [...messagesWithUser, {
        ...assistantMessage,
        content: accumulatedContent,
        isStreaming: false
      }];
      
      console.log(`[Chat] Streaming complete - final content length: ${accumulatedContent.length}`);
      console.log(`[Chat] Final content preview: ${accumulatedContent.slice(0, 100)}...`);
      updateConversationMessages(chatContent.activeConversationId!, finalMessages);

      console.log(`Sent message and received response for conversation: ${chatContent.activeConversationId}`);
      
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Remove the assistant message placeholder on error
      const messagesWithoutAssistant = activeConversation.messages.concat([{
        id: `msg-${Date.now()}-user`,
        role: 'user' as const,
        content: message,
        timestamp: new Date(),
      }]);
      
      updateConversationMessages(chatContent.activeConversationId!, messagesWithoutAssistant);
      
    } finally {
      setIsLoading(false);
    }
  }, [chatContent, onUpdateContent, isLoading, updateConversationMessages]);

  const activeConversation = chatContent.conversations.find(
    conv => conv.id === chatContent.activeConversationId
  );

  return (
    <div className="flex h-full bg-gray-50">
      {/* Left Sidebar - Conversation List */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <ConversationList
          conversations={chatContent.conversations}
          activeConversationId={chatContent.activeConversationId}
          onCreateConversation={handleCreateConversation}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
        />
      </div>

      {/* Right Side - Chat Window */}
      <div className="flex-1 flex flex-col">
        <ChatWindow
          conversation={activeConversation}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
};

export default ChatInterface; 