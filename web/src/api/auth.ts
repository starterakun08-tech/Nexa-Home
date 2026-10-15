import { apiClient, setMemoryToken } from './client';

export interface UserProfile {
  id: number;
  username: string;
  role: 'pemilik' | 'anggota' | 'biasa' | 'admin' | 'member' | 'child';
  display_name?: string;
  full_name?: string;
  email?: string;
  email_verified?: boolean;
  is_approved?: boolean;
  is_google_linked?: boolean;
  has_password?: boolean;
  created_at?: string;
}

export interface SetupStatusResponse {
  is_setup: boolean;
  admin_exists: boolean;
  setup_code_required: boolean;
}

export interface SetupAdminPayload {
  setup_code: string;
  username: string;
  password: string;
}

export interface RegisterPayload {
  full_name?: string;
  username: string;
  email: string;
  password: string;
  invite_code?: string;
}

export interface GoogleAuthPayload {
  id_token?: string;
  code?: string;
  access_token?: string;
  redirect_uri?: string;
  invite_code?: string;
}

export interface LoginResponse {
  status: 'ok' | '2fa_required';
  temp_token?: string;
  access_token?: string;
  token_type?: string;
  user?: UserProfile;
  message?: string;
}

export const authApi = {
  getSetupStatus: () => apiClient<SetupStatusResponse>('/api/auth/setup-status'),

  setupAdmin: (payload: SetupAdminPayload) =>
    apiClient<{
      status: string;
      message: string;
      user: UserProfile;
      totp_secret: string;
      totp_uri: string;
      recovery_codes: string[];
    }>('/api/auth/setup-admin', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  register: (payload: RegisterPayload) =>
    apiClient<LoginResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (username: string, password: string) =>
    apiClient<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  googleLogin: (payload: GoogleAuthPayload) =>
    apiClient<LoginResponse>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getGoogleAuthUrl: (redirectUri?: string) => {
    const query = redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : '';
    return apiClient<{ status: string; url: string }>(`/api/auth/google/url${query}`);
  },

  linkGoogle: (payload: GoogleAuthPayload) =>
    apiClient<{ status: string; message: string; google_email?: string }>('/api/auth/link-google', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  unlinkGoogle: () =>
    apiClient<{ status: string; message: string }>('/api/auth/unlink-google', {
      method: 'POST',
    }),

  forgotPasswordRequest: (email: string) =>
    apiClient<{ status: string; message: string }>('/api/auth/forgot-password/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  forgotPasswordReset: (email: string, otp: string, newPassword: string) =>
    apiClient<{ status: string; message: string }>('/api/auth/forgot-password/reset', {
      method: 'POST',
      body: JSON.stringify({ email, otp, new_password: newPassword }),
    }),

  sendQrEmail: (deviceId: string, claimToken: string, pairingCode?: string) =>
    apiClient<{ status: string; message: string }>('/api/auth/send-qr-email', {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId, claim_token: claimToken, pairing_code: pairingCode }),
    }),

  verify2fa: (tempToken: string, code: string) =>
    apiClient<LoginResponse>('/api/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ temp_token: tempToken, code }),
    }),

  refresh: () =>
    apiClient<{
      status: string;
      access_token: string;
      token_type: string;
    }>('/api/auth/refresh', {
      method: 'POST',
    }),

  getMe: () => apiClient<UserProfile>('/api/auth/me'),

  redeemInvite: (inviteCode: string) =>
    apiClient<{ status: string; message: string }>('/api/auth/redeem-invite', {
      method: 'POST',
      body: JSON.stringify({ invite_code: inviteCode }),
    }),

  setPassword: (newPassword: string, oldPassword?: string) =>
    apiClient<{ status: string; message: string }>('/api/auth/set-password', {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword, old_password: oldPassword }),
    }),

  getPendingUsers: () => apiClient<UserProfile[]>('/api/auth/pending-users'),

  approveUser: (userId: number) =>
    apiClient<{ status: string; message: string }>(`/api/auth/users/${userId}/approve`, {
      method: 'POST',
    }),

  rejectUser: (userId: number) =>
    apiClient<{ status: string; message: string }>(`/api/auth/users/${userId}/reject`, {
      method: 'POST',
    }),

  createInviteCode: (role: 'member' | 'child' = 'member', expiresInHours: number = 48) =>
    apiClient<{ status: string; invite_code: string; role: string; expires_at: string }>('/api/auth/invite-codes', {
      method: 'POST',
      body: JSON.stringify({ role, expires_in_hours: expiresInHours }),
    }),

  getInviteCodes: () =>
    apiClient<Array<{ id: number; code: string; role: string; is_used: boolean; expires_at: string | null; created_at: string }>>('/api/auth/invite-codes'),

  logout: async () => {
    try {
      await apiClient('/api/auth/logout', { method: 'POST' });
    } finally {
      setMemoryToken(null);
    }
  },
};

