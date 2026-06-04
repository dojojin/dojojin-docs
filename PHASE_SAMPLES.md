# Vigil Mobile — Phase Implementation Samples

> Starter code ของทุก phase ใน ROADMAP.md
> ใช้คู่กับ `PATTERNS.md` (pattern หลัก) + `CLAUDE.md` (constraints)
> Updated 2026-05-31

---

## Phase 1A — GroupFilter pill clipping + count=0 fix

**ไฟล์:** `src/components/GroupFilter.tsx`, `app/(tabs)/index.tsx`

```tsx
// GroupFilter.tsx — แก้ pill clipped + รับ count จริงผ่าน prop
export function GroupFilter({ groups, totalCount, selected, onChange }: Props) {
  // ❌ เดิม: const allCount = groups.reduce((s, g) => s + g.camera_count, 0);  // 0 ถ้า groups ว่าง
  // ✅ ใหม่: รับ totalCount จากภายนอก (camera list จริง)
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      <Pill label={`ทั้งหมด (${totalCount})`} active={selected === undefined} onPress={() => onChange(undefined)} theme={theme} />
      {groups.map((g) => (
        <Pill key={g.id} label={`${g.name} (${g.camera_count})`} active={selected === g.id} onPress={() => onChange(g.id)} theme={theme} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row:  { paddingHorizontal: 16, paddingVertical: 12, gap: 8, flexDirection: 'row' },
  pill: {
    paddingHorizontal: 14,
    paddingVertical:   8,      // ← เพิ่มจาก 7 → 8
    minHeight:         34,     // ← เพิ่มเข้ามา กัน clip
    borderRadius:      20,
    borderWidth:       0.5,
    alignItems:        'center', justifyContent: 'center',
  },
});
```

```tsx
// index.tsx — ส่ง cameras.length เป็น totalCount
<GroupFilter
  groups={groups}
  totalCount={cameras.length}    // ← เพิ่ม
  selected={selectedGroup}
  onChange={setSelectedGroup}
/>
```

---

## Phase 1B — Pull-to-refresh Stats + Map

**Stats** (`app/(tabs)/stats.tsx`) — มี `refreshControl` แล้ว ตรวจว่าครอบทุก state

```tsx
<ScrollView
  refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={theme.accent} />}
>
```

**Map** (`app/(tabs)/map.tsx`) — WebView ไม่มี pull-to-refresh native ต้องเพิ่ม ScrollView wrap หรือใช้ปุ่ม refresh มุมขวาบน

```tsx
// ทางเลือก A: ปุ่ม refresh ลอย (แนะนำ — WebView pull-to-refresh ยุ่ง)
<View style={styles.fab}>
  <Pressable
    onPress={refresh}
    style={[styles.fabBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
  >
    <Ionicons name="refresh" size={20} color={theme.textPrimary} />
  </Pressable>
</View>

const styles = StyleSheet.create({
  fab:    { position: 'absolute', top: 16, right: 16 },
  fabBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center', elevation: 4 },
});
```

---

## Phase 1C — Biometric login

**Install:** `npx expo install expo-local-authentication`

**Store** (`src/store/authStore.ts`) — เพิ่ม biometric pref

```typescript
// constants
PUSH_TOKEN:  'vigil_push_token',
NOTIF_PREF:  'vigil_notif_enabled',
BIOMETRIC:   'vigil_biometric_enabled',   // ← เพิ่ม
```

**Lib** (`src/lib/biometric.ts` — สร้างใหม่)

```typescript
import * as LocalAuth from 'expo-local-authentication';

export async function isBiometricAvailable(): Promise<boolean> {
  const supported = await LocalAuth.hasHardwareAsync();
  const enrolled  = await LocalAuth.isEnrolledAsync();
  return supported && enrolled;
}

export async function promptBiometric(reason = 'ปลดล็อก Vigil'): Promise<boolean> {
  const r = await LocalAuth.authenticateAsync({
    promptMessage:      reason,
    fallbackLabel:      'ใช้รหัสผ่าน',
    disableDeviceFallback: false,
  });
  return r.success;
}
```

**Settings UI** — เพิ่ม section

