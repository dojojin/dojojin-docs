# Vigil Mobile — Code Patterns

> Code patterns ที่ใช้ทั่วโครงการ — session ใหม่ยึดตามนี้เพื่อ consistency
> Updated 2026-05-31

---

## 1. Zustand Store

ใช้กับ state ที่ใช้ข้าม component (auth, ws, theme)
**ไฟล์อ้างอิง:** `src/store/authStore.ts`, `src/store/wsStore.ts`, `src/store/themeStore.ts`

```typescript
// src/store/exampleStore.ts
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const KEY = 'vigil_example_pref';

interface ExampleState {
  value:    string;
  isReady:  boolean;
  hydrate:  () => Promise<void>;
  setValue: (v: string) => void;
}

export const useExampleStore = create<ExampleState>((set) => ({
  value:   '',
  isReady: false,
  hydrate: async () => {
    try {
      const saved = await SecureStore.getItemAsync(KEY);
      if (saved) set({ value: saved });
    } finally { set({ isReady: true }); }
  },
  setValue: (v) => {
    set({ value: v });
    SecureStore.setItemAsync(KEY, v).catch(() => {});
  },
}));
```

**Conventions:**
- เก็บ pref ใน `SecureStore` (ไม่ใช่ AsyncStorage)
- key prefix `vigil_*`
- `hydrate()` เรียกใน `app/_layout.tsx`
- subscribe ใน component: `const value = useExampleStore(s => s.value)` (selector กัน re-render)

---

## 2. Custom Hook (REST + pagination)

ใช้กับการดึงข้อมูลจาก API พร้อม loading/error/refresh
**ไฟล์อ้างอิง:** `src/hooks/useEvents.ts`, `src/hooks/useFaces.ts`, `src/hooks/useStats.ts`, `src/hooks/useCameras.ts`

```typescript
// src/hooks/useExample.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { exampleApi } from '../api/client';
import { ExampleItem } from '../types';

const PAGE_SIZE = 20;

interface UseExampleResult {
  items:         ExampleItem[];
  total:         number;
  hasMore:       boolean;
  isLoading:     boolean;
  isLoadingMore: boolean;
  error:         string | null;
  refresh:       () => void;
  loadMore:      () => void;
}

export function useExample(filter: { camera?: string } = {}): UseExampleResult {
  const [items,         setItems]         = useState<ExampleItem[]>([]);
  const [total,         setTotal]         = useState(0);
  const [isLoading,     setIsLoading]     = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  const lenRef = useRef(0);
  lenRef.current = items.length;

  const fetchPage = useCallback(async (reset: boolean) => {
    if (reset) { setIsLoading(true); setError(null); }
    else        setIsLoadingMore(true);
    try {
      const { items: rows, total: t } = await exampleApi.list({
        ...filter, limit: PAGE_SIZE, offset: reset ? 0 : lenRef.current,
      });
      setTotal(t);
      setItems(prev => reset ? rows : [...prev, ...rows]);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed to load');
    } finally {
      if (reset) setIsLoading(false);
      else        setIsLoadingMore(false);
    }
  }, [JSON.stringify(filter)]);

  useEffect(() => { fetchPage(true); }, [fetchPage]);

  return {
    items, total,
    hasMore:  items.length < total,
    isLoading, isLoadingMore, error,
    refresh:  useCallback(() => fetchPage(true), [fetchPage]),
    loadMore: useCallback(() => {
      if (!isLoadingMore && lenRef.current < total) fetchPage(false);
    }, [isLoadingMore, total, fetchPage]),
  };
}
```

**Conventions:**
- `Promise.allSettled` ถ้ามีหลาย endpoint (ดู `useStats.ts`, `useCameras.ts`)
- `JSON.stringify(filter)` ใน deps — re-fetch เมื่อ filter เปลี่ยน
- length ใน `ref` กัน stale closure ใน loadMore
- ใส่ `lenRef.current` ใน `useEffect(()=>{}, [...])` ไม่ใช่ deps ของ callback

---

## 3. API Client

**ไฟล์อ้างอิง:** `src/api/client.ts`

