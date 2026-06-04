// ============================================================
// Vigil Mobile — CameraDetailContent (shared — used by route + iPad pane)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { EventDetailModal, useFormatEventType, useFormatTime } from './EventDetailModal';
import { useI18n } from '../i18n/useI18n';
import { useLanguageStore } from '../store/languageStore';
import { useEvents } from '../hooks/useEvents';
import { useTheme, TYPE } from '../theme';
import { Camera, VigilEvent } from '../types';

// ── Helpers ───────────────────────────────────────────────────

function useGetRelativeTime() {
  const t = useI18n();
  return (dateStr: string): string => {
    const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (secs < 60)    return t('time.sAgo',  { count: secs });
    if (secs < 3600)  return t('time.mAgo',  { count: Math.floor(secs / 60) });
    if (secs < 86400) return t('time.hAgo',  { count: Math.floor(secs / 3600) });
    return t('time.dAgo', { count: Math.floor(secs / 86400) });
  };
}

function fmtShortTime(d: string, locale: 'th' | 'en' = 'th'): string {
  const jsLocale = locale === 'th' ? 'th-TH' : 'en-US';
  return new Date(d).toLocaleTimeString(jsLocale, { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── Sub-components ────────────────────────────────────────────

function StatCard({ label, value, color, theme }: {
  label: string; value: string; color?: string; theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={[cd.statCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[TYPE.titleLg, { color: color ?? theme.textPrimary }]}>{value}</Text>
      <Text style={[TYPE.label, { color: theme.textSecondary, marginTop: 3 }]}>{label}</Text>
    </View>
  );
}

function ActionBtn({ icon, label, onPress, theme }: {
  icon: string; label: string; onPress: () => void; theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [cd.actionBtn, { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <Ionicons name={icon as any} size={20} color={theme.accent} />
      <Text style={[TYPE.bodySm, { color: theme.accent, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

function InfoRow({ label, value, theme }: {
  label: string; value: string; theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={cd.infoRow}>
      <Text style={[TYPE.bodySm, { color: theme.textSecondary, width: 90 }]}>{label}</Text>
      <Text style={[TYPE.bodySm, { color: theme.textPrimary, flex: 1, fontWeight: '500' }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function TimelineRow({ event, token, serverUrl, theme, isLast, onPress, fmt, fmtTime }: {
  event: VigilEvent; token: string | null; serverUrl: string;
  theme: ReturnType<typeof useTheme>; isLast: boolean;
  onPress: (e: VigilEvent) => void;
  fmt: (type: string) => string;
  fmtTime: (d: string) => string;
}) {
  const thumbUri = event.has_snapshot && event.snapshot_file
    ? `${serverUrl}/snapshots/${event.snapshot_file}?w=120` : null;
  return (
    <Pressable
      style={({ pressed }) => [cd.timelineRow, !isLast && { borderBottomWidth: 0.5, borderBottomColor: theme.border }, { opacity: pressed ? 0.75 : 1 }]}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(event); }}
    >
      {thumbUri && token ? (
        <Image source={{ uri: thumbUri, headers: { Authorization: `Bearer ${token}` } }}
          style={[cd.timelineThumb, { backgroundColor: theme.surfaceElevated }]}
          contentFit="cover" cachePolicy="memory-disk" transition={150} />
      ) : (
        <View style={[cd.timelineThumb, { backgroundColor: theme.surfaceElevated }]} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={[TYPE.body, { color: theme.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
          {event.rule_name?.trim() || fmt(event.event_type)}
        </Text>
        <Text style={[TYPE.label, { color: theme.textSecondary, marginTop: 4 }]}>{fmtTime(event.event_time)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={theme.border} />
      {event.clip_file && event.clip_status === 'done' && (
        <Ionicons name="videocam-outline" size={14} color={theme.accent} />
      )}
    </Pressable>
  );
}

function FullSnapModal({ uri, token, visible, onClose, theme }: {
  uri: string | null; token: string | null; visible: boolean;
  onClose: () => void; theme: ReturnType<typeof useTheme>;
}) {
  if (!uri || !token) return null;
  return (
    <Modal visible={visible} animationType="fade" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={[cd.snapModal, { backgroundColor: '#000' }]}>
        <Image source={{ uri, headers: { Authorization: `Bearer ${token}` } }}
          style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="none" />
        <Pressable style={cd.snapClose} onPress={onClose} hitSlop={12}>
          <Ionicons name="close-circle" size={32} color="rgba(255,255,255,0.8)" />
        </Pressable>
      </View>
    </Modal>
  );
}

// ── CameraDetailContent (exported) ───────────────────────────

export interface CameraDetailContentProps {
  camera:    Camera;
  token:     string | null;
  serverUrl: string;
  onClose:   () => void;
}

export function CameraDetailContent({ camera, token, serverUrl, onClose }: CameraDetailContentProps) {
  const router   = useRouter();
  const theme    = useTheme();
  const t        = useI18n();
  const fmt      = useFormatEventType();
  const fmtTime  = useFormatTime();
  const relTime  = useGetRelativeTime();
  const locale   = useLanguageStore(s => s.locale);

  const online      = camera.status === 'online';
  const statusColor = online ? theme.statusOk : theme.statusBad;

  // Live snapshot refresh (5s, online only)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!online) return;
    const id = setInterval(() => setTick(n => n + 1), 5000);
    return () => clearInterval(id);
  }, [online]);

  const [snapVisible,   setSnapVisible]   = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<VigilEvent | null>(null);

  const { events, isLoading: eventsLoading } = useEvents(
    useMemo(() => ({ camera: camera.camera_id }), [camera.camera_id]),
  );

  const snapshotUri = (online && token)
    ? `${serverUrl}/api/snapshot/live/${camera.camera_id}?t=${tick}` : null;
  const imgHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
  const lastAlertTime = events.length > 0 ? fmtShortTime(events[0].event_time, locale) : '—';

  return (
    <View style={[cd.root, { backgroundColor: theme.background }]}>
      {/* Event detail modal */}
      <EventDetailModal
        key={selectedEvent?.id ?? 'none'}
        event={selectedEvent}
        token={token}
        serverUrl={serverUrl}
        visible={selectedEvent !== null}
        onClose={() => setSelectedEvent(null)}
        presentationStyle="fullScreen"
      />

      {/* Full-screen snapshot modal */}
      <FullSnapModal uri={snapshotUri} token={token} visible={snapVisible} onClose={() => setSnapVisible(false)} theme={theme} />

      {/* Header */}
      <View style={[cd.header, { borderBottomColor: theme.border }]}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={[TYPE.titleLg, { color: theme.textPrimary }]} numberOfLines={1}>{camera.camera_name}</Text>
          {camera.location ? (
            <Text style={[TYPE.bodySm, { color: theme.textSecondary, marginTop: 2 }]} numberOfLines={1}>{camera.location}</Text>
          ) : null}
        </View>
        <Pressable onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={24} color={theme.textSecondary} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={cd.body}>
        {/* Hero */}
        <Pressable style={[cd.hero, { backgroundColor: theme.surfaceElevated }]} onPress={() => snapshotUri ? setSnapVisible(true) : null}>
          {snapshotUri && imgHeaders ? (
            <Image source={{ uri: snapshotUri, headers: imgHeaders }}
              style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="none" transition={0} />
          ) : (
            <View style={cd.heroPlaceholder}>
              <Ionicons name="videocam-outline" size={48} color={theme.border} />
              <Text style={[TYPE.bodySm, { color: theme.textSecondary, marginTop: 8 }]}>
                {online ? t('cameraDetail.liveLoading') : t('cameraDetail.locked')}
              </Text>
            </View>
          )}
          <View style={[cd.statusBadge, { backgroundColor: statusColor + 'dd' }]}>
            <View style={[cd.statusDot]} />
            <Text style={cd.statusBadgeText}>{online ? 'ONLINE' : 'OFFLINE'}</Text>
          </View>
          {camera.recording && (
            <View style={[cd.recBadge, { backgroundColor: theme.statusBad + 'dd' }]}>
              <View style={cd.recDot} />
              <Text style={cd.recText}>REC</Text>
            </View>
          )}
          {snapshotUri && (
            <View style={cd.fullscreenHint}>
              <Ionicons name="expand-outline" size={14} color="rgba(255,255,255,0.7)" />
            </View>
          )}
        </Pressable>

        {/* Quick stats */}
        <View style={cd.statsRow}>
          <StatCard label={t('cameraDetail.eventsToday')} value={String(camera.alert_count_today ?? 0)}
            color={(camera.alert_count_today ?? 0) > 0 ? theme.statusWarn : undefined} theme={theme} />
          <StatCard label={t('cameraDetail.lastSeen')} value={camera.last_seen ? relTime(camera.last_seen) : '—'}
            color={online ? theme.statusOk : theme.statusBad} theme={theme} />
          <StatCard label={t('cameraDetail.lastAlert')} value={lastAlertTime} theme={theme} />
        </View>

        {/* Actions */}
        <View style={cd.actionRow}>
          {online && token && (
            <ActionBtn icon="image-outline" label={t('cameraDetail.fullSnapshot')} onPress={() => setSnapVisible(true)} theme={theme} />
          )}
          {camera.latitude && camera.longitude && (
            <ActionBtn icon="map-outline" label={t('cameraDetail.mapBtn')} onPress={() => router.push('/(tabs)/map')} theme={theme} />
          )}
        </View>

        {/* Activity timeline */}
        <View style={[cd.section, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={cd.sectionHeader}>
            <Text style={[TYPE.label, { color: theme.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }]}>
              {t('cameraDetail.activity')}
            </Text>
            {!eventsLoading && events.length > 0 && (
              <Text style={[TYPE.label, { color: theme.textSecondary }]}>{t('cameraDetail.activityCount', { count: events.length })}</Text>
            )}
          </View>
          {eventsLoading && events.length === 0 ? (
            <ActivityIndicator size="small" color={theme.accent} style={{ paddingVertical: 20 }} />
          ) : events.length === 0 ? (
            <Text style={[TYPE.bodySm, { color: theme.textSecondary, paddingHorizontal: 16, paddingVertical: 16 }]}>
              {t('cameraDetail.noActivity')}
            </Text>
          ) : (
            events.map((ev, i) => (
              <TimelineRow key={ev.id} event={ev} token={token} serverUrl={serverUrl}
                theme={theme} isLast={i === events.length - 1}
                onPress={setSelectedEvent} fmt={fmt} fmtTime={fmtTime} />
            ))
          )}
        </View>

        {/* Camera info */}
        <View style={[cd.section, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={cd.sectionHeader}>
            <Text style={[TYPE.label, { color: theme.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }]}>
              {t('cameraDetail.cameraInfo')}
            </Text>
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 10 }}>
            {camera.ip_address && <InfoRow label={t('cameraDetail.ipAddress')} value={camera.ip_address} theme={theme} />}
            {camera.vendor     && <InfoRow label={t('cameraDetail.vendor')}    value={camera.vendor}     theme={theme} />}
            {camera.group_name && <InfoRow label={t('cameraDetail.group')}     value={camera.group_name} theme={theme} />}
            {camera.sd_status  && <InfoRow label={t('cameraDetail.sdCard')}    value={camera.sd_status}  theme={theme} />}
            {camera.notes      && <InfoRow label={t('cameraDetail.notes')}     value={camera.notes}      theme={theme} />}
            <InfoRow label={t('cameraDetail.status')}
              value={online ? t('cameraDetail.online') : t('cameraDetail.offline')}
              theme={{ ...theme, textPrimary: statusColor }} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const cd = StyleSheet.create({
  root:         { flex: 1 },
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5 },
  body:         { paddingBottom: 48 },
  hero:         { aspectRatio: 16 / 9, overflow: 'hidden', position: 'relative' },
  heroPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statusBadge:  { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  statusDot:    { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  statusBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff', letterSpacing: 0.5 },
  recBadge:     { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4 },
  recDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  recText:      { fontSize: 10, fontWeight: '700', color: '#fff', letterSpacing: 0.5 },
  fullscreenHint: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 6, padding: 5 },
  statsRow:     { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 4 },
  statCard:     { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 0.5 },
  actionRow:    { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  actionBtn:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 0.5 },
  section:      { marginHorizontal: 12, marginTop: 8, borderRadius: 16, borderWidth: 0.5, overflow: 'hidden' },
  sectionHeader:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  timelineRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  timelineThumb:{ width: 60, height: 44, borderRadius: 6, overflow: 'hidden', flexShrink: 0 },
  infoRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  snapModal:    { flex: 1, justifyContent: 'center' },
  snapClose:    { position: 'absolute', top: 52, right: 20 },
});