```tsx
const [bioEnabled, setBioEnabled] = useState(false);
const [bioAvailable, setBioAvailable] = useState(false);

useEffect(() => {
  isBiometricAvailable().then(setBioAvailable);
  SecureStore.getItemAsync(STORAGE_KEYS.BIOMETRIC).then(v => setBioEnabled(v === '1'));
}, []);

const toggleBio = async (v: boolean) => {
  if (v) {
    const ok = await promptBiometric('ยืนยันตัวตนเพื่อเปิดใช้งาน');
    if (!ok) return;
  }
  setBioEnabled(v);
  await SecureStore.setItemAsync(STORAGE_KEYS.BIOMETRIC, v ? '1' : '0');
};

// JSX
{bioAvailable && (
  <Row icon="finger-print-outline" label="ปลดล็อกด้วย Face ID / ลายนิ้วมือ" theme={theme}>
    <Switch value={bioEnabled} onValueChange={toggleBio} ... />
  </Row>
)}
```

**Auth gate** (`app/_layout.tsx`) — prompt ตอน foreground เข้ามาใหม่

```tsx
import { AppState } from 'react-native';

useEffect(() => {
  if (!user) return;
  const sub = AppState.addEventListener('change', async (next) => {
    if (next === 'active' && _wasBackground) {
      const enabled = await SecureStore.getItemAsync(STORAGE_KEYS.BIOMETRIC);
      if (enabled === '1') {
        const ok = await promptBiometric();
        if (!ok) await logout();
      }
    }
    _wasBackground = next.match(/inactive|background/);
  });
  return () => sub.remove();
}, [user]);
```

---

## Phase 2A — Custom Server URL

**Constants** — `API_BASE_URL` กลายเป็น initial default

```typescript
export const DEFAULT_API_URL = 'https://dashboard.dojojin.tech';
// (เก่า) export const API_BASE_URL = 'https://...';   ลบ
```

**Store** (`src/store/serverStore.ts` — สร้างใหม่)

```typescript
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_API_URL, STORAGE_KEYS } from '../constants';

interface ServerState {
  baseUrl:  string;
  isReady:  boolean;
  hydrate:  () => Promise<void>;
  setUrl:   (u: string) => Promise<void>;
}

export const useServerStore = create<ServerState>((set) => ({
  baseUrl: DEFAULT_API_URL,
  isReady: false,
  hydrate: async () => {
    const saved = await SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL);
    if (saved) set({ baseUrl: saved });
    set({ isReady: true });
  },
  setUrl: async (u) => {
    const clean = u.replace(/\/+$/, '');   // strip trailing slash
    await SecureStore.setItemAsync(STORAGE_KEYS.SERVER_URL, clean);
    set({ baseUrl: clean });
  },
}));
```

**API client** — axios `baseURL` อ่านจาก store (interceptor):

```typescript
client.interceptors.request.use(async (config) => {
  config.baseURL = useServerStore.getState().baseUrl;
  const token = await SecureStore.getItemAsync(STORAGE_KEYS.AUTH_TOKEN);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

**Server setup screen** (`app/(auth)/server-setup.tsx` — สร้างใหม่)

```tsx
export default function ServerSetupScreen() {
  const theme = useTheme();
  const [url, setUrl] = useState('https://');
  const [testing, setTesting] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const validate = async () => {
    setTesting(true); setError(null);
    try {
      const r = await fetch(`${url.replace(/\/+$/, '')}/api/auth/me`);
      if (r.status === 401 || r.ok) {   // 401 = endpoint มีจริง, แค่ไม่มี token
        await useServerStore.getState().setUrl(url);
        router.back();
      } else throw new Error('Server ไม่ตอบสนอง');
    } catch (e: any) {
      setError(e.message);
    } finally { setTesting(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background, padding: 16 }}>
      <Text style={[TYPE.title, { color: theme.textPrimary }]}>ตั้งค่า Server</Text>
      <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" ... />
      {error && <Text style={{ color: theme.statusBad }}>{error}</Text>}
      <Pressable onPress={validate} disabled={testing} style={{ backgroundColor: theme.accent }}>
        <Text>{testing ? 'กำลังทดสอบ…' : 'บันทึก'}</Text>
      </Pressable>
    </SafeAreaView>
  );
}
```

**Login screen** — ปุ่ม ⚙️ มุมขวาบน

```tsx
<Pressable onPress={() => router.push('/(auth)/server-setup')} style={{ position: 'absolute', top: 50, right: 20 }}>
  <Ionicons name="settings-outline" size={22} color={theme.textSecondary} />
