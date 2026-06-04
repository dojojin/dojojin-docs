// ============================================================
// Vigil Mobile — English strings
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// ============================================================

import type { TranslationKeys } from './th';

const en: TranslationKeys = {
  tabs: {
    cameras:  'Cameras',
    events:   'Events',
    map:      'Map',
    stats:    'Stats',
    alerts:   'Alerts',
  },

  headers: {
    cameras:  'Cameras',
    events:   'Live Events',
    map:      'Map View',
    stats:    'Analytics',
    alerts:   'Alerts',
    settings: 'Settings',
  },

  auth: {
    username:         'Username',
    password:         'Password',
    login:            'Sign In',
    loginError:       'Missing fields',
    loginErrorDetail: 'Username and password are required',
    version:          'Vigil Mobile · v1.0.0',
  },

  server: {
    title:          'Server Setup',
    description:    'Enter the URL of the Vigil server to connect to.\nThe app will test connectivity before saving.',
    currentLabel:   'Currently using',
    newUrlLabel:    'New URL',
    placeholder:    'https://your-server.example.com',
    saveBtn:        'Test & Save',
    resetLink:      'Reset to default (dashboard.dojojin.tech)',
    connectOk:      'Connected ✓ Saving…',
    connectFail:    'Cannot connect — check URL and connectivity',
  },

  cameras: {
    selectHint:   'Select a camera to view details',
    loading:      'Loading cameras…',
    retry:        'Tap to retry',
    allFilter:    'All',
    searchPlaceholder: 'Search cameras...',
    updatedAt:    'Updated %{time}',
    emptySearch:  'No cameras matching "%{query}"',
    emptyAlert:   'No cameras with alerts today',
    emptyOffline: 'All cameras are online',
    emptyOnline:  'No cameras online',
    emptyGroup:   'No cameras in this group',
    emptyNone:    'No cameras in the system',
  },

  kpi: {
    total:   'Total',
    online:  'Online',
    offline: 'Offline',
    alert:   'Alert',
  },

  filter: {
    all:     'All',
    alert:   'Alert',
    offline: 'Offline',
    online:  'Online',
  },

  cameraDetail: {
    eventsToday:   'Events today',
    lastSeen:      'Last seen',
    lastAlert:     'Last alert',
    fullSnapshot:  'Full image',
    mapBtn:        'Map',
    activity:      'Recent activity',
    activityCount: '%{count} items',
    noActivity:    'No recent activity',
    cameraInfo:    'Camera info',
    ipAddress:     'IP Address',
    vendor:        'Vendor',
    group:         'Group',
    sdCard:        'SD Card',
    notes:         'Notes',
    status:        'Status',
    offline:       'Offline',
    online:        'Online',
    notFound:      'Camera not found',
    back:          'Back',
    locked:        'Camera Offline',
    liveLoading:   'Loading…',
  },

  events: {
    tabAll:    'All',
    tabSnap:   'Images',
    tabClip:   'Clips',
    tabFace:   'Faces',
    count:     '%{total} items',
    noResults: 'No results',
    tryFilter: 'Try changing the filter',
    noData:    'No data in the system yet',
    noFaces:   'No faces found',
    allShown:  'All items shown',
    search:    'Search camera, type, rule…',
  },

  eventDetail: {
    noImage:     'No image',
    watchVideo:  'Watch Video',
    watchImage:  'View image',
    saveImage:   'Save image',
    saving:      'Saving…',
    saved:       'Saved',
    saveFailed:  'Save failed',
    faceDetail:  'Face details',
    saveFace:    'Save image',
    savedFace:   'Saved',
    saveFailedFace: 'Save failed',
  },

  eventType: {
    motion:     'Motion detected',
    crossed:    'Line crossed',
    intruder:   'Intruder detected',
    loitering:  'Suspicious behavior',
    crowd:      'Abnormal crowd',
    face:       'Face detected',
    tailgating: 'Tailgating',
  },

  alertsScreen: {
    noAlerts:       'No alerts',
    noAlertsHint:   'Real-time alerts will appear here',
    wsLive:         'Live',
    wsConnecting:   'Connecting…',
    wsDisconnected: 'Disconnected',
  },

  map: {
    loading:        'Loading map…',
    noLocation:     'No camera locations',
    noLocationHint: 'Cameras have no map coordinates set',
    refresh:        'Tap to retry',
    cameraOffline:  'Camera offline — no live feed',
    events24h:      '%{count} events (24h)',
  },

  statsScreen: {
    noData:     'No data yet',
    retry:      'Tap to retry',
    vendorAll:  'ALL',
    rangeToday: 'Today',
    range7d:    '7 days',
    range30d:   '30 days',
    chartTitle: 'Events by category',
  },

  settings: {
    title:          'Settings',
    security:       'Security',
    user:           'User',
    role:           'Role',
    pushToggle:     'Push notifications',
    pushNote:       'Works when the app is closed',
    bioUnavailable: 'Unavailable',
    bioSetupHint:   'Set up Face ID / fingerprint on your device first',
    biometric:   'Unlock with %{label}',
    push:        'Notifications',
    pushAlerts:  'Alerts',
    pushFaces:   'Faces',
    appearance:  'Appearance',
    themeAuto:   'Auto',
    themeLight:  'Light',
    themeDark:   'Dark',
    language:    'Language',
    langAuto:    'Auto (system)',
    langTh:      'ภาษาไทย',
    langEn:      'English',
    account:     'Account',
    logout:      'Sign out',
    logoutConfirmTitle: 'Sign out',
    logoutConfirmMsg:   'Are you sure you want to sign out?',
    logoutCancel:       'Cancel',
    logoutConfirm:      'Sign out',
    pushStatusOk:    'Notifications enabled',
    pushErrPerm:     'Permission denied — enable in device Settings',
    pushErrBuild:    'Notifications require a production build',
    pushErrDevice:   'Device only (not simulator)',
    pushErrGeneral:  'Failed to enable notifications',
  },

  lock: {
    title:   'Vigil is locked',
    sub:     'Authenticate to continue',
    unlock:  'Unlock',
    logout:  'Sign out',
    prompt:  'Unlock Vigil',
    cancel:  'Cancel',
    confirmLogoutTitle: 'Sign out',
    confirmLogoutMsg:   'Are you sure you want to sign out?',
  },

  time: {
    justNow:    'Just now',
    secondsAgo: '%{count}s ago',
    minutesAgo: '%{count}m ago',
    hoursAgo:   '%{count}h ago',
    sAgo:       '%{count}s ago',
    mAgo:       '%{count}m ago',
    hAgo:       '%{count}h ago',
    dAgo:       '%{count}d ago',
  },

  face: {
    gender:     'Gender',
    age:        'Approx. age',
    expression: 'Expression',
    mask:       'Mask',
    hat:        'Hat',
    glasses:    'Glasses',
    faceScore:  'Face score',
    male:       'Male',
    female:     'Female',
    wearing:    'Wearing',
  },
};

export default en;
