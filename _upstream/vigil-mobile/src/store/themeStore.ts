// ============================================================
// Vigil Mobile — Theme Mode Store (Zustand)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

export type ThemeMode = 'auto' | 'light' | 'dark';

const KEY = 'vigil_theme_mode';

interface ThemeState {
  mode:     ThemeMode;
  hydrate:  () => Promise<void>;
  setMode:  (m: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'auto',
  hydrate: async () => {
    try {
      const saved = await SecureStore.getItemAsync(KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'auto') set({ mode: saved });
    } catch { /* default auto */ }
  },
  setMode: (m) => {
    set({ mode: m });
    SecureStore.setItemAsync(KEY, m).catch(() => {});
  },
}));