</Pressable>
```

---

## Phase 2B — Camera scale 100-3,000 ตัว

**Hook** (`src/hooks/useCameras.ts`) — เพิ่ม `searchQuery` + `statusFilter`

```typescript
export function useCameras(opts: { search?: string; statusFilter?: 'all' | 'online' | 'offline' | 'alert' } = {}) {
  // ... existing fetch logic
  const filtered = useMemo(() => {
    let list = cameras;
    if (opts.search) {
      const q = opts.search.toLowerCase();
      list = list.filter(c =>
        c.camera_name.toLowerCase().includes(q) ||
        c.camera_id.toLowerCase().includes(q) ||
        (c.location ?? '').toLowerCase().includes(q),
      );
    }
    if (opts.statusFilter === 'online')  list = list.filter(isOnline);
    if (opts.statusFilter === 'offline') list = list.filter(c => !isOnline(c));
    if (opts.statusFilter === 'alert')   list = list.filter(c => (c.alert_count_today ?? 0) > 0);
    // Sort: alert > offline > online
    return [...list].sort((a, b) => {
      const sa = (a.alert_count_today ?? 0) > 0 ? 0 : isOnline(a) ? 2 : 1;
      const sb = (b.alert_count_today ?? 0) > 0 ? 0 : isOnline(b) ? 2 : 1;
      return sa - sb;
    });
  }, [cameras, opts.search, opts.statusFilter]);
  return { ...rest, cameras: filtered };
}
```

**Search bar component** (`src/components/CameraSearchBar.tsx`)

```tsx
export function CameraSearchBar({ value, onChange }: Props) {
  const theme = useTheme();
  return (
    <View style={[s.wrap, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
      <Ionicons name="search-outline" size={16} color={theme.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="ค้นหากล้อง, ตำแหน่ง…"
        placeholderTextColor={theme.textSecondary}
        style={[s.input, { color: theme.textPrimary }]}
        autoCorrect={false} autoCapitalize="none"
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChange('')}>
          <Ionicons name="close-circle" size={16} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}
```

**Status filter chips** (`src/components/StatusFilterChips.tsx`)

```tsx
const CHIPS = [
  { key: 'all',     label: 'ทั้งหมด', icon: 'apps-outline' },
  { key: 'alert',   label: 'Alert',   icon: 'alert-circle-outline', color: 'statusWarn' },
  { key: 'offline', label: 'Offline', icon: 'cloud-offline-outline', color: 'statusBad' },
  { key: 'online',  label: 'Online',  icon: 'checkmark-circle-outline', color: 'statusOk' },
] as const;

export function StatusFilterChips({ active, onChange }: Props) {
  // map cols → counts (จาก hook)
  // render pill row พร้อม count
}
```

**FlatList tuning** สำหรับ 3,000 รายการ

```tsx
<FlatList
  data={cameras}
  windowSize={5}                        // ← ลดจาก default 21 → 5
  initialNumToRender={10}
  maxToRenderPerBatch={10}
  removeClippedSubviews                 // Android optimization
  getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
  // ... rest
/>
```

**CameraCard** — lazy snapshot (โหลดเมื่อ visible เท่านั้น)

```tsx
// ใน CameraCard:
const [shouldLoad, setShouldLoad] = useState(false);
useEffect(() => {
  // ใช้ ViewabilityTracker หรือ delay ตาม scroll position
  const t = setTimeout(() => setShouldLoad(true), 200);
  return () => clearTimeout(t);
}, []);

{shouldLoad && online && snapshotUri && token && (
  <Image source={{ uri: snapshotUri, headers: { Authorization: `Bearer ${token}` } }} ... />
)}
```

---

## Phase 3 — Camera Detail screen

**Route** (`app/camera/[id].tsx` — สร้างใหม่)

```tsx
import { useLocalSearchParams, Stack, router } from 'expo-router';

export default function CameraDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme  = useTheme();
  const [camera, setCamera] = useState<Camera | null>(null);
  const { events } = useEvents({ camera: id, limit: 20 });

  useEffect(() => {
    cameraApi.list().then(list => setCamera(list.find(c => c.camera_id === id) ?? null));
  }, [id]);

  if (!camera) return <ActivityIndicator />;

  return (
    <>
      <Stack.Screen options={{ title: camera.camera_name, presentation: 'modal' }} />
      <ScrollView style={{ backgroundColor: theme.background }}>
        {/* Live snapshot */}
        <View style={{ aspectRatio: 16/9 }}>
          <LiveSnapshot cameraId={id} online={camera.status === 'online'} />
        </View>

        {/* Quick stats */}
        <View style={s.statsRow}>
          <Stat label="วันนี้" value={camera.alert_count_today ?? 0} />
          <Stat label="Status" value={camera.status} />
          <Stat label="Last seen" value={getRelativeTime(camera.last_seen)} />
        </View>

        {/* Action row */}
        <View style={s.actions}>
          <ActionBtn icon="expand-outline" label="ดูภาพเต็ม" onPress={openFullscreen} />
          <ActionBtn icon="map-outline" label="ดูบนแผนที่" onPress={openOnMap} />
        </View>

        {/* Activity timeline */}
        <Text style={s.sectionLabel}>กิจกรรมล่าสุด</Text>
        {events.map(e => <EventListRow key={e.id} event={e} token={token} onPress={...} />)}

        {/* Camera info */}
        <Text style={s.sectionLabel}>ข้อมูลกล้อง</Text>
        <MetaCard label="IP"     value={camera.ip_address} />
        <MetaCard label="Vendor" value={camera.vendor ?? '—'} />
      </ScrollView>
    </>
  );
}
```

**LiveSnapshot component** — auto-refresh ทุก 5 วินาที

```tsx
function LiveSnapshot({ cameraId, online }: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!online) return;
    const t = setInterval(() => setTick(x => x + 1), 5000);
    return () => clearInterval(t);
  }, [online]);
  const uri = `${API_BASE_URL}/api/snapshot/live/${cameraId}?t=${tick}`;
  return <Image source={{ uri, headers: { Authorization: `Bearer ${token}` } }} cachePolicy="none" />;
}
```

**Tap Camera card → push route**

```tsx
// (tabs)/index.tsx
const handleCameraPress = useCallback((camera: Camera) => {
  router.push(`/camera/${camera.camera_id}`);
}, []);
```

---

## Phase 4 — i18n th/en

**Install:** `npx expo install expo-localization`

**Lib** (`src/i18n/index.ts` — สร้างใหม่)

```typescript
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as Localization from 'expo-localization';
import { th } from './th';
import { en } from './en';

