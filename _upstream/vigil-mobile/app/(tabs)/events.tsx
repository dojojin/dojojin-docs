// ============================================================
// Vigil Mobile — Events Screen
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import * as MediaLibrary from 'expo-media-library';
import { Paths, File as FSFile } from 'expo-file-system';
import { EventDetailModal, MetaRow, formatEventType, formatTime, saveImageToLibrary, useFormatEventType, useFormatTime } from '../../src/components/EventDetailModal';
import { useI18n } from '../../src/i18n/useI18n';
import { SkeletonEventRow } from '../../src/components/SkeletonBox';
import { useEvents } from '../../src/hooks/useEvents';
import { useFaces }  from '../../src/hooks/useFaces';
import { useTheme, useGridColumns, TYPE } from '../../src/theme';
import { API_BASE_URL, STORAGE_KEYS } from '../../src/constants';
import { VigilEvent, VigilFace } from '../../src/types';

// ── Types ─────────────────────────────────────────────────────

type EventTab = 'all' | 'snap' | 'clip' | 'face';
type ViewMode = 'list' | 'grid';

const TABS: { key: EventTab; labelKey: string }[] = [
  { key: 'all',  labelKey: 'events.tabAll'  },
  { key: 'snap', labelKey: 'events.tabSnap' },
  { key: 'clip', labelKey: 'events.tabClip' },
  { key: 'face', labelKey: 'events.tabFace' },
];

const GRID_GAP  = 6;
const GRID_HPAD = 12;

// ── Helpers ──────────────────────────────────────────────────
// formatEventType, formatTime, saveImageToLibrary → imported from EventDetailModal

// cellWidth รับ screenWidth จาก useWindowDimensions — reactive บน rotation
function calcCellWidth(screenWidth: number, cols: number): number {
  return (screenWidth - GRID_HPAD * 2 - GRID_GAP * (cols - 1)) / cols;
}

// ── Shared UI ─────────────────────────────────────────────────

function ListFooter({ isLoadingMore, hasMore }: { isLoadingMore: boolean; hasMore: boolean }) {
  const theme = useTheme();
  const t     = useI18n();
  if (isLoadingMore) return <View style={s.footerRow}><ActivityIndicator size="small" color={theme.accent} /></View>;
  if (!hasMore)      return <Text style={[TYPE.label, s.footerText, { color: theme.textSecondary }]}>{t('events.allShown')}</Text>;
  return null;
}

function CountBar({ total, isLoading }: { total: number; isLoading: boolean }) {
  const theme = useTheme();
  const t     = useI18n();
  if (isLoading) {
    return (
      <View style={[s.countBar, { borderBottomColor: theme.border }]}>
        {[0,1,2].map(i => <SkeletonEventRow key={i} />)}
      </View>
    );
  }
  return (
    <View style={[s.countBar, { borderBottomColor: theme.border }]}>
      <Text style={[TYPE.label, { color: theme.textSecondary }]}>{t('events.count', { total: total.toLocaleString() })}</Text>
    </View>
  );
}

// ── Segmented control ─────────────────────────────────────────

