// ============================================================
// Vigil Mobile — Map Screen
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useMapData, MapMarker } from '../../src/hooks/useMapData';
import { useTheme, TYPE } from '../../src/theme';
import { useI18n } from '../../src/i18n/useI18n';
import { API_BASE_URL, STORAGE_KEYS } from '../../src/constants';

// สร้าง HTML ที่ฝัง MapLibre GL JS + CartoDB raster + markers
function buildHtml(markers: MapMarker[], colors: { ok: string; bad: string; warn: string }): string {
  // center = ค่าเฉลี่ยพิกัด (fallback Bangkok)
  const lats = markers.map(m => m.lat);
  const lons = markers.map(m => m.lon);
  const cLat = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 13.7563;
  const cLon = lons.length ? lons.reduce((a, b) => a + b, 0) / lons.length : 100.5018;

  // CartoDB raster basemap (ฟรี ไม่ต้อง key)
  // force voyager (light) เสมอ — ตัวแผนที่คงโทนสว่างแม้ app เป็น dark mode
  const tilePath = 'rastertiles/voyager';

  const markerJson = JSON.stringify(markers);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>
    /* map คงโทนสว่างเสมอ (voyager) แม้ app dark mode */
    html, body, #map { margin: 0; height: 100%; width: 100%; background: #F5F5F5; }
    .pin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.5); cursor: pointer; }
    .pin.badge::after {
      content: attr(data-count); position: absolute; top: -8px; right: -8px;
      background: ${colors.warn}; color: #000; font-size: 9px; font-weight: 700;
      min-width: 14px; height: 14px; border-radius: 7px; display: flex;
      align-items: center; justify-content: center; padding: 0 3px;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    function rnlog(m) { try { window.ReactNativeWebView.postMessage(String(m)); } catch(e){} }
    var markers = ${markerJson};
    var map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          carto: {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/${tilePath}/{z}/{x}/{y}@2x.png',
              'https://b.basemaps.cartocdn.com/${tilePath}/{z}/{x}/{y}@2x.png',
              'https://c.basemaps.cartocdn.com/${tilePath}/{z}/{x}/{y}@2x.png'
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap © CARTO'
          }
        },
        layers: [{ id: 'carto', type: 'raster', source: 'carto' }]
      },
      center: [${cLon}, ${cLat}],
      zoom: 14,
      attributionControl: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    function addPins() {
      var bounds = new maplibregl.LngLatBounds();
      markers.forEach(function(m) {
        var el = document.createElement('div');
        el.className = 'pin' + (m.count > 0 ? ' badge' : '');
        el.style.background = m.online ? '${colors.ok}' : '${colors.bad}';
        if (m.count > 0) el.setAttribute('data-count', m.count);
        // แตะ marker → ส่ง camera กลับ RN เพื่อเปิด native sheet (snapshot + Bearer)
        el.addEventListener('click', function() { rnlog('TAP:' + JSON.stringify(m)); });
        new maplibregl.Marker({ element: el })
          .setLngLat([m.lon, m.lat])
          .addTo(map);
        bounds.extend([m.lon, m.lat]);
      });
      if (markers.length > 1) map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 0 });
    }
    map.on('load', addPins);
  </script>