const dicts = { th, en };
type Lang = 'auto' | 'th' | 'en';

export const useI18n = create<{
  lang: Lang;
  t: (key: keyof typeof th) => string;
  setLang: (l: Lang) => void;
  hydrate: () => Promise<void>;
}>((set, get) => ({
  lang: 'auto',
  t: (key) => {
    const eff = get().lang === 'auto' ? (Localization.locale.startsWith('th') ? 'th' : 'en') : get().lang;
    return (dicts[eff] as any)[key] ?? key;
  },
  setLang: (l) => { set({ lang: l }); SecureStore.setItemAsync('vigil_lang', l).catch(()=>{}); },
  hydrate: async () => {
    const v = await SecureStore.getItemAsync('vigil_lang');
    if (v === 'th' || v === 'en' || v === 'auto') set({ lang: v });
  },
}));
```

**Dictionaries** (`src/i18n/{th,en}.ts`)

```typescript
// th.ts
export const th = {
  'tab.camera': 'กล้อง',
  'tab.events': 'เหตุการณ์',
  'tab.map':    'แผนที่',
  'tab.stats':  'สถิติ',
  'tab.alerts': 'แจ้งเตือน',
  'camera.kpi.total':   'ทั้งหมด',
  'camera.kpi.online':  'Online',
  'camera.kpi.offline': 'Offline',
  'camera.kpi.alert':   'Alert',
  // ... รวบ string จากทุก screen
} as const;

// en.ts — same keys, English values
```

**ใช้ใน component**

```tsx
const t = useI18n(s => s.t);
<Text>{t('camera.kpi.total')}</Text>
```

**Settings UI** — language selector (เพิ่ม)

```tsx
const { lang, setLang } = useI18n();
// 3-way: auto / ไทย / English (pattern เดียวกับ theme selector)
```

---

## Phase 5 — Tablet split-view

**Detection** — ใช้ `useGridColumns` หรือ width breakpoint

```typescript
import { useWindowDimensions } from 'react-native';

export function useIsTablet() {
  const { width } = useWindowDimensions();
  return width >= 768;
}
```

**Layout** — แบ่ง master/detail บน tablet

```tsx
// (tabs)/index.tsx
const isTablet = useIsTablet();

