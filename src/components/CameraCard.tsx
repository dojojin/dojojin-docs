// ============================================================
// Vigil Mobile — CameraCard Component
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useTheme, TYPE } from '../theme';
import { Camera } from '../types';

export type CardDensity = 'list' | 'grid' | 'spacious';

interface Props {
  camera:    Camera;
  token:     string | null;
  serverUrl: string;
  density?:  CardDensity;
  onPress?:  (camera: Camera) => void;
}

function getRelativeTime(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export function CameraCard({ camera, token, serverUrl, density = 'grid', onPress }: Props) {
  const theme       = useTheme();
  const online      = camera.status === 'online';
  const statusColor = online ? theme.statusOk : theme.statusBad;
  const lastSeen    = camera.last_seen ? getRelativeTime(camera.last_seen) : 'Never';
  const alertCount  = camera.alert_count_today ?? 0;

  // Only request snapshot for online cameras — avoids HTTP 404 storm for offline fleet
  const snapshotUri = (online && token)
    ? `${serverUrl}/api/snapshot/live/${camera.camera_id}`
    : null;

  // Reset error state when camera changes
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [camera.camera_id]);

  const imgHeaders  = token ? { Authorization: `Bearer ${token}` } : undefined;
  const showImage   = !!(snapshotUri && imgHeaders && !imgError);

  // ── List (compact horizontal) layout ──────────────────────
  if (density === 'list') {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.listCard,
          { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
        ]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress?.(camera); }}
      >
        {/* Thumbnail */}
        <View style={[styles.listThumb, { backgroundColor: theme.surfaceElevated }]}>
          {showImage ? (
            <Image
              source={{ uri: snapshotUri!, headers: imgHeaders }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory"
              transition={150}
              onError={() => setImgError(true)}
            />
          ) : (
            <Text style={[TYPE.label, { color: theme.textSecondary, fontSize: 9 }]}>
              {online ? 'LIVE' : 'OFF'}
            </Text>
          )}
          <View style={[styles.dot, styles.dotSm, { backgroundColor: statusColor }]} />
        </View>

        {/* Info */}
        <View style={styles.listInfo}>
          <View style={styles.listNameRow}>
            <Text style={[TYPE.body, { color: theme.textPrimary, flex: 1, fontWeight: '600' }]} numberOfLines={1}>
              {camera.camera_name}
            </Text>
            {alertCount > 0 && (
              <View style={[styles.alertBadge, { backgroundColor: theme.statusWarn }]}>
                <Text style={styles.alertText}>{alertCount}</Text>
              </View>
            )}
          </View>
          {camera.location ? (
            <Text style={[TYPE.bodySm, { color: theme.textSecondary }]} numberOfLines={1}>
              {camera.location}
            </Text>
          ) : null}
          <View style={styles.footer}>
            <View style={[styles.statusChip, { backgroundColor: statusColor + '20', borderColor: statusColor + '50' }]}>
              <Text style={[TYPE.label, { color: statusColor, fontWeight: '600' }]}>
                {online ? 'Online' : 'Offline'}
              </Text>
            </View>
            {camera.recording && (
              <View style={[styles.statusChip, { backgroundColor: theme.statusBad + '20', borderColor: theme.statusBad + '50' }]}>
                <Text style={[TYPE.label, { color: theme.statusBad, fontWeight: '600' }]}>REC</Text>
              </View>
            )}
            <Text style={[TYPE.label, { color: theme.textSecondary, marginLeft: 'auto' }]}>{lastSeen}</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  // ── Grid / Spacious (vertical) layout ─────────────────────
  const thumbHeight = density === 'spacious' ? 180 : 110;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
      ]}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress?.(camera); }}
    >
      {/* Thumbnail */}
      <View style={[styles.thumb, { height: thumbHeight, backgroundColor: theme.surfaceElevated }]}>
        {showImage ? (
          <Image
            source={{ uri: snapshotUri!, headers: imgHeaders }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory"
            transition={200}
            onError={() => setImgError(true)}
          />
        ) : (
          <Text style={[TYPE.label, { color: theme.textSecondary, letterSpacing: 1 }]}>
            {online ? 'LIVE' : 'OFFLINE'}
          </Text>
        )}
        <View style={[styles.dot, { backgroundColor: statusColor }]} />
        {alertCount > 0 && (
          <View style={[styles.alertBadge, { backgroundColor: theme.statusWarn }]}>
            <Text style={styles.alertText}>{alertCount}</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <Text style={[TYPE.body, styles.name, { color: theme.textPrimary }]} numberOfLines={1}>
        {camera.camera_name}
      </Text>
      {camera.location ? (
        <Text style={[TYPE.bodySm, { color: theme.textSecondary }]} numberOfLines={1}>
          {camera.location}
        </Text>
      ) : null}

      {/* Footer */}
      <View style={styles.footer}>
        <View style={[styles.statusChip, { backgroundColor: statusColor + '20', borderColor: statusColor + '50' }]}>
          <Text style={[TYPE.label, { color: statusColor, fontWeight: '600' }]}>
            {online ? 'Online' : 'Offline'}
          </Text>
        </View>
        {camera.recording && (
          <View style={[styles.statusChip, { backgroundColor: theme.statusBad + '20', borderColor: theme.statusBad + '50' }]}>
            <Text style={[TYPE.label, { color: theme.statusBad, fontWeight: '600' }]}>REC</Text>
          </View>
        )}
        <Text style={[TYPE.label, { color: theme.textSecondary, marginLeft: 'auto' }]}>{lastSeen}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Grid / Spacious card
  card: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    margin: 5,
    borderWidth: 0.5,
  },
  thumb: {
    borderRadius: 10,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // List card
  listCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 10,
    marginHorizontal: 12,
    marginVertical: 4,
    borderWidth: 0.5,
    gap: 12,
  },
  listThumb: {
    width: 72,
    height: 56,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  listInfo: {
    flex: 1,
    gap: 3,
  },
  listNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // Shared
  dot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotSm: {
    width: 6,
    height: 6,
    top: 5,
    right: 5,
  },
  alertBadge: {
    borderRadius: 8,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  alertText: {
    fontSize: 10,
    color: '#000',
    fontWeight: '700',
  },
  name: {
    marginBottom: 3,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  statusChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 0.5,
  },
});
