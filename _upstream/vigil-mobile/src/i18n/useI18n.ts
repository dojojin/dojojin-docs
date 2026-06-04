// ============================================================
// Vigil Mobile — useI18n hook
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// ============================================================

import { useCallback } from 'react';
import { useLanguageStore } from '../store/languageStore';
import { i18n } from './index';

export function useI18n() {
  const locale = useLanguageStore(s => s.locale);
  // Pass locale explicitly on each call — avoids mutating the singleton during render
  // (New Architecture concurrent rendering on Android breaks singleton mutation)
  return useCallback(
    (key: string, options?: Record<string, unknown>) => i18n.t(key, { locale, ...options }),
    [locale],
  );
}
