// ============================================================
// Vigil Mobile — Alerts Screen
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useCallback } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, { useAnimatedStyle, SharedValue } from 'react-native-reanimated';
import { useWsStore } from '../../src/store/wsStore';
import { useTheme, TYPE } from '../../src/theme';
import { useI18n } from '../../src/i18n/useI18n';
import { useFormatEventType } from '../../src/components/EventDetailModal';
import { VigilEvent } from '../../src/types';

// ── Helpers ──────────────────────────────────────────────────
// formatEventType → useFormatEventType() hook (imported)

function useGetRelativeTime() {
  const t = useI18n();
  return (dateStr: string): string => {
    const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (secs < 10)   return t('time.justNow');
    if (secs < 60)   return t('time.secondsAgo', { count: secs });
    if (secs < 3600) return t('time.minutesAgo', { count: Math.floor(secs / 60) });
    return t('time.hoursAgo', { count: Math.floor(secs / 3600) });
  };
}

// ── Swipe-to-dismiss action ───────────────────────────────────

function SwipeAction(_prog: SharedValue<number>, drag: SharedValue<number>) {
  const theme = useTheme();
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value + 80 }],
  }));
  return (
    <Reanimated.View style={[styles.swipeAction, { backgroundColor: theme.statusBad }, style]}>
      <Ionicons name="trash-outline" size={20} color="#fff" />
    </Reanimated.View>
  );
}

// ── WS Status chip ────────────────────────────────────────────

function WsStatusChip() {
  const theme  = useTheme();
  const t      = useI18n();
  const status = useWsStore(s => s.status);

  const cfg = {
    connected:    { color: theme.statusOk,   label: t('alertsScreen.wsLive') },
    connecting:   { color: theme.statusWarn, label: t('alertsScreen.wsConnecting') },
    disconnected: { color: theme.statusBad,  label: t('alertsScreen.wsDisconnected') },
  }[status];

  return (
    <View style={[styles.wsChip, { backgroundColor: cfg.color + '18', borderColor: cfg.color + '44' }]}>
      <View style={[styles.wsDot, { backgroundColor: cfg.color }]} />
      <Text style={[TYPE.label, { color: cfg.color, fontWeight: '600' }]}>{cfg.label}</Text>
    </View>
  );
}

// ── Event row ─────────────────────────────────────────────────

function EventRow({ event }: { event: VigilEvent }) {
  const theme    = useTheme();
  const fmt      = useFormatEventType();
  const relTime  = useGetRelativeTime();

  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
      <View style={[styles.accent, { backgroundColor: theme.statusWarn }]} />
      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <Text style={[TYPE.body, { color: theme.textPrimary, fontWeight: '600', flex: 1 }]} numberOfLines={1}>
            {fmt(event.event_type)}
          </Text>
          <Text style={[TYPE.label, { color: theme.textSecondary }]}>
            {relTime(event.event_time)}
          </Text>
        </View>
        <Text style={[TYPE.bodySm, { color: theme.textSecondary, marginTop: 2 }]} numberOfLines={1}>
          {event.camera_name ?? event.camera_id}
          {event.location ? `  ·  ${event.location}` : ''}
        </Text>
      </View>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────

export default function AlertsScreen() {
  const theme        = useTheme();
  const t            = useI18n();
  const recentEvents = useWsStore(s => s.recentEvents);

  const dismissEvent = useWsStore(s => s.dismissEvent);

  const renderItem = useCallback(
    ({ item }: { item: VigilEvent }) => (
      <ReanimatedSwipeable
        friction={2}
        rightThreshold={60}
        renderRightActions={SwipeAction}
        onSwipeableOpen={() => dismissEvent(item.id)}
      >
        <EventRow event={item} />
      </ReanimatedSwipeable>
    ),
    [dismissEvent],
  );

  const keyExtractor = useCallback((item: VigilEvent) => String(item.id), []);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {/* Header row */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[TYPE.bodySm, { color: theme.textSecondary }]}>
          {recentEvents.length > 0 ? t('events.count', { total: recentEvents.length }) : t('alertsScreen.noAlerts')}
        </Text>
        <WsStatusChip />
      </View>

      <FlatList
        data={recentEvents}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={recentEvents.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[TYPE.title, { color: theme.border, marginBottom: 8 }]}>{t('alertsScreen.noAlerts')}</Text>
            <Text style={[TYPE.bodySm, { color: theme.textSecondary, textAlign: 'center' }]}>
              {t('alertsScreen.noAlertsHint')}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:         { flex: 1 },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5 },
  wsChip:         { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 0.5 },
  wsDot:          { width: 6, height: 6, borderRadius: 3 },
  row:            { flexDirection: 'row', borderBottomWidth: 0.5 },
  accent:         { width: 3, borderRadius: 2, marginVertical: 12, marginLeft: 16 },
  rowContent:     { flex: 1, paddingVertical: 14, paddingHorizontal: 14 },
  rowTop:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  emptyContainer: { flex: 1 },
  swipeAction:    { width: 80, justifyContent: 'center', alignItems: 'center' },
  empty:          { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
});
