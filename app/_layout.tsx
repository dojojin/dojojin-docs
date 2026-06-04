// ============================================================
// Vigil Mobile — Root Layout
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../src/store/authStore';
import { useWsStore } from '../src/store/wsStore';
import { useThemeStore } from '../src/store/themeStore';
import { useLanguageStore } from '../src/store/languageStore';
import { useI18n } from '../src/i18n/useI18n';
import { registerForPush, IS_EXPO_GO } from '../src/lib/push';
import { STORAGE_KEYS } from '../src/constants';

// แตะ notification → ไปหน้าที่เกี่ยวข้อง (event/face → Events tab)
function routeFromNotification(router: ReturnType<typeof useRouter>, data: any) {
  if (!data) return;
  if (data.type === 'face')  router.push('/(tabs)/events');
  else if (data.type === 'event') router.push('/(tabs)/events');
}

// ── Biometric lock screen overlay ───────────────────────────
function LockScreen({ onUnlock, onLogout }: { onUnlock: () => void; onLogout: () => void }) {
  const t = useI18n();
  return (
    <View style={ls.overlay}>
      <Ionicons name="lock-closed" size={48} color="#fff" style={{ opacity: 0.8 }} />
      <Text style={ls.title}>{t('lock.title')}</Text>
      <Text style={ls.sub}>{t('lock.sub')}</Text>
      <Pressable style={ls.btn} onPress={onUnlock}>
        <Ionicons name="lock-open-outline" size={22} color="#fff" />
        <Text style={ls.btnText}>{t('lock.unlock')}</Text>
      </Pressable>
      <Pressable onPress={onLogout} hitSlop={12}>
        <Text style={ls.logoutText}>{t('lock.logout')}</Text>
      </Pressable>
    </View>
  );
}

const ls = StyleSheet.create({
  overlay:    { ...StyleSheet.absoluteFillObject, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', gap: 12, zIndex: 999 },
  title:      { fontSize: 22, fontWeight: '700', color: '#fff', marginTop: 8 },
  sub:        { fontSize: 14, color: 'rgba(255,255,255,0.55)', marginBottom: 8 },
  btn:        { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
  btnText:    { fontSize: 16, fontWeight: '600', color: '#fff' },
  logoutText: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 16 },
});

// ────────────────────────────────────────────────────────────

export default function RootLayout() {
  const { user, isReady, hydrate, token, logout } = useAuthStore();
  const { connect: wsConnect, disconnect: wsDisconnect } = useWsStore();
  const router  = useRouter();

  // ── Biometric gate ───────────────────────────────────────
  const [isLocked, setIsLocked] = useState(false);
  const prevAppState   = useRef(AppState.currentState);
  const isPromptingRef = useRef(false);
  const isLockedRef    = useRef(false);  // sync ref ป้องกัน stale closure ใน callbacks

  useEffect(() => { isLockedRef.current = isLocked; }, [isLocked]);

  const promptBiometric = useCallback(async () => {
    if (isPromptingRef.current) return;
    isPromptingRef.current = true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Vigil',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (result.success) {
        isLockedRef.current = false;
        setIsLocked(false);
      }
    } catch {
      isLockedRef.current = false;
      setIsLocked(false);
    } finally {
      isPromptingRef.current = false;
    }
  }, []);

  // checkAndLock: ไม่ทำอะไรถ้า prompting อยู่แล้ว หรือ locked อยู่แล้ว
  // → AppState events ทุกตัวที่มาขณะ locked จะถูก skip ทั้งหมด
  const checkAndLock = useCallback(async () => {
    if (isPromptingRef.current || isLockedRef.current) return;
    const pref = await SecureStore.getItemAsync(STORAGE_KEYS.BIOMETRIC_PREF);
    if (pref === '1') {
      isLockedRef.current = true;
      setIsLocked(true);
      promptBiometric();
    }
  }, [promptBiometric]);

  // Cold start: isReady เพิ่งกลายเป็น true พร้อม user → session คืนจาก SecureStore
  // login() ไม่ trigger effect นี้เพราะ isReady ไม่เปลี่ยนระหว่าง login
  useEffect(() => {
    if (isReady && user) checkAndLock();
  }, [isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Background → Active: lock เมื่อ user backgrounded จริงๆ
  // เช็ค 'background' specifically — ไม่นับ 'inactive' ที่เกิดจาก
  // biometric UI / share sheet / control center (จะ trigger loop)
  useEffect(() => {
    if (!user) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (prevAppState.current === 'background' && next === 'active') {
        checkAndLock();
      }
      prevAppState.current = next;
    });
    return () => sub.remove();
  }, [user, checkAndLock]);

  const handleBioLogout = useCallback(() => {
    Alert.alert('ออกจากระบบ', 'ต้องการออกจากระบบใช่ไหม?', [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'ออกจากระบบ', style: 'destructive', onPress: async () => { setIsLocked(false); await logout(); } },
    ]);
  }, [logout]);

  // ── Hydrate token + theme mode จาก SecureStore ตอน app start
  useEffect(() => { hydrate(); useThemeStore.getState().hydrate(); useLanguageStore.getState().hydrate(); }, []);

  // WS lifecycle — เชื่อมเมื่อ login, ตัดเมื่อ logout
  useEffect(() => {
    if (token) wsConnect(token);
    else wsDisconnect();
  }, [token]);

  // Push: register หลัง login (ถ้าผู้ใช้เคยเปิดไว้) + tap listener
  useEffect(() => {
    if (!token) return;
    (async () => {
      const pref = await SecureStore.getItemAsync(STORAGE_KEYS.NOTIF_PREF);
      if (pref !== '0') registerForPush();   // default เปิด (เงียบถ้า Expo Go/ไม่มี projectId)
    })();
  }, [token]);

  // Notification tap → navigate (ทั้งตอนแอปเปิดและ cold-start)
  // skip ใน Expo Go — expo-notifications native API throw (SDK 53+)
  useEffect(() => {
    if (IS_EXPO_GO) return;
    const sub = Notifications.addNotificationResponseReceivedListener(resp => {
      routeFromNotification(router, resp.notification.request.content.data);
    });
    Notifications.getLastNotificationResponseAsync().then(resp => {
      if (resp) routeFromNotification(router, resp.notification.request.content.data);
    });
    return () => sub.remove();
  }, [router]);

  // Auth gate — redirect ตาม login/logout transition เท่านั้น
  // depend แค่ [user, isReady] ไม่ใช่ segments → (1) แก้ Android segments
  // unreliable (เดิม GOTCHA #1) (2) ไม่เด้ง route ภายในที่ valid เช่น /settings
  // ออก เพราะ effect ไม่ re-run ตอน navigate ในเมื่อ user ไม่เปลี่ยน
  useEffect(() => {
    if (!isReady) return;
    if (user) router.replace('/(tabs)');
    else      router.replace('/(auth)/login');
  }, [user, isReady]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings"    options={{ headerShown: true, presentation: 'modal' }} />
        <Stack.Screen name="camera/[id]" options={{ presentation: 'modal' }} />
      </Stack>
      {isLocked && <LockScreen onUnlock={promptBiometric} onLogout={handleBioLogout} />}
    </GestureHandlerRootView>
  );
}
