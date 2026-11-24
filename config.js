/**
 * HJC 멀티채널 재고 매칭 설정 관리 모듈 (v3.0)
 * - 지원 채널: cafe24 (카페24), smartstore (네이버 스마트스토어), coupang (쿠팡)
 * - 공통 규칙(inventory_url, hq_default_stock, 별칭·색상) + 채널별 독립 매핑(channels.*)
 * - v2.0 브라우저 설정(hjc_smartstore_matcher_config_v1) 및 v2.0 백업 JSON 자동 마이그레이션 지원
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HJCConfig = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const APP_VERSION = '3.0';
  const STORAGE_KEY = 'hjc_multichannel_matcher_config_v3';
  const LEGACY_STORAGE_KEY = 'hjc_smartstore_matcher_config_v1';
  const CHANNELS = ['cafe24', 'smartstore', 'coupang'];

  const CHANNEL_META = {
    cafe24: {
      id: 'cafe24',
      name: '카페24',
      fullName: '카페24 (자사몰)',
      badge: 'CAFE24',
      idLabel: '상품코드',
      optIdLabel: '품목코드',
      accept: '.csv',
      chunkSize: 1000
    },
    smartstore: {
      id: 'smartstore',
      name: '네이버 스마트스토어',
      fullName: '네이버 스마트스토어',
      badge: 'SMARTSTORE',
      idLabel: '상품번호',
      optIdLabel: '옵션값',
      accept: '.xlsx',
      chunkSize: 500
    },
    coupang: {
      id: 'coupang',
      name: '쿠팡',
      fullName: '쿠팡 (Wing)',
      badge: 'COUPANG',
      idLabel: '업체상품 ID',
      optIdLabel: '옵션 ID',
      accept: '.xlsx',
      chunkSize: 1500
    }
  };

  function createEmptyChannelConfig(withSampleByName = false) {
    return {
      manual_map: {},
      manual_map_by_name: withSampleByName
        ? { '안티 베놈 2 ANTI VENOM': ['HJC 헬멧 알파12 안티 베놈2 마블 MC8'] }
        : {},
      option_manual_map: {},
      confirmed_missing_sizes: {},
      fixed_stock: {},
      ignore_products: [],
      ignored_options: []
    };
  }

  const FALLBACK_DEFAULT_CONFIG = {
    inventory_url: '',
    hq_default_stock: 100,
    drop_warning_percent: 50,
    models_extra: ['알파13'],
    aliases: {
      '과타라로': '콰타라로',
      '쿼타라로': '콰타라로',
      '로윈': '라윈',
      '퀘이즈': '퀘즈'
    },
    color_synonyms: {
      '앤그레이': '엔그레이',
      '러버톤무광블랙': '플랫블랙',
      '러버톤플랫블랙': '플랫블랙',
      '리얼펄화이트': '펄화이트',
      '리얼화이트': '펄화이트',
      '무광블랙': '매트블랙'
    },
    color_fallback: {
      '화이트': '펄화이트',
      '플랫블랙': '세미플랫블랙',
      '매트블랙': '세미플랫블랙'
    },
    channels: {
      cafe24: createEmptyChannelConfig(true),
      smartstore: createEmptyChannelConfig(true),
      coupang: createEmptyChannelConfig(true)
    }
  };

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function sanitizeChannelConfig(baseCh, overrideCh, preserveUserDeletions = false) {
    const b = deepClone(baseCh || createEmptyChannelConfig(false));
    const o = (overrideCh && typeof overrideCh === 'object') ? overrideCh : null;
    if (!o) return b;

    if (preserveUserDeletions) {
      return {
        manual_map: o.manual_map && typeof o.manual_map === 'object' ? deepClone(o.manual_map) : b.manual_map,
        manual_map_by_name: o.manual_map_by_name && typeof o.manual_map_by_name === 'object' ? deepClone(o.manual_map_by_name) : b.manual_map_by_name,
        option_manual_map: o.option_manual_map && typeof o.option_manual_map === 'object' ? deepClone(o.option_manual_map) : b.option_manual_map,
        confirmed_missing_sizes: o.confirmed_missing_sizes && typeof o.confirmed_missing_sizes === 'object' ? deepClone(o.confirmed_missing_sizes) : b.confirmed_missing_sizes,
        fixed_stock: o.fixed_stock && typeof o.fixed_stock === 'object' ? deepClone(o.fixed_stock) : b.fixed_stock,
        ignore_products: Array.isArray(o.ignore_products) ? [...new Set(o.ignore_products.map(String))] : b.ignore_products,
        ignored_options: Array.isArray(o.ignored_options) ? [...new Set(o.ignored_options.map(String))] : b.ignored_options
      };
    }

    return {
      manual_map: Object.assign({}, b.manual_map, o.manual_map || {}),
      manual_map_by_name: Object.assign({}, b.manual_map_by_name, o.manual_map_by_name || {}),
      option_manual_map: Object.assign({}, b.option_manual_map, o.option_manual_map || {}),
      confirmed_missing_sizes: Object.assign({}, b.confirmed_missing_sizes, o.confirmed_missing_sizes || {}),
      fixed_stock: Object.assign({}, b.fixed_stock, o.fixed_stock || {}),
      ignore_products: Array.isArray(o.ignore_products) ? [...new Set(o.ignore_products.map(String))] : [...b.ignore_products],
      ignored_options: Array.isArray(o.ignored_options) ? [...new Set(o.ignored_options.map(String))] : [...b.ignored_options]
    };
  }

  function hasLegacyTopLevelChannelFields(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return (
      'manual_map' in obj ||
      'manual_map_by_name' in obj ||
      'option_manual_map' in obj ||
      'confirmed_missing_sizes' in obj ||
      'fixed_stock' in obj ||
      'ignore_products' in obj ||
      'ignored_options' in obj
    );
  }

  function extractLegacyChannelFields(obj) {
    return {
      manual_map: obj.manual_map,
      manual_map_by_name: obj.manual_map_by_name,
      option_manual_map: obj.option_manual_map,
      confirmed_missing_sizes: obj.confirmed_missing_sizes,
      fixed_stock: obj.fixed_stock,
      ignore_products: obj.ignore_products,
      ignored_options: obj.ignored_options
    };
  }

  function mergeConfig(base, override, preserveUserDeletions = false) {
    const b = deepClone(base || FALLBACK_DEFAULT_CONFIG);
    if (!b.channels) {
      b.channels = {
        cafe24: createEmptyChannelConfig(true),
        smartstore: hasLegacyTopLevelChannelFields(b)
          ? sanitizeChannelConfig(createEmptyChannelConfig(true), extractLegacyChannelFields(b), false)
          : createEmptyChannelConfig(true),
        coupang: createEmptyChannelConfig(true)
      };
    }

    const o = override || {};
    const oChannels = (o.channels && typeof o.channels === 'object') ? o.channels : {};
    const legacyFlat = !o.channels && hasLegacyTopLevelChannelFields(o) ? extractLegacyChannelFields(o) : null;

    const channels = {};
    for (const ch of CHANNELS) {
      const baseCh = b.channels[ch] || createEmptyChannelConfig(true);
      const ovCh = oChannels[ch] || (ch === 'smartstore' ? legacyFlat : null);
      channels[ch] = sanitizeChannelConfig(baseCh, ovCh, preserveUserDeletions);
    }

    return {
      inventory_url: typeof o.inventory_url === 'string' ? o.inventory_url : b.inventory_url,
      hq_default_stock: Number.isFinite(Number(o.hq_default_stock)) ? Math.max(0, Math.floor(Number(o.hq_default_stock))) : b.hq_default_stock,
      drop_warning_percent: Number.isFinite(Number(o.drop_warning_percent)) ? Math.max(1, Math.min(100, Number(o.drop_warning_percent))) : b.drop_warning_percent,
      models_extra: Array.isArray(o.models_extra) ? [...o.models_extra] : [...b.models_extra],
      aliases: preserveUserDeletions
        ? (o.aliases && typeof o.aliases === 'object' ? deepClone(o.aliases) : b.aliases)
        : Object.assign({}, b.aliases, o.aliases || {}),
      color_synonyms: preserveUserDeletions
        ? (o.color_synonyms && typeof o.color_synonyms === 'object' ? deepClone(o.color_synonyms) : b.color_synonyms)
        : Object.assign({}, b.color_synonyms, o.color_synonyms || {}),
      color_fallback: preserveUserDeletions
        ? (o.color_fallback && typeof o.color_fallback === 'object' ? deepClone(o.color_fallback) : b.color_fallback)
        : Object.assign({}, b.color_fallback, o.color_fallback || {}),
      channels
    };
  }

  /**
   * 특정 채널의 실행용 평탄화(flat) 설정 반환 (매칭 엔진에 주입)
   */
  function getEffectiveConfig(rootConfig, channelId = 'smartstore') {
    const ch = CHANNELS.includes(channelId) ? channelId : 'smartstore';
    const rc = rootConfig || FALLBACK_DEFAULT_CONFIG;
    const chCfg = (rc.channels && rc.channels[ch])
      ? rc.channels[ch]
      : (hasLegacyTopLevelChannelFields(rc) ? extractLegacyChannelFields(rc) : createEmptyChannelConfig(false));

    return {
      channel: ch,
      inventory_url: rc.inventory_url || '',
      hq_default_stock: Number.isFinite(Number(rc.hq_default_stock)) ? Number(rc.hq_default_stock) : 100,
      drop_warning_percent: Number.isFinite(Number(rc.drop_warning_percent)) ? Number(rc.drop_warning_percent) : 50,
      models_extra: Array.isArray(rc.models_extra) ? [...rc.models_extra] : [],
      aliases: Object.assign({}, rc.aliases || {}),
      color_synonyms: Object.assign({}, rc.color_synonyms || {}),
      color_fallback: Object.assign({}, rc.color_fallback || {}),
      manual_map: Object.assign({}, chCfg.manual_map || {}),
      manual_map_by_name: Object.assign({}, chCfg.manual_map_by_name || {}),
      option_manual_map: Object.assign({}, chCfg.option_manual_map || {}),
      confirmed_missing_sizes: Object.assign({}, chCfg.confirmed_missing_sizes || {}),
      fixed_stock: Object.assign({}, chCfg.fixed_stock || {}),
      ignore_products: Array.isArray(chCfg.ignore_products) ? [...chCfg.ignore_products] : [],
      ignored_options: Array.isArray(chCfg.ignored_options) ? [...chCfg.ignored_options] : []
    };
  }

  function ensureChannelBag(rootConfig, channelId) {
    const ch = CHANNELS.includes(channelId) ? channelId : 'smartstore';
    if (!rootConfig.channels) {
      rootConfig.channels = {
        cafe24: createEmptyChannelConfig(true),
        smartstore: createEmptyChannelConfig(true),
        coupang: createEmptyChannelConfig(true)
      };
    }
    if (!rootConfig.channels[ch]) {
      rootConfig.channels[ch] = createEmptyChannelConfig(false);
    }
    return rootConfig.channels[ch];
  }

  async function fetchDefaultConfig() {
    if (typeof fetch !== 'function') {
      return deepClone(FALLBACK_DEFAULT_CONFIG);
    }
    try {
      const res = await fetch(`default_config.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return mergeConfig(FALLBACK_DEFAULT_CONFIG, data, false);
    } catch (_) {
      return deepClone(FALLBACK_DEFAULT_CONFIG);
    }
  }

  function loadUserConfigRaw() {
    if (typeof localStorage === 'undefined') return { raw: null, migratedFromLegacy: false };
    try {
      const rawV3 = localStorage.getItem(STORAGE_KEY);
      if (rawV3) return { raw: JSON.parse(rawV3), migratedFromLegacy: false };

      // v2.0 레거시 설정이 있으면 자동 마이그레이션
      const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (rawLegacy) return { raw: JSON.parse(rawLegacy), migratedFromLegacy: true };
      return { raw: null, migratedFromLegacy: false };
    } catch (_) {
      return { raw: null, migratedFromLegacy: false };
    }
  }

  async function loadConfig() {
    const defaults = await fetchDefaultConfig();
    const { raw, migratedFromLegacy } = loadUserConfigRaw();
    if (!raw) return defaults;

    const merged = mergeConfig(defaults, raw, true);
    if (migratedFromLegacy) {
      // 마이그레이션된 v3 설정을 즉시 v3 키에 저장 (레거시 키는 v2.0 호환을 위해 삭제하지 않음)
      saveConfig(merged);
    }
    return merged;
  }

  function saveConfig(config) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  function resetConfig() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
    return fetchDefaultConfig();
  }

  function validateImportedConfig(obj, currentConfig = null) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('유효한 JSON 객체 형식이 아닙니다.');
    }
    const base = currentConfig ? mergeConfig(FALLBACK_DEFAULT_CONFIG, currentConfig, true) : FALLBACK_DEFAULT_CONFIG;
    // v2.0 백업 JSON 임포트 시 smartstore 채널만 덮어쓰고 cafe24/coupang 기존 설정은 보존
    if (!obj.channels && hasLegacyTopLevelChannelFields(obj)) {
      const next = mergeConfig(base, obj, false);
      next.channels.smartstore = sanitizeChannelConfig(createEmptyChannelConfig(false), extractLegacyChannelFields(obj), true);
      return next;
    }
    return mergeConfig(FALLBACK_DEFAULT_CONFIG, obj, true);
  }

  return {
    APP_VERSION,
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    CHANNELS,
    CHANNEL_META,
    FALLBACK_DEFAULT_CONFIG,
    createEmptyChannelConfig,
    deepClone,
    mergeConfig,
    getEffectiveConfig,
    ensureChannelBag,
    fetchDefaultConfig,
    loadConfig,
    saveConfig,
    resetConfig,
    validateImportedConfig
  };
});
