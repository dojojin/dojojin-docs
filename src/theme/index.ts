// ============================================================
// Vigil Mobile — Theme System
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import { useColorScheme, useWindowDimensions } from 'react-native';
import { useThemeStore } from '../store/themeStore';

const dark = {
  background:      '#0F0F0F',
  surface:         '#1A1A1A',
  surfaceElevated: '#242424',
  textPrimary:     '#F2F2F2',
  textSecondary:   '#8A8A8A',
  border:          '#2A2A2A',
  accent:          '#29B6F6',
  statusOk:        '#22C55E',
  statusBad:       '#EF4444',
  statusWarn:      '#F59E0B',
};

const light = {
  background:      '#F5F5F5',
  surface:         '#FFFFFF',
  surfaceElevated: '#EFEFEF',
  textPrimary:     '#0F0F0F',
  textSecondary:   '#6B6B6B',
  border:          '#E0E0E0',
  accent:          '#0288D1',
  statusOk:        '#16A34A',
  statusBad:       '#DC2626',
  statusWarn:      '#D97706',
};

export type Theme = typeof dark;

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const mode   = useThemeStore(s => s.mode);
  const isDark = mode === 'auto' ? scheme === 'dark' : mode === 'dark';
  return isDark ? dark : light;
}

// ── Responsive grid columns ──────────────────────────────────
export function useGridColumns(): number {
  const { width } = useWindowDimensions();
  if (width >= 900) return 4;
  if (width >= 600) return 3;
  return 2;
}

// ── Wide-screen gate (iPad two-pane layout) ──────────────────
// Reuses 900px — same breakpoint as useGridColumns max tier
export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= 900;
}

// ── Typography scale ─────────────────────────────────────────
export const TYPE = {
  titleLg: { fontSize: 22, fontWeight: '700' as const },
  title:   { fontSize: 17, fontWeight: '600' as const },
  body:    { fontSize: 15, fontWeight: '400' as const },
  bodySm:  { fontSize: 13, fontWeight: '400' as const },
  label:   { fontSize: 11, fontWeight: '500' as const },
} as const;