function SegmentedControl({ active, onChange }: { active: EventTab; onChange: (t: EventTab) => void }) {
  const theme = useTheme();
  const t     = useI18n();
  return (
    <View style={[s.segmented, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
      {TABS.map((tab, i) => {
        const isActive = active === tab.key;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={[
              s.segment,
              isActive && { backgroundColor: theme.surface },
              i > 0 && { borderLeftWidth: 0.5, borderLeftColor: theme.border },
            ]}
          >
            <Text style={[TYPE.bodySm, { color: isActive ? theme.textPrimary : theme.textSecondary, fontWeight: isActive ? '600' : '400' }]}>
              {t(tab.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Event rows / cells ────────────────────────────────────────

function EventListRow({ event, token, serverUrl, onPress }: { event: VigilEvent; token: string | null; serverUrl: string; onPress: (e: VigilEvent) => void }) {
  const theme    = useTheme();
  const fmt      = useFormatEventType();
  const fmtTime  = useFormatTime();
  const thumbUri = event.has_snapshot && event.snapshot_file
    ? `${serverUrl}/snapshots/${event.snapshot_file}?w=120` : null;
  return (
    <Pressable
      style={({ pressed }) => [s.listRow, { backgroundColor: theme.surface, borderBottomColor: theme.border, opacity: pressed ? 0.85 : 1 }]}
      onPress={() => onPress(event)}
    >
      {thumbUri && token
        ? <Image source={{ uri: thumbUri, headers: { Authorization: `Bearer ${token}` } }}
            style={[s.listThumb, { backgroundColor: theme.surfaceElevated }]}
            contentFit="cover" cachePolicy="memory-disk" transition={150} />
        : <View style={s.listThumbEmpty} />
      }
      <View style={s.listContent}>
        <View style={s.rowTop}>
          <Text style={[TYPE.body, { color: theme.textPrimary, fontWeight: '600', flex: 1 }]} numberOfLines={1}>
            {fmt(event.event_type)}
          </Text>
          {event.clip_file && event.clip_status === 'done' &&
            <Ionicons name="videocam-outline" size={14} color={theme.accent} />}
        </View>
        <Text style={[TYPE.bodySm, { color: theme.textSecondary, marginTop: 3 }]} numberOfLines={1}>
          {event.camera_name ?? event.camera_id}{event.location ? `  ·  ${event.location}` : ''}
        </Text>
        <Text style={[TYPE.label, { color: theme.textSecondary, marginTop: 4 }]}>{fmtTime(event.event_time)}</Text>
      </View>
    </Pressable>
  );
}

function EventGridCell({ event, token, serverUrl, cols, onPress }: { event: VigilEvent; token: string | null; serverUrl: string; cols: number; onPress: (e: VigilEvent) => void }) {
  const theme        = useTheme();
  const fmt          = useFormatEventType();
  const fmtTime      = useFormatTime();
  const { width: sw } = useWindowDimensions();
  const w            = calcCellWidth(sw, cols);
  const thumbUri     = event.has_snapshot && event.snapshot_file
    ? `${serverUrl}/snapshots/${event.snapshot_file}?w=240` : null;
  return (
    <Pressable
      style={({ pressed }) => [s.gridCell, { backgroundColor: theme.surface, borderColor: theme.border, width: w, opacity: pressed ? 0.85 : 1 }]}
      onPress={() => onPress(event)}
    >
      <View style={[s.gridThumb, { backgroundColor: theme.surfaceElevated, height: w * 0.65 }]}>
        {thumbUri && token &&
          <Image source={{ uri: thumbUri, headers: { Authorization: `Bearer ${token}` } }}
            style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="memory-disk" transition={150} />}
        {event.clip_file && event.clip_status === 'done' &&
          <View style={[s.clipBadge, { backgroundColor: theme.accent + 'cc' }]}>
            <Ionicons name="videocam" size={10} color="#fff" />
          </View>}
      </View>
      <View style={s.gridInfo}>
        <Text style={[TYPE.label, { color: theme.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
          {fmt(event.event_type)}
        </Text>
        <Text style={[TYPE.label, { color: theme.textSecondary, marginTop: 2 }]} numberOfLines={1}>
          {fmtTime(event.event_time)}
        </Text>
      </View>
    </Pressable>
  );
}

// ── Face cell ─────────────────────────────────────────────────

function FaceCell({ face, token, serverUrl, cols, onPress }: { face: VigilFace; token: string | null; serverUrl: string; cols: number; onPress: (f: VigilFace) => void }) {
  const theme         = useTheme();
  const fmtTime       = useFormatTime();
  const { width: sw } = useWindowDimensions();
  const w             = calcCellWidth(sw, cols);
  const thumbUri      = face.snapshot ? `${serverUrl}/snapshots/${face.snapshot}?w=240` : null;
  const gColor        = face.gender === 'female' ? '#f472b6' : face.gender === 'male' ? '#60a5fa' : theme.textSecondary;
  const gLabel        = face.gender === 'female' ? '♀' : face.gender === 'male' ? '♂' : '?';

  return (
    <Pressable
      style={({ pressed }) => [s.gridCell, { backgroundColor: theme.surface, borderColor: theme.border, width: w, opacity: pressed ? 0.85 : 1 }]}
      onPress={() => onPress(face)}
    >
      <View style={[s.gridThumb, { backgroundColor: theme.surfaceElevated, height: w * 1.1 }]}>
        {thumbUri && token &&
          <Image source={{ uri: thumbUri, headers: { Authorization: `Bearer ${token}` } }}
            style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="memory-disk" transition={150} />}
        {(face.gender || face.age) &&
          <View style={[s.faceBadge, { backgroundColor: '#00000088' }]}>
            <Text style={{ color: gColor, fontSize: 11, fontWeight: '700' }}>{gLabel}</Text>
            {face.age && <Text style={{ color: '#fff', fontSize: 10, marginLeft: 3 }}>{face.age}</Text>}
          </View>}
        <View style={s.attrRow}>
          {face.mask  === 'yes' && <AttrChip label="mask"  />}
          {face.hat   === 'yes' && <AttrChip label="hat"   />}
          {face.glass === 'yes' && <AttrChip label="glass" />}
        </View>
      </View>
      <View style={s.gridInfo}>
        <Text style={[TYPE.label, { color: theme.textSecondary }]} numberOfLines={1}>{face.camera_id}</Text>
        <Text style={[TYPE.label, { color: theme.textSecondary, marginTop: 2 }]} numberOfLines={1}>{fmtTime(face.event_time)}</Text>
      </View>
    </Pressable>
  );
}

function AttrChip({ label }: { label: string }) {
  return (
    <View style={s.attrChip}>
      <Text style={{ color: '#fff', fontSize: 8, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

// ── Face Detail Modal ─────────────────────────────────────────

function FaceDetailModal({
  face, token, serverUrl, visible, onClose,
}: { face: VigilFace | null; token: string | null; serverUrl: string; visible: boolean; onClose: () => void }) {
  const theme   = useTheme();
  const t       = useI18n();
  const fmtTime = useFormatTime();
  const [saving,     setSaving]     = useState(false);
  const [saveResult, setSaveResult] = useState<'ok' | 'err' | null>(null);

  if (!face) return null;

  const fullFile = face.snapshot_full || face.snapshot;
  const fullUri  = fullFile ? `${serverUrl}/snapshots/${fullFile}` : null;
  const headers  = token   ? { Authorization: `Bearer ${token}` }    : undefined;

  const gLabel = face.gender === 'female' ? 'หญิง' : face.gender === 'male' ? 'ชาย' : null;
  const gColor = face.gender === 'female' ? '#f472b6' : '#60a5fa';

  const attrs: { label: string; value: string }[] = [
    ...(gLabel              ? [{ label: 'เพศ',           value: gLabel }]              : []),
    ...(face.age            ? [{ label: 'อายุโดยประมาณ', value: `${face.age} ปี` }]   : []),
    ...(face.expression     ? [{ label: 'อารมณ์',        value: face.expression }]     : []),
    ...(face.mask  === 'yes'? [{ label: 'หน้ากาก',       value: 'สวมใส่' }]            : []),
    ...(face.hat   === 'yes'? [{ label: 'หมวก',          value: 'สวมใส่' }]            : []),
    ...(face.glass === 'yes'? [{ label: 'แว่นตา',        value: 'สวมใส่' }]            : []),
    ...(face.face_score     ? [{ label: 'Face score',    value: face.face_score }]     : []),
  ];

  const handleSave = async () => {
    if (!fullUri || !token || saving) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const ok = await saveImageToLibrary(fullUri, token, fullFile ?? 'face.jpg');
      setSaveResult(ok ? 'ok' : 'err');
      Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
    } catch {
      setSaveResult('err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.modalSafe, { backgroundColor: theme.background }]}>
        <View style={[s.modalHeader, { borderBottomColor: theme.border }]}>
          <Text style={[TYPE.title, { color: theme.textPrimary }]}>{t('eventDetail.faceDetail')}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={theme.textSecondary} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.modalContent}>
          <View style={[s.modalImgWrap, { backgroundColor: theme.surfaceElevated }]}>
            {fullUri && headers ? (
              <Image source={{ uri: fullUri, headers }} style={s.modalImg} contentFit="contain" cachePolicy="memory-disk" transition={200} />
            ) : (
              <View style={[s.modalImgPlaceholder, { flex: 1 }]}>
                <Ionicons name="person-outline" size={64} color={theme.border} />
              </View>
            )}
          </View>

          {fullUri && (
            <Pressable
              onPress={handleSave}
              disabled={saving || saveResult === 'ok'}
              style={({ pressed }) => [
                s.actionBtn,
                {
                  backgroundColor: saveResult === 'ok'  ? theme.statusOk
                                  : saveResult === 'err' ? theme.statusBad
                                  : theme.accent,
                  opacity: pressed || saving ? 0.75 : 1,
                },
              ]}
            >
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons
                    name={saveResult === 'ok' ? 'checkmark' : saveResult === 'err' ? 'alert-circle-outline' : 'download-outline'}
                    size={18} color="#fff" />
              }
              <Text style={[TYPE.body, { color: '#fff', fontWeight: '600', marginLeft: 8 }]}>
                {saving ? t('eventDetail.saving') : saveResult === 'ok' ? t('eventDetail.savedFace') : saveResult === 'err' ? t('eventDetail.saveFailedFace') : t('eventDetail.saveFace')}
              </Text>
            </Pressable>
          )}

          <View style={[s.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <MetaRow label="กล้อง" value={face.camera_id}              theme={theme} />
            <MetaRow label="เวลา"  value={fmtTime(face.event_time)} theme={theme} />
          </View>

          {attrs.length > 0 && (
            <View style={[s.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[TYPE.label, { color: theme.textSecondary, marginBottom: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }]}>
                ข้อมูลบุคคล
              </Text>
              {attrs.map((a, i) => (
                <MetaRow key={i} label={a.label} value={a.value} theme={theme}
                  valueColor={a.label === 'เพศ' ? gColor : undefined} />
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ── EventsSection ─────────────────────────────────────────────

function EventsSection({
  activeTab, viewMode, debouncedQ, token, serverUrl,
}: { activeTab: EventTab; viewMode: ViewMode; debouncedQ: string; token: string | null; serverUrl: string }) {
  const theme   = useTheme();
  const t       = useI18n();
  const cols    = useGridColumns();
  const isGrid  = viewMode === 'grid';
  const numCols = isGrid ? cols : 1;

  const [selectedEvent, setSelectedEvent] = useState<VigilEvent | null>(null);

  const filter = {
    ...(activeTab !== 'all' ? { tab: activeTab as 'snap' | 'clip' } : {}),
    ...(debouncedQ          ? { q: debouncedQ }                     : {}),
  };
  const { events, total, hasMore, isLoading, isLoadingMore, error, refresh, loadMore } = useEvents(filter);

  const renderItem   = useCallback(({ item }: { item: VigilEvent }) =>
    isGrid
      ? <EventGridCell event={item} token={token} serverUrl={serverUrl} cols={cols} onPress={setSelectedEvent} />
      : <EventListRow  event={item} token={token} serverUrl={serverUrl} onPress={setSelectedEvent} />,
  [isGrid, token, serverUrl, cols]);
  const keyExtractor = useCallback((i: VigilEvent) => `e-${i.id}`, []);

  if (error && events.length === 0) return (
    <View style={s.center}>
      <Text style={[TYPE.body, { color: theme.statusBad }]}>{error}</Text>
      <Text style={[TYPE.bodySm, { color: theme.accent, marginTop: 12 }]} onPress={refresh}>แตะเพื่อลองใหม่</Text>
    </View>
  );

  return (
    <View style={s.sectionWrap}>
      <EventDetailModal
        key={selectedEvent?.id ?? 'none'}
        event={selectedEvent}
        token={token}
        serverUrl={serverUrl}
        visible={selectedEvent !== null}
        onClose={() => setSelectedEvent(null)}
      />
      <CountBar total={total} isLoading={isLoading && events.length === 0} />
      <FlatList
        style={s.list}
        data={events}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={numCols}
        key={`ev-${numCols}`}
        contentContainerStyle={isGrid ? [s.gridContent, { padding: GRID_HPAD, gap: GRID_GAP }] : undefined}
        columnWrapperStyle={isGrid && numCols > 1 ? { gap: GRID_GAP } : undefined}
        showsVerticalScrollIndicator={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        refreshControl={<RefreshControl refreshing={isLoading && events.length > 0} onRefresh={refresh} tintColor={theme.accent} />}
        ListFooterComponent={<ListFooter isLoadingMore={isLoadingMore} hasMore={hasMore} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={s.empty}>
              <Text style={[TYPE.title, { color: theme.border, marginBottom: 8 }]}>{t('events.noResults')}</Text>
              <Text style={[TYPE.bodySm, { color: theme.textSecondary }]}>
                {debouncedQ || activeTab !== 'all' ? t('events.tryFilter') : t('events.noData')}
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

// ── FacesSection ──────────────────────────────────────────────

function FacesSection({ token, serverUrl }: { token: string | null; serverUrl: string }) {
  const theme   = useTheme();
  const t       = useI18n();
  const cols    = useGridColumns();
  const numCols = cols;

  const [selectedFace, setSelectedFace] = useState<VigilFace | null>(null);
  const { faces, total, hasMore, isLoading, isLoadingMore, error, refresh, loadMore } = useFaces();

  const renderItem   = useCallback(({ item }: { item: VigilFace }) =>
    <FaceCell face={item} token={token} serverUrl={serverUrl} cols={cols} onPress={setSelectedFace} />,
  [token, serverUrl, cols]);
  const keyExtractor = useCallback((i: VigilFace) => `f-${i.id}`, []);

  if (error && faces.length === 0) return (
    <View style={s.center}>
      <Text style={[TYPE.body, { color: theme.statusBad }]}>{error}</Text>
      <Text style={[TYPE.bodySm, { color: theme.accent, marginTop: 12 }]} onPress={refresh}>แตะเพื่อลองใหม่</Text>
    </View>
  );

  return (
    <View style={s.sectionWrap}>
      <FaceDetailModal
        key={selectedFace?.id ?? 'none'}
        face={selectedFace}
        token={token}
        serverUrl={serverUrl}
        visible={selectedFace !== null}
        onClose={() => setSelectedFace(null)}
      />
      <CountBar total={total} isLoading={isLoading && faces.length === 0} />
      <FlatList
        style={s.list}
        data={faces}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={numCols}
        key={`face-${numCols}`}
        contentContainerStyle={[s.gridContent, { padding: GRID_HPAD, gap: GRID_GAP }]}
        columnWrapperStyle={numCols > 1 ? { gap: GRID_GAP } : undefined}
        showsVerticalScrollIndicator={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        refreshControl={<RefreshControl refreshing={isLoading && faces.length > 0} onRefresh={refresh} tintColor={theme.accent} />}
        ListFooterComponent={<ListFooter isLoadingMore={isLoadingMore} hasMore={hasMore} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={s.empty}>
              <Text style={[TYPE.title, { color: theme.border, marginBottom: 8 }]}>{t('events.noFaces')}</Text>
              <Text style={[TYPE.bodySm, { color: theme.textSecondary }]}>{t('events.noData')}</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────

export default function EventsScreen() {
  const theme = useTheme();

  const t = useI18n();
  const [activeTab,   setActiveTab]   = useState<EventTab>('all');
  const [viewMode,    setViewMode]    = useState<ViewMode>('list');
  const [prevMode,    setPrevMode]    = useState<ViewMode>('list'); // restore เมื่อออกจาก face
  const [searchText,  setSearchText]  = useState('');
  const [debouncedQ,  setDebouncedQ]  = useState('');
  const [token,     setToken]     = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState(API_BASE_URL);

  useEffect(() => {
    Promise.all([
      SecureStore.getItemAsync(STORAGE_KEYS.AUTH_TOKEN),
      SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL),
    ]).then(([t, s]) => {
      if (t) setToken(t);
      if (s) setServerUrl(s);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchText.trim()), 400);
    return () => clearTimeout(t);
  }, [searchText]);

  const handleTabChange = useCallback((t: EventTab) => {
    if (t === 'face' && activeTab !== 'face') {
      setPrevMode(viewMode);   // save ก่อนเข้า face
      setViewMode('grid');
    } else if (t !== 'face' && activeTab === 'face') {
      setViewMode(prevMode);   // restore เมื่อออกจาก face
    }
    setActiveTab(t);
  }, [activeTab, viewMode, prevMode]);

  const isFaceTab = activeTab === 'face';

  return (
    <View style={[s.screen, { backgroundColor: theme.background }]}>
      {/* Toolbar */}
      <View style={[s.toolbar, { borderBottomColor: theme.border }]}>
        <View style={s.tabRow}>
          <SegmentedControl active={activeTab} onChange={handleTabChange} />
          {!isFaceTab && (
            <Pressable
              onPress={() => setViewMode(v => v === 'list' ? 'grid' : 'list')}
              style={[s.viewBtn, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
              hitSlop={8}
            >
              <Ionicons name={viewMode === 'grid' ? 'list-outline' : 'grid-outline'} size={18} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>

        {!isFaceTab && (
          <View style={[s.searchWrap, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
            <Ionicons name="search-outline" size={16} color={theme.textSecondary} />
            <TextInput
              style={[s.searchInput, { color: theme.textPrimary }]}
              value={searchText}
              onChangeText={setSearchText}
              placeholder={t('events.search')}
              placeholderTextColor={theme.textSecondary}
              autoCorrect={false} autoCapitalize="none" returnKeyType="search"
            />
            {searchText.length > 0 && (
              <Pressable onPress={() => { setSearchText(''); setDebouncedQ(''); }} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={theme.textSecondary} />
              </Pressable>
            )}
          </View>
        )}
      </View>

      {isFaceTab
        ? <FacesSection  token={token} serverUrl={serverUrl} />
        : <EventsSection activeTab={activeTab} viewMode={viewMode} debouncedQ={debouncedQ} token={token} serverUrl={serverUrl} />
      }
    </View>
  );
}

const s = StyleSheet.create({
  screen:         { flex: 1 },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center' },
  toolbar:        { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10, gap: 10, borderBottomWidth: 0.5 },
  tabRow:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  segmented:      { flex: 1, flexDirection: 'row', borderRadius: 10, borderWidth: 0.5, overflow: 'hidden' },
  segment:        { flex: 1, paddingVertical: 8, alignItems: 'center' },
  viewBtn:        { padding: 8, borderRadius: 10, borderWidth: 0.5 },
  searchWrap:     { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 0.5, paddingHorizontal: 12, paddingVertical: 9, gap: 8 },
  searchInput:    { flex: 1, fontSize: 15, padding: 0 },
  countBar:       { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 0.5 },
  sectionWrap:    { flex: 1 },
  list:           { flex: 1 },
  // List row
  listRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, gap: 12 },
  listThumb:      { width: 72, height: 54, borderRadius: 8, flexShrink: 0 },
  listThumbEmpty: { width: 72, height: 54, flexShrink: 0 },
  listContent:    { flex: 1 },
  rowTop:         { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Grid
  gridContent:    { paddingBottom: 24 },
  gridCell:       { borderRadius: 12, borderWidth: 0.5, overflow: 'hidden' }, // ลบ marginBottom — ใช้ gap ใน contentContainer แทน
  gridThumb:      { position: 'relative', overflow: 'hidden' },
  gridInfo:       { padding: 8 },
  clipBadge:      { position: 'absolute', bottom: 6, right: 6, borderRadius: 4, padding: 3 },
  // Face badges
  faceBadge:      { position: 'absolute', top: 6, left: 6, flexDirection: 'row', alignItems: 'center', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  attrRow:        { position: 'absolute', bottom: 6, left: 6, flexDirection: 'row', gap: 3 },
  attrChip:       { backgroundColor: '#00000099', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  // Footer
  footerRow:      { alignItems: 'center', paddingVertical: 20 },
  footerText:     { textAlign: 'center', paddingVertical: 20 },
  empty:          { alignItems: 'center', paddingTop: 80 },
  // Modal
  modalSafe:      { flex: 1 },
  modalHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5 },
  modalContent:   { padding: 16, gap: 12, paddingBottom: 40 },
  modalImgWrap:   { borderRadius: 16, overflow: 'hidden', aspectRatio: 1 },
  modalImg:       { width: '100%', height: '100%' },
  modalImgPlaceholder: { alignItems: 'center', justifyContent: 'center', aspectRatio: 1 },
  modalCard:      { borderRadius: 14, borderWidth: 0.5, paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  metaRow:        { flexDirection: 'row', alignItems: 'center' },
  actionBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingVertical: 14, gap: 6 },
  videoView:      { width: '100%', aspectRatio: 16 / 9 },
  // Event detail
  snapWrap:       { borderRadius: 14, overflow: 'hidden', aspectRatio: 16 / 9 },
  snapImg:        { width: '100%', height: '100%' },
  snapPlaceholder:{ alignItems: 'center', justifyContent: 'center' },
  btnRow:         { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  btnOutline:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 0.5, minHeight: 48, paddingHorizontal: 12, gap: 6 },
  btnFilled:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12, minHeight: 48, paddingHorizontal: 12, gap: 6 },
  metaGrid:       { borderRadius: 14, borderWidth: 0.5, padding: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  metaCell:       { width: '45%', flexGrow: 1 },
});
