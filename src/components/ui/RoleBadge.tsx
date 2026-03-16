'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';

export type RoleBadgeRole = 'root' | 'admin' | 'premium' | 'regular';

interface RoleBadgeProps {
  role: RoleBadgeRole;
  size?: 'sm' | 'md';
  className?: string;
}

const ROLE_STYLES: Record<RoleBadgeRole, string> = {
  root: 'bg-red-600/15 text-red-600 dark:bg-red-500/20 dark:text-red-400 border-red-600/30 dark:border-red-500/30',
  admin: 'bg-purple-600/15 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-600/30 dark:border-purple-500/30',
  premium: 'bg-amber-600/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-600/30 dark:border-amber-500/30',
  regular: 'bg-gray-500/15 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400 border-gray-500/30 dark:border-gray-500/30',
};

const SIZE_STYLES: Record<'sm' | 'md', string> = {
  sm: 'text-[10px] px-1.5 py-0.5',
  md: 'text-xs px-2 py-0.5',
};

/**
 * Resolves the display role from a User object's fields.
 * Useful for callers that have a User but need to pick the right badge role.
 */
export function resolveUserRole(user: {
  isRoot?: boolean;
  isAdmin?: boolean;
  userRole?: string;
}): RoleBadgeRole {
  if (user.isRoot) return 'root';
  if (user.isAdmin || user.userRole === 'admin') return 'admin';
  if (user.userRole === 'premium') return 'premium';
  return 'regular';
}

const RoleBadge: React.FC<RoleBadgeProps> = ({ role, size = 'sm', className = '' }) => {
  const { t } = useLocale();

  const labels: Record<RoleBadgeRole, string> = {
    root: t.adminSettings.roleRoot ?? '超级管理员',
    admin: t.adminSettings.roleAdmin ?? '管理员',
    premium: t.adminSettings.rolePremium ?? '高级用户',
    regular: t.adminSettings.roleRegular ?? '普通用户',
  };

  return (
    <span
      className={`inline-flex items-center font-medium rounded border leading-none select-none whitespace-nowrap ${ROLE_STYLES[role]} ${SIZE_STYLES[size]} ${className}`}
    >
      {labels[role]}
    </span>
  );
};

export default RoleBadge;
