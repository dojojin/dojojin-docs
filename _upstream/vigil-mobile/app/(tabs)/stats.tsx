// ============================================================
// Vigil Mobile — Stats Screen
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { cameraApi } from '../../src/api/client';
import { useStats, RangeKey } from '../../src/hooks/useStats';
import { MultiLineChart } from '../../src/components/MultiLineChart';
import { SkeletonStatCard, SkeletonBox } from '../../src/components/SkeletonBox';
import { useI18n } from '../../src/i18n/useI18n';
import { useTheme, TYPE } from '../../src/theme';
import { CategoryStat, Camera } from '../../src/types';

const RANGES: { key: RangeKey; labelKey: string }[] = [
  { key: 'today', labelKey: 'statsScreen.rangeToday' },
  { key: '7d',    labelKey: 'statsScreen.range7d'    },
  { key: '30d',   labelKey: 'statsScreen.range30d'   },
];

// vendor → label สั้นๆ
const VENDOR_LABEL: Record<string, string> = {
  bosch: 'BOSCH', hikvision: 'HIKVISION', dahua: 'DAHUA', onvif: 'ONVIF',
};

// ── Comparison line — port จาก web formatComparison ──
type Tone = 'up' | 'down' | 'dim';
function comparison(cur: number, prev: number, changePct: number | null): { text: string; tone: Tone } {
  if (prev === 0 && cur === 0) return { text: '— no data', tone: 'dim' };
  if (prev === 0 && cur  >  0) return { text: '↑ NEW',     tone: 'up' };
  if (prev  >  0 && cur === 0) return { text: '▼ STOPPED', tone: 'down' };
  const diff = cur - prev;
  if (prev < 5) {
    if (diff === 0) return { text: '— 0 vs prev', tone: 'dim' };
    return { text: `${diff > 0 ? '↑' : '▼'} ${diff > 0 ? '+' : ''}${diff} events`, tone: diff > 0 ? 'up' : 'down' };
  }
  if (diff === 0) return { text: '— 0% vs prev', tone: 'dim' };
  const pct = Math.abs(changePct ?? ((diff / prev) * 100));
  const capped = pct > 999 ? '>999' : pct.toFixed(1);
  return { text: `${diff > 0 ? '↑' : '▼'} ${capped}% vs prev`, tone: diff > 0 ? 'up' : 'down' };
}

// ── Pill row (range + vendor ใช้ pattern เดียวกัน) ──

