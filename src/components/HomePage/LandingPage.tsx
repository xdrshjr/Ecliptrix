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
      type: 'video' as TaskType,
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
      title: t.tasks.aiChat,
      description: t.landing.aiChatDesc,
      type: 'chat' as TaskType,
    },
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
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="landing-features">
          <div className="landing-features-grid">
            {features.map((feature, index) => {
              const isLoadingDisabled = isAuthLoading;
              const stateClass = isLoadingDisabled
                ? 'opacity-60 cursor-wait pointer-events-none'
                : '';
              const handleActivate = () => {
                if (isAuthLoading) return;
                handleGetStarted(feature.type);
              };
              return (
                <div
                  key={index}
                  className={`landing-feature-card relative ${stateClass}`}
                  role="button"
                  tabIndex={0}
                  aria-disabled={isLoadingDisabled || undefined}
                  aria-label={`${feature.title} — ${feature.description}`}
                  onClick={handleActivate}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleActivate();
                    }
                  }}
                >
                  <div className="landing-feature-icon bg-primary/10 text-primary">
                    {feature.icon}
                  </div>
                  <h3 className="landing-feature-title">{feature.title}</h3>
                  <p className="landing-feature-description">{feature.description}</p>
                </div>
              );
            })}
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

