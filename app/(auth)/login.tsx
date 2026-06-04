// ============================================================
// Vigil Mobile — Login Screen
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { useTheme, TYPE } from '../../src/theme';
import { useI18n } from '../../src/i18n/useI18n';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const theme = useTheme();
  const router = useRouter();
  const t      = useI18n();

  const { login, isLoading, error, clearError } = useAuthStore();

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert(t('auth.loginError'), t('auth.loginErrorDetail'));
      return;
    }
    clearError();
    try {
      await login({ username: username.trim(), password });
    } catch {
      // error แสดงผ่าน store.error
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>

        {/* Server config button — top-right corner */}
        <Pressable
          style={styles.serverBtn}
          onPress={() => router.push('/(auth)/server-setup')}
          hitSlop={12}
        >
          <Ionicons name="settings-outline" size={18} color={theme.textSecondary} />
        </Pressable>

        {/* Logo */}
        <View style={styles.logoWrap}>
          <Text style={[styles.logoText, { color: theme.accent }]}>Vigil</Text>
          <Text style={[TYPE.bodySm, { color: theme.textSecondary, marginTop: 4 }]}>
            CCTV Security Dashboard
          </Text>

        </View>

        {/* Error banner */}
        {error ? (
          <View style={[styles.errorBanner, { backgroundColor: theme.statusBad + '22', borderColor: theme.statusBad + '55' }]}>
            <Text style={[TYPE.bodySm, { color: theme.statusBad }]}>{error}</Text>
          </View>
        ) : null}

        {/* Username */}
        <Text style={[TYPE.label, styles.fieldLabel, { color: theme.textSecondary }]}>{t('auth.username')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.surfaceElevated, borderColor: theme.border, color: theme.textPrimary }]}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          placeholderTextColor={theme.textSecondary}
          placeholder="admin"
        />

        {/* Password */}
        <Text style={[TYPE.label, styles.fieldLabel, { color: theme.textSecondary }]}>{t('auth.password')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.surfaceElevated, borderColor: theme.border, color: theme.textPrimary }]}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          returnKeyType="done"
          onSubmitEditing={handleLogin}
          placeholderTextColor={theme.textSecondary}
          placeholder="••••••••"
        />

        {/* Submit */}
        <Pressable
          style={({ pressed }) => [styles.btn, { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          {isLoading
            ? <ActivityIndicator color="#fff" />
            : <Text style={[TYPE.title, { color: '#fff' }]}>{t('auth.login')}</Text>
          }
        </Pressable>

        <Text style={[TYPE.label, styles.version, { color: theme.border }]}>
          {t('auth.version')}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 20,
    padding: 28,
    borderWidth: 0.5,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoText: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 1,
  },
  errorBanner: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 0.5,
  },
  fieldLabel: {
    marginBottom: 8,
  },
  input: {
    borderRadius: 12,
    borderWidth: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    marginBottom: 20,
  },
  btn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  version: {
    textAlign: 'center',
    marginTop: 24,
  },
  serverBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    padding: 4,
  },
});
