// ============================================================
// Vigil Mobile — API Client
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL, STORAGE_KEYS } from '../constants';
import { AuthResponse, Camera, CameraGroup, LoginPayload, VigilEvent, VigilFace, StatsKpi, TopRule, TimelineBucket, CategoryStat, TimelineSeries } from '../types';

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const [token, serverUrl] = await Promise.all([
      SecureStore.getItemAsync(STORAGE_KEYS.AUTH_TOKEN),
      SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL),
    ]);
    if (token) config.headers.Authorization = `Bearer ${token}`;
    if (serverUrl) config.baseURL = serverUrl;
    return config;
  },
  (error) => Promise.reject(error),
);

let _onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { _onUnauthorized = fn; };

client.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401 && _onUnauthorized) _onUnauthorized();
    return Promise.reject(error);
  },
);

export const authApi = {
  login: async (payload: LoginPayload): Promise<AuthResponse> => {
    const { data } = await client.post<AuthResponse>('/api/auth/login', payload);
    return data;
  },
  logout: async (): Promise<void> => { await client.post('/api/auth/logout'); },
  me: async (): Promise<AuthResponse['user']> => {
    const { data } = await client.get('/api/auth/me');
    return data.user;
  },
};

export const cameraApi = {
  // Response เป็น array ตรงๆ ไม่มี wrapper
  list: async (groupId?: number): Promise<Camera[]> => {
    const params = groupId ? { group_id: groupId } : {};
    const { data } = await client.get('/api/cameras', { params });
    // รองรับทั้ง array และ { cameras: [] }
    return Array.isArray(data) ? data : (data.cameras ?? []);
  },

  groups: async (): Promise<CameraGroup[]> => {
    const { data } = await client.get('/api/camera-groups');
    return Array.isArray(data) ? data : (data.groups ?? []);
  },
};

export interface EventListParams {
  limit?:  number;
  offset?: number;
  camera?: string;
  q?:      string;
  from?:   string;
  to?:     string;
  hasSnapshot?: boolean;
  tab?:    'snap' | 'clip' | 'lpr' | 'no_snap';
}

export const eventApi = {
  list: async (params: EventListParams = {}): Promise<{ events: VigilEvent[]; total: number }> => {
    const { data, headers } = await client.get('/api/events', { params });
    const events = Array.isArray(data) ? data : [];
    const total  = parseInt(headers['x-total-count'] ?? '0', 10);
    return { events, total };
  },
};

export interface FaceListParams {
  limit?:    number;
  offset?:   number;
  camera?:   string;
  gender?:   string;
  mask?:     string;
}

export const faceApi = {
  list: async (params: FaceListParams = {}): Promise<{ faces: VigilFace[]; total: number }> => {
    const { data, headers } = await client.get('/api/faces', { params });
    const faces = Array.isArray(data) ? data : [];
    const total = parseInt(headers['x-total-count'] ?? '0', 10);
    return { faces, total };
  },
};

export interface StatsRange { from?: string; to?: string; cameras?: string; }

export const statsApi = {
  kpi: async (range: StatsRange = {}): Promise<StatsKpi> => {
    const { data } = await client.get('/api/stats/kpi', { params: range });
    return data ?? {};
  },
  categories: async (range: StatsRange = {}): Promise<CategoryStat[]> => {
    const { data } = await client.get('/api/stats/categories', { params: range });
    // response: { from, to, prev_from, prev_to, categories: [...] }
    return Array.isArray(data) ? data : (data.categories ?? []);
  },
  topRules: async (range: StatsRange = {}, limit = 8): Promise<TopRule[]> => {
    const { data } = await client.get('/api/stats/top-rules', { params: { ...range, limit } });
    // response: { from, to, top: [...] }
    return Array.isArray(data) ? data : (data.top ?? []);
  },
  timeline: async (range: StatsRange = {}, granularity: 'hour' | 'day' = 'hour'): Promise<TimelineBucket[]> => {
    const { data } = await client.get('/api/stats/timeline', { params: { ...range, granularity } });
    return Array.isArray(data) ? data : [];
  },
  timelineByCategory: async (range: StatsRange = {}): Promise<TimelineSeries[]> => {
    const { data } = await client.get('/api/stats/timeline-by-category', { params: range });
    // response: { from, to, trunc, tz, series: [...] }
    return Array.isArray(data) ? data : (data.series ?? []);
  },
};

export default client;