```typescript
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL, STORAGE_KEYS } from '../constants';

const client = axios.create({ baseURL: API_BASE_URL, timeout: 15_000 });

// Bearer interceptor
client.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(STORAGE_KEYS.AUTH_TOKEN);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 401 → global handler
let _onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { _onUnauthorized = fn; };
client.interceptors.response.use(
  (r) => r,
  (e) => { if (e.response?.status === 401) _onUnauthorized?.(); return Promise.reject(e); },
);

// Endpoint API group
export const exampleApi = {
  list: async (params: { limit?: number; offset?: number } = {}) => {
    const { data, headers } = await client.get('/api/examples', { params });
    return {
      items: Array.isArray(data) ? data : (data.items ?? []),
      total: parseInt(headers['x-total-count'] ?? '0', 10),
    };
  },
};

export default client;
```

**Conventions:**
- response รองรับทั้ง `[]` และ `{ items: [] }` (ห้ามตัด fallback)
- `X-Total-Count` header สำหรับ pagination
- group endpoints เป็น object (`authApi`, `cameraApi`, `eventApi`, `statsApi`)

---

## 4. Screen (with refresh)

**ไฟล์อ้างอิง:** `app/(tabs)/index.tsx`, `app/(tabs)/events.tsx`, `app/(tabs)/stats.tsx`

```tsx
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useExample } from '../../src/hooks/useExample';
import { useTheme, TYPE } from '../../src/theme';
import { ExampleItem } from '../../src/types';

export default function ExampleScreen() {
  const theme = useTheme();
  const { items, total, isLoading, isLoadingMore, hasMore, error, refresh, loadMore } = useExample();

  const renderItem = useCallback(({ item }: { item: ExampleItem }) => (
    <ExampleRow item={item} />
  ), []);
  const keyExtractor = useCallback((i: ExampleItem) => `x-${i.id}`, []);

  if (isLoading && items.length === 0) return (
    <View style={[s.center, { backgroundColor: theme.background }]}>
      <ActivityIndicator size="large" color={theme.accent} />
    </View>
  );

  if (error && items.length === 0) return (
    <View style={[s.center, { backgroundColor: theme.background }]}>
      <Text style={[TYPE.body, { color: theme.statusBad }]}>{error}</Text>
      <Text style={[TYPE.bodySm, { color: theme.accent, marginTop: 12 }]} onPress={refresh}>
        แตะเพื่อลองใหม่
      </Text>
    </View>
  );

  return (
    <View style={[s.screen, { backgroundColor: theme.background }]}>
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl refreshing={isLoading && items.length > 0} onRefresh={refresh} tintColor={theme.accent} />
        }
        ListEmptyComponent={!isLoading ? <EmptyState /> : null}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
```

**Conventions:**
- `theme = useTheme()` เสมอ — ห้าม hardcode สี
- error state มีปุ่ม "แตะเพื่อลองใหม่"
- `RefreshControl.refreshing` = `isLoading && items.length > 0` (กัน double spinner)
- styles ตั้ง `const s = StyleSheet.create(...)` ท้ายไฟล์

---

## 5. Modal / Bottom Sheet

**ไฟล์อ้างอิง:** `app/(tabs)/events.tsx` (FaceDetailModal, EventDetailModal), `app/(tabs)/map.tsx` (CameraMapSheet)

```tsx
import { Modal, Pressable, SafeAreaView, ScrollView, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, TYPE } from '../src/theme';

function ExampleModal({ item, visible, onClose }: {
  item: Item | null; visible: boolean; onClose: () => void;
}) {
  const theme = useTheme();
  if (!item) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.safe, { backgroundColor: theme.background }]}>
        <View style={[s.header, { borderBottomColor: theme.border }]}>
          <Text style={[TYPE.title, { color: theme.textPrimary, flex: 1 }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={theme.textSecondary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {/* content */}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// Render in screen:
// <ExampleModal
//   key={selected?.id ?? 'none'}    ← สำคัญ! reset internal state per item
//   item={selected}
//   visible={selected !== null}
//   onClose={() => setSelected(null)}
// />
```

**Conventions:**
- `key={item?.id ?? 'none'}` บน modal เพื่อ **reset state ทุกครั้งที่เปิด item ใหม่** (เช่น `saveResult`, `showVideo`)
- `presentationStyle="pageSheet"` (iOS modal style)
- `onRequestClose` รองรับปุ่ม back บน Android
- `if (!item) return null` หลัง hooks เพื่อหลีกเลี่ยง "rendered fewer hooks" — แต่ต้องอยู่หลัง useState ทั้งหมด

---

## 6. Theme + Responsive

**ไฟล์อ้างอิง:** `src/theme/index.ts`

