/**
 * User Management API client
 * 用户管理 API 客户端
 *
 * Refactored in T05 to use the secure-by-default `http.*` wrapper. The
 * previous local `getAuthHeaders()` helper has been removed — auth is now
 * injected globally by `src/lib/api/http-client.ts`.
 */

import { http } from '@/lib/api/http-client';
import type {
  UserListParams,
  UserListResponse,
  UserStats,
  CreateUserData,
  ResetPasswordData,
  LoginHistoryRecord,
  UserInfo,
} from '@/types/auth';

// ---------------------------------------------------------------------------
// Normalize helpers — backend uses snake_case, frontend uses camelCase
// ---------------------------------------------------------------------------

function normalizeUserInfo(raw: Record<string, unknown>): UserInfo {
  return {
    id: (raw.id as string) ?? '',
    username: (raw.username as string) ?? '',
    email: (raw.email as string) ?? undefined,
    fullName: (raw.full_name ?? raw.fullName) as string | undefined,
    avatarUrl: (raw.avatar_url ?? raw.avatarUrl) as string | undefined,
    userRole: (raw.user_role ?? raw.userRole) as UserInfo['userRole'],
    isAdmin: (raw.is_admin ?? raw.isAdmin) as boolean | undefined,
    isRoot: (raw.is_root ?? raw.isRoot) as boolean | undefined,
    isActive: (raw.is_active ?? raw.isActive) as boolean | undefined,
    createdAt: (raw.created_at ?? raw.createdAt) as string | undefined,
    lastLoginAt: (raw.last_login_at ?? raw.lastLoginAt) as string | undefined,
    lastLoginIp: (raw.last_login_ip ?? raw.lastLoginIp) as string | undefined,
  };
}