</body>
</html>`;
}

// ── Camera bottom sheet — live snapshot (expo-image + Bearer) ──
function CameraMapSheet({ marker, token, serverUrl, onClose }: { marker: MapMarker | null; token: string | null; serverUrl: string; onClose: () => void }) {
  const theme = useTheme();
  const t     = useI18n();
  if (!marker) return null;

  const snapUri = marker.online
    ? `${serverUrl}/api/snapshot/live/${marker.camera_id}` : null;
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const statusColor = marker.online ? theme.statusOk : theme.statusBad;

  return (
    <Modal visible={!!marker} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.sheetBackdrop} onPress={onClose}>
        <Pressable style={[s.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={() => {}}>
          {/* grabber + close */}
          <View style={s.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[TYPE.title, { color: theme.textPrimary }]} numberOfLines={1}>{marker.camera_name}</Text>
              {marker.location ? <Text style={[TYPE.bodySm, { color: theme.textSecondary, marginTop: 2 }]} numberOfLines={1}>{marker.location}</Text> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={12}><Ionicons name="close" size={24} color={theme.textSecondary} /></Pressable>
          </View>

          {/* Live snapshot */}
          <View style={[s.snapWrap, { backgroundColor: theme.surfaceElevated }]}>
            {snapUri && headers ? (
              <Image
                source={{ uri: snapUri, headers }}
                style={s.snapImg}
                contentFit="cover"
                cachePolicy="none"
                transition={150}
              />
            ) : (
              <View style={s.snapPlaceholder}>
                <Ionicons name="videocam-off-outline" size={40} color={theme.border} />
                <Text style={[TYPE.bodySm, { color: theme.textSecondary, marginTop: 8 }]}>{t('map.cameraOffline')}</Text>
              </View>
            )}
          </View>

          {/* Status chips */}
          <View style={s.chipRow}>
            <View style={[s.chip, { backgroundColor: statusColor + '20', borderColor: statusColor + '50' }]}>
              <View style={[s.chipDot, { backgroundColor: statusColor }]} />
              <Text style={[TYPE.bodySm, { color: statusColor, fontWeight: '600' }]}>{marker.online ? 'Online' : 'Offline'}</Text>
            </View>
            <View style={[s.chip, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
              <Ionicons name="flash-outline" size={13} color={theme.textSecondary} />
              <Text style={[TYPE.bodySm, { color: theme.textSecondary, fontWeight: '600' }]}>{t('map.events24h', { count: marker.count })}</Text>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function MapScreen() {
  const theme  = useTheme();
  const t      = useI18n();
  const { markers, isLoading, error, refresh } = useMapData();

  const [selected,  setSelected]  = useState<MapMarker | null>(null);
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

  const handleMessage = (raw: string) => {
    if (raw.startsWith('TAP:')) {
      try { setSelected(JSON.parse(raw.slice(4))); } catch {}
    }
  };

  // rebuild HTML เมื่อ markers เปลี่ยน — map คงโทนสว่างเสมอ (ไม่ขึ้นกับ dark mode)
  const html = useMemo(
    () => buildHtml(markers, { ok: theme.statusOk, bad: theme.statusBad, warn: theme.statusWarn }),
    [markers, theme.statusOk, theme.statusBad, theme.statusWarn],
  );

  if (isLoading && markers.length === 0) {
    return (
      <View style={[s.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={[TYPE.bodySm, { color: theme.textSecondary, marginTop: 12 }]}>{t('map.loading')}</Text>
      </View>
    );
  }

  if (error && markers.length === 0) {
    return (
      <View style={[s.center, { backgroundColor: theme.background }]}>
        <Text style={[TYPE.body, { color: theme.statusBad }]}>{error}</Text>
        <Text style={[TYPE.bodySm, { color: theme.accent, marginTop: 12 }]} onPress={refresh}>{t('map.refresh')}</Text>
      </View>
    );
  }

  if (markers.length === 0) {
    return (
      <View style={[s.center, { backgroundColor: theme.background }]}>
        <Text style={[TYPE.title, { color: theme.border, marginBottom: 8 }]}>{t('map.noLocation')}</Text>
        <Text style={[TYPE.bodySm, { color: theme.textSecondary }]}>{t('map.noLocationHint')}</Text>
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={s.webview}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        onMessage={(e) => handleMessage(e.nativeEvent.data)}
        startInLoadingState
        renderLoading={() => (
          <View style={[s.center, { backgroundColor: theme.background }]}>
            <ActivityIndicator size="large" color={theme.accent} />
          </View>
        )}
      />
      <Pressable
        style={[s.refreshBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
        onPress={refresh}
      >
        {isLoading
          ? <ActivityIndicator size="small" color={theme.accent} />
          : <Ionicons name="refresh-outline" size={20} color={theme.textSecondary} />
        }
      </Pressable>
      <CameraMapSheet marker={selected} token={token} serverUrl={serverUrl} onClose={() => setSelected(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  screen:     { flex: 1 },
  webview:    { flex: 1 },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  refreshBtn: {
    position: 'absolute', top: 16, left: 16,
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15, shadowRadius: 3, elevation: 3,
  },
  // Bottom sheet
  sheetBackdrop: { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
  sheet:         { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 0.5, borderLeftWidth: 0.5, borderRightWidth: 0.5, padding: 20, paddingBottom: 32, gap: 14 },
  sheetHeader:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  snapWrap:      { borderRadius: 14, overflow: 'hidden', aspectRatio: 16 / 9 },
  snapImg:       { width: '100%', height: '100%' },
  snapPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chipRow:       { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip:          { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 0.5 },
  chipDot:       { width: 7, height: 7, borderRadius: 4 },
});