```tsx
const theme   = useTheme();           // tokens (color)
const cols    = useGridColumns();     // 2 (phone) / 3 / 4 (tablet)
const { width } = useWindowDimensions();  // reactive width (ใช้สำหรับ cellWidth)

// ใช้ token ทุกที่ ห้าม hardcode hex
<View style={[s.box, { backgroundColor: theme.surface, borderColor: theme.border }]}>
  <Text style={[TYPE.body, { color: theme.textPrimary }]}>Hello</Text>
</View>
```

**Conventions:**
- `useTheme()` คืน object: `background, surface, surfaceElevated, textPrimary, textSecondary, border, accent, statusOk, statusBad, statusWarn`
- `TYPE`: `titleLg`, `title`, `body`, `bodySm`, `label` (อย่าใช้ font size อื่น)
- responsive: `useGridColumns()` for grid, `useWindowDimensions()` for calculation (เปลี่ยนตอน rotation)
- ห้ามใช้ `useColorScheme` ตรงๆ — `useTheme` ตัดสินใจให้แล้ว (auto/light/dark)

---

## 7. WebSocket (singleton)

**ไฟล์อ้างอิง:** `src/store/wsStore.ts`

```typescript
let _socket: WebSocket | null = null;
let _token:  string | null    = null;

export const useWsStore = create<WsState>((set) => {
  function open(token: string) {
    if (_socket?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    _socket = ws;
    ws.onopen    = () => set({ status: 'connected' });
    ws.onmessage = (e) => { /* parse + update state */ };
    ws.onclose   = () => {
      _socket = null;
      // exponential backoff reconnect
    };
  }
  return {
    status: 'disconnected',
    connect:    (token) => { _token = token; open(token); },
    disconnect: () => { _token = null; _socket?.close(); _socket = null; },
  };
});
```

**Conventions:**
- WS singleton อยู่นอก React tree (module-level)
- auth: `?token=<bearer>` ใน URL (RN ไม่รองรับ custom header ใน upgrade)
- AppState: ปิดเมื่อ background, เปิดใหม่เมื่อ active
- Backoff: 1s → 2s → 4s → 8s → 16s → 30s
- เรียก `connect/disconnect` จาก `app/_layout.tsx` ตาม auth state

---

## 8. SVG Chart (multi-series + tooltip)

**ไฟล์อ้างอิง:** `src/components/MultiLineChart.tsx`

```tsx
import Svg, { Polyline, Line, Circle, Text as SvgText } from 'react-native-svg';

// 1. Union x-axis — ห้าม index-only (series ไม่ align กัน)
const axis = [...new Set(series.flatMap(s => s.points.map(p => p.bucket)))].sort();
const max  = niceMax(Math.max(1, ...visible.flatMap(s => s.points.map(p => p.count))));

// 2. xAt/yAt helpers
const xAt = (i: number) => PAD + (i / (axis.length - 1)) * INNER_W;
const yAt = (v: number) => PAD + INNER_H - (v / max) * INNER_H;

// 3. 0-fill gaps per series
const m = new Map(s.points.map(p => [p.bucket, p.count]));
const ys = axis.map(b => m.get(b) ?? 0);
const pts = axis.map((_, i) => `${xAt(i)},${yAt(ys[i])}`).join(' ');
<Polyline points={pts} stroke={s.category.color} strokeWidth={2} fill="none" />

// 4. Tap to inspect — onStartShouldSetResponder + onResponderMove
<View onStartShouldSetResponder={() => true} onResponderMove={onTouch}>
  <Svg>...</Svg>
  {activeIdx && <TooltipOverlay ... />}
</View>
```

**Conventions:**
- Union axis + 0-fill: **บังคับ** เพราะแต่ละ series มี bucket ต่างกัน
- `niceMax`: round ขึ้นเป็น 5/10/20/50/100/... ให้แกน Y สวย
- Touch → nearest index → tooltip ที่อยู่ด้านตรงข้ามนิ้ว (กัน finger occlusion)

---

## 9. WebView ↔ RN (Map)

**ไฟล์อ้างอิง:** `app/(tabs)/map.tsx`

```tsx
const html = buildHtml(markers, theme);
// HTML inside:
//   el.addEventListener('click', function() {
//     window.ReactNativeWebView.postMessage('TAP:' + JSON.stringify(m));
//   });

<WebView
  source={{ html }}
  onMessage={(e) => {
    const raw = e.nativeEvent.data;
    if (raw.startsWith('TAP:')) setSelected(JSON.parse(raw.slice(4)));
  }}
  javaScriptEnabled
  domStorageEnabled
/>
```