return (
  <View style={{ flex: 1, flexDirection: isTablet ? 'row' : 'column' }}>
    {/* Master — camera list */}
    <View style={{ flex: isTablet ? 1 : 0, maxWidth: isTablet ? 400 : undefined }}>
      <CameraList onSelect={setSelectedCam} />
    </View>

    {/* Detail — preview area (เฉพาะ tablet) */}
    {isTablet && (
      <View style={{ flex: 2, borderLeftWidth: 0.5, borderLeftColor: theme.border }}>
        {selectedCam
          ? <CameraDetailInline cameraId={selectedCam.camera_id} />
          : <EmptyDetail />
        }
      </View>
    )}
  </View>
);
```

**CameraDetailInline** = แยก Camera Detail logic (Phase 3) ออกเป็น reusable component ที่ใช้ได้ทั้ง modal และ inline

---

## Phase 6 — Polish (micro-interactions)

### 6A. Haptic feedback

**Install:** `npx expo install expo-haptics`

```typescript
import * as Haptics from 'expo-haptics';

// แตะ card / button
<Pressable onPress={() => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  onPress();
}}>

// success (save image, login)
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

// error
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
```

### 6B. Skeleton loaders

**Component** (`src/components/Skeleton.tsx`)

```tsx
import { Animated, useAnimatedValue } from 'react-native';

export function Skeleton({ width, height, style }: Props) {
  const theme = useTheme();
  const opacity = useAnimatedValue(0.3);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  return <Animated.View style={[{ width, height, backgroundColor: theme.surfaceElevated, borderRadius: 8, opacity }, style]} />;
}

// ใช้
{isLoading && cameras.length === 0
  ? <CameraGridSkeleton />
  : <FlatList data={cameras} ... />}
```

### 6C. Swipe to dismiss (Alerts)

**Install:** `npx expo install react-native-gesture-handler`

```tsx
import { Swipeable } from 'react-native-gesture-handler';

function AlertRow({ event, onDismiss }) {
  return (
    <Swipeable
      renderRightActions={() => (
        <View style={s.dismissAction}>
          <Ionicons name="close" size={20} color="#fff" />
          <Text style={{ color: '#fff' }}>ปิด</Text>
        </View>
      )}
      onSwipeableOpen={onDismiss}
    >
      {/* row content */}
    </Swipeable>
  );
}
```

### 6D. Tab transitions

```tsx
// (tabs)/_layout.tsx
<Tabs
  screenOptions={{
    animation: 'shift',          // ← เพิ่ม (Expo Router v6+)
    // หรือ 'fade' / 'flip'
  }}
>
```

### 6E. Tab labels Thai

```tsx
<Tabs.Screen name="index"  options={{ title: 'กล้อง', ... }} />
<Tabs.Screen name="events" options={{ title: 'เหตุการณ์', ... }} />
<Tabs.Screen name="map"    options={{ title: 'แผนที่', ... }} />
<Tabs.Screen name="stats"  options={{ title: 'สถิติ', ... }} />
<Tabs.Screen name="alerts" options={{ title: 'แจ้งเตือน', ... }} />
```

(หรือใช้ `t('tab.camera')` ถ้า Phase 4 เสร็จก่อน)

### 6F. App badge

```typescript
// ตอน push noti มา (ใน notification handler)
await Notifications.setBadgeCountAsync(count);

// ตอนเปิดแอป
await Notifications.setBadgeCountAsync(0);
```

---

## Pattern Lookup สำหรับ Opus Plan

| Phase | อ่าน sample | + pattern |
|---|---|---|
| 1A bug | ด้านบน | (no new pattern) |
| 1B refresh | ด้านบน | `PATTERNS.md` #4 Screen |
| 1C biometric | ด้านบน | `PATTERNS.md` #1 Store + ใหม่ `lib/biometric.ts` |
| 2A custom URL | ด้านบน | `PATTERNS.md` #1 Store + #3 API |
| 2B camera scale | ด้านบน | `PATTERNS.md` #2 Hook + #4 Screen |
| 3 Camera detail | ด้านบน | `PATTERNS.md` #4 Screen + #5 Modal |
| 4 i18n | ด้านบน | `PATTERNS.md` #1 Store (selector pattern) |
| 5 Tablet | ด้านบน | `useGridColumns` + reusable component split |
| 6 Polish | ด้านบน | per-item (haptic, skeleton, swipe) |

---

<sub>Updated 2026-05-31 · อ่านคู่ `PATTERNS.md` `ROADMAP.md` `CLAUDE.md` `GOTCHAS.md`</sub>
