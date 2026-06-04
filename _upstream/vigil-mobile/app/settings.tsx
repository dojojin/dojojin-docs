// ============================================================
// Vigil Mobile — Settings Screen
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../src/store/authStore';
import { useThemeStore, ThemeMode } from '../src/store/themeStore';
import { useLanguageStore, LangMode } from '../src/store/languageStore';
import { useI18n } from '../src/i18n/useI18n';
import { registerForPush, unregisterPush } from '../src/lib/push';
import { useTheme, TYPE } from '../src/theme';
import { STORAGE_KEYS } from '../src/constants';

const THEME_OPTS: { key: ThemeMode; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'auto',  label: 'อัตโนมัติ', icon: 'phone-portrait-outline' },
  { key: 'light', label: 'สว่าง',     icon: 'sunny-outline' },
  { key: 'dark',  label: 'มืด',       icon: 'moon-outline' },
];

const LANG_OPTS: { key: LangMode; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'auto', icon: 'globe-outline'  },
  { key: 'th',   icon: 'chatbubble-outline' },
  { key: 'en',   icon: 'language-outline'  },
];

export default function SettingsScreen() {
  const theme  = useTheme();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const { mode: themeMode, setMode: setThemeMode } = useThemeStore();
  const { mode: langMode, setMode: setLangMode }   = useLanguageStore();
  const t = useI18n();

  const [notifEnabled, setNotifEnabled] = useState(true);
  const [alertOn,      setAlertOn]      = useState(true);
  const [faceOn,       setFaceOn]       = useState(true);
  const [busy,         setBusy]         = useState(false);
  const [statusMsg,    setStatusMsg]    = useState<string | null>(null);

  // biometric
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled,   setBioEnabled]   = useState(false);
  const [bioLabel,     setBioLabel]     = useState('Face ID / ลายนิ้วมือ');

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEYS.NOTIF_PREF).then(v => setNotifEnabled(v !== '0'));
    SecureStore.getItemAsync(STORAGE_KEYS.NOTIF_ALERT).then(v => setAlertOn(v !== '0'));
    SecureStore.getItemAsync(STORAGE_KEYS.NOTIF_FACE).then(v => setFaceOn(v !== '0'));
    SecureStore.getItemAsync(STORAGE_KEYS.BIOMETRIC_PREF).then(v => setBioEnabled(v === '1'));

    // ตรวจว่า hardware + enrollment พร้อม
    (async () => {
      const has = await LocalAuthentication.hasHardwareAsync();
      const enrolled = has ? await LocalAuthentication.isEnrolledAsync() : false;
      setBioAvailable(has && enrolled);
      if (has) {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
        const hasFace  = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
        const hasPrint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
        setBioLabel(
          hasFace && hasPrint ? 'Face ID / ลายนิ้วมือ'
          : hasFace           ? 'Face ID'
          : hasPrint          ? 'ลายนิ้วมือ'
          :                     'Biometric'
        );
      }
    })();
  }, []);

  const toggleSub = async (kind: 'alert' | 'face', value: boolean) => {
    if (kind === 'alert') { setAlertOn(value); await SecureStore.setItemAsync(STORAGE_KEYS.NOTIF_ALERT, value ? '1' : '0'); }
    else                  { setFaceOn(value);  await SecureStore.setItemAsync(STORAGE_KEYS.NOTIF_FACE,  value ? '1' : '0'); }
    // ส่ง pref ไป backend (กรองฝั่ง server เพราะ push มาแม้ปิดแอป)
    registerForPush().catch(() => {});
  };

  const toggleNotif = async (value: boolean) => {
    setBusy(true);
    setStatusMsg(null);
    setNotifEnabled(value);
    await SecureStore.setItemAsync(STORAGE_KEYS.NOTIF_PREF, value ? '1' : '0');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (value) {
        const r = await registerForPush();
        if (!r.ok) {
          setNotifEnabled(false);
          await SecureStore.setItemAsync(STORAGE_KEYS.NOTIF_PREF, '0');
          setStatusMsg(
            r.reason === 'permission' ? t('settings.pushErrPerm')
            : r.reason === 'no_project' ? t('settings.pushErrBuild')
            : r.reason === 'no_device'  ? t('settings.pushErrDevice')
            : t('settings.pushErrGeneral')
          );
        } else {
          setStatusMsg(t('settings.pushStatusOk'));
        }
      } else {
        await unregisterPush();
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleBiometric = async (value: boolean) => {
    if (value) {
      // ต้องยืนยันตัวตนก่อนเปิด — ป้องกัน self-lockout
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'ยืนยันเพื่อเปิดใช้งาน',
        cancelLabel: 'ยกเลิก',
        disableDeviceFallback: false,
      });
      if (!result.success) return;
    }
    setBioEnabled(value);
    await SecureStore.setItemAsync(STORAGE_KEYS.BIOMETRIC_PREF, value ? '1' : '0');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleLogout = () => {
    Alert.alert(t('settings.logoutConfirmTitle'), t('settings.logoutConfirmMsg'), [
      { text: t('settings.logoutCancel'), style: 'cancel' },
      { text: t('settings.logoutConfirm'), style: 'destructive', onPress: async () => { await unregisterPush(); await logout(); } },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{
        title: 'ตั้งค่า',
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.textPrimary,
        headerShadowVisible: false,
      }} />
      <ScrollView style={[s.screen, { backgroundColor: theme.background }]} contentContainerStyle={s.content}>

        {/* Account */}
        <Text style={[s.sectionLabel, { color: theme.textSecondary }]}>{t('settings.account')}</Text>
        <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Row icon="person-outline" label={t('settings.user')} theme={theme}>
            <Text style={[TYPE.body, { color: theme.textPrimary }]}>{user?.username ?? '—'}</Text>
          </Row>
          <Divider theme={theme} />
          <Row icon="shield-checkmark-outline" label={t('settings.role')} theme={theme}>
            <Text style={[TYPE.body, { color: theme.textSecondary }]}>{user?.role ?? '—'}</Text>
          </Row>
        </View>

        {/* Notifications */}
        <Text style={[s.sectionLabel, { color: theme.textSecondary }]}>{t('settings.push')}</Text>
        <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Row icon="notifications-outline" label={t('settings.pushToggle')} theme={theme}>
            {busy
              ? <ActivityIndicator size="small" color={theme.accent} />
              : <Switch
                  value={notifEnabled}
                  onValueChange={toggleNotif}
                  trackColor={{ true: theme.accent, false: theme.border }}
                  thumbColor="#fff"
                />
            }
          </Row>
          {statusMsg && (
            <Text style={[TYPE.label, { color: theme.textSecondary, paddingHorizontal: 16, paddingBottom: 12 }]}>{statusMsg}</Text>
          )}

          {/* sub-toggles — เปิดเมื่อ push เปิด */}
          {notifEnabled && (
            <>
              <Divider theme={theme} />
              <Row icon="flash-outline" label={t('settings.pushAlerts')} theme={theme}>
                <Switch value={alertOn} onValueChange={v => toggleSub('alert', v)} trackColor={{ true: theme.accent, false: theme.border }} thumbColor="#fff" />
              </Row>
              <Divider theme={theme} />
              <Row icon="person-outline" label={t('settings.pushFaces')} theme={theme}>
                <Switch value={faceOn} onValueChange={v => toggleSub('face', v)} trackColor={{ true: theme.accent, false: theme.border }} thumbColor="#fff" />
              </Row>
            </>
          )}
        </View>
        <Text style={[TYPE.label, { color: theme.textSecondary, paddingHorizontal: 4 }]}>
          {t('settings.pushNote')}
        </Text>

        {/* Security */}
        <Text style={[s.sectionLabel, { color: theme.textSecondary }]}>{t('settings.security')}</Text>
        <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Row icon="finger-print-outline" label={t('settings.biometric', { label: bioLabel })} theme={theme}>
            {bioAvailable
              ? <Switch
                  value={bioEnabled}
                  onValueChange={toggleBiometric}
                  trackColor={{ true: theme.accent, false: theme.border }}
                  thumbColor="#fff"
                />
              : <Text style={[TYPE.bodySm, { color: theme.textSecondary }]}>{t('settings.bioUnavailable')}</Text>
            }
          </Row>
        </View>
        {!bioAvailable && (
          <Text style={[TYPE.label, { color: theme.textSecondary, paddingHorizontal: 4 }]}>
            {t('settings.bioSetupHint')}
          </Text>
        )}

        {/* Appearance */}
        <Text style={[s.sectionLabel, { color: theme.textSecondary }]}>{t('settings.appearance')}</Text>
        <View style={[s.themeRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {THEME_OPTS.map((opt, i) => {
            const active = themeMode === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setThemeMode(opt.key)}
                style={[s.themeCell, active && { backgroundColor: theme.accent + '20' }, i > 0 && { borderLeftWidth: 0.5, borderLeftColor: theme.border }]}
              >
                <Ionicons name={opt.icon} size={20} color={active ? theme.accent : theme.textSecondary} />
                <Text style={[TYPE.label, { color: active ? theme.accent : theme.textSecondary, marginTop: 4, fontWeight: active ? '600' : '400' }]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Language */}
        <Text style={[s.sectionLabel, { color: theme.textSecondary }]}>{t('settings.language')}</Text>
        <View style={[s.themeRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {LANG_OPTS.map((opt, i) => {
            const active = langMode === opt.key;
            const label  = t(`settings.lang${opt.key.charAt(0).toUpperCase() + opt.key.slice(1)}`);
            return (
              <Pressable
                key={opt.key}
                onPress={() => setLangMode(opt.key)}
                style={[s.themeCell, active && { backgroundColor: theme.accent + '20' }, i > 0 && { borderLeftWidth: 0.5, borderLeftColor: theme.border }]}
              >
                <Ionicons name={opt.icon} size={20} color={active ? theme.accent : theme.textSecondary} />
                <Text style={[TYPE.label, { color: active ? theme.accent : theme.textSecondary, marginTop: 4, fontWeight: active ? '600' : '400' }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Logout */}
        <Pressable
          style={[s.logoutBtn, { backgroundColor: theme.statusBad + '18', borderColor: theme.statusBad + '40' }]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={18} color={theme.statusBad} />
          <Text style={[TYPE.body, { color: theme.statusBad, fontWeight: '600', marginLeft: 8 }]}>{t('settings.logout')}</Text>
        </Pressable>

        <Text style={[TYPE.label, { color: theme.border, textAlign: 'center', marginTop: 8 }]}>{t('auth.version')}</Text>
      </ScrollView>
    </>
  );
}

function Row({ icon, label, theme, children }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  theme: ReturnType<typeof useTheme>;
  children: React.ReactNode;
}) {
  return (
    <View style={s.row}>
      <Ionicons name={icon} size={18} color={theme.textSecondary} />
      <Text style={[TYPE.body, { color: theme.textPrimary, flex: 1, marginLeft: 12 }]}>{label}</Text>
      {children}
    </View>
  );
}

function Divider({ theme }: { theme: ReturnType<typeof useTheme> }) {
  return <View style={[s.divider, { backgroundColor: theme.border }]} />;
}

const s = StyleSheet.create({
  screen:       { flex: 1 },
  content:      { padding: 16, gap: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 2, paddingHorizontal: 4 },
  card:         { borderRadius: 14, borderWidth: 0.5, overflow: 'hidden' },
  row:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  divider:      { height: 0.5, marginLeft: 46 },
  logoutBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 0.5, paddingVertical: 14, marginTop: 20 },
  themeRow:     { flexDirection: 'row', borderRadius: 14, borderWidth: 0.5, overflow: 'hidden' },
  themeCell:    { flex: 1, alignItems: 'center', paddingVertical: 14 },
});
