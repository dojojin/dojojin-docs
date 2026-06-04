// ============================================================
// Vigil Mobile — MultiLineChart Component
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import React, { useMemo, useState } from 'react';
import {
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Polyline, Line as SvgLine, Circle, Text as SvgText } from 'react-native-svg';
import { useTheme, TYPE } from '../theme';
import { TimelineSeries } from '../types';

const CHART_H  = 180;
const Y_AXIS_W = 34;
const X_AXIS_H = 22;
const PAD_T    = 10;
const PAD_R    = 8;

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const mag  = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function shortNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export function MultiLineChart({ series }: { series: TimelineSeries[] }) {
  const theme         = useTheme();
  const { width: sw } = useWindowDimensions();
  const chartW = sw - 32 - 32;

  const active = useMemo(() => series.filter(s => s.points.length > 0), [series]);

  const [hidden, setHidden]       = useState<Set<number>>(new Set());
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const toggle = (id: number) => setHidden(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const axis = useMemo(
    () => [...new Set(active.flatMap(s => s.points.map(p => p.bucket)))].sort(),
    [active],
  );

  const visible = active.filter(s => !hidden.has(s.category.id));
  const rawMax  = useMemo(() => Math.max(1, ...visible.flatMap(s => s.points.map(p => p.count))), [visible]);
  const max     = niceMax(rawMax);

  // map: categoryId → (bucket → count) สำหรับ lookup เร็ว
  const lookup = useMemo(() => {
    const m: Record<number, Map<string, number>> = {};
    active.forEach(s => { m[s.category.id] = new Map(s.points.map(p => [p.bucket, p.count])); });
    return m;
  }, [active]);

  const sameDay = useMemo(() => {
    if (axis.length < 2) return true;
    const d0 = new Date(axis[0]).toDateString();
    return axis.every(b => new Date(b).toDateString() === d0);
  }, [axis]);

  const fmtX = (iso: string) => {
    const d = new Date(iso);
    return sameDay
      ? `${String(d.getHours()).padStart(2, '0')}:00`
      : `${d.getDate()}/${d.getMonth() + 1}`;
  };
  const fmtFull = (iso: string) => {
    const d = new Date(iso);
    return sameDay
      ? `${String(d.getHours()).padStart(2, '0')}:00 น.`
      : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  };

  if (active.length === 0) {
    return <Text style={[TYPE.bodySm, { color: theme.textSecondary, paddingVertical: 24, textAlign: 'center' }]}>ไม่มีข้อมูลในช่วงนี้</Text>;
  }

  const plotX = Y_AXIS_W;
  const plotW = chartW - Y_AXIS_W - PAD_R;
  const plotY = PAD_T;
  const plotH = CHART_H - X_AXIS_H - PAD_T;

  const xAt = (i: number) => plotX + (axis.length <= 1 ? plotW / 2 : (i / (axis.length - 1)) * plotW);
  const yAt = (v: number) => plotY + plotH - (v / max) * plotH;

  const singlePoint = axis.length < 2;

  const yTicks   = [0, max / 2, max];
  const xTickIdx = axis.length <= 1
    ? [0]
    : axis.length <= 3
      ? axis.map((_, i) => i)
      : [0, Math.floor((axis.length - 1) / 2), axis.length - 1];

  // ── Touch → nearest bucket index ──
  const onTouch = (e: GestureResponderEvent) => {
    if (axis.length < 2) return;
    const x   = e.nativeEvent.locationX;
    const rel = (x - plotX) / plotW;
    const idx = Math.round(rel * (axis.length - 1));
    setActiveIdx(Math.max(0, Math.min(axis.length - 1, idx)));
  };

  // tooltip data ณ activeIdx
  const tipRows = activeIdx == null ? [] : visible
    .map(s => ({ cat: s.category, value: lookup[s.category.id]?.get(axis[activeIdx]) ?? 0 }))
    .sort((a, b) => b.value - a.value);

  // ตำแหน่ง tooltip — เด้งซ้ายถ้า activeIdx อยู่ครึ่งขวา
  const tipLeft = activeIdx != null && xAt(activeIdx) > chartW / 2;

  return (
    <View>
      <View
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={onTouch}
        onResponderMove={onTouch}
      >
        <Svg width={chartW} height={CHART_H}>
          {/* Y grid + labels */}
          {yTicks.map((t, i) => {
            const y = yAt(t);
            return (
              <React.Fragment key={`y-${i}`}>
                <SvgLine x1={plotX} y1={y} x2={plotX + plotW} y2={y} stroke={theme.border} strokeWidth={i === 0 ? 1 : 0.5} strokeDasharray={i === 0 ? undefined : '3,3'} />
                <SvgText x={plotX - 6} y={y + 3} fontSize={9} fill={theme.textSecondary} textAnchor="end">{shortNum(Math.round(t))}</SvgText>
              </React.Fragment>
            );
          })}

          {/* X labels */}
          {xTickIdx.map(i => (
            <SvgText key={`x-${i}`} x={xAt(i)} y={CHART_H - 6} fontSize={9} fill={theme.textSecondary} textAnchor="middle">{fmtX(axis[i])}</SvgText>
          ))}

          {/* Crosshair */}
          {activeIdx != null && !singlePoint && (
            <SvgLine x1={xAt(activeIdx)} y1={plotY} x2={xAt(activeIdx)} y2={plotY + plotH} stroke={theme.textSecondary} strokeWidth={1} strokeDasharray="2,2" />
          )}

          {/* Series */}
          {visible.map(ser => {
            const ys = axis.map(b => lookup[ser.category.id]?.get(b) ?? 0);
            if (singlePoint) {
              return <Circle key={ser.category.id} cx={xAt(0)} cy={yAt(ys[0])} r={4} fill={ser.category.color} />;
            }
            const pts = axis.map((_, i) => `${xAt(i)},${yAt(ys[i])}`).join(' ');
            return <Polyline key={ser.category.id} points={pts} fill="none" stroke={ser.category.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
          })}

          {/* Active dots */}
          {activeIdx != null && visible.map(ser => {
            const v = lookup[ser.category.id]?.get(axis[activeIdx]) ?? 0;
            return <Circle key={`d-${ser.category.id}`} cx={xAt(activeIdx)} cy={yAt(v)} r={3.5} fill={ser.category.color} stroke={theme.background} strokeWidth={1.5} />;
          })}
        </Svg>

        {/* Tooltip overlay */}
        {activeIdx != null && tipRows.length > 0 && (
          <View
            pointerEvents="none"
            style={[s.tooltip, { backgroundColor: theme.surfaceElevated, borderColor: theme.border, [tipLeft ? 'left' : 'right']: 8, top: 4 }]}
          >
            <Text style={[TYPE.label, { color: theme.textSecondary, marginBottom: 4 }]}>{fmtFull(axis[activeIdx])}</Text>
            {tipRows.slice(0, 6).map(r => (
              <View key={r.cat.id} style={s.tipRow}>
                <View style={[s.tipDot, { backgroundColor: r.cat.color }]} />
                <Text style={[TYPE.label, { color: theme.textPrimary, flex: 1 }]} numberOfLines={1}>{r.cat.name}</Text>
                <Text style={[TYPE.label, { color: theme.textPrimary, fontWeight: '700', marginLeft: 8 }]}>{r.value.toLocaleString()}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Tappable legend */}
      <View style={s.legend}>
        {active.map(ser => {
          const isHidden = hidden.has(ser.category.id);
          const total    = ser.points.reduce((sum, p) => sum + p.count, 0);
          return (
            <Pressable key={ser.category.id} onPress={() => toggle(ser.category.id)} style={s.legendItem}>
              <View style={[s.dot, { backgroundColor: isHidden ? 'transparent' : ser.category.color, borderColor: ser.category.color }]} />
              <Text style={[TYPE.label, { color: isHidden ? theme.textSecondary : theme.textPrimary, textDecorationLine: isHidden ? 'line-through' : 'none', flexShrink: 1 }]} numberOfLines={1}>
                {ser.category.name}
              </Text>
              <Text style={[TYPE.label, { color: theme.textSecondary, fontWeight: '600' }]}>{total.toLocaleString()}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  tooltip:    { position: 'absolute', borderRadius: 10, borderWidth: 0.5, paddingVertical: 8, paddingHorizontal: 10, minWidth: 130, maxWidth: 190 },
  tipRow:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 1 },
  tipDot:     { width: 7, height: 7, borderRadius: 4 },
  legend:     { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 8, marginTop: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, width: '46%' },
  dot:        { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
});
