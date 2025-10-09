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
      {/* Backdrop with blur effect */}
      <div 
        className="absolute inset-0 bg-black/30 backdrop-blur-md"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-4xl mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
        >
          <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex">
          {/* Left side - Login form */}
          <div className="flex-1 p-8 lg:p-12">
            <div className="max-w-sm mx-auto">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                  {t.auth.welcomeBack}
                </h2>
                <p className="text-gray-600">
                  {t.auth.loginRegister}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                    {t.auth.username}
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    value={formData.username}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    placeholder="admin"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                    {t.auth.password}
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    placeholder="admin"
                  />
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-sm text-red-600">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-xl transition-all duration-200 flex items-center justify-center space-x-2"
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
                <p className="text-xs text-gray-500">
                  Test credentials: admin / 7#rA3310
                </p>
              </div>
            </div>
          </div>

          {/* Right side - Welcome content */}
          <div className="hidden lg:flex flex-1 bg-gradient-to-br from-blue-50 to-purple-50 p-12 items-center">
            <div className="max-w-md">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mb-6 flex items-center justify-center">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              
              <h3 className="text-2xl font-semibold text-gray-900 mb-4">
                {t.auth.welcomeTitle}
              </h3>
              
              <p className="text-gray-600 leading-relaxed">
                {t.auth.welcomeSubtitle}
              </p>

              <div className="mt-8 space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">Professional video editing tools</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">AI-powered content creation</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">Creative brainstorming assistance</span>
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