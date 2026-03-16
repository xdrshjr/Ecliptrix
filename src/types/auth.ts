export type UserRole = 'admin' | 'regular' | 'premium';

export interface User {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
  fullName?: string;
  avatarUrl?: string;
  userRole?: UserRole;
  isAdmin?: boolean;
  isRoot?: boolean;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionToken?: string | null;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface SessionValidationRequest {
  user_id: string;
  session_token: string;
}

export interface SessionValidationResponse {
  success: boolean;
  valid: boolean;
  message?: string;
  reason?: string;
}

export interface AuthContextType extends AuthState {
  isRoot: boolean;
  isAdmin: boolean;
  canManageUsers: boolean;
  canManageAdmins: boolean;
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  updateUserProfile: (user: User) => Promise<void>;
  validateSession: () => Promise<boolean>;
}

// --- User Management Types ---

export interface UserInfo extends User {
  isActive?: boolean;
  createdAt?: string;
  lastLoginAt?: string;
  lastLoginIp?: string;
}

export interface UserListParams {
  page?: number;
  pageSize?: number;
  role?: string;
  status?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface UserListResponse {
  users: UserInfo[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UserStats {
  totalUsers: number;
  adminCount: number;
  premiumCount: number;
  regularCount: number;
  activeCount: number;
  disabledCount: number;
  onlineCount: number;
}

export interface LoginHistoryRecord {
  id: string;
  loginAt: string;
  ipAddress: string;
  deviceInfo: string;
  loginResult: 'success' | 'failed';
  failureReason?: string;
}

export interface CreateUserData {
  username: string;
  password: string;
  email?: string;
  fullName?: string;
  userRole: 'admin' | 'regular' | 'premium';
}

export interface ResetPasswordData {
  newPassword?: string;
} 