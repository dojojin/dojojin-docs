// ============================================================
// Vigil Mobile — Camera Detail Route (thin wrapper)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { CameraDetailContent } from '../../src/components/CameraDetailContent';
import { useI18n } from '../../src/i18n/useI18n';
import { useTheme, TYPE } from '../../src/theme';
import { API_BASE_URL, STORAGE_KEYS } from '../../src/constants';
import { Camera } from '../../src/types';

export default function CameraDetailScreen() {
  const router = useRouter();
  const theme  = useTheme();
  const t      = useI18n();
  const { id, data } = useLocalSearchParams<{ id: string; data: string }>();

  const camera = useMemo<Camera | null>(() => {
    try { return data ? (JSON.parse(data) as Camera) : null; }
    catch { return null; }
  }, [data]);

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

  if (!camera) {
    return (
      <SafeAreaView style={[s.screen, { backgroundColor: theme.background }]}>
        <View style={s.center}>
          <Text style={[TYPE.body, { color: theme.statusBad }]}>{t('cameraDetail.notFound')}</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }} hitSlop={8}>
            <Text style={[TYPE.bodySm, { color: theme.accent }]}>{t('cameraDetail.back')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.screen, { backgroundColor: theme.background }]}>
      <CameraDetailContent
        camera={camera}
        token={token}
        serverUrl={serverUrl}
        onClose={() => router.back()}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
