/**
 * HJC 스마트스토어 재고 매칭 설정 관리 모듈
 * - 팀 공통 기본 설정(default_config.json) + 담당자별 개인 설정(localStorage) 병합
 * - JSON 내보내기 / 불러오기 / 초기화 지원
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HJCConfig = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'hjc_smartstore_matcher_config_v1';

  const FALLBACK_DEFAULT_CONFIG = {
    inventory_url: '',
    hq_default_stock: 100,
    drop_warning_percent: 50,
    models_extra: ['알파13'],
    aliases: {
      '과타라로': '콰타라로',
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
    manual_map: {},
    manual_map_by_name: {
      '안티 베놈 2 ANTI VENOM': ['HJC 헬멧 알파12 안티 베놈2 마블 MC8']
    },
    option_manual_map: {},
    confirmed_missing_sizes: {},
    fixed_stock: {},
    ignore_products: [],
    ignored_options: []
  };

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function mergeConfig(base, override) {
    const b = deepClone(base || FALLBACK_DEFAULT_CONFIG);
    const o = override || {};
    return {
      inventory_url: typeof o.inventory_url === 'string' ? o.inventory_url : b.inventory_url,
      hq_default_stock: Number.isFinite(Number(o.hq_default_stock)) ? Math.max(0, Math.floor(Number(o.hq_default_stock))) : b.hq_default_stock,
      drop_warning_percent: Number.isFinite(Number(o.drop_warning_percent)) ? Math.max(1, Math.min(100, Number(o.drop_warning_percent))) : b.drop_warning_percent,
      models_extra: Array.isArray(o.models_extra) ? [...o.models_extra] : [...b.models_extra],
      aliases: Object.assign({}, b.aliases, o.aliases || {}),
      color_synonyms: Object.assign({}, b.color_synonyms, o.color_synonyms || {}),
      color_fallback: Object.assign({}, b.color_fallback, o.color_fallback || {}),
      manual_map: Object.assign({}, b.manual_map, o.manual_map || {}),
      manual_map_by_name: Object.assign({}, b.manual_map_by_name, o.manual_map_by_name || {}),
      option_manual_map: Object.assign({}, b.option_manual_map, o.option_manual_map || {}),
      confirmed_missing_sizes: Object.assign({}, b.confirmed_missing_sizes, o.confirmed_missing_sizes || {}),
      fixed_stock: Object.assign({}, b.fixed_stock, o.fixed_stock || {}),
      ignore_products: Array.isArray(o.ignore_products) ? [...new Set(o.ignore_products.map(String))] : [...b.ignore_products],
      ignored_options: Array.isArray(o.ignored_options) ? [...new Set(o.ignored_options.map(String))] : [...b.ignored_options]
    };
  }

  async function fetchDefaultConfig() {
    if (typeof fetch !== 'function') {
      return deepClone(FALLBACK_DEFAULT_CONFIG);
    }
    try {
      const res = await fetch(`default_config.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return mergeConfig(FALLBACK_DEFAULT_CONFIG, data);
    } catch (_) {
      return deepClone(FALLBACK_DEFAULT_CONFIG);
    }
  }

  function loadUserConfigRaw() {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  async function loadConfig() {
    const defaults = await fetchDefaultConfig();
    const userRaw = loadUserConfigRaw();
    if (!userRaw) return defaults;
    // 사용자 저장본이 존재하면 삭제된 키가 복원되지 않도록 기본 구조만 보정하고 사용자 값을 존중
    return {
      inventory_url: typeof userRaw.inventory_url === 'string' ? userRaw.inventory_url : defaults.inventory_url,
      hq_default_stock: Number.isFinite(Number(userRaw.hq_default_stock)) ? Math.max(0, Math.floor(Number(userRaw.hq_default_stock))) : defaults.hq_default_stock,
      drop_warning_percent: Number.isFinite(Number(userRaw.drop_warning_percent)) ? Math.max(1, Math.min(100, Number(userRaw.drop_warning_percent))) : defaults.drop_warning_percent,
      models_extra: Array.isArray(userRaw.models_extra) ? userRaw.models_extra : defaults.models_extra,
      aliases: userRaw.aliases && typeof userRaw.aliases === 'object' ? userRaw.aliases : defaults.aliases,
      color_synonyms: userRaw.color_synonyms && typeof userRaw.color_synonyms === 'object' ? userRaw.color_synonyms : defaults.color_synonyms,
      color_fallback: userRaw.color_fallback && typeof userRaw.color_fallback === 'object' ? userRaw.color_fallback : defaults.color_fallback,
      manual_map: userRaw.manual_map && typeof userRaw.manual_map === 'object' ? userRaw.manual_map : defaults.manual_map,
      manual_map_by_name: userRaw.manual_map_by_name && typeof userRaw.manual_map_by_name === 'object' ? userRaw.manual_map_by_name : defaults.manual_map_by_name,
      option_manual_map: userRaw.option_manual_map && typeof userRaw.option_manual_map === 'object' ? userRaw.option_manual_map : defaults.option_manual_map,
      confirmed_missing_sizes: userRaw.confirmed_missing_sizes && typeof userRaw.confirmed_missing_sizes === 'object' ? userRaw.confirmed_missing_sizes : defaults.confirmed_missing_sizes,
      fixed_stock: userRaw.fixed_stock && typeof userRaw.fixed_stock === 'object' ? userRaw.fixed_stock : defaults.fixed_stock,
      ignore_products: Array.isArray(userRaw.ignore_products) ? userRaw.ignore_products.map(String) : defaults.ignore_products,
      ignored_options: Array.isArray(userRaw.ignored_options) ? userRaw.ignored_options.map(String) : defaults.ignored_options
    };
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

  function validateImportedConfig(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('유효한 JSON 객체 형식이 아닙니다.');
    }
    return mergeConfig(FALLBACK_DEFAULT_CONFIG, obj);
  }

  return {
    STORAGE_KEY,
    FALLBACK_DEFAULT_CONFIG,
    deepClone,
    mergeConfig,
    fetchDefaultConfig,
    loadConfig,
    saveConfig,
    resetConfig,
    validateImportedConfig
  };
});
