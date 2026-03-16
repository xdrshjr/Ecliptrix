'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { useAuth } from '@/contexts/AuthContext';
import RoleBadge, { resolveUserRole } from '@/components/ui/RoleBadge';
import type { UserInfo, UserStats, UserListParams, LoginHistoryRecord, CreateUserData } from '@/types/auth';
import * as userApi from '@/lib/api/userManagement';
import type { UpdateUserData } from '@/lib/api/userManagement';

// ---------------------------------------------------------------------------
// Inline SVG Icons (no external icon library)
// ---------------------------------------------------------------------------

type IconProps = { className?: string };
const svgBase = (className: string | undefined, d: string, extra?: React.ReactNode) => (
  <svg className={className ?? 'w-4 h-4'} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">{extra}<path d={d} /></svg>
);

const IconUsers = ({ className }: IconProps) => svgBase(className, 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', <><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>);
const IconShield = ({ className }: IconProps) => svgBase(className, 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z');
const IconCrown = ({ className }: IconProps) => svgBase(className, 'M2 4l3 12h14l3-12-5 4-5-4-5 4z', <path d="M2 16h20" />);
const IconUserCheck = ({ className }: IconProps) => svgBase(className, 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', <><circle cx="8.5" cy="7" r="4" /><polyline points="17 11 19 13 23 9" /></>);
const IconWifi = ({ className }: IconProps) => svgBase(className, 'M12 20h.01', <><path d="M2 8.82a15 15 0 0 1 20 0" /><path d="M5 12.86a10 10 0 0 1 14 0" /><path d="M8.5 16.9a5 5 0 0 1 7 0" /></>);
const IconSearch = ({ className }: IconProps) => svgBase(className, 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z');
const IconPlus = ({ className }: IconProps) => svgBase(className, 'M12 5v14m-7-7h14');
const IconRefreshCw = ({ className }: IconProps) => svgBase(className, 'M23 4v6h-6', <><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></>);
const IconMoreHorizontal = ({ className }: IconProps) => (<svg className={className ?? 'w-4 h-4'} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>);
const IconPencil = ({ className }: IconProps) => svgBase(className, 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z');
const IconKeyRound = ({ className }: IconProps) => svgBase(className, 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4');
const IconBan = ({ className }: IconProps) => (<svg className={className ?? 'w-4 h-4'} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>);
const IconHistory = ({ className }: IconProps) => svgBase(className, 'M1 4v6h6', <><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></>);
const IconLogOut = ({ className }: IconProps) => svgBase(className, 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', <><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>);
const IconTrash2 = ({ className }: IconProps) => svgBase(className, 'M3 6h18', <><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></>);
const IconChevronUp = ({ className }: IconProps) => svgBase(className, 'M18 15l-6-6-6 6');
const IconChevronDown = ({ className }: IconProps) => svgBase(className, 'M6 9l6 6 6-6');
const IconChevronLeft = ({ className }: IconProps) => svgBase(className, 'M15 18l-6-6 6-6');
const IconChevronRight = ({ className }: IconProps) => svgBase(className, 'M9 18l6-6-6-6');
const IconX = ({ className }: IconProps) => svgBase(className, 'M18 6L6 18M6 6l12 12');
const IconCopy = ({ className }: IconProps) => svgBase(className, '', <><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>);
const IconCheck = ({ className }: IconProps) => svgBase(className, 'M20 6L9 17l-5-5');
const IconAlertTriangle = ({ className }: IconProps) => svgBase(className, 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', <><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>);
const IconEye = ({ className }: IconProps) => svgBase(className, 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', <circle cx="12" cy="12" r="3" />);
const IconEyeOff = ({ className }: IconProps) => svgBase(className, 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24', <line x1="1" y1="1" x2="23" y2="23" />);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '< 1 min';
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d`;
    return date.toLocaleDateString();
  } catch {
    return '-';
  }
}

function formatDateTime(dateString?: string): string {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Stats cards */
function UserStatsCards({ stats, t }: { stats: UserStats | null; t: ReturnType<typeof useLocale>['t'] }) {
  const cards = [
    { label: t.adminSettings.totalUsers, value: stats?.totalUsers ?? 0, color: 'text-blue-500', bg: 'bg-blue-500/10', icon: IconUsers },
    { label: t.adminSettings.adminUsers, value: stats?.adminCount ?? 0, color: 'text-purple-500', bg: 'bg-purple-500/10', icon: IconShield },
    { label: t.adminSettings.premiumUsers, value: stats?.premiumCount ?? 0, color: 'text-amber-500', bg: 'bg-amber-500/10', icon: IconCrown },
    { label: t.adminSettings.regularUsers, value: stats?.regularCount ?? 0, color: 'text-gray-500', bg: 'bg-gray-500/10', icon: IconUsers },
    { label: t.adminSettings.active, value: stats?.activeCount ?? 0, color: 'text-green-500', bg: 'bg-green-500/10', icon: IconUserCheck },
    { label: t.adminSettings.onlineUsers, value: stats?.onlineCount ?? 0, color: 'text-cyan-500', bg: 'bg-cyan-500/10', icon: IconWifi },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((c) => (
        <div key={c.label} className={`${c.bg} rounded-lg p-3`}>
          <div className="flex items-center gap-2 mb-1">
            <c.icon className={`w-4 h-4 ${c.color}`} />
            <span className={`text-xs font-medium ${c.color}`}>{c.label}</span>
          </div>
          <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Sortable column header */
function SortHeader({
  label, field, sortBy, sortOrder, onSort,
}: {
  label: string; field: string;
  sortBy: string; sortOrder: 'asc' | 'desc';
  onSort: (field: string) => void;
}) {
  const active = sortBy === field;
  return (
    <button
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground"
      onClick={() => onSort(field)}
    >
      {label}
      <span className="flex flex-col leading-none">
        <IconChevronUp className={`w-3 h-3 -mb-0.5 ${active && sortOrder === 'asc' ? 'text-primary' : 'text-muted-foreground/40'}`} />
        <IconChevronDown className={`w-3 h-3 ${active && sortOrder === 'desc' ? 'text-primary' : 'text-muted-foreground/40'}`} />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Create User Dialog
// ---------------------------------------------------------------------------

interface CreateUserDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  canManageAdmins: boolean;
  t: ReturnType<typeof useLocale>['t'];
}

function CreateUserDialog({ open, onClose, onCreated, canManageAdmins, t }: CreateUserDialogProps) {
  const notification = useNotification();
  const [form, setForm] = useState<CreateUserData & { confirmPassword: string }>({
    username: '', password: '', confirmPassword: '', email: '', fullName: '', userRole: 'regular',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ username: '', password: '', confirmPassword: '', email: '', fullName: '', userRole: 'regular' });
      setErrors({});
    }
  }, [open]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.username.trim()) e.username = t.adminSettings.usernameRequired;
    else if (form.username.trim().length < 3) e.username = t.adminSettings.usernameMinLength;
    else if (!/^[a-zA-Z0-9_]+$/.test(form.username.trim())) e.username = t.adminSettings.usernameInvalidChars;
    if (!form.password) e.password = ***REMOVED***;
    else if (form.password.length < 6) e.password = ***REMOVED***;
    if (form.password !== form.confirmPassword) e.confirmPassword = ***REMOVED***;
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = t.adminSettings.emailInvalid;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    try {
      setSubmitting(true);
      await userApi.createUser(form);
      notification.showSuccess(t.adminSettings.createSuccess);
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.adminSettings.createError;
      notification.showError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const inputClass = (field: string) =>
    `w-full px-3 py-2 bg-input text-foreground border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm ${errors[field] ? 'border-destructive' : 'border-border'}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-lg max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{t.adminSettings.createUserTitle}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{t.adminSettings.createUserDesc}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" disabled={submitting}>
            <IconX className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t.adminSettings.username} <span className="text-destructive">*</span></label>
            <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={t.adminSettings.usernamePlaceholder} className={inputClass('username')} disabled={submitting} />
            {errors.username && <p className="text-destructive text-xs mt-1">{errors.username}</p>}
          </div>
          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t.adminSettings.password} <span className="text-destructive">*</span></label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={t.adminSettings.passwordPlaceholder} className={inputClass('password')} disabled={submitting} />
            {errors.password && <p className="text-destructive text-xs mt-1">{errors.password}</p>}
          </div>
          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t.adminSettings.confirmPassword} <span className="text-destructive">*</span></label>
            <input type="password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} placeholder={t.adminSettings.confirmPassword} className={inputClass('confirmPassword')} disabled={submitting} />
            {errors.confirmPassword && <p className="text-destructive text-xs mt-1">{errors.confirmPassword}</p>}
          </div>
          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t.profile.email}</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={t.adminSettings.emailPlaceholder} className={inputClass('email')} disabled={submitting} />
            {errors.email && <p className="text-destructive text-xs mt-1">{errors.email}</p>}
          </div>
          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t.adminSettings.fullName}</label>
            <input type="text" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder={t.adminSettings.fullNamePlaceholder} className={inputClass('fullName')} disabled={submitting} />
          </div>
          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t.adminSettings.userRole} <span className="text-destructive">*</span></label>
            <select value={form.userRole} onChange={(e) => setForm({ ...form, userRole: e.target.value as CreateUserData['userRole'] })} className={inputClass('userRole')} disabled={submitting}>
              {canManageAdmins && <option value="admin">{t.adminSettings.userRoleAdmin}</option>}
              <option value="premium">{t.adminSettings.userRolePremium}</option>
              <option value="regular">{t.adminSettings.userRoleRegular}</option>
            </select>
          </div>
        </div>
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-accent transition-colors" disabled={submitting}>{t.adminSettings.cancel}</button>
          <button onClick={handleSubmit} className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={submitting}>{submitting ? t.adminSettings.creating : t.adminSettings.createUser}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit User Dialog
// ---------------------------------------------------------------------------

interface EditUserDialogProps {
  open: boolean;
  user: UserInfo | null;
  onClose: () => void;
  onUpdated: () => void;
  canManageAdmins: boolean;
  t: ReturnType<typeof useLocale>['t'];
}

function EditUserDialog({ open, user, onClose, onUpdated, canManageAdmins, t }: EditUserDialogProps) {
  const notification = useNotification();
  const [form, setForm] = useState<UpdateUserData>({ email: '', fullName: '', userRole: 'regular' });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && user) {
      setForm({ email: user.email ?? '', fullName: user.fullName ?? '', userRole: user.userRole ?? 'regular' });
      setErrors({});
    }
  }, [open, user]);

  const handleSubmit = async () => {
    if (!user) return;
    const e: Record<string, string> = {};
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = t.adminSettings.emailInvalid;
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    try {
      setSubmitting(true);
      await userApi.updateUser(user.id, form);
      notification.showSuccess(t.adminSettings.editSuccess);
      onUpdated();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.adminSettings.editError;
      notification.showError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !user) return null;

  const inputClass = (field: string) =>
    `w-full px-3 py-2 bg-input text-foreground border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm ${errors[field] ? 'border-destructive' : 'border-border'}`;

  const currentRole = resolveUserRole(user);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-lg max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{t.adminSettings.editUserTitle}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{t.adminSettings.editUserDesc}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><IconX className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {/* Username (read only) */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t.adminSettings.username}</label>
            <div className="flex items-center gap-2">
              <input type="text" value={user.username} disabled className="w-full px-3 py-2 bg-muted text-muted-foreground border border-border rounded-md text-sm cursor-not-allowed" />
              <RoleBadge role={currentRole} size="md" />
            </div>
          </div>
          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t.profile.email}</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={t.adminSettings.emailPlaceholder} className={inputClass('email')} disabled={submitting} />
            {errors.email && <p className="text-destructive text-xs mt-1">{errors.email}</p>}
          </div>
          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t.adminSettings.fullName}</label>
            <input type="text" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder={t.adminSettings.fullNamePlaceholder} className={inputClass('fullName')} disabled={submitting} />
          </div>
          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t.adminSettings.userRole}</label>
            <select
              value={form.userRole}
              onChange={(e) => setForm({ ...form, userRole: e.target.value })}
              className={inputClass('userRole')}
              disabled={submitting || (!canManageAdmins && currentRole === 'admin')}
            >
              {canManageAdmins && <option value="admin">{t.adminSettings.userRoleAdmin}</option>}
              <option value="premium">{t.adminSettings.userRolePremium}</option>
              <option value="regular">{t.adminSettings.userRoleRegular}</option>
            </select>
          </div>
        </div>
        <div className="border-t border-border px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-accent transition-colors" disabled={submitting}>{t.adminSettings.cancel}</button>
          <button onClick={handleSubmit} className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={submitting}>{submitting ? t.adminSettings.saving : t.adminSettings.save}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reset Password Dialog
