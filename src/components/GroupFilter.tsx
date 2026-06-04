// ============================================================
// Vigil Mobile — GroupFilter Component
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme, TYPE } from '../theme';
import { useI18n } from '../i18n/useI18n';
import { CameraGroup } from '../types';

interface Props {
  groups:     CameraGroup[];
  selected:   number | undefined;
  onChange:   (groupId: number | undefined) => void;
  totalCount: number;
}

export function GroupFilter({ groups, selected, onChange, totalCount }: Props) {
  const theme = useTheme();
  const t     = useI18n();

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <Pill
          label={`${t('cameras.allFilter')} (${totalCount})`}
          active={selected === undefined}
          onPress={() => onChange(undefined)}
          theme={theme}
        />
        {groups.map((g) => (
          <Pill
            key={g.id}
            label={`${g.name} (${g.camera_count})`}
            active={selected === g.id}
            onPress={() => onChange(g.id)}
            theme={theme}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Pill({ label, active, onPress, theme }: {
  label:   string;
  active:  boolean;
  onPress: () => void;
  theme:   ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: active ? theme.accent + '22' : theme.surfaceElevated,
          borderColor:     active ? theme.accent        : theme.border,
          opacity:         pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[TYPE.bodySm, { color: active ? theme.accent : theme.textSecondary, fontWeight: '500', lineHeight: 20 }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
  },
  row: {
    paddingHorizontal: 16,
    alignItems:        'center',
    gap:               8,
    flexDirection:     'row',
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical:   7,
    borderRadius:      20,
    borderWidth:       0.5,
  },
});
