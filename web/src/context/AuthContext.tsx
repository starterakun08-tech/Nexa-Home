import React, { createContext, useContext, useEffect, useState } from 'react';
import { authApi, type UserProfile, type LoginResponse, type RegisterPayload, type GoogleAuthPayload } from '../api/auth';
import { setMemoryToken } from '../api/client';

interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<LoginResponse>;
  register: (payload: RegisterPayload) => Promise<LoginResponse>;
  googleLogin: (payload: GoogleAuthPayload) => Promise<LoginResponse>;
  verify2fa: (tempToken: string, code: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  setUser: (user: UserProfile | null) => void;
  refreshUser: () => Promise<UserProfile | null>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => ({ status: 'ok' }),
  register: async () => ({ status: 'ok' }),
  googleLogin: async () => ({ status: 'ok' }),
  verify2fa: async () => ({ status: 'ok' }),
  logout: async () => {},
  setUser: () => {},
  refreshUser: async () => null,
});


export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Inisialisasi sesi saat aplikasi pertama kali dimuat
  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      try {
        // Coba refresh token menggunakan httpOnly cookie
        const res = await authApi.refresh();
        if (res.access_token) {
          setMemoryToken(res.access_token);
          const profile = await authApi.getMe();
          if (isMounted) {
            setUser(profile);
          }
        }
      } catch {
        // Belum login atau sesi telah kedaluwarsa
        if (isMounted) {
          setMemoryToken(null);
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = async (username: string, password: string): Promise<LoginResponse> => {
    const res = await authApi.login(username, password);
    if (res.status === 'ok' && res.access_token) {
      setMemoryToken(res.access_token);
      if (res.user) {
        setUser(res.user);
      } else {
        const profile = await authApi.getMe();
        setUser(profile);
      }
    }
    return res;
  };

  const register = async (payload: RegisterPayload): Promise<LoginResponse> => {
    const res = await authApi.register(payload);
    if (res.status === 'ok' && res.access_token) {
      setMemoryToken(res.access_token);
      if (res.user) {
        setUser(res.user);
      } else {
        const profile = await authApi.getMe();
        setUser(profile);
      }
    }
    return res;
  };

  const googleLogin = async (payload: GoogleAuthPayload): Promise<LoginResponse> => {
    const res = await authApi.googleLogin(payload);
    if (res.status === 'ok' && res.access_token) {
      setMemoryToken(res.access_token);
      if (res.user) {
        setUser(res.user);
      } else {
        const profile = await authApi.getMe();
        setUser(profile);
      }
    }
    return res;
  };

  const verify2fa = async (tempToken: string, code: string): Promise<LoginResponse> => {
    const res = await authApi.verify2fa(tempToken, code);
    if (res.status === 'ok' && res.access_token) {
      setMemoryToken(res.access_token);
      if (res.user) {
        setUser(res.user);
      } else {
        const profile = await authApi.getMe();
        setUser(profile);
      }
    }
    return res;
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      setMemoryToken(null);
      setUser(null);
    }
  };

  const refreshUser = async (): Promise<UserProfile | null> => {
    try {
      const profile = await authApi.getMe();
      setUser(profile);
      return profile;
    } catch {
      return null;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        googleLogin,
        verify2fa,
        logout,
        setUser,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );

};

export const useAuth = () => useContext(AuthContext);
