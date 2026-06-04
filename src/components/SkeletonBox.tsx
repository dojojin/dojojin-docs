// ============================================================
// Vigil Mobile — SkeletonBox Component
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme';

interface Props {
  width?:  number | `${number}%`;
  height:  number;
  radius?: number;
  style?:  ViewStyle;
}

export function SkeletonBox({ width = '100%', height, radius = 8, style }: Props) {
  const theme   = useTheme();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4,  duration: 700, useNativeDriver: true }),
      ]),
    ).start();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: theme.surfaceElevated, opacity },
        style,
      ]}
    />
  );
}

// ── Pre-built skeleton shapes ────────────────────────────────

export function SkeletonCameraCard() {
  const theme = useTheme();
  return (
    <View style={[sk.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <SkeletonBox height={110} radius={10} style={{ marginBottom: 10 }} />
      <SkeletonBox height={14} width="70%" radius={6} style={{ marginBottom: 8 }} />
      <SkeletonBox height={11} width="50%" radius={6} style={{ marginBottom: 10 }} />
      <View style={sk.footerRow}>
        <SkeletonBox height={22} width={60} radius={6} />
        <SkeletonBox height={11} width={50} radius={6} />
      </View>
    </View>
  );
}

export function SkeletonEventRow() {
  return (
    <View style={sk.eventRow}>
      <SkeletonBox width={72} height={54} radius={8} style={{ flexShrink: 0 }} />
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonBox height={14} width="65%" radius={6} />
        <SkeletonBox height={11} width="45%" radius={6} />
        <SkeletonBox height={10} width="30%" radius={6} />
      </View>
    </View>
  );
}

export function SkeletonStatCard() {
  const theme = useTheme();
  return (
    <View style={[sk.statCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <SkeletonBox height={28} width={56} radius={8} style={{ marginBottom: 8 }} />
      <SkeletonBox height={11} width="60%" radius={6} />
    </View>
  );
}

const sk = StyleSheet.create({
  card: {
    flex: 1, borderRadius: 16, padding: 12, margin: 5, borderWidth: 0.5,
  },
  footerRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  eventRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
  },
  statCard: {
    flex: 1, alignItems: 'center', paddingVertical: 14,
    borderRadius: 12, borderWidth: 0.5,
  },
});
