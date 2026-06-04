// ============================================================
// Vigil Mobile — Language Store (Zustand)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as Localization from 'expo-localization';

export type LangMode = 'auto' | 'th' | 'en';

const KEY = 'vigil_lang_mode';

// Resolve 'auto' → actual locale code ('th' | 'en')
export function resolveLocale(mode: LangMode): 'th' | 'en' {
  if (mode === 'th') return 'th';
  if (mode === 'en') return 'en';
  const device = Localization.getLocales()[0]?.languageCode ?? 'th';
  return device.startsWith('th') ? 'th' : 'en';
}

interface LangState {
  mode:     LangMode;
  locale:   'th' | 'en';
  hydrate:  () => Promise<void>;
  setMode:  (m: LangMode) => void;
}

export const useLanguageStore = create<LangState>((set) => ({
  mode:   'auto',
  locale: resolveLocale('auto'),

  hydrate: async () => {
    try {
      const saved = await SecureStore.getItemAsync(KEY);
      if (saved === 'th' || saved === 'en' || saved === 'auto') {
        set({ mode: saved as LangMode, locale: resolveLocale(saved as LangMode) });
      }
    } catch { /* default auto */ }
  },

  setMode: (m) => {
    const locale = resolveLocale(m);
    set({ mode: m, locale });
    SecureStore.setItemAsync(KEY, m).catch(() => {});
  },
}));
