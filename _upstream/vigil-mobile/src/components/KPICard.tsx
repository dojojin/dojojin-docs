// ============================================================
// Vigil Mobile — KPICard Component
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, TYPE } from '../theme';

interface Props {
  value:     number | string;
  label:     string;
  color?:    string;
}

export function KPICard({ value, label, color }: Props) {
  const theme = useTheme();
  const valueColor = color ?? theme.textPrimary;

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.value, { color: valueColor }]}>{value}</Text>
      <Text style={[TYPE.label, { color: theme.textSecondary, marginTop: 2 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 0.5,
  },
  value: {
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 32,
  },
});
