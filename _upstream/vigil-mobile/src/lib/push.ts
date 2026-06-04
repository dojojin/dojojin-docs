// ============================================================
// Vigil Mobile — Push Notification helper
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// Remote push ต้อง development build + EAS projectId — ใน Expo Go
// getExpoPushTokenAsync จะ throw (SDK 53+ ถอด remote push ออก).
// ทุกฟังก์ชัน handle error → คืน null/false ไม่ crash.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import client from '../api/client';
import { STORAGE_KEYS } from '../constants';

// Expo Go (SDK 53+) ถอด remote push ออก — เรียก native API จะ throw error overlay.
// guard ทุกฟังก์ชันด้วยตัวนี้ → ใช้ได้เฉพาะ dev/prod build
export const IS_EXPO_GO =
  Constants.appOwnership === 'expo' ||
  Constants.executionEnvironment === 'storeClient';

// Foreground handler — set เฉพาะนอก Expo Go
if (!IS_EXPO_GO) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList:   true,
      shouldPlaySound:  true,
      shouldSetBadge:   true,
    }),
  });
}

// Android: ต้องสร้าง channel 'alerts' (ตรงกับ channelId ที่ backend ส่ง)
export async function setupAndroidChannel() {
  if (IS_EXPO_GO || Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('alerts', {
      name: 'การแจ้งเตือนเหตุการณ์',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#29B6F6',
    });
  } catch { /* noop */ }
}

function getProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId ??
    undefined
  );
}

export type RegisterResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'permission' | 'no_device' | 'no_project' | 'error'; message?: string };

// ขอ permission → token → POST /api/push/register
export async function registerForPush(): Promise<RegisterResult> {
  // Expo Go → remote push ไม่รองรับ ตัดก่อนเรียก native API ใดๆ
  if (IS_EXPO_GO) return { ok: false, reason: 'no_project', message: 'ใช้ได้เฉพาะ production build (ไม่รองรับใน Expo Go)' };
  if (!Device.isDevice) return { ok: false, reason: 'no_device' };

  await setupAndroidChannel();

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') return { ok: false, reason: 'permission' };

  const projectId = getProjectId();
  if (!projectId) return { ok: false, reason: 'no_project', message: 'ต้อง development build (ไม่มี EAS projectId)' };

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await SecureStore.setItemAsync(STORAGE_KEYS.PUSH_TOKEN, token);
    // sub-preferences (กรองฝั่ง server เพราะ push มาแม้ปิดแอป)
    const notifyAlert = (await SecureStore.getItemAsync(STORAGE_KEYS.NOTIF_ALERT)) !== '0';
    const notifyFace  = (await SecureStore.getItemAsync(STORAGE_KEYS.NOTIF_FACE))  !== '0';
    await client.post('/api/push/register', {
      token, platform: Platform.OS, notify_alert: notifyAlert, notify_face: notifyFace,
    });
    return { ok: true, token };
  } catch (e: any) {
    return { ok: false, reason: 'error', message: e?.message };
  }
}

// ปิด push (toggle off / logout)
export async function unregisterPush(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(STORAGE_KEYS.PUSH_TOKEN);
    if (token) await client.post('/api/push/unregister', { token });
  } catch { /* best-effort */ }
}
