import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(persist(
  (set) => ({
    user: null,
    token: null,
    refreshToken: null,
    isAuthenticated: false,
    login: (user, token, refreshToken) => set({ user, token, refreshToken, isAuthenticated: true }),
    logout: () => set({ user: null, token: null, refreshToken: null, isAuthenticated: false }),
    setToken: (token) => set({ token }),
    updateUser: (user) => set({ user }),
  }),
  { name: 'zenith-auth', partialize: (s) => ({ user: s.user, token: s.token, refreshToken: s.refreshToken, isAuthenticated: s.isAuthenticated }) }
));