function normalizeLoginHistory(raw: Record<string, unknown>): LoginHistoryRecord {
  return {
    id: (raw.id as string) ?? '',
    loginAt: (raw.login_at ?? raw.loginAt) as string,
    ipAddress: (raw.ip_address ?? raw.ipAddress) as string,
    deviceInfo: (raw.device_info ?? raw.deviceInfo) as string,
    loginResult: (raw.login_result ?? raw.loginResult) as 'success' | 'failed',
    failureReason: (raw.failure_reason ?? raw.failureReason) as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function getUserList(params: UserListParams = {}): Promise<UserListResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('page_size', String(params.pageSize));
  if (params.role) searchParams.set('role', params.role);
  if (params.status) searchParams.set('status', params.status);
  if (params.search) searchParams.set('search', params.search);
  if (params.sortBy) searchParams.set('sort_by', params.sortBy);
  if (params.sortOrder) searchParams.set('sort_order', params.sortOrder);

  const qs = searchParams.toString();
  const url = `/api/admin/users/list${qs ? `?${qs}` : ''}`;

  const json = await http.get<Record<string, unknown>>(url);

  // Backend wraps payload in `data`: { success, message, data: { users, total, ... } }
  const envelope = (json.data ?? json) as Record<string, unknown>;
  const rawUsers = (envelope.users ?? []) as Record<string, unknown>[];
  return {
    users: rawUsers.map(normalizeUserInfo),
    total: (envelope.total ?? 0) as number,
    page: (envelope.page ?? params.page ?? 1) as number,
    pageSize: (envelope.page_size ?? envelope.pageSize ?? params.pageSize ?? 10) as number,
    totalPages: (envelope.total_pages ?? envelope.totalPages ?? 1) as number,
  };
}

export async function createUser(
  payload: CreateUserData,
): Promise<{ success: boolean; user?: UserInfo; message?: string }> {
  const body = {
    username: payload.username,
    password: payload.password,
    email: payload.email || undefined,
    full_name: payload.fullName || undefined,
    user_role: payload.userRole,
    is_admin: payload.userRole === 'admin',
    is_active: true,
  };

  const data = await http.post<Record<string, unknown>>(
    '/api/admin/users/create',
    body,
  );

  return {
    success: (data.success as boolean | undefined) ?? true,
    user: data.user ? normalizeUserInfo(data.user as Record<string, unknown>) : undefined,
    message: data.message as string | undefined,
  };
}

export interface UpdateUserData {
  email?: string;
  fullName?: string;
  userRole?: string;
}

export async function updateUser(
  userId: string,
  payload: UpdateUserData,
): Promise<{ success: boolean; message?: string }> {
  const body: Record<string, unknown> = {};
  if (payload.email !== undefined) body.email = payload.email;
  if (payload.fullName !== undefined) body.full_name = payload.fullName;
  if (payload.userRole !== undefined) {
    body.user_role = payload.userRole;
    body.is_admin = payload.userRole === 'admin';
  }

  const data = await http.put<Record<string, unknown>>(
    `/api/admin/users/${userId}/edit`,
    body,
  );

  return {
    success: (data.success as boolean | undefined) ?? true,
    message: data.message as string | undefined,
  };
}

export async function toggleUserStatus(
  userId: string,
): Promise<{ success: boolean; isActive?: boolean; message?: string }> {
  const data = await http.post<Record<string, unknown>>(
    `/api/admin/users/${userId}/toggle-status`,
  );

  return {
    success: (data.success as boolean | undefined) ?? true,
    isActive: (data.is_active ?? data.isActive) as boolean | undefined,
    message: data.message as string | undefined,
  };
}

export async function resetUserPassword(
  userId: string,
  payload?: ResetPasswordData,
): Promise<{ success: boolean; tempPassword?: string; message?: string }> {
  const body: Record<string, unknown> = {};
  if (payload?.newPassword) {
    body.new_password = payload.newPassword;
  }

  const data = await http.post<Record<string, unknown>>(
    `/api/admin/users/${userId}/reset-password`,
    body,
  );

  return {
    success: (data.success as boolean | undefined) ?? true,
    tempPassword: (data.temp_password ?? data.tempPassword ?? data.temporary_password) as string | undefined,
    message: data.message as string | undefined,
  };
}

export async function getUserLoginHistory(
  userId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<{
  records: LoginHistoryRecord[];
  total: number;
  page: number;
  totalPages: number;
}> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('page_size', String(params.pageSize));

  const qs = searchParams.toString();
  const url = `/api/admin/users/${userId}/login-history${qs ? `?${qs}` : ''}`;

  const data = await http.get<Record<string, unknown>>(url);

  const rawRecords = (data.records ?? data.data ?? data.history ?? []) as Record<string, unknown>[];
  return {
    records: rawRecords.map(normalizeLoginHistory),
    total: (data.total ?? data.total_count ?? 0) as number,
    page: (data.page ?? params.page ?? 1) as number,
    totalPages: (data.total_pages ?? data.totalPages ?? 1) as number,
  };
}

export async function forceLogout(userId: string): Promise<{ success: boolean; message?: string }> {
  const data = await http.post<Record<string, unknown>>(
    `/api/admin/users/${userId}/force-logout`,
  );

  return {
    success: (data.success as boolean | undefined) ?? true,
    message: data.message as string | undefined,
  };
}

export async function deleteUser(userId: string): Promise<{ success: boolean; message?: string }> {
  const data = await http.del<Record<string, unknown>>(
    `/api/admin/users/${userId}/delete`,
  );

  return {
    success: (data.success as boolean | undefined) ?? true,
    message: data.message as string | undefined,
  };
}

export async function getUserStats(): Promise<UserStats> {
  const data = await http.get<Record<string, unknown>>('/api/admin/users/stats');

  // The backend may nest stats inside a 'data' field or return them flat
  const stats = (data.data ?? data) as Record<string, unknown>;
  return {
    totalUsers: (stats.total_users ?? stats.totalUsers ?? 0) as number,
    adminCount: (stats.admin_count ?? stats.adminCount ?? 0) as number,
    premiumCount: (stats.premium_count ?? stats.premiumCount ?? 0) as number,
    regularCount: (stats.regular_count ?? stats.regularCount ?? 0) as number,
    activeCount: (stats.active_count ?? stats.activeCount ?? 0) as number,
    disabledCount: (stats.disabled_count ?? stats.disabledCount ?? 0) as number,
    onlineCount: (stats.online_count ?? stats.onlineCount ?? 0) as number,
  };
}
