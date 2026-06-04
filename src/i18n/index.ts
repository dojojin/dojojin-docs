// ============================================================
// Vigil Mobile — i18n setup
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// ============================================================

import { I18n } from 'i18n-js';
import th from './th';
import en from './en';

export const i18n = new I18n({ th, en });
i18n.enableFallback = true;
i18n.defaultLocale  = 'th';
i18n.locale         = 'th';