// ---------------------------------------------------------------------------

interface ResetPasswordDialogProps {
  open: boolean;
  user: UserInfo | null;
  onClose: () => void;
  t: ReturnType<typeof useLocale>['t'];
}

function ResetPasswordDialog({ open, user, onClose, t }: ResetPasswordDialogProps) {
  const notification = useNotification();
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setMode('auto');
      setNewPassword('');
      setConfirmPassword('');
      setGeneratedPassword('');
      setCopied(false);
      setErrors({});
    }
  }, [open]);

  const handleAutoGenerate = async () => {
    if (!user) return;
    try {
      setSubmitting(true);
      const result = await userApi.resetUserPassword(user.id);
      if (result.tempPassword) {
        setGeneratedPassword(result.tempPassword);
      }
      notification.showSuccess(t.adminSettings.resetPasswordSuccess);
    } catch (err: unknown) {
      notification.showError(err instanceof Error ? err.message : t.adminSettings.resetPasswordError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualSet = async () => {
    if (!user) return;
    const e: Record<string, string> = {};
    if (!newPassword) e.newPassword = ***REMOVED***;
    else if (newPassword.length < 6) e.newPassword = ***REMOVED***;
    if (newPassword !== confirmPassword) e.confirmPassword = ***REMOVED***;
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    try {
      setSubmitting(true);
      await userApi.resetUserPassword(user.id, { newPassword });
      notification.showSuccess(t.adminSettings.resetPasswordSuccess);
      onClose();
    } catch (err: unknown) {
      notification.showError(err instanceof Error ? err.message : t.adminSettings.resetPasswordError);
    } finally {
      setSubmitting(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  if (!open || !user) return null;

  const inputClass = (field: string) =>
    `w-full px-3 py-2 bg-input text-foreground border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm ${errors[field] ? 'border-destructive' : 'border-border'}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{t.adminSettings.resetPasswordTitle}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{user.username}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><IconX className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {/* Warning */}
          <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-md">
            <IconAlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-600 dark:text-amber-400">{t.adminSettings.resetPasswordWarning}</p>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2">
            <button onClick={() => setMode('auto')} className={`flex-1 px-3 py-2 text-sm font-medium rounded-md border transition-colors ${mode === 'auto' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground border-border hover:bg-accent'}`}>{t.adminSettings.autoGenerate}</button>
            <button onClick={() => setMode('manual')} className={`flex-1 px-3 py-2 text-sm font-medium rounded-md border transition-colors ${mode === 'manual' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground border-border hover:bg-accent'}`}>{t.adminSettings.manualSet}</button>
          </div>

          {mode === 'auto' ? (
            <div className="space-y-3">
              {generatedPassword ? (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-foreground">{t.adminSettings.generatedPassword}</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-muted text-foreground rounded-md text-sm font-mono select-all">{generatedPassword}</code>
                    <button onClick={copyToClipboard} className="p-2 text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-accent transition-colors" title={t.adminSettings.copyPassword}>
                      {copied ? <IconCheck className="w-4 h-4 text-green-500" /> : <IconCopy className="w-4 h-4" />}
                    </button>
                  </div>
                  {copied && <p className="text-xs text-green-500">{t.adminSettings.copied}</p>}
                </div>
              ) : (
                <button onClick={handleAutoGenerate} disabled={submitting} className="w-full px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">{submitting ? t.adminSettings.loading : t.adminSettings.generatePassword}</button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">{t.adminSettings.newPassword}</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t.adminSettings.newPasswordPlaceholder} className={inputClass('newPassword')} disabled={submitting} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <IconEyeOff className="w-4 h-4" /> : <IconEye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.newPassword && <p className="text-destructive text-xs mt-1">{errors.newPassword}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">{t.adminSettings.confirmNewPassword}</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t.adminSettings.confirmNewPassword} className={inputClass('confirmPassword')} disabled={submitting} />
                {errors.confirmPassword && <p className="text-destructive text-xs mt-1">{errors.confirmPassword}</p>}
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-border px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-accent transition-colors">{t.adminSettings.close}</button>
          {mode === 'manual' && (
            <button onClick={handleManualSet} disabled={submitting} className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">{submitting ? t.adminSettings.saving : t.adminSettings.resetPassword}</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login History Panel
// ---------------------------------------------------------------------------

interface LoginHistoryPanelProps {
  open: boolean;
  user: UserInfo | null;
  onClose: () => void;
  t: ReturnType<typeof useLocale>['t'];
}

function LoginHistoryPanel({ open, user, onClose, t }: LoginHistoryPanelProps) {
  const [records, setRecords] = useState<LoginHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchHistory = useCallback(async (p: number) => {
    if (!user) return;
    try {
      setLoading(true);
      const result = await userApi.getUserLoginHistory(user.id, { page: p, pageSize: 10 });
      setRecords(result.records);
      setTotalPages(result.totalPages);
      setTotal(result.total);
      setPage(p);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (open && user) {
      fetchHistory(1);
    }
  }, [open, user, fetchHistory]);

  if (!open || !user) return null;

  const title = t.adminSettings.loginHistoryFor.replace('{username}', user.username);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-[199]" onClick={onClose} />
      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-card border-l border-border shadow-xl z-[200] flex flex-col animate-in slide-in-from-right duration-200">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{t.adminSettings.loginHistory}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{title}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><IconX className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">{t.adminSettings.noLoginHistory}</div>
          ) : (
            <div className="space-y-3">
              {records.map((r) => (
                <div key={r.id} className="p-3 bg-background rounded-md border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">{formatDateTime(r.loginAt)}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${r.loginResult === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive'}`}>
                      {r.loginResult === 'success' ? t.adminSettings.loginSuccess : t.adminSettings.loginFailed}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.adminSettings.ipAddress}:</span>
                      <span className="text-foreground font-mono">{r.ipAddress || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.adminSettings.deviceInfo}:</span>
                      <span className="text-foreground truncate ml-2 max-w-[200px]" title={r.deviceInfo}>{r.deviceInfo || '-'}</span>
                    </div>
                    {r.loginResult === 'failed' && r.failureReason && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t.adminSettings.failureReason}:</span>
                        <span className="text-destructive">{r.failureReason}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {totalPages > 1 && (
          <div className="border-t border-border px-6 py-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t.adminSettings.totalRecords.replace('{count}', String(total))}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => fetchHistory(page - 1)} disabled={page <= 1 || loading} className="p-1 rounded hover:bg-accent disabled:opacity-40"><IconChevronLeft className="w-4 h-4" /></button>
              <span className="text-xs text-muted-foreground">{t.adminSettings.pageOf.replace('{current}', String(page)).replace('{total}', String(totalPages))}</span>
              <button onClick={() => fetchHistory(page + 1)} disabled={page >= totalPages || loading} className="p-1 rounded hover:bg-accent disabled:opacity-40"><IconChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Confirm Dialogs
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  extraMessage?: string;
  confirmText: string;
  cancelText: string;
  danger?: boolean;
  requireInput?: string; // if set, user must type this string to confirm
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ open, title, message, extraMessage, confirmText, cancelText, danger, requireInput, loading, onConfirm, onCancel }: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (open) setInputValue('');
  }, [open]);

  if (!open) return null;

  const canConfirm = !requireInput || inputValue === requireInput;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={onCancel}>
      <div className="bg-card rounded-lg shadow-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4 text-center">
          <div className={`mx-auto flex items-center justify-center h-12 w-12 rounded-full ${danger ? 'bg-destructive/10' : 'bg-amber-500/10'} mb-3`}>
            <IconAlertTriangle className={`w-6 h-6 ${danger ? 'text-destructive' : 'text-amber-500'}`} />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
          <p className="text-sm text-muted-foreground">{message}</p>
          {extraMessage && <p className="text-sm text-amber-500 mt-2">{extraMessage}</p>}
        </div>
        {requireInput && (
          <div className="px-6 pb-4">
            <p className="text-xs text-muted-foreground mb-2">
              {`Type "${requireInput}" to confirm:`}
            </p>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm"
              placeholder={requireInput}
            />
          </div>
        )}
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-accent rounded-md transition-colors" disabled={loading}>{cancelText}</button>
          <button onClick={onConfirm} disabled={!canConfirm || loading} className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50 ${danger ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}>{loading ? '...' : confirmText}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action Dropdown
// ---------------------------------------------------------------------------

interface ActionDropdownProps {
  user: UserInfo;
  isRoot: boolean;
  canManageAdmins: boolean;
  onEdit: (u: UserInfo) => void;
  onResetPassword: (u: UserInfo) => void;
  onToggleStatus: (u: UserInfo) => void;
  onLoginHistory: (u: UserInfo) => void;
  onForceLogout: (u: UserInfo) => void;
  onDelete: (u: UserInfo) => void;
  t: ReturnType<typeof useLocale>['t'];
}

function ActionDropdown({ user, isRoot: currentIsRoot, canManageAdmins, onEdit, onResetPassword, onToggleStatus, onLoginHistory, onForceLogout, onDelete, t }: ActionDropdownProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Don't show actions for root users (unless current user is root themselves AND target is not root)
  const targetRole = resolveUserRole(user);
  if (targetRole === 'root') return <span className="text-xs text-muted-foreground">-</span>;

  // Admin users can only manage regular/premium users
  if (!currentIsRoot && targetRole === 'admin') return <span className="text-xs text-muted-foreground">-</span>;

  const items = [
    { key: 'edit', label: t.adminSettings.editUser, icon: IconPencil, action: () => onEdit(user) },
    { key: 'resetPassword', label: t.adminSettings.resetPassword, icon: IconKeyRound, action: () => onResetPassword(user) },
    { key: 'toggleStatus', label: user.isActive ? t.adminSettings.disableUser : t.adminSettings.enableUser, icon: IconBan, action: () => onToggleStatus(user) },
    { key: 'loginHistory', label: t.adminSettings.loginHistory, icon: IconHistory, action: () => onLoginHistory(user) },
    { key: 'forceLogout', label: t.adminSettings.forceLogout, icon: IconLogOut, action: () => onForceLogout(user) },
    { key: 'delete', label: t.adminSettings.deleteUser, icon: IconTrash2, action: () => onDelete(user), danger: true },
  ];

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setMenuOpen(!menuOpen)} className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
        <IconMoreHorizontal className="w-4 h-4" />
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-md shadow-lg z-50 py-1">
          {items.map((item) => (
            <button
              key={item.key}
              onClick={() => { item.action(); setMenuOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-accent transition-colors ${
                'danger' in item && item.danger ? 'text-destructive hover:text-destructive' : 'text-foreground'
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const UserManagement: React.FC = () => {
  const { t } = useLocale();
  const notification = useNotification();
  const { isRoot, canManageAdmins } = useAuth();

  // Data state
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Pagination / filtering / sorting
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserInfo | null>(null);
  const [resetPwDialogOpen, setResetPwDialogOpen] = useState(false);
  const [resetPwUser, setResetPwUser] = useState<UserInfo | null>(null);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [historyUser, setHistoryUser] = useState<UserInfo | null>(null);

  // Confirm dialogs
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserInfo | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [disableTarget, setDisableTarget] = useState<UserInfo | null>(null);
  const [disableLoading, setDisableLoading] = useState(false);
  const [forceLogoutConfirmOpen, setForceLogoutConfirmOpen] = useState(false);
  const [forceLogoutTarget, setForceLogoutTarget] = useState<UserInfo | null>(null);
  const [forceLogoutLoading, setForceLogoutLoading] = useState(false);

  // Debounce search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search]);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const params: UserListParams = {
        page,
        pageSize,
        sortBy,
        sortOrder,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (roleFilter) params.role = roleFilter;
      if (statusFilter) params.status = statusFilter;

      const result = await userApi.getUserList(params);
      setUsers(result.users);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err) {
      console.error('[UserManagement] Failed to fetch users:', err);
      notification.showError(t.adminSettings.fetchError);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, sortBy, sortOrder, debouncedSearch, roleFilter, statusFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const result = await userApi.getUserStats();
      setStats(result);
    } catch {
      // silently fail for stats
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const refreshAll = () => {
    fetchUsers();
    fetchStats();
  };

  // Sort handler
  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  };

  // Filter change resets page
  const handleRoleFilterChange = (v: string) => { setRoleFilter(v); setPage(1); };
  const handleStatusFilterChange = (v: string) => { setStatusFilter(v); setPage(1); };

  // Action handlers
  const handleToggleStatus = (user: UserInfo) => {
    if (user.isActive) {
      // Show disable confirm
      setDisableTarget(user);
      setDisableConfirmOpen(true);
    } else {
      // Enable directly
      doToggleStatus(user);
    }
  };

  const doToggleStatus = async (user: UserInfo) => {
    try {
      setDisableLoading(true);
      await userApi.toggleUserStatus(user.id);
      notification.showSuccess(t.adminSettings.toggleStatusSuccess);
      setDisableConfirmOpen(false);
      setDisableTarget(null);
      refreshAll();
    } catch (err: unknown) {
      notification.showError(err instanceof Error ? err.message : t.adminSettings.toggleStatusError);
    } finally {
      setDisableLoading(false);
    }
  };

  const handleDelete = (user: UserInfo) => {
    setDeleteTarget(user);
    setDeleteConfirmOpen(true);
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleteLoading(true);
      await userApi.deleteUser(deleteTarget.id);
      notification.showSuccess(t.adminSettings.deleteSuccess);
      setDeleteConfirmOpen(false);
      setDeleteTarget(null);
      refreshAll();
    } catch (err: unknown) {
      notification.showError(err instanceof Error ? err.message : t.adminSettings.deleteError);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleForceLogout = (user: UserInfo) => {
    setForceLogoutTarget(user);
    setForceLogoutConfirmOpen(true);
  };

  const doForceLogout = async () => {
    if (!forceLogoutTarget) return;
    try {
      setForceLogoutLoading(true);
      await userApi.forceLogout(forceLogoutTarget.id);
      notification.showSuccess(t.adminSettings.forceLogoutSuccess);
      setForceLogoutConfirmOpen(false);
      setForceLogoutTarget(null);
    } catch (err: unknown) {
      notification.showError(err instanceof Error ? err.message : t.adminSettings.forceLogoutError);
    } finally {
      setForceLogoutLoading(false);
    }
  };

  // Page size selector
  const pageSizeOptions = [10, 20, 50];

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-5 space-y-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t.adminSettings.userManagement}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{t.adminSettings.userManagementDesc}</p>
          </div>
          <button onClick={refreshAll} className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md transition-colors" title={t.adminSettings.refresh}>
            <IconRefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Stats */}
        <UserStatsCards stats={stats} t={t} />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.adminSettings.searchPlaceholder}
              className="w-full pl-9 pr-4 py-2 bg-input text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm"
            />
          </div>
          {/* Role filter */}
          <select
            value={roleFilter}
            onChange={(e) => handleRoleFilterChange(e.target.value)}
            className="px-3 py-2 bg-input text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm min-w-[120px]"
          >
            <option value="">{t.adminSettings.allRoles}</option>
            {(isRoot) && <option value="admin">{t.adminSettings.userRoleAdmin}</option>}
            <option value="premium">{t.adminSettings.userRolePremium}</option>
            <option value="regular">{t.adminSettings.userRoleRegular}</option>
          </select>
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilterChange(e.target.value)}
            className="px-3 py-2 bg-input text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm min-w-[120px]"
          >
            <option value="">{t.adminSettings.allStatus}</option>
            <option value="active">{t.adminSettings.enabled}</option>
            <option value="disabled">{t.adminSettings.disabled}</option>
          </select>
          {/* Create button */}
          <button
            onClick={() => setCreateDialogOpen(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm font-medium flex items-center gap-2"
          >
            <IconPlus className="w-4 h-4" />
            {t.adminSettings.addUser}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="mt-3 text-sm text-muted-foreground">{t.adminSettings.loading}</p>
            </div>
          </div>
        ) : users.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <IconUsers className="w-16 h-16 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">{t.adminSettings.noUsers}</p>
            </div>
          </div>
        ) : (
          <div className="min-w-full">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <SortHeader label={t.adminSettings.user} field="username" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{t.adminSettings.role}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{t.adminSettings.status}</th>
                  <th className="px-4 py-3 text-left">
                    <SortHeader label={t.adminSettings.lastLogin} field="last_login_at" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3 text-left">
                    <SortHeader label={t.adminSettings.createdAt} field="created_at" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">{t.adminSettings.actions}</th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {users.map((user) => {
                  const role = resolveUserRole(user);
                  return (
                    <tr key={user.id} className="hover:bg-accent/50 transition-colors">
                      {/* User cell */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-sm font-medium text-primary">
                              {user.username.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">{user.username}</div>
                            <div className="text-xs text-muted-foreground truncate">{user.email || user.fullName || '-'}</div>
                          </div>
                        </div>
                      </td>
                      {/* Role */}
                      <td className="px-4 py-3">
                        <RoleBadge role={role} size="sm" />
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded ${
                          user.isActive !== false
                            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                            : 'bg-destructive/10 text-destructive'
                        }`}>
                          {user.isActive !== false ? t.adminSettings.enabled : t.adminSettings.disabled}
                        </span>
                      </td>
                      {/* Last Login */}
                      <td className="px-4 py-3 text-sm text-muted-foreground" title={formatDateTime(user.lastLoginAt)}>
                        {formatRelativeTime(user.lastLoginAt)}
                      </td>
                      {/* Created */}
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {formatDateTime(user.createdAt)}
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <ActionDropdown
                          user={user}
                          isRoot={isRoot}
                          canManageAdmins={canManageAdmins}
                          onEdit={(u) => { setEditUser(u); setEditDialogOpen(true); }}
                          onResetPassword={(u) => { setResetPwUser(u); setResetPwDialogOpen(true); }}
                          onToggleStatus={handleToggleStatus}
                          onLoginHistory={(u) => { setHistoryUser(u); setHistoryPanelOpen(true); }}
                          onForceLogout={handleForceLogout}
                          onDelete={handleDelete}
                          t={t}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination footer */}
      {total > 0 && (
        <div className="flex-shrink-0 border-t border-border bg-card px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{t.adminSettings.totalRecords.replace('{count}', String(total))}</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="px-2 py-1 bg-input border border-border rounded text-sm text-foreground"
            >
              {pageSizeOptions.map((s) => (
                <option key={s} value={s}>{s} {t.adminSettings.perPage}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-accent disabled:opacity-40 transition-colors flex items-center gap-1">
              <IconChevronLeft className="w-4 h-4" />
              {t.adminSettings.previous}
            </button>
            {/* Page numbers */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-8 h-8 text-sm rounded-md transition-colors ${
                    pageNum === page
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent text-muted-foreground'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-accent disabled:opacity-40 transition-colors flex items-center gap-1">
              {t.adminSettings.next}
              <IconChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <CreateUserDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={refreshAll}
        canManageAdmins={canManageAdmins}
        t={t}
      />
      <EditUserDialog
        open={editDialogOpen}
        user={editUser}
        onClose={() => { setEditDialogOpen(false); setEditUser(null); }}
        onUpdated={refreshAll}
        canManageAdmins={canManageAdmins}
        t={t}
      />
      <ResetPasswordDialog
        open={resetPwDialogOpen}
        user={resetPwUser}
        onClose={() => { setResetPwDialogOpen(false); setResetPwUser(null); }}
        t={t}
      />
      <LoginHistoryPanel
        open={historyPanelOpen}
        user={historyUser}
        onClose={() => { setHistoryPanelOpen(false); setHistoryUser(null); }}
        t={t}
      />

      {/* Delete confirmation with username typing */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        title={t.adminSettings.deleteConfirmTitle}
        message={t.adminSettings.deleteConfirmMessage.replace('{username}', deleteTarget?.username ?? '')}
        requireInput={deleteTarget?.username}
        confirmText={t.adminSettings.confirmDelete}
        cancelText={t.adminSettings.cancelDelete}
        danger
        loading={deleteLoading}
        onConfirm={doDelete}
        onCancel={() => { setDeleteConfirmOpen(false); setDeleteTarget(null); }}
      />

      {/* Disable confirmation */}
      <ConfirmDialog
        open={disableConfirmOpen}
        title={t.adminSettings.disableConfirmTitle}
        message={t.adminSettings.disableConfirmMessage.replace('{username}', disableTarget?.username ?? '')}
        confirmText={t.adminSettings.disableUser}
        cancelText={t.adminSettings.cancel}
        danger
        loading={disableLoading}
        onConfirm={() => disableTarget && doToggleStatus(disableTarget)}
        onCancel={() => { setDisableConfirmOpen(false); setDisableTarget(null); }}
      />

      {/* Force logout confirmation */}
      <ConfirmDialog
        open={forceLogoutConfirmOpen}
        title={t.adminSettings.forceLogoutConfirmTitle}
        message={t.adminSettings.forceLogoutConfirmMessage.replace('{username}', forceLogoutTarget?.username ?? '')}
        confirmText={t.adminSettings.forceLogout}
        cancelText={t.adminSettings.cancel}
        loading={forceLogoutLoading}
        onConfirm={doForceLogout}
        onCancel={() => { setForceLogoutConfirmOpen(false); setForceLogoutTarget(null); }}
      />
    </div>
  );
};

export default UserManagement;
