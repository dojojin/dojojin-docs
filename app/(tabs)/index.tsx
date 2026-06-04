// ============================================================
// Vigil Mobile — Camera Screen
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { CameraDetailContent } from '../../src/components/CameraDetailContent';
import { useCameras } from '../../src/hooks/useCameras';
import { CameraCard, CardDensity } from '../../src/components/CameraCard';
import { CameraSearchBar } from '../../src/components/CameraSearchBar';
import { SkeletonCameraCard, SkeletonStatCard } from '../../src/components/SkeletonBox';
import { useI18n } from '../../src/i18n/useI18n';
import { GroupFilter } from '../../src/components/GroupFilter';
import { KPICard } from '../../src/components/KPICard';
import { StatusFilterChips, StatusFilter } from '../../src/components/StatusFilterChips';
import { useTheme, useGridColumns, useIsWide, TYPE } from '../../src/theme';
import { API_BASE_URL, STORAGE_KEYS } from '../../src/constants';
import { Camera } from '../../src/types';

function priorityScore(c: Camera): number {
  if ((c.alert_count_today ?? 0) > 0) return 2;
  if (c.status === 'offline') return 1;
  return 0;
}

export default function CameraScreen() {
  const theme       = useTheme();
  const gridColumns = useGridColumns();
  const isWide      = useIsWide();
  const router      = useRouter();
  const t           = useI18n();

  // iPad two-pane: selected camera for right pane
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);

  // ── Auth + server (read once on mount) ─────────────────────
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

  // ── Filter / search / density state ───────────────────────
  const [selectedGroup,  setSelectedGroup]  = useState<number | undefined>(undefined);
  const [query,          setQuery]          = useState('');
  const [statusFilter,   setStatusFilter]   = useState<StatusFilter>('all');
  const [density,        setDensity]        = useState<CardDensity>('grid');

  const { cameras, groups, stats, isLoading, error, lastFetch, refresh } = useCameras(selectedGroup);

  // ── Derived: filter → search → sort ───────────────────────
  const displayCameras = useMemo(() => {
    let result = cameras;

    if (statusFilter === 'alert')   result = result.filter(c => (c.alert_count_today ?? 0) > 0);
    else if (statusFilter === 'offline') result = result.filter(c => c.status === 'offline');
    else if (statusFilter === 'online')  result = result.filter(c => c.status === 'online');

    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(c =>
        c.camera_name.toLowerCase().includes(q) ||
        (c.location ?? '').toLowerCase().includes(q),
      );
    }

    return [...result].sort((a, b) => priorityScore(b) - priorityScore(a));
  }, [cameras, statusFilter, query]);

  const chipCounts = useMemo(() => ({
    all:     cameras.length,
    alert:   cameras.filter(c => (c.alert_count_today ?? 0) > 0).length,
    offline: cameras.filter(c => c.status === 'offline').length,
    online:  cameras.filter(c => c.status === 'online').length,
  }), [cameras]);

  // In wide mode: force list density in the narrow left pane
  const effectiveDensity: CardDensity = isWide ? 'list' : density;
  const numColumns = effectiveDensity === 'grid' ? gridColumns : 1;

  // ── Render ──────────────────────────────────────────────
  const handleCameraPress = useCallback((camera: Camera) => {
    if (isWide) {
      // iPad: show in right pane (toggle off on second tap)
      setSelectedCamera(prev => prev?.camera_id === camera.camera_id ? null : camera);
    } else {
      router.push({
        pathname: '/camera/[id]',
        params: { id: camera.camera_id, data: JSON.stringify(camera) },
      });
    }
  }, [isWide, router]);

  const renderCamera = useCallback(
    ({ item }: { item: Camera }) => (
      <CameraCard
        camera={item}
        token={token}
        serverUrl={serverUrl}
        density={effectiveDensity}
        onPress={handleCameraPress}
      />
    ),
    [token, serverUrl, effectiveDensity, handleCameraPress],
  );

  const keyExtractor = useCallback((item: Camera) => item.camera_id, []);

  const lastFetchLabel = lastFetch
    ? t('cameras.updatedAt', { time: lastFetch.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })
    : '';

  if (isLoading && cameras.length === 0) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <View style={styles.kpiRow}>
          {[0,1,2,3].map(i => (
            <SkeletonStatCard key={i} />
          ))}
        </View>
        <View style={styles.row}>
          {[0,1].map(i => <SkeletonCameraCard key={i} />)}
        </View>
        <View style={styles.row}>
          {[0,1].map(i => <SkeletonCameraCard key={i} />)}
        </View>
      </View>
    );
  }

  if (error && cameras.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={[TYPE.body, { color: theme.statusBad }]}>{error}</Text>
        <Text style={[TYPE.bodySm, { color: theme.accent, marginTop: 12 }]} onPress={refresh}>
          {t('cameras.retry')}
        </Text>
      </View>
    );
  }

  // Empty state message based on active filter
  const emptyMessage = (() => {
    if (query.trim()) return t('cameras.emptySearch', { query });
    if (statusFilter === 'alert')   return t('cameras.emptyAlert');
    if (statusFilter === 'offline') return t('cameras.emptyOffline');
    if (statusFilter === 'online')  return t('cameras.emptyOnline');
    if (selectedGroup)              return t('cameras.emptyGroup');
    return t('cameras.emptyNone');
  })();

  // ── Camera list (shared between narrow + left pane) ─────────
  const cameraList = (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {/* KPI Row */}
      <View style={styles.kpiRow}>
        <KPICard value={stats.total}        label={t('kpi.total')}   />
        <KPICard value={stats.online}       label={t('kpi.online')}  color={theme.statusOk}  />
        <KPICard value={stats.offline}      label={t('kpi.offline')} color={theme.statusBad} />
        <KPICard value={stats.alerts_today} label={t('kpi.alert')}   color={theme.statusWarn}/>
      </View>

      {/* Group Filter */}
      <GroupFilter
        groups={groups}
        selected={selectedGroup}
        onChange={setSelectedGroup}
        totalCount={cameras.length}
      />

      {/* Search */}
      <CameraSearchBar
        value={query}
        onChangeText={setQuery}
        resultCount={displayCameras.length}
        totalCount={cameras.length}
      />

      {/* Status chips + Density toggle */}
      <StatusFilterChips
        filter={statusFilter}
        onFilterChange={setStatusFilter}
        counts={chipCounts}
        density={density}
        onDensityChange={setDensity}
      />

      {/* Camera list */}
      <FlatList
        data={displayCameras}
        renderItem={renderCamera}
        keyExtractor={keyExtractor}
        numColumns={numColumns}
        key={`${effectiveDensity}-${numColumns}`}
        columnWrapperStyle={numColumns > 1 ? styles.row : undefined}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        // Scale optimisations
        windowSize={5}
        removeClippedSubviews
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refresh}
            tintColor={theme.accent}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[TYPE.body, { color: theme.textSecondary }]}>{emptyMessage}</Text>
          </View>
        }
        ListFooterComponent={
          lastFetchLabel
            ? <Text style={[TYPE.label, styles.footer, { color: theme.textSecondary }]}>{lastFetchLabel}</Text>
            : null
        }
      />
    </View>
  );

  // ── Two-pane (iPad wide) or single-pane (phone/tablet narrow) ──
  if (isWide) {
    return (
      <View style={[styles.twoPane, { backgroundColor: theme.background }]}>
        {/* Left pane: camera list */}
        <View style={[styles.leftPane, { borderRightColor: theme.border }]}>
          {cameraList}
        </View>

        {/* Right pane: camera detail or empty placeholder */}
        <View style={[styles.rightPane, { backgroundColor: theme.background }]}>
          {selectedCamera ? (
            <CameraDetailContent
              camera={selectedCamera}
              token={token}
              serverUrl={serverUrl}
              onClose={() => setSelectedCamera(null)}
            />
          ) : (
            <View style={styles.emptyPane}>
              <Ionicons name="camera-outline" size={56} color={theme.border} />
              <Text style={[TYPE.bodySm, { color: theme.textSecondary, marginTop: 12 }]}>
                {t('cameras.selectHint')}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  // Narrow (phone): return camera list only, detail opens as modal route
  return cameraList;
}

const styles = StyleSheet.create({
  screen:      { flex: 1 },
  kpiRow:      { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  row:         { paddingHorizontal: 10 },
  listContent: { paddingBottom: 24, paddingTop: 4 },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty:       { alignItems: 'center', paddingTop: 60 },
  footer:      { textAlign: 'center', paddingVertical: 16 },
  // iPad two-pane
  twoPane:     { flex: 1, flexDirection: 'row' },
  leftPane:    { width: 380, borderRightWidth: 0.5 },
  rightPane:   { flex: 1 },
  emptyPane:   { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