function PillRow<T extends string>({ items, active, onChange }: {
  items: { key: T; label: string; count?: number }[];
  active: T;
  onChange: (k: T) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pillRow}>
      {items.map(it => {
        const isActive = active === it.key;
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            style={[s.pill, {
              backgroundColor: isActive ? theme.accent + '22' : theme.surfaceElevated,
              borderColor:     isActive ? theme.accent        : theme.border,
            }]}
          >
            <Text style={[TYPE.bodySm, { color: isActive ? theme.accent : theme.textSecondary, fontWeight: '600' }]}>
              {it.label}{it.count != null ? ` ${it.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ── Range selector (segmented) ──

function RangeSelector({ active, onChange }: { active: RangeKey; onChange: (k: RangeKey) => void }) {
  const theme = useTheme();
  const t     = useI18n();
  return (
    <View style={[s.segmented, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
      {RANGES.map((r, i) => {
        const isActive = active === r.key;
        return (
          <Pressable
            key={r.key}
            onPress={() => onChange(r.key)}
            style={[s.segment, isActive && { backgroundColor: theme.surface }, i > 0 && { borderLeftWidth: 0.5, borderLeftColor: theme.border }]}
          >
            <Text style={[TYPE.bodySm, { color: isActive ? theme.textPrimary : theme.textSecondary, fontWeight: isActive ? '600' : '400' }]}>
              {t(r.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Category card ──

function CategoryCard({ cat }: { cat: CategoryStat }) {
  const theme = useTheme();
  const cmp   = comparison(cat.count, cat.prev_count, cat.change_pct);
  const toneColor = cmp.tone === 'up' ? theme.statusOk : cmp.tone === 'down' ? theme.statusBad : theme.textSecondary;
  return (
    <View style={[s.catCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[s.catStripe, { backgroundColor: cat.color }]} />
      <View style={s.catBody}>
        <View style={s.catHeader}>
          <Text style={s.catIcon}>{cat.icon}</Text>
          <Text style={[TYPE.label, { color: theme.textSecondary, flex: 1 }]} numberOfLines={1}>{cat.name}</Text>
        </View>
        <Text style={[s.catValue, { color: theme.textPrimary }]}>{cat.count.toLocaleString()}</Text>
        <Text style={[TYPE.label, { color: toneColor, marginTop: 2 }]} numberOfLines={1}>{cmp.text}</Text>
      </View>
    </View>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[s.section, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[TYPE.label, { color: theme.textSecondary, marginBottom: 14, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

// ── Screen ──

export default function StatsScreen() {
  const theme = useTheme();
  const t     = useI18n();
  const [range,  setRange]  = useState<RangeKey>('7d');
  const [vendor, setVendor] = useState<string>('all');   // 'all' หรือ vendor key
  const [cameras, setCameras] = useState<Camera[]>([]);

  // โหลดรายชื่อกล้องครั้งเดียว — ใช้ derive vendor tabs + camera_ids ต่อ vendor
  useEffect(() => {
    cameraApi.list().then(setCameras).catch(() => {});
  }, []);

  // derive vendor tabs จากข้อมูลจริง (ไม่ hardcode — white-label)
  const vendorTabs = useMemo(() => {
    const counts: Record<string, number> = {};
    cameras.forEach(c => {
      const v = (c.vendor || 'bosch').toLowerCase();
      counts[v] = (counts[v] ?? 0) + 1;
    });
    const tabs: { key: string; label: string; count?: number }[] = [
      { key: 'all', label: t('statsScreen.vendorAll'), count: cameras.length },
    ];
    Object.keys(counts).sort().forEach(v => {
      tabs.push({ key: v, label: VENDOR_LABEL[v] ?? v.toUpperCase(), count: counts[v] });
    });
    return tabs;
  }, [cameras]);

  // camera_ids ของ vendor ที่เลือก (undefined = ALL)
  const cameraIds = useMemo(() => {
    if (vendor === 'all') return undefined;
    return cameras.filter(c => (c.vendor || 'bosch').toLowerCase() === vendor).map(c => c.camera_id);
  }, [vendor, cameras]);

  const { categories, series, isLoading, error, refresh } = useStats(range, cameraIds);

  const sortedCats = useMemo(() => [...categories].sort((a, b) => b.count - a.count), [categories]);

  return (
    <View style={[s.screen, { backgroundColor: theme.background }]}>
      <View style={[s.toolbar, { borderBottomColor: theme.border }]}>
        {/* Vendor filter */}
        {vendorTabs.length > 1 && (
          <PillRow items={vendorTabs} active={vendor} onChange={setVendor} />
        )}
        {/* Range */}
        <RangeSelector active={range} onChange={setRange} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={theme.accent} />}
      >
        {isLoading && categories.length === 0 ? (
          <View>
            <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
              {[0,1,2,3].map(i => <SkeletonStatCard key={i} />)}
            </View>
            <SkeletonBox height={180} radius={12} style={{ margin: 12 }} />
            {[0,1,2,3].map(i => <SkeletonBox key={i} height={52} radius={12} style={{ marginHorizontal: 12, marginBottom: 8 }} />)}
          </View>
        ) : error && categories.length === 0 ? (
          <View style={s.center}>
            <Text style={[TYPE.body, { color: theme.statusBad }]}>{error}</Text>
            <Text style={[TYPE.bodySm, { color: theme.accent, marginTop: 12 }]} onPress={refresh}>{t('statsScreen.retry')}</Text>
          </View>
        ) : (
          <>
            <View style={s.catGrid}>
              {sortedCats.map(c => <CategoryCard key={c.id} cat={c} />)}
            </View>
            <SectionCard title={t('statsScreen.chartTitle')}>
              <MultiLineChart series={series} />
            </SectionCard>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen:     { flex: 1 },
  toolbar:    { paddingTop: 12, paddingBottom: 12, gap: 10, borderBottomWidth: 0.5 },
  content:    { padding: 16, gap: 16 },
  center:     { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 4 },
  // Pills (vendor)
  pillRow:    { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  pill:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 0.5 },
  // Range segmented
  segmented:  { flexDirection: 'row', borderRadius: 10, borderWidth: 0.5, overflow: 'hidden', marginHorizontal: 16 },
  segment:    { flex: 1, paddingVertical: 8, alignItems: 'center' },
  // Category grid
  catGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  catCard:    { flexGrow: 1, flexBasis: '45%', borderRadius: 14, borderWidth: 0.5, overflow: 'hidden', flexDirection: 'row' },
  catStripe:  { width: 4 },
  catBody:    { flex: 1, paddingVertical: 12, paddingHorizontal: 14 },
  catHeader:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  catIcon:    { fontSize: 14 },
  catValue:   { fontSize: 24, fontWeight: '700', lineHeight: 28 },
  // Section
  section:    { borderRadius: 14, borderWidth: 0.5, padding: 16 },
});