**Conventions:**
- ใช้ `postMessage` prefix (เช่น `TAP:`, `LOG:`) แยก channel
- snapshot ที่ต้องการ Bearer header ทำใน RN native sheet (ไม่ใช่ใน WebView — ส่ง custom header ใน `<img>` ไม่ได้)

---

## 10. Save Image (cross-platform helper)

**ไฟล์อ้างอิง:** `app/(tabs)/events.tsx` `saveImageToLibrary()`

```typescript
import * as MediaLibrary from 'expo-media-library';
import { Paths, File as FSFile } from 'expo-file-system';

async function saveImageToLibrary(uri: string, token: string, filename: string): Promise<boolean> {
  const perm = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
  if (perm.status !== 'granted') return false;

  const ext  = filename.split('.').pop() ?? 'jpg';
  const dest = new FSFile(Paths.cache, `vigil_save_${Date.now()}.${ext}`);
  await FSFile.downloadFileAsync(uri, dest, { headers: { Authorization: `Bearer ${token}` } });

  try {
    // dev/prod build: album "Vigil Image"
    const asset = await MediaLibrary.createAssetAsync(dest.uri);
    const album = await MediaLibrary.getAlbumAsync('Vigil Image');
    if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    else       await MediaLibrary.createAlbumAsync('Vigil Image', asset, false);
  } catch {
    await MediaLibrary.saveToLibraryAsync(dest.uri);   // Expo Go fallback
  } finally {
    dest.delete();
  }
  return true;
}
```

**Conventions:**
- expo-file-system **v19+ OOP API** (`new FSFile`, `Paths.cache`) — ไม่ใช่ `cacheDirectory` ของ v18 เก่า
- permission `['photo']` (เลี่ยง AUDIO error)
- album ops → fallback `saveToLibraryAsync` (Expo Go Android block)

---

## 11. Push Notification Guard

**ไฟล์อ้างอิง:** `src/lib/push.ts`

```typescript
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

// SDK 53+ ถอด remote push ออกจาก Expo Go — เรียก native API จะ throw
export const IS_EXPO_GO =
  Constants.appOwnership === 'expo' ||
  Constants.executionEnvironment === 'storeClient';

// Guard ทุกฟังก์ชัน:
if (!IS_EXPO_GO) {
  Notifications.setNotificationHandler({ /* ... */ });
}

export async function registerForPush() {
  if (IS_EXPO_GO) return { ok: false, reason: 'no_project', message: '...' };
  // ... continue with native API
}
```

**Conventions:**
- ทุก expo-notifications call ต้องอยู่หลัง `IS_EXPO_GO` guard
- module-level `setNotificationHandler` ก็ต้อง guard (throw ตอน import)
- `_layout.tsx` listener: `if (IS_EXPO_GO) return;` ใน useEffect

---

## 12. Working Agreement (project-wide)

อ่าน `CLAUDE.md` ส่วน Working Agreement:
1. **Investigate-first** — Fact / Opinion แยกชัด, รอ green light
2. **UI-first** — token + safe-area + ไม่มี emoji เป็น UI
3. **Reproduce-before-fix** (bug only) — verify บน device ก่อนเสร็จ
4. **No Co-Authored-By Claude** ใน commits

---

## Pattern Lookup (สำหรับ session ใหม่)

| ทำอะไร | อ่านไฟล์ไหน |
|---|---|
| สร้าง store ใหม่ | `authStore.ts` หรือ `themeStore.ts` |
| สร้าง hook ดึงข้อมูล | `useEvents.ts` หรือ `useStats.ts` |
| สร้าง screen ใหม่ | `(tabs)/events.tsx` (เต็มที่สุด) |
| สร้าง modal | `events.tsx` `FaceDetailModal` หรือ `EventDetailModal` |
| สร้าง bottom sheet | `map.tsx` `CameraMapSheet` |
| chart/graph | `MultiLineChart.tsx` |
| WebView/map | `map.tsx` |
| save image | `events.tsx` `saveImageToLibrary` |
| Push noti | `lib/push.ts` |
| backend hook (alert/face) | `vigil-platform/src/alert-engine.js` + `push-sender.js` |

---

<sub>Updated 2026-05-31 · ดู `CLAUDE.md` `ROADMAP.md` `GOTCHAS.md` ประกอบ</sub>
