// ============================================================
// Vigil Mobile — Auth Store (Zustand)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { authApi, setUnauthorizedHandler } from '../api/client';
import { STORAGE_KEYS } from '../constants';
import { User, LoginPayload } from '../types';

interface AuthState {
  user:        User | null;
  token:       string | null;
  isLoading:   boolean;
  isReady:     boolean;   // hydration เสร็จแล้ว
  error:       string | null;

  // actions
  hydrate:     () => Promise<void>;
  login:       (payload: LoginPayload) => Promise<void>;
  logout:      () => Promise<void>;
  clearError:  () => void;
}

export const useAuthStore = create<AuthState>((set, get) => {

  // ลงทะเบียน 401 handler → logout อัตโนมัติ
  setUnauthorizedHandler(() => get().logout());

  return {
    user:      null,
    token:     null,
    isLoading: false,
    isReady:   false,
    error:     null,

    // โหลด token จาก SecureStore ตอน app start
    hydrate: async () => {
      try {
        const token = await SecureStore.getItemAsync(STORAGE_KEYS.AUTH_TOKEN);
        const raw   = await SecureStore.getItemAsync(STORAGE_KEYS.USER);
        const user  = raw ? (JSON.parse(raw) as User) : null;

        if (token && user) {
          set({ token, user, isReady: true });
          // ยืนยัน token ยังใช้ได้กับ server
          try {
            const fresh = await authApi.me();
            set({ user: fresh });
          } catch {
            // token หมดอายุ — logout
            await get().logout();
            return;
          }
        }
      } catch {
        // SecureStore อ่านไม่ได้ — เริ่มใหม่
      } finally {
        set({ isReady: true });
      }
    },

    login: async (payload) => {
      set({ isLoading: true, error: null });
      try {
        const res = await authApi.login(payload);
        await SecureStore.setItemAsync(STORAGE_KEYS.AUTH_TOKEN, res.token);
        await SecureStore.setItemAsync(STORAGE_KEYS.USER, JSON.stringify(res.user));
        set({ token: res.token, user: res.user, isLoading: false });
      } catch (err: any) {
        const msg = err?.response?.data?.error ?? err?.message ?? 'Login failed';
        set({ error: msg, isLoading: false });
        throw err;
      }
    },

    logout: async () => {
      try { await authApi.logout(); } catch { /* best-effort */ }
      await SecureStore.deleteItemAsync(STORAGE_KEYS.AUTH_TOKEN);
      await SecureStore.deleteItemAsync(STORAGE_KEYS.USER);
      set({ user: null, token: null, error: null });
    },

    clearError: () => set({ error: null }),
  };
});
