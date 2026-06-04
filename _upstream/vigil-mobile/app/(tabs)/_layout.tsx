// ============================================================
// Vigil Mobile — Tabs Layout
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { useI18n } from '../../src/i18n/useI18n';
import { Pressable } from 'react-native';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(outline: IoniconName, filled: IoniconName) {
  return ({ focused, color }: { focused: boolean; color: string }) => (
    <Ionicons name={focused ? filled : outline} size={24} color={color} />
  );
}

export default function TabsLayout() {
  const theme  = useTheme();
  const router = useRouter();
  const t      = useI18n();

  return (
    <Tabs
      screenOptions={{
        animation: 'shift',
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor:  theme.border,
          borderTopWidth:  0.5,
          paddingBottom:   8,
          height:          60,
        },
        tabBarActiveTintColor:   theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarLabelStyle:        { fontSize: 11, marginTop: 2 },
        headerStyle:             { backgroundColor: theme.surface },
        headerTintColor:         theme.textPrimary,
        headerShadowVisible:     false,
        headerTitleStyle:        { fontWeight: '600', fontSize: 17 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title:       t('tabs.cameras'),
          headerTitle: t('headers.cameras'),
          headerRight: () => (
            <Pressable onPress={() => router.push('/settings')} style={{ marginRight: 16 }} hitSlop={8}>
              <Ionicons name="settings-outline" size={22} color={theme.textSecondary} />
            </Pressable>
          ),
          tabBarIcon: tabIcon('camera-outline', 'camera'),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title:       t('tabs.events'),
          headerTitle: t('headers.events'),
          tabBarIcon:  tabIcon('flash-outline', 'flash'),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title:       t('tabs.map'),
          headerTitle: t('headers.map'),
          tabBarIcon:  tabIcon('map-outline', 'map'),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title:       t('tabs.stats'),
          headerTitle: t('headers.stats'),
          tabBarIcon:  tabIcon('bar-chart-outline', 'bar-chart'),
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title:       t('tabs.alerts'),
          headerTitle: t('headers.alerts'),
          tabBarIcon:  tabIcon('notifications-outline', 'notifications'),
        }}
      />
    </Tabs>
  );
}
