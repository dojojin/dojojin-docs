// ============================================================
// Vigil Mobile — EventDetailModal (shared)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import { Paths, File as FSFile } from 'expo-file-system';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme, TYPE } from '../theme';
import { API_BASE_URL } from '../constants';  // fallback default only
import { useLanguageStore } from '../store/languageStore';
import { useI18n } from '../i18n/useI18n';
import { VigilEvent } from '../types';

// ── Helpers ──────────────────────────────────────────────────

// Returns i18n key for known types, null for unknown
export function eventTypeKey(type: string): string | null {
  if (type.includes('Motion'))     return 'eventType.motion';
  if (type.includes('CrossedLine') || type.includes('Crossed')) return 'eventType.crossed';
  if (type.includes('Intruder'))   return 'eventType.intruder';
  if (type.includes('Loitering'))  return 'eventType.loitering';
  if (type.includes('Crowd'))      return 'eventType.crowd';
  if (type.includes('Face'))       return 'eventType.face';
  if (type.includes('Tailgating')) return 'eventType.tailgating';
  return null;
}

// Hook — reactive to language switch
export function useFormatEventType() {
  const t = useI18n();
  return (type: string): string => {
    const key = eventTypeKey(type);
    return key ? t(key) : type.replace(/([A-Z])/g, ' $1').replace(/\//g, ' · ').trim();
  };
}

export function useFormatTime() {
  const locale = useLanguageStore(s => s.locale);
  const jsLocale = locale === 'th' ? 'th-TH' : 'en-US';
  return (d: string) => new Date(d).toLocaleString(jsLocale, { hour12: false });
}

// Non-hook versions (Thai default) — kept for contexts without hooks
export function formatEventType(type: string): string {
  const key = eventTypeKey(type);
  if (key) {
    const labels: Record<string, string> = {
      'eventType.motion': 'ตรวจพบการเคลื่อนไหว', 'eventType.crossed': 'ข้ามเส้นกำหนด',
      'eventType.intruder': 'ตรวจพบผู้บุกรุก',  'eventType.loitering': 'พฤติกรรมต้องสงสัย',
      'eventType.crowd': 'ฝูงชนผิดปกติ',         'eventType.face': 'ตรวจพบใบหน้า',
      'eventType.tailgating': 'ติดตามเข้ามา',
    };
    return labels[key] ?? type;
  }
  return type.replace(/([A-Z])/g, ' $1').replace(/\//g, ' · ').trim();
}

export function formatTime(d: string): string {
  return new Date(d).toLocaleString('th-TH', { hour12: false });
}

const VIGIL_ALBUM = 'Vigil Image';

export async function saveImageToLibrary(uri: string, token: string, filename: string): Promise<boolean> {
  const perm = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
  if (perm.status !== 'granted') return false;

  const ext  = filename.split('.').pop() ?? 'jpg';
  const dest = new FSFile(Paths.cache, `vigil_save_${Date.now()}.${ext}`);
  await FSFile.downloadFileAsync(uri, dest, { headers: { Authorization: `Bearer ${token}` } });

  try {
    const asset = await MediaLibrary.createAssetAsync(dest.uri);
    const album = await MediaLibrary.getAlbumAsync(VIGIL_ALBUM);
    if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    else       await MediaLibrary.createAlbumAsync(VIGIL_ALBUM, asset, false);
  } catch {
    await MediaLibrary.saveToLibraryAsync(dest.uri);
  } finally {
    dest.delete();
  }
  return true;
}

// ── Sub-components ───────────────────────────────────────────

export function MetaRow({ label, value, theme, valueColor }: {
  label: string; value: string;
  theme: ReturnType<typeof useTheme>;
  valueColor?: string;
}) {
  return (
    <View style={m.metaRow}>
      <Text style={[TYPE.bodySm, { color: theme.textSecondary, flex: 1 }]}>{label}</Text>
      <Text style={[TYPE.bodySm, { color: valueColor ?? theme.textPrimary, fontWeight: '500', flex: 2, textAlign: 'right' }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function ClipPlayer({ clipUri, token }: { clipUri: string; token: string }) {
  const player = useVideoPlayer(
    { uri: clipUri, headers: { Authorization: `Bearer ${token}` } },
    p => { p.loop = false; p.play(); },
  );
  return <VideoView player={player} style={m.videoView} allowsFullscreen contentFit="contain" />;
}

// ── EventDetailModal ─────────────────────────────────────────

interface Props {
  event:             VigilEvent | null;
  token:             string | null;
  serverUrl?:        string;
  visible:           boolean;
  onClose:           () => void;
  presentationStyle?: 'pageSheet' | 'fullScreen' | 'overFullScreen';
}

export function EventDetailModal({ event, token, serverUrl = API_BASE_URL, visible, onClose, presentationStyle = 'pageSheet' }: Props) {
  const theme = useTheme();
  const t     = useI18n();
  const fmt   = useFormatEventType();
  const fmtTime = useFormatTime();
  const [showVideo,  setShowVideo]  = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saveResult, setSaveResult] = useState<'ok' | 'err' | null>(null);

  if (!event) return null;

  const thumbUri = event.snapshot_file ? `${serverUrl}/snapshots/${event.snapshot_file}?w=640` : null;
  const fullUri  = event.snapshot_file ? `${serverUrl}/snapshots/${event.snapshot_file}` : null;
  const clipUri  = event.clip_file && event.clip_status === 'done' ? `${serverUrl}/media/${event.clip_file}` : null;
  const headers  = token ? { Authorization: `Bearer ${token}` } : undefined;

  const title   = event.rule_name?.trim() || fmt(event.event_type);
  const clipSec = event.clip_duration_sec ? parseFloat(String(event.clip_duration_sec)).toFixed(1) : null;

  const handleSave = async () => {
    if (!fullUri || !token || saving) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const ok = await saveImageToLibrary(fullUri, token, event.snapshot_file ?? 'snapshot.jpg');
      setSaveResult(ok ? 'ok' : 'err');
      Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
    } catch {
      setSaveResult('err');
    } finally {
      setSaving(false);
    }
  };

  const metaFields: [string, string][] = [
    ['เวลา',       fmtTime(event.event_time)],
    ['กล้อง',      event.camera_name ?? event.camera_id],
    ['Rule',       event.rule_name       || '—'],
    ['ประเภท',     event.event_type],
    ['Class',      event.object_class    || '—'],
    ['Confidence', event.likelihood != null ? `${(event.likelihood * 100).toFixed(1)}%` : '—'],
    ['ความเร็ว',   event.speed != null ? `${event.speed} m/s` : '—'],
    ['Source',     event.snapshot_source || '—'],
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={presentationStyle}
      onRequestClose={onClose}
    >
      <SafeAreaView style={[m.safe, { backgroundColor: theme.background }]}>
        {/* Header */}
        <View style={[m.header, { borderBottomColor: theme.border }]}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={[TYPE.title, { color: theme.textPrimary }]} numberOfLines={2}>{title}</Text>
            <Text style={[TYPE.bodySm, { color: theme.textSecondary, marginTop: 2 }]} numberOfLines={1}>
              {event.camera_name ?? event.camera_id}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={theme.textSecondary} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={m.content}>
          {/* Snapshot / Video */}
          {showVideo && clipUri && token ? (
            <View style={[m.snapWrap, { backgroundColor: '#000' }]}>
              <ClipPlayer clipUri={clipUri} token={token} />
            </View>
          ) : thumbUri && headers ? (
            <View style={[m.snapWrap, { backgroundColor: theme.surfaceElevated }]}>
              <Image source={{ uri: thumbUri, headers }} style={m.snapImg} contentFit="cover" cachePolicy="memory-disk" transition={200} />
            </View>
          ) : (
            <View style={[m.snapWrap, m.snapPlaceholder, { backgroundColor: theme.surfaceElevated }]}>
              <Ionicons name="camera-outline" size={56} color={theme.border} />
              <Text style={[TYPE.bodySm, { color: theme.textSecondary, marginTop: 8 }]}>{t('eventDetail.noImage')}</Text>
            </View>
          )}

          {/* Button row */}
          <View style={m.btnRow}>
            {clipUri && token && !showVideo && (
              <Pressable style={[m.btnFilled, { backgroundColor: theme.accent, flex: 1 }]} onPress={() => setShowVideo(true)}>
                <Ionicons name="film-outline" size={16} color="#fff" />
                <Text style={[TYPE.bodySm, { color: '#fff', fontWeight: '600', marginLeft: 6 }]} numberOfLines={1}>
                  {`${t('eventDetail.watchVideo')}${clipSec ? ` (${clipSec}s)` : ''}`}
                </Text>
              </Pressable>
            )}
            {showVideo && (
              <Pressable style={[m.btnOutline, { borderColor: theme.border, backgroundColor: theme.surfaceElevated, flex: 1 }]} onPress={() => setShowVideo(false)}>
                <Ionicons name="image-outline" size={16} color={theme.textPrimary} />
                <Text style={[TYPE.bodySm, { color: theme.textPrimary, fontWeight: '600', marginLeft: 6 }]} numberOfLines={1}>{t('eventDetail.watchImage')}</Text>
              </Pressable>
            )}
            {fullUri && token && (() => {
              const isOk  = saveResult === 'ok';
              const isErr = saveResult === 'err';
              const bg    = isOk ? theme.statusOk : isErr ? theme.statusBad : theme.surfaceElevated;
              const fg    = (isOk || isErr) ? '#fff' : theme.textPrimary;
              return (
                <Pressable
                  onPress={handleSave}
                  disabled={saving || isOk}
                  style={({ pressed }) => [
                    m.btnFilled,
                    { flex: 1, backgroundColor: bg, borderWidth: 0.5, borderColor: bg === theme.surfaceElevated ? theme.border : bg, opacity: pressed || saving ? 0.8 : 1 },
                  ]}
                >
                  {saving
                    ? <ActivityIndicator size="small" color={theme.accent} />
                    : <Ionicons name={isOk ? 'checkmark-circle' : isErr ? 'alert-circle-outline' : 'download-outline'} size={16} color={fg} />
                  }
                  <Text style={[TYPE.bodySm, { color: fg, fontWeight: '600', marginLeft: 6 }]} numberOfLines={1}>
                    {saving ? t('eventDetail.saving') : isOk ? t('eventDetail.saved') : isErr ? t('eventDetail.saveFailed') : t('eventDetail.saveImage')}
                  </Text>
                </Pressable>
              );
            })()}
          </View>

          {/* Meta grid */}
          <View style={[m.metaGrid, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {metaFields.map(([k, v]) => (
              <View key={k} style={m.metaCell}>
                <Text style={[TYPE.label, { color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3 }]}>{k}</Text>
                <Text style={[TYPE.body, { color: theme.textPrimary, marginTop: 3 }]} numberOfLines={2}>{v}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const m = StyleSheet.create({
  safe:           { flex: 1 },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5 },
  content:        { padding: 16, gap: 12, paddingBottom: 40 },
  snapWrap:       { borderRadius: 14, overflow: 'hidden', aspectRatio: 16 / 9 },
  snapImg:        { width: '100%', height: '100%' },
  snapPlaceholder:{ alignItems: 'center', justifyContent: 'center' },
  btnRow:         { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  btnOutline:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 0.5, minHeight: 48, paddingHorizontal: 12, gap: 6 },
  btnFilled:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12, minHeight: 48, paddingHorizontal: 12, gap: 6 },
  metaGrid:       { borderRadius: 14, borderWidth: 0.5, padding: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  metaCell:       { width: '45%', flexGrow: 1 },
  metaRow:        { flexDirection: 'row', alignItems: 'center' },
  videoView:      { width: '100%', aspectRatio: 16 / 9 },
});
