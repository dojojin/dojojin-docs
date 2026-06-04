// ============================================================
// Vigil Mobile — Server Setup Screen
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, TYPE } from '../../src/theme';
import { API_BASE_URL, STORAGE_KEYS, normalizeServerUrl } from '../../src/constants';

// 200 or 401 both mean the server exists and is Vigil-shaped (401 expected pre-login)
async function pingServer(url: string): Promise<boolean> {
  try {
    await axios.get(`${url}/api/auth/me`, { timeout: 8_000 });
    return true;
  } catch (e: any) {
    if (e?.response?.status === 401) return true;
    return false;
  }
}

export default function ServerSetupScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [urlInput, setUrlInput] = useState('');
  const [current, setCurrent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<'ok' | 'error' | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL).then(v => {
      const val = v ?? API_BASE_URL;
      setCurrent(val);
      setUrlInput(val);
    });
  }, []);

  const handleSave = async () => {
    const normalized = normalizeServerUrl(urlInput.trim() || API_BASE_URL);
    setIsLoading(true);
    setResult(null);
    const ok = await pingServer(normalized);
    setIsLoading(false);
    if (!ok) { setResult('error'); return; }
    await SecureStore.setItemAsync(STORAGE_KEYS.SERVER_URL, normalized);
    setCurrent(normalized);
    setResult('ok');
    setTimeout(() => router.back(), 900);
  };

  const handleReset = async () => {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.SERVER_URL);
    setCurrent(API_BASE_URL);
    setUrlInput(API_BASE_URL);
    setResult(null);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[TYPE.titleLg, { color: theme.textPrimary }]}>ตั้งค่า Server</Text>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={24} color={theme.textSecondary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[TYPE.bodySm, { color: theme.textSecondary, marginBottom: 24, lineHeight: 20 }]}>
          กำหนด URL ของ Vigil server ที่ต้องการเชื่อมต่อ{'\n'}ระบบจะทดสอบการเชื่อมต่อก่อนบันทึก
        </Text>

        {/* Current */}
        <Text style={[TYPE.label, styles.fieldLabel, { color: theme.textSecondary }]}>ใช้งานอยู่</Text>
        <View style={[styles.currentBox, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <Ionicons name="server-outline" size={14} color={theme.textSecondary} style={{ marginRight: 6 }} />
          <Text style={[TYPE.bodySm, { color: theme.textPrimary, flex: 1 }]} numberOfLines={1}>{current}</Text>
        </View>

        {/* Input */}
        <Text style={[TYPE.label, styles.fieldLabel, { color: theme.textSecondary, marginTop: 24 }]}>URL ใหม่</Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: theme.surfaceElevated,
              borderColor: result === 'error' ? theme.statusBad : theme.border,
              color: theme.textPrimary,
            },
          ]}
          value={urlInput}
          onChangeText={(t) => { setUrlInput(t); setResult(null); }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={handleSave}
          placeholder="https://your-server.example.com"
          placeholderTextColor={theme.textSecondary}
        />

        {/* Result feedback */}
        {result === 'error' && (
          <View style={styles.feedback}>
            <Ionicons name="alert-circle-outline" size={14} color={theme.statusBad} />
            <Text style={[TYPE.bodySm, { color: theme.statusBad, marginLeft: 6 }]}>
              เชื่อมต่อไม่ได้ — ตรวจสอบ URL และการเชื่อมต่อ
            </Text>
          </View>
        )}
        {result === 'ok' && (
          <View style={styles.feedback}>
            <Ionicons name="checkmark-circle-outline" size={14} color={theme.statusOk} />
            <Text style={[TYPE.bodySm, { color: theme.statusOk, marginLeft: 6 }]}>
              เชื่อมต่อได้ ✓ กำลังบันทึก…
            </Text>
          </View>
        )}

        {/* Save */}
        <Pressable
          style={({ pressed }) => [styles.btn, { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1, marginTop: 28 }]}
          onPress={handleSave}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="wifi" size={18} color="#fff" />
              <Text style={[TYPE.title, { color: '#fff' }]}>ทดสอบ & บันทึก</Text>
            </>
          )}
        </Pressable>

        {/* Reset to default */}
        <Pressable onPress={handleReset} style={styles.resetLink} hitSlop={8}>
          <Text style={[TYPE.bodySm, { color: theme.textSecondary }]}>
            รีเซ็ตเป็นค่าเริ่มต้น (dashboard.dojojin.tech)
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
  },
  body:      { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48 },
  fieldLabel:{ marginBottom: 8 },
  currentBox:{
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 0.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: {
    borderRadius: 12,
    borderWidth: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
  },
  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  btn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  resetLink: {
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 8,
  },
});
