'use client';

import React, { useState, useEffect } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotification } from '@/contexts/NotificationContext';
import { http, ApiError } from '@/lib/api/http-client';

interface UserFormData {
  username: string;
  email: string;
  fullName: string;
  avatarUrl: string;
}

const UserInfoPanel: React.FC = () => {
  const { t } = useLocale();
  const { user, updateUserProfile } = useAuth();
  const { showSuccess, showError } = useNotification();
  
  const [formData, setFormData] = useState<UserFormData>({
    username: '',
    email: '',
    fullName: '',
    avatarUrl: ''
  });
  const [isLoading, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize form data from user context
  useEffect(() => {
    if (user) {
      const initialData = {
        username: user.username || '',
        email: user.email || '',
        fullName: user.fullName || '',
        avatarUrl: user.avatarUrl || user.avatar || ''
      };
      setFormData(initialData);
    }
  }, [user]);

  // Check for changes
  useEffect(() => {
    if (user) {
      const hasChanges = 
        formData.username !== (user.username || '') ||
        formData.email !== (user.email || '') ||
        formData.fullName !== (user.fullName || '') ||
        formData.avatarUrl !== (user.avatarUrl || user.avatar || '');
      setHasChanges(hasChanges);
    }
  }, [formData, user]);

  const handleInputChange = (field: keyof UserFormData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    if (!hasChanges) return;

    setSaving(true);
    try {
      // Call API to update user profile
      let result: any;
      try {
        result = await http.put<any>('/api/user/profile', formData);
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          result = { success: false, message: httpError.message || `HTTP ${httpError.status}` };
        } else {
          throw httpError;
        }
      }

      if (result.success) {
        // Update auth context with new user data
        await updateUserProfile(result.user);
        showSuccess(t.profile.saveSuccess);
        setHasChanges(false);
      } else {
        showError(result.message || t.profile.saveError);
      }
    } catch (error) {
      console.error('Profile update error:', error);
      showError(t.profile.saveError);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (user) {
      setFormData({
        username: user.username || '',
        email: user.email || '',
        fullName: user.fullName || '',
        avatarUrl: user.avatarUrl || user.avatar || ''
      });
      setHasChanges(false);
    }
  };

  return (
    <div className="p-8 flex justify-center">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-2">
            {t.profile.userInfo}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t.profile.userInfoDescription}
          </p>
        </div>

        {/* Avatar Section */}
        <div className="mb-8">
          <label className="block text-sm font-medium text-foreground mb-3">
            {t.profile.avatar}
          </label>
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center">
              {formData.avatarUrl ? (
                <img
                  src={formData.avatarUrl}
                  alt="Avatar"
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <span className="text-xl font-medium text-primary-foreground">
                  {formData.username.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <input
                type="text"
                value={formData.avatarUrl}
                onChange={(e) => handleInputChange('avatarUrl', e.target.value)}
                placeholder={t.profile.avatarUrlPlaceholder}
                className="block w-80 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t.profile.avatarUrlHelper}
              </p>
            </div>
          </div>
        </div>

        {/* Form Fields */}
        <div className="space-y-6">
          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t.profile.username}
            </label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => handleInputChange('username', e.target.value)}
              className="block w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              placeholder={t.profile.usernamePlaceholder}
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t.profile.email}
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              className="block w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              placeholder={t.profile.emailPlaceholder}
            />
          </div>

          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t.profile.fullName}
            </label>
            <input
              type="text"
              value={formData.fullName}
              onChange={(e) => handleInputChange('fullName', e.target.value)}
              className="block w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              placeholder={t.profile.fullNamePlaceholder}
            />
          </div>
        </div>

        {/* Action Buttons — iter5: render persistently with disabled state so
            users see immediate, predictable affordance instead of buttons that
            appear/disappear with every keystroke. */}
        <div className="mt-8 flex items-center space-x-4 pt-6 border-t border-border">
          <button
            onClick={handleSave}
            disabled={!hasChanges || isLoading}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? t.profile.saving : t.profile.save}
          </button>
          <button
            onClick={handleReset}
            disabled={!hasChanges || isLoading}
            className="px-4 py-2 border border-border text-foreground text-sm font-medium rounded-md hover:bg-accent focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t.profile.cancel}
          </button>
          {!hasChanges && (
            <span className="text-xs text-muted-foreground">{t.profile.noChanges}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserInfoPanel; 