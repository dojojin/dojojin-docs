// ============================================================
// Vigil Mobile — StatusFilterChips Component
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, TYPE } from '../theme';
import { useI18n } from '../i18n/useI18n';
import type { CardDensity } from './CameraCard';

export type StatusFilter = 'all' | 'alert' | 'offline' | 'online';

interface ChipCounts {
  all:     number;
  alert:   number;
  offline: number;
  online:  number;
}

interface Props {
  filter:          StatusFilter;
  onFilterChange:  (f: StatusFilter) => void;
  counts:          ChipCounts;
  density:         CardDensity;
  onDensityChange: (d: CardDensity) => void;
}

const CHIPS: { key: StatusFilter; labelKey: string; icon: string; colorKey: 'accent' | 'statusWarn' | 'statusBad' | 'statusOk' }[] = [
  { key: 'all',     labelKey: 'filter.all',     icon: 'apps',            colorKey: 'accent'     },
  { key: 'alert',   labelKey: 'filter.alert',   icon: 'alert-circle',    colorKey: 'statusWarn' },
  { key: 'offline', labelKey: 'filter.offline', icon: 'cloud-offline',   colorKey: 'statusBad'  },
  { key: 'online',  labelKey: 'filter.online',  icon: 'radio-button-on', colorKey: 'statusOk'   },
];

const DENSITY_BTNS: { key: CardDensity; icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap }[] = [
  { key: 'list',     icon: 'list'   },
  { key: 'grid',     icon: 'grid'   },
  { key: 'spacious', icon: 'albums' },
];

export function StatusFilterChips({ filter, onFilterChange, counts, density, onDensityChange }: Props) {
  const theme = useTheme();
  const t     = useI18n();

  return (
    <View style={styles.row}>
      {/* Status filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {CHIPS.map(({ key, labelKey, icon, colorKey }) => {
          const active = filter === key;
          const color  = theme[colorKey];
          const count  = counts[key];
          return (
            <Pressable
              key={key}
              onPress={() => onFilterChange(key)}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: active ? color + '22' : theme.surfaceElevated,
                  borderColor:     active ? color        : theme.border,
                  opacity:         pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name={icon as any} size={11} color={active ? color : theme.textSecondary} />
              <Text style={[TYPE.label, { color: active ? color : theme.textSecondary, fontWeight: active ? '600' : '400' }]}>
                {t(labelKey)}
              </Text>
              <Text style={[TYPE.label, { color: active ? color : theme.textSecondary, opacity: 0.75 }]}>
                {count}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Density toggle */}
      <View style={[styles.densityGroup, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
        {DENSITY_BTNS.map(({ key, icon }) => (
          <Pressable
            key={key}
            onPress={() => onDensityChange(key)}
            style={[
              styles.densityBtn,
              density === key && { backgroundColor: theme.accent + '22' },
            ]}
            hitSlop={4}
          >
            <Ionicons
              name={icon}
              size={15}
              color={density === key ? theme.accent : theme.textSecondary}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingRight:   12,
    marginBottom:   6,
  },
  chips: {
    paddingLeft:  12,
    paddingRight: 6,
    gap:          6,
    alignItems:   'center',
    flexDirection: 'row',
  },
  chip: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            4,
    paddingHorizontal: 10,
    paddingVertical:   6,
    borderRadius:   20,
    borderWidth:    0.5,
  },
  densityGroup: {
    flexDirection: 'row',
    borderRadius:  10,
    borderWidth:   0.5,
    overflow:      'hidden',
  },
  densityBtn: {
    paddingHorizontal: 8,
    paddingVertical:   7,
  },
});
