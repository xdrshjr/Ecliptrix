export type UserRole = 'admin' | 'regular' | 'premium';

export interface User {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
  fullName?: string;
  avatarUrl?: string;
  userRole?: UserRole;
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
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  updateUserProfile: (user: User) => Promise<void>;
  validateSession: () => Promise<boolean>;
} 