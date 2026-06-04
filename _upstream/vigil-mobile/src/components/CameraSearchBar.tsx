// ============================================================
// Vigil Mobile — CameraSearchBar Component
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, TYPE } from '../theme';
import { useI18n } from '../i18n/useI18n';

interface Props {
  value:        string;
  onChangeText: (text: string) => void;
  resultCount:  number;
  totalCount:   number;
}

export function CameraSearchBar({ value, onChangeText, resultCount, totalCount }: Props) {
  const theme = useTheme();
  const t     = useI18n();

  return (
    <View style={[styles.container, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
      <Ionicons name="search" size={15} color={theme.textSecondary} style={{ marginRight: 8 }} />
      <TextInput
        style={[styles.input, { color: theme.textPrimary }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={t('cameras.searchPlaceholder')}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <>
          <Text style={[TYPE.label, { color: theme.textSecondary, marginRight: 6 }]}>
            {resultCount}/{totalCount}
          </Text>
          <Pressable onPress={() => onChangeText('')} hitSlop={10}>
            <Ionicons name="close-circle" size={16} color={theme.textSecondary} />
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  input: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
});
