'use client';

import React from 'react';
import { TaskType } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';

interface LandingPageProps {
  onCreateTask: (type: TaskType) => void;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  onLoginRequired: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ 
  onCreateTask, 
  isAuthenticated, 
  isAuthLoading, 
  onLoginRequired 
}) => {
  const { t } = useLocale();

  const handleGetStarted = (taskType: TaskType) => {
    if (isAuthLoading) {
      return;
    }

    if (!isAuthenticated) {
      onLoginRequired();
      return;
    }

    onCreateTask(taskType);
  };

  const features = [
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
      title: t.tasks.videoEditing,
      description: t.landing.videoEditingDesc,
      type: 'video' as TaskType
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
        </svg>
      ),
      title: t.tasks.workflow,
      description: t.landing.workflowDesc,
      type: 'workflow' as TaskType
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
      title: t.tasks.aiChat,
      description: t.landing.aiChatDesc,
      type: 'chat' as TaskType
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ),
      title: t.tasks.brainstorming,
      description: t.landing.brainstormingDesc,
      type: 'brainstorm' as TaskType
    }
  ];

  return (
    <div className="landing-page">
      {/* Main Content */}
      <div className="landing-content">
        {/* Hero Section */}
        <section className="landing-hero">
          <div className="landing-hero-content">
            <h1 className="landing-title">
              Ecliptrix
            </h1>
            <p className="landing-subtitle">
              {t.header.brandSubtitle}
            </p>
            <p className="landing-description">
              {t.landing.heroDescription}
            </p>
            
            {/* CTA Buttons */}
            <div className="landing-cta-group">
              <button
                onClick={() => handleGetStarted('video')}
                disabled={isAuthLoading}
                className={`landing-cta-primary ${isAuthLoading ? 'opacity-60 cursor-wait' : ''}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{isAuthLoading ? t.landing.loading : t.landing.startCreating}</span>
              </button>
              <button
                onClick={() => handleGetStarted('workflow')}
                disabled={isAuthLoading}
                className={`landing-cta-secondary ${isAuthLoading ? 'opacity-60 cursor-wait' : ''}`}
              >
                <span>{t.landing.exploreWorkflows}</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </button>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="landing-features">
          <div className="landing-features-grid">
            {features.map((feature, index) => (
              <div
                key={index}
                className={`landing-feature-card ${isAuthLoading ? 'opacity-60 cursor-wait pointer-events-none' : ''}`}
                onClick={() => handleGetStarted(feature.type)}
              >
                <div className="landing-feature-icon bg-primary/10 text-primary">
                  {feature.icon}
                </div>
                <h3 className="landing-feature-title">{feature.title}</h3>
                <p className="landing-feature-description">{feature.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Stats Section */}
        <section className="landing-stats">
          <div className="landing-stats-grid">
            <div className="landing-stat-item">
              <div className="landing-stat-value">100+</div>
              <div className="landing-stat-label">{t.landing.aiModels}</div>
            </div>
            <div className="landing-stat-item">
              <div className="landing-stat-value">50+</div>
              <div className="landing-stat-label">{t.landing.workflowTemplates}</div>
            </div>
            <div className="landing-stat-item">
              <div className="landing-stat-value">∞</div>
              <div className="landing-stat-label">{t.landing.creativePossibilities}</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default LandingPage;

