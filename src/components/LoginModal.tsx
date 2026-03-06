'use client';

import React, { useState, useEffect } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotification } from '@/contexts/NotificationContext';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose }) => {
  const { t } = useLocale();
  const { login } = useAuth();
  const notification = useNotification();
  
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setFormData({ username: '', password: '' });
      setError('');
      setIsLoading(false);
    }
  }, [isOpen]);

  // Close modal on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (error) setError(''); // Clear error when user starts typing
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    console.log('[LoginModal] Login attempt started:', {
      username: formData.username,
      hasPassword: !!formData.password,
      timestamp: new Date().toISOString()
    });
    
    if (!formData.username || !formData.password) {
      console.warn('[LoginModal] Login validation failed:', {
        hasUsername: !!formData.username,
        hasPassword: !!formData.password,
        error: 'missing required fields',
        timestamp: new Date().toISOString()
      });
      setError(t.auth.requiredFields);
      return;
    }

    setIsLoading(true);
    setError('');

    console.log('[LoginModal] Login loading state activated:', {
      username: formData.username,
      loadingState: true,
      timestamp: new Date().toISOString()
    });

    try {
      const result = await login(formData);
      
      if (result.success) {
        console.log('[LoginModal] Login successful, closing modal:', {
          username: formData.username,
          success: true,
          timestamp: new Date().toISOString()
        });
        onClose();
      } else {
        console.warn('[LoginModal] Login failed:', {
          username: formData.username,
          error: result.error,
          timestamp: new Date().toISOString()
        });
        const errorMessage = result.error || t.auth.loginFailed;
        setError(errorMessage);
        notification.showError(errorMessage, 4000);
      }
    } catch (err) {
      console.error('[LoginModal] Login error occurred:', {
        username: formData.username,
        error: err,
        timestamp: new Date().toISOString()
      });
      setError(t.auth.loginFailed);
      notification.showError(t.auth.loginFailed, 4000);
    } finally {
      setIsLoading(false);
      console.log('[LoginModal] Login loading state deactivated:', {
        username: formData.username,
        loadingState: false,
        timestamp: new Date().toISOString()
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-4xl mx-4 bg-card rounded-md border border-border shadow-xl overflow-hidden">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors"
        >
          <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex">
          {/* Left side - Login form */}
          <div className="flex-1 p-8 lg:p-12">
            <div className="max-w-sm mx-auto">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-semibold text-foreground mb-2">
                  {t.auth.welcomeBack}
                </h2>
                <p className="text-muted-foreground">
                  {t.auth.loginRegister}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="username" className="block text-sm font-medium text-muted-foreground mb-2">
                    {t.auth.username}
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    value={formData.username}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors"
                    placeholder="admin"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-muted-foreground mb-2">
                    {t.auth.password}
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors"
                    placeholder="admin"
                  />
                </div>

                {error && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 bg-primary hover:opacity-90 disabled:opacity-50 text-primary-foreground font-medium rounded-md transition-opacity duration-200 flex items-center justify-center space-x-2"
                >
                  {isLoading && (
                    <svg
                      className="w-4 h-4 animate-spin"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray="60 40"
                        className="opacity-75"
                      />
                    </svg>
                  )}
                  <span>{isLoading ? t.auth.loggingIn : t.auth.loginButton}</span>
                </button>
              </form>

              <div className="mt-6 text-center">
                <p className="text-xs text-muted-foreground">
                  Test credentials: admin / *
                </p>
              </div>
            </div>
          </div>

          {/* Right side - Welcome content */}
          <div className="hidden lg:flex flex-1 bg-muted p-12 items-center border-l border-border">
            <div className="max-w-md">
              <div className="w-16 h-16 bg-primary rounded-md mb-6 flex items-center justify-center">
                <svg className="w-8 h-8 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>

              <h3 className="text-2xl font-semibold text-foreground mb-4">
                {t.auth.welcomeTitle}
              </h3>

              <p className="text-muted-foreground leading-relaxed">
                {t.auth.welcomeSubtitle}
              </p>

              <div className="mt-8 space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-primary rounded-full"></div>
                  <span className="text-sm text-muted-foreground">Professional video editing tools</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-primary rounded-full"></div>
                  <span className="text-sm text-muted-foreground">AI-powered content creation</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-primary rounded-full"></div>
                  <span className="text-sm text-muted-foreground">Creative brainstorming assistance</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginModal; 