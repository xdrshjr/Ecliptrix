'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';

interface UserData {
  id: string;
  username: string;
  email?: string;
  full_name?: string;
  avatar_url?: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
  last_login_at?: string;
}

interface CreateUserFormData {
  username: string;
  email: string;
  password: string;
  full_name: string;
  avatar_url: string;
  is_active: boolean;
  is_admin: boolean;
  user_role: 'admin' | 'regular' | 'premium';
}

const UserManagement: React.FC = () => {
  const { t } = useLocale();
  const notification = useNotification();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<CreateUserFormData>({
    username: '',
    email: '',
    password: '',
    full_name: '',
    avatar_url: '',
    is_active: true,
    is_admin: false,
    user_role: 'regular',
  });
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof CreateUserFormData, string>>>({});
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      console.log('[UserManagement] Fetching users...');

      const response = await fetch('/api/admin/users/list');
      const data = await response.json();

      if (data.success) {
        console.log('[UserManagement] Users fetched:', data.total_count);
        setUsers(data.users || []);
      } else {
        console.error('[UserManagement] Failed to fetch users:', data.message);
        notification.showError(t.adminSettings.fetchError);
      }
    } catch (error) {
      console.error('[UserManagement] Error fetching users:', error);
      notification.showError(t.adminSettings.fetchError);
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    console.log('[UserManagement] Opening create user modal');
    setIsCreateModalOpen(true);
    setFormData({
      username: '',
      email: '',
      password: '',
      full_name: '',
      avatar_url: '',
      is_active: true,
      is_admin: false,
      user_role: 'regular',
    });
    setFormErrors({});
  };

  const closeCreateModal = () => {
    console.log('[UserManagement] Closing create user modal');
    setIsCreateModalOpen(false);
    setFormData({
      username: '',
      email: '',
      password: '',
      full_name: '',
      avatar_url: '',
      is_active: true,
      is_admin: false,
      user_role: 'regular',
    });
    setFormErrors({});
  };

  const validateForm = (): boolean => {
    const errors: Partial<Record<keyof CreateUserFormData, string>> = {};

    if (!formData.username.trim()) {
      errors.username = t.adminSettings.usernameRequired;
    } else if (formData.username.trim().length < 3) {
      errors.username = t.adminSettings.usernameMinLength;
    }

    if (!formData.email.trim()) {
      errors.email = t.profile.email + ' ' + t.adminSettings.usernameRequired;
    }

    if (!formData.password.trim()) {
      errors.password = ***REMOVED***;
    } else if (formData.password.length < 6) {
      errors.password = ***REMOVED***;
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateUser = async () => {
    console.log('[UserManagement] Creating user:', { username: formData.username, email: formData.email });

    if (!validateForm()) {
      console.log('[UserManagement] Form validation failed');
      return;
    }

    try {
      setIsCreating(true);

      const response = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (data.success) {
        console.log('[UserManagement] User created successfully:', data.user?.id);
        notification.showSuccess(t.adminSettings.createSuccess);
        closeCreateModal();
        await fetchUsers(); // Refresh the user list
      } else {
        console.error('[UserManagement] Failed to create user:', data.message);

        // Handle specific error messages
        if (data.message?.includes('用户名') || data.message?.includes('Username')) {
          notification.showError(t.adminSettings.usernameExists);
        } else if (data.message?.includes('邮箱') || data.message?.includes('Email')) {
          notification.showError(t.adminSettings.emailExists);
        } else {
          notification.showError(data.message || t.adminSettings.createError);
        }
      }
    } catch (error) {
      console.error('[UserManagement] Error creating user:', error);
      notification.showError(t.adminSettings.createError);
    } finally {
      setIsCreating(false);
    }
  };

  const openDeleteModal = (user: UserData) => {
    console.log('[UserManagement] Opening delete confirmation modal for user:', user.username);
    setUserToDelete(user);
    setIsDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    console.log('[UserManagement] Closing delete confirmation modal');
    setIsDeleteModalOpen(false);
    setUserToDelete(null);
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;

    console.log('[UserManagement] Deleting user:', { id: userToDelete.id, username: userToDelete.username });

    try {
      setIsDeleting(true);

      const response = await fetch(`/api/admin/users/delete/${userToDelete.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        console.log('[UserManagement] User deleted successfully:', userToDelete.id);
        notification.showSuccess(t.adminSettings.deleteSuccess);
        closeDeleteModal();
        await fetchUsers(); // Refresh the user list
      } else {
        console.error('[UserManagement] Failed to delete user:', data.message);
        notification.showError(data.message || t.adminSettings.deleteError);
      }
    } catch (error) {
      console.error('[UserManagement] Error deleting user:', error);
      notification.showError(t.adminSettings.deleteError);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '-';
    }
  };

  const getUserRole = (user: UserData) => {
    if (user.is_admin) return t.adminSettings.adminUsers;
    // You can extend this to check for premium role if needed
    return t.adminSettings.regularUsers;
  };

  const filteredUsers = users.filter(user =>
    user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const stats = {
    total: users.length,
    admin: users.filter(u => u.is_admin).length,
    active: users.filter(u => u.is_active).length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 text-sm text-muted-foreground">{t.adminSettings.loading}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border px-8 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">
              {t.adminSettings.registeredUsers}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t.adminSettings.userManagementDesc}
            </p>
          </div>
          <button
            onClick={fetchUsers}
            className="px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 rounded-md transition-colors"
          >
            <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            刷新
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-primary/10 rounded-md p-4">
            <div className="text-sm text-primary font-medium">{t.adminSettings.totalUsers}</div>
            <div className="text-2xl font-bold text-primary mt-1">{stats.total}</div>
          </div>
          <div className="bg-primary/10 rounded-md p-4">
            <div className="text-sm text-primary font-medium">{t.adminSettings.adminUsers}</div>
            <div className="text-2xl font-bold text-primary mt-1">{stats.admin}</div>
          </div>
          <div className="bg-green-500/10 rounded-md p-4">
            <div className="text-sm text-green-500 font-medium">{t.adminSettings.active}</div>
            <div className="text-2xl font-bold text-green-500 mt-1">{stats.active}</div>
          </div>
        </div>

        {/* Search Bar with Add User Button */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.adminSettings.searchPlaceholder}
              className="w-full pl-10 pr-4 py-2 bg-input text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <svg className="absolute left-3 top-2.5 w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t.adminSettings.addUser}
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {filteredUsers.length === 0 ? (
          <div className="bg-card rounded-md border border-border p-12 text-center">
            <svg className="w-16 h-16 mx-auto text-muted-foreground mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="text-muted-foreground text-lg">{t.adminSettings.noUsers}</p>
          </div>
        ) : (
          <div className="bg-card rounded-md border border-border overflow-hidden">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t.adminSettings.username}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t.profile.email}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t.adminSettings.role}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t.adminSettings.status}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t.adminSettings.createdAt}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t.adminSettings.lastLogin}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t.adminSettings.actions}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-accent transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center">
                            <span className="text-sm font-medium text-primary-foreground">
                              {user.username.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-foreground">{user.username}</div>
                          {user.full_name && (
                            <div className="text-sm text-muted-foreground">{user.full_name}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-muted-foreground">{user.email || '-'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded ${
                        user.is_admin
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {getUserRole(user)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded ${
                        user.is_active
                          ? 'bg-green-500/10 text-green-500'
                          : 'bg-destructive/10 text-destructive'
                      }`}>
                        {user.is_active ? t.adminSettings.active : t.adminSettings.inactive}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(user.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(user.last_login_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => openDeleteModal(user)}
                        className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-destructive hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                        title={t.adminSettings.deleteUser}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create User Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4">
          <div className="bg-card rounded-md shadow-sm max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold text-foreground">{t.adminSettings.createUserTitle}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t.adminSettings.createUserDesc}</p>
              </div>
              <button
                onClick={closeCreateModal}
                className="text-muted-foreground hover:text-foreground transition-colors"
                disabled={isCreating}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-4 space-y-4">
              {/* Username */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t.adminSettings.username} <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder={t.adminSettings.usernamePlaceholder}
                  className={`w-full px-3 py-2 bg-input text-foreground border rounded-md focus:outline-none focus:ring-2 focus:ring-ring ${
                    formErrors.username ? 'border-destructive' : 'border-border'
                  }`}
                  disabled={isCreating}
                />
                {formErrors.username && (
                  <p className="text-destructive text-sm mt-1">{formErrors.username}</p>
                )}
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t.profile.email} <span className="text-destructive">*</span>
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder={t.profile.emailPlaceholder}
                  className={`w-full px-3 py-2 bg-input text-foreground border rounded-md focus:outline-none focus:ring-2 focus:ring-ring ${
                    formErrors.email ? 'border-destructive' : 'border-border'
                  }`}
                  disabled={isCreating}
                />
                {formErrors.email && (
                  <p className="text-destructive text-sm mt-1">{formErrors.email}</p>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t.adminSettings.password} <span className="text-destructive">*</span>
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder={t.adminSettings.passwordPlaceholder}
                  className={`w-full px-3 py-2 bg-input text-foreground border rounded-md focus:outline-none focus:ring-2 focus:ring-ring ${
                    formErrors.password ? 'border-destructive' : 'border-border'
                  }`}
                  disabled={isCreating}
                />
                {formErrors.password && (
                  <p className="text-destructive text-sm mt-1">{formErrors.password}</p>
                )}
              </div>

              {/* Full Name */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t.adminSettings.fullName}
                </label>
                <input
                  type="text"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder={t.adminSettings.fullNamePlaceholder}
                  className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={isCreating}
                />
              </div>

              {/* Avatar URL */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t.adminSettings.avatarUrl}
                </label>
                <input
                  type="text"
                  value={formData.avatar_url}
                  onChange={(e) => setFormData({ ...formData, avatar_url: e.target.value })}
                  placeholder={t.adminSettings.avatarUrlPlaceholder}
                  className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={isCreating}
                />
              </div>

              {/* User Role */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t.adminSettings.userRole}
                </label>
                <select
                  value={formData.user_role}
                  onChange={(e) => setFormData({ ...formData, user_role: e.target.value as 'admin' | 'regular' | 'premium' })}
                  className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={isCreating}
                >
                  <option value="regular">{t.adminSettings.userRoleRegular}</option>
                  <option value="premium">{t.adminSettings.userRolePremium}</option>
                </select>
              </div>

              {/* Checkboxes */}
              <div className="space-y-3">
                {/* Is Admin */}
                <div className="flex items-start">
                  <input
                    type="checkbox"
                    id="is_admin"
                    checked={formData.is_admin}
                    onChange={(e) => setFormData({ ...formData, is_admin: e.target.checked })}
                    className="mt-1 w-4 h-4 text-primary border-border rounded focus:ring-ring"
                    disabled={isCreating}
                  />
                  <label htmlFor="is_admin" className="ml-2">
                    <div className="text-sm font-medium text-foreground">{t.adminSettings.isAdmin}</div>
                    <div className="text-xs text-muted-foreground">{t.adminSettings.isAdminDesc}</div>
                  </label>
                </div>

                {/* Is Active */}
                <div className="flex items-start">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="mt-1 w-4 h-4 text-primary border-border rounded focus:ring-ring"
                    disabled={isCreating}
                  />
                  <label htmlFor="is_active" className="ml-2">
                    <div className="text-sm font-medium text-foreground">{t.adminSettings.isActive}</div>
                    <div className="text-xs text-muted-foreground">{t.adminSettings.isActiveDesc}</div>
                  </label>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-background border-t border-border px-6 py-4 flex justify-end gap-3">
              <button
                onClick={closeCreateModal}
                className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-accent transition-colors"
                disabled={isCreating}
              >
                {t.adminSettings.cancel}
              </button>
              <button
                onClick={handleCreateUser}
                className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isCreating}
              >
                {isCreating ? t.adminSettings.creating : t.adminSettings.createUser}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal - Apple Light Style */}
      {isDeleteModalOpen && userToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4">
          <div className="bg-card rounded-md shadow-sm w-full max-w-md overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 pt-6 pb-4 text-center">
              <div className="mx-auto flex items-center justify-center h-14 w-14 rounded-full bg-destructive/10 mb-4">
                <svg className="h-7 w-7 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                {t.adminSettings.deleteConfirmTitle}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {t.adminSettings.deleteConfirmMessage}
              </p>
            </div>

            {/* User Info */}
            <div className="px-6 pb-4">
              <div className="bg-background rounded-md p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t.adminSettings.deleteConfirmUsername}:
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {userToDelete.username}
                  </span>
                </div>
                {userToDelete.email && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">
                      {t.adminSettings.deleteConfirmEmail}:
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      {userToDelete.email}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={closeDeleteModal}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-foreground bg-muted hover:bg-accent rounded-md transition-colors"
                disabled={isDeleting}
              >
                {t.adminSettings.cancelDelete}
              </button>
              <button
                onClick={handleDeleteUser}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-destructive-foreground bg-destructive hover:bg-destructive/90 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isDeleting}
              >
                {isDeleting ? t.adminSettings.deleting : t.adminSettings.confirmDelete}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
