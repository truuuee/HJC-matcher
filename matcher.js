/**
 * HJC 스마트스토어 재고 매칭 엔진 (명세서 §3 ~ §7-2, §9, §12 구현)
 * - 브라우저(window.HJCMatcher) 및 Node.js(module.exports) 양쪽 호환
 * - 모든 매칭 상수/규칙은 config 객체에서 주입받아 유연하게 변경 가능
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HJCMatcher = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_MODELS = [
    '알파90S', '알파72', '알파71', '알파70', '알파91', '알파60', '알파31', '알파12', '알파11', '알파1',
    'FG-JET', 'CH-5', 'CL-33', 'IS-2', 'C10', 'C50', 'C70', 'C71', 'C91', 'F100', 'F31', 'F70', 'F71',
    'I100', 'I20', 'I30', 'I31', 'I40', 'I50', 'I70', 'I71', 'I80', 'I90', 'I91',
    'V10', 'V30', 'V31', 'V60', 'V90'
  ];

  const COLORS = [
    '세미플랫티타늄', '세미플랫샌드베이지', '세미플랫메탈릭블루', '세미플랫블랙', '플랫블랙',
    '매트블랙', '메탈블랙', '펄화이트', '엔그레이', '딥그린', '딥레드', '딥옐로우',
    '플루오리센트그린', '화이트', '블랙'
  ];

  const BASE_REPL_HEAD = [
    ['SEMIFLAT', '세미플랫'],
    ['METALLICBLUE', '메탈릭블루'],
    ['METALBLACK', '메탈블랙'],
    ['PEARLWHITE', '펄화이트'],
    ['리얼펄화이트', '펄화이트'],
    ['리얼화이트', '펄화이트'],
    ['앤그레이', '엔그레이'],
    ['NGRAY', '엔그레이'],
    ['NGREY', '엔그레이'],
    ['MATTEBLACK', '매트블랙'],
    ['DEEPGREEN', '딥그린'],
    ['DEEPRED', '딥레드'],
    ['DEEPYELLOW', '딥옐로우'],
    ['FLUORESCENTGREEN', '플루오리센트그린'],
    ['러버톤무광블랙', '플랫블랙'],
    ['러버톤플랫블랙', '플랫블랙'],
    ['FLATBLACK', '플랫블랙'],
    ['무광블랙', '매트블랙'],
    ['TITANIUM', '티타늄'],
    ['SANDBEIGE', '샌드베이지']
  ];

  const BASE_REPL_TAIL = [
    ['CARBON', '카본'],
    ['SOLID', '솔리드'],
    ['WHITE', '화이트'],
    ['BLACK', '블랙']
  ];

  const GENERIC_WORDS = new Set([
    'HJC', '헬멧', 'MC', 'V2', 'CARBON', '카본', '솔리드', 'SOLID', '세미', '플랫', '블랙',
    '화이트', '펄', '메탈', '엔', '그레이', '딥', '레드', '그린', '옐로우', '매트', '티타늄',
    '풀페이스', '오픈페이스', '시스템', '제트', '오프로드', '모토크로스', '바이크', '오토바이'
  ]);

  const SIZES_PATTERN = '(3XS|2XS|XS|S|M|L|XL|2XL|3XL|4XL)';
  const END_SIZE_RE = new RegExp('\\s+' + SIZES_PATTERN + '\\s*$', 'i');
  const START_SIZE_RE = new RegExp('^\\s*' + SIZES_PATTERN + '(?![A-Z0-9])', 'i');
  const SHIELD_CODE_BRACKET_RE = /\[(HJ-\d+[A-Z]?|XD-\d+)\]/i;
  const SHIELD_CODE_ANY_RE = /(HJ-\d+[A-Z]?|XD-\d+)/i;
  const SHIELD_CODE_GLOBAL_RE = /(HJ-\d+[A-Z]?|XD-\d+)/gi;

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // §4.3 문자열 정규화
  function canon(s) {
    let t = String(s || '').toUpperCase();
    t = t.replace(/RPHA\s*(\d+)/g, '알파$1');
    t = t.replace(/알파\s*(\d+)/g, '알파$1');
    t = t.replace(/90 S/g, '90S');
    return t;
  }

  function compact(s, config) {
    let t = canon(s).replace(/[\s/\.\(\)\[\],]/g, '');
    for (const [a, b] of BASE_REPL_HEAD) {
      t = t.split(a).join(b);
    }
    // 사용자 추가 색상 동의어 적용 (일반 WHITE/BLACK 치환보다 먼저)
    const syn = (config && config.color_synonyms) || {};
    const synEntries = Object.entries(syn).sort((a, b) => b[0].length - a[0].length);
    for (const [k, v] of synEntries) {
      if (!k) continue;
      const ck = canon(k).replace(/[\s/\.\(\)\[\],]/g, '');
      const cv = canon(v).replace(/[\s/\.\(\)\[\],]/g, '');
      if (ck && ck !== cv) t = t.split(ck).join(cv);
    }
    for (const [a, b] of BASE_REPL_TAIL) {
      t = t.split(a).join(b);
    }
    return t;
  }

  // §4.4, §12.2 모델 목록 자동 추출 + 설정 병합
  function buildModelList(items, config) {
    const modelSet = new Set(DEFAULT_MODELS.map(m => canon(m)));
    const extra = (config && config.models_extra) || [];
    for (const m of extra) {
      if (m && String(m).trim()) modelSet.add(canon(String(m).trim()));
    }

    const patterns = [
      /(?:알파|RPHA)\s?\d+S?/gi,
      /(?<![A-Z0-9])[CFIV]\d{1,3}(?![A-Z0-9])/gi,
      /FG-JET|CH-\d+|CL-\d+|IS-[A-Z0-9]+|CS-[A-Z0-9]+/gi
    ];

    for (const it of items || []) {
      const name = String(it.product_name || '');
      if (!name.startsWith('HJC 헬멧')) continue;
      const baseName = name.replace(END_SIZE_RE, '');
      const c = canon(baseName);
      for (const pat of patterns) {
        pat.lastIndex = 0;
        let m;
        while ((m = pat.exec(c)) !== null) {
          const tok = canon(m[0]).replace(/\s+/g, '');
          // V2는 버전 플래그이므로 모델로 오인하지 않음 (§12.2)
          if (tok === 'V2') continue;
          if (/^[CFIV]\d{1,3}$/.test(tok) && tok.length < 3 && tok !== 'V2') {
            // C10, I20, V10 등 3자 이상만 모델로 인정 (예: I1 등 오탐 방지)
            continue;
          }
          modelSet.add(tok);
        }
      }
    }

    // 긴 모델명부터 탐색하되, 같은 길이는 DEFAULT_MODELS 순서 우선
    const defaultOrder = new Map(DEFAULT_MODELS.map((m, i) => [canon(m), i]));
    return Array.from(modelSet).sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      const oa = defaultOrder.has(a) ? defaultOrder.get(a) : 9999;
      const ob = defaultOrder.has(b) ? defaultOrder.get(b) : 9999;
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });
  }

  function modelOf(s, models) {
    const toks = canon(s).match(/[A-Z0-9가-힣\-]+/g) || [];
    const tokSet = new Set(toks);
    for (const m of models) {
      if (tokSet.has(m)) return m;
    }
    return null;
  }

  function mcOf(s) {
    const m = String(s || '').toUpperCase().match(/MC\s?(\d+)([A-Z]*)/);
    return m ? [m[1], m[2]] : null;
  }

  function flagsOf(s, config) {
    const v2 = canon(s).replace(/\s+/g, '').includes('V2');
    const carb = compact(s, config).includes('카본');
    return { v2, carb };
  }

  function colorOf(s, config) {
    const c = compact(s, config);
    for (const col of COLORS) {
      if (c.includes(col)) return col;
    }
    return null;
  }

  function extractWords(text, model, models) {
    const modelSet = new Set(models);
    const raw = String(text || '').match(/[가-힣A-Za-z0-9]{2,}/g) || [];
    const out = [];
    const seen = new Set();
    for (const w of raw) {
      const wu = w.toUpperCase();
      if (seen.has(wu)) continue;
      if (GENERIC_WORDS.has(wu)) continue;
      if (/^MC\d/.test(wu)) continue;
      if (model && wu === model) continue;
      if (/^(?:(?:알파|RPHA)\d+S?|\d{1,3}S?)$/.test(wu)) continue;
      if (modelSet.has(wu)) continue;
      seen.add(wu);
      out.push(wu);
    }
    return out;
  }

  // §5.1 비교용 정규화 문자열 (별칭 보정 포함)
  function cn(name, config) {
    let t = String(name || '').toUpperCase();
    const aliases = (config && config.aliases) || {};
    const entries = Object.entries(aliases).sort((a, b) => b[0].length - a[0].length);
    for (const [k, v] of entries) {
      if (!k) continue;
      t = t.split(String(k).toUpperCase()).join(String(v || '').toUpperCase());
    }
    return t.replace(/[\s/\.\-\(\)\[\],]/g, '');
  }

  function keywordScore(base, name, config) {
    if (!base.words || base.words.length === 0) return 0.0;
    const c = cn(name, config);
    let hits = 0;
    for (const w of base.words) {
      if (c.includes(w)) hits++;
    }
    return hits / base.words.length;
  }

  // Python difflib.SequenceMatcher.ratio() 근사 구현 (LCS 기반 유사도)
  function similarityRatio(a, b) {
    const s1 = String(a || '').toUpperCase();
    const s2 = String(b || '').toUpperCase();
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;
    const m = s1.length;
    const n = s2.length;
    const dp = new Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
      let prev = 0;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        if (s1[i - 1] === s2[j - 1]) {
          dp[j] = prev + 1;
        } else {
          dp[j] = Math.max(dp[j], dp[j - 1]);
        }
        prev = tmp;
      }
    }
    return (2 * dp[n]) / (m + n);
  }

  // §3 재고수량 산정 규칙
  function newStock(st, hq, hqDefault) {
    const def = Number.isFinite(Number(hqDefault)) ? Number(hqDefault) : 100;
    if (hq) return Math.max(def, st);
    return Math.max(st, 0);
  }

  // §4 헬멧 재고 인덱싱 + 코드/바코드 빠른 조회 인덱스
  function buildInventoryIndex(inventoryData, config) {
    const items = (inventoryData && inventoryData.items) || [];
    const models = buildModelList(items, config);
    const baseMap = new Map();
    const byProductCode = new Map();
    const byBarcode = new Map();
    const nonHelmetItems = [];

    for (const it of items) {
      const pname = String(it.product_name || '').trim();
      const st = Number(it.store_stock) || 0;
      const hq = String(it.hq_stock || '').trim().toUpperCase() === 'O';
      const pcode = String(it.product_code || '').trim().toUpperCase();
      const bcode = String(it.barcode || '').trim().toUpperCase();

      if (pcode) {
        if (!byProductCode.has(pcode)) byProductCode.set(pcode, []);
        byProductCode.get(pcode).push(it);
      }
      if (bcode) {
        if (!byBarcode.has(bcode)) byBarcode.set(bcode, []);
        byBarcode.get(bcode).push(it);
      }

      if (!pname.startsWith('HJC 헬멧')) {
        nonHelmetItems.push(it);
        continue;
      }

      const szMatch = pname.match(END_SIZE_RE);
      if (!szMatch) {
        nonHelmetItems.push(it);
        continue;
      }

      const size = szMatch[1].toUpperCase();
      const baseName = pname.slice(0, szMatch.index).trim();
      const model = modelOf(baseName, models);
      if (!model) continue;

      if (!baseMap.has(baseName)) {
        const mc = mcOf(baseName);
        const fl = flagsOf(baseName, config);
        const solid = compact(baseName, config).includes('솔리드') && !mc;
        const color = solid ? colorOf(baseName, config) : null;
        const words = extractWords(baseName, model, models);
        baseMap.set(baseName, {
          name: baseName,
          model,
          v2: fl.v2,
          carb: fl.carb,
          mc,
          solid,
          color,
          words,
          sizes: {},
          codes: new Set(),
          barcodes: new Set()
        });
      }

      const rec = baseMap.get(baseName);
      if (!rec.sizes[size]) rec.sizes[size] = [0, false];
      rec.sizes[size][0] += st;
      rec.sizes[size][1] = rec.sizes[size][1] || hq;
      if (pcode) rec.codes.add(pcode);
      if (bcode) rec.barcodes.add(bcode);
    }

    const bases = Array.from(baseMap.values());
    const basesByModel = new Map();
    for (const b of bases) {
      if (!basesByModel.has(b.model)) basesByModel.set(b.model, []);
      basesByModel.get(b.model).push(b);
    }

    return {
      meta: (inventoryData && inventoryData.meta) || {},
      items,
      nonHelmetItems,
      models,
      bases,
      baseMap,
      basesByModel,
      byProductCode,
      byBarcode
    };
  }

  function mergeBaseSizes(matchedBases) {
    const merged = {};
    for (const b of matchedBases) {
      for (const [sz, [st, hq]] of Object.entries(b.sizes || {})) {
        if (!merged[sz]) merged[sz] = [0, false];
        merged[sz][0] += st;
        merged[sz][1] = merged[sz][1] || hq;
      }
    }
    return merged;
  }

  function summarizeBase(b) {
    let totalStore = 0;
    let hqCount = 0;
    const szKeys = Object.keys(b.sizes || {});
    for (const [st, hq] of Object.values(b.sizes || {})) {
      totalStore += st;
      if (hq) hqCount++;
    }
    return {
      name: b.name,
      totalStore,
      hqAny: hqCount > 0,
      hqCount,
      sizeCount: szKeys.length,
      sizes: szKeys.join(', ')
    };
  }

  // §12.3 후보 점수 기반 상위 N개 추천 계산
  function rankHelmetCandidates(productName, index, config, topN = 3) {
    const model = modelOf(productName, index.models);
    const mc = mcOf(productName);
    const fl = flagsOf(productName, config);
    const col = colorOf(productName, config);
    const nameWords = extractWords(productName, model, index.models);
    const cName = cn(productName, config);
    const aliases = (config && config.aliases) || {};

    let pool = model ? (index.basesByModel.get(model) || []) : index.bases;
    if (pool.length === 0) pool = index.bases;

    const scored = [];
    for (const b of pool) {
      let pts = 0;
      if (model && b.model === model) pts += 15;
      if (b.v2 === fl.v2) pts += 5; else pts -= 15;
      if (b.carb === fl.carb) pts += 5; else pts -= 15;

      if (mc && b.mc) {
        if (mc[0] === b.mc[0] && mc[1] === b.mc[1]) pts += 50;
        else if (mc[0] === b.mc[0]) pts += 35;
      }
      if (col && b.solid && b.color === col) {
        pts += 50;
      } else if (col && b.solid && config && config.color_fallback && config.color_fallback[col] === b.color) {
        pts += 30;
      }

      const kw = keywordScore(b, productName, config);
      pts += Math.round(40 * kw);

      // 키워드 유사 일치 (difflib >= 0.8)
      if (b.words.length > 0 && nameWords.length > 0) {
        let bestSimSum = 0;
        for (const bw of b.words) {
          let bestSim = 0;
          if (cName.includes(bw)) {
            bestSim = 1.0;
          } else {
            for (const nw of nameWords) {
              const r = similarityRatio(bw, nw);
              if (r > bestSim) bestSim = r;
            }
          }
          if (bestSim >= 0.8 && bestSim < 1.0) bestSimSum += bestSim;
        }
        pts += Math.round(20 * (bestSimSum / b.words.length));
      }

      // 별칭 사전 적중 가산점
      for (const [k, v] of Object.entries(aliases)) {
        if (productName.toUpperCase().includes(k.toUpperCase()) && b.name.toUpperCase().includes(String(v).toUpperCase())) {
          pts += 40;
          break;
        }
      }

      scored.push({
        base: b,
        score: Math.max(0, Math.min(100, pts)),
        ...summarizeBase(b)
      });
    }

    scored.sort((a, b) => b.score - a.score || b.totalStore - a.totalStore);
    return scored.slice(0, topN);
  }

  // §12.6 별칭 사전 자동 학습 후보 추출
  function detectAliasCandidates(productName, matchedBases, index, config) {
    const model = modelOf(productName, index.models);
    const pWords = extractWords(productName, model, index.models);
    const aliases = (config && config.aliases) || {};
    const cName = cn(productName, config);
    const found = [];

    const isKorean = s => /^[가-힣]+$/.test(s);
    const isAscii = s => /^[A-Z0-9]+$/.test(s);

    for (const b of matchedBases) {
      for (const bw of b.words) {
        if (cName.includes(bw)) continue; // 이미 일치
        for (const pw of pWords) {
          if (pw === bw) continue;
          if (aliases[pw]) continue;
          // 같은 문자 체계끼리만 비교 (한글↔한글 또는 영문↔영문)
          if (!((isKorean(pw) && isKorean(bw)) || (isAscii(pw) && isAscii(bw)))) continue;
          if (pw.length < 2 || bw.length < 2) continue;
          const sim = similarityRatio(pw, bw);
          if (sim >= 0.6 && sim < 1.0) {
            found.push({
              from: pw,
              to: bw,
              similarity: Number(sim.toFixed(2)),
              sampleProduct: productName,
              sampleBase: b.name
            });
          }
        }
      }
    }
    return found;
  }

  // §5.2 헬멧 매칭 (find_group)
  function findHelmetGroup(productRow, index, config) {
    const productNo = String(productRow.productNo || '').trim();
    const name = String(productRow.productName || '').trim();
    const sellerCode = String(productRow.sellerCode || '').trim().toUpperCase();
    const sellerBarcode = String(productRow.sellerBarcode || '').trim().toUpperCase();

    // 0. 고정밀 모드 (§12.8): 판매자 상품코드 / 판매자바코드 최우선
    if (sellerCode || sellerBarcode) {
      const codeMatchedBases = [];
      for (const b of index.bases) {
        if ((sellerCode && (b.codes.has(sellerCode) || b.barcodes.has(sellerCode))) ||
            (sellerBarcode && (b.barcodes.has(sellerBarcode) || b.codes.has(sellerBarcode)))) {
          codeMatchedBases.push(b);
        }
      }
      if (codeMatchedBases.length > 0) {
        return {
          bases: codeMatchedBases,
          method: '판매자코드 일치',
          isEstimate: false,
          isNewModel: false,
          aliasCandidates: []
        };
      }
    }

    // 1. 수동 매핑 (§5.4, §12.5): 상품번호 우선 → 상품명 포함 문자열
    const manualByNo = config && config.manual_map && config.manual_map[productNo];
    if (Array.isArray(manualByNo) && manualByNo.length > 0) {
      const bases = manualByNo.map(bn => index.baseMap.get(bn)).filter(Boolean);
      if (bases.length > 0) {
        return {
          bases,
          method: '수동매핑(상품번호)',
          isEstimate: false,
          isNewModel: false,
          aliasCandidates: []
        };
      }
    }

    const manualByName = (config && config.manual_map_by_name) || {};
    const upperName = name.toUpperCase();
    for (const [substr, baseNames] of Object.entries(manualByName)) {
      if (!substr || !Array.isArray(baseNames)) continue;
      if (upperName.includes(String(substr).toUpperCase())) {
        const bases = baseNames.map(bn => index.baseMap.get(bn)).filter(Boolean);
        if (bases.length > 0) {
          return {
            bases,
            method: '수동매핑(상품명)',
            isEstimate: false,
            isNewModel: false,
            aliasCandidates: []
          };
        }
      }
    }

    const model = modelOf(name, index.models);
    if (!model) {
      return {
        bases: [],
        method: '모델 식별 불가 (재고 미등록 신제품)',
        isEstimate: false,
        isNewModel: true,
        aliasCandidates: []
      };
    }

    const cands = index.basesByModel.get(model) || [];
    if (cands.length === 0) {
      return {
        bases: [],
        method: `재고 미등록 모델(${model})`,
        isEstimate: false,
        isNewModel: true,
        aliasCandidates: []
      };
    }

    const mc = mcOf(name);
    const { v2, carb } = flagsOf(name, config);

    // [A] 상품명에 MC코드가 있는 경우
    if (mc) {
      let matched = cands.filter(b => b.mc && b.mc[0] === mc[0] && b.mc[1] === mc[1] && b.v2 === v2 && b.carb === carb);
      let method = '정확';

      if (matched.length === 0) {
        matched = cands.filter(b => b.mc && b.mc[0] === mc[0] && b.v2 === v2 && b.carb === carb);
        method = 'MC코드 유사';
      }
      if (matched.length === 0) {
        matched = cands.filter(b => b.mc && b.mc[0] === mc[0] && b.mc[1] === mc[1]);
        method = 'V2/카본 표기 차이';
      }
      if (matched.length === 0) {
        return {
          bases: [],
          method: 'MC코드 일치 후보 없음',
          isEstimate: false,
          isNewModel: false,
          aliasCandidates: []
        };
      }

      if (matched.length >= 2) {
        const scored = matched.map(b => ({ b, s: keywordScore(b, name, config) }));
        const top = Math.max(...scored.map(x => x.s));
        if (top <= 0) {
          return {
            bases: [],
            method: `동일 MC 후보 ${matched.length}개 구분불가`,
            isEstimate: false,
            isNewModel: false,
            aliasCandidates: []
          };
        }
        matched = scored.filter(x => x.s >= top - 0.01).map(x => x.b);
      }

      const aliasCandidates = detectAliasCandidates(name, matched, index, config);
      return {
        bases: matched,
        method,
        isEstimate: false,
        isNewModel: false,
        aliasCandidates
      };
    }

    // [B] MC코드가 없는 경우
    const col = colorOf(name, config);
    const isSolidLike = compact(name, config).includes('솔리드') || col !== null;

    if (isSolidLike && col) {
      let matched = cands.filter(b => b.solid && b.color === col && b.v2 === v2 && b.carb === carb);
      if (matched.length > 0) {
        return { bases: matched, method: '솔리드 색상 일치', isEstimate: false, isNewModel: false, aliasCandidates: [] };
      }

      matched = cands.filter(b => b.solid && b.color === col && b.carb === carb);
      if (matched.length > 0) {
        return { bases: matched, method: 'V2 표기 차이', isEstimate: false, isNewModel: false, aliasCandidates: [] };
      }

      const fallbackMap = (config && config.color_fallback) || {};
      const altCol = fallbackMap[col];
      if (altCol) {
        matched = cands.filter(b => b.solid && b.color === altCol && b.carb === carb);
        if (matched.length > 0) {
          return {
            bases: matched,
            method: `★추정(${col}→${altCol})`,
            isEstimate: true,
            isNewModel: false,
            aliasCandidates: []
          };
        }
      }
    }

    // 솔리드 매칭 실패 시 디자인명 매칭
    const designPool = cands.filter(b => b.mc && b.v2 === v2 && b.carb === carb && b.words.length > 0);
    if (designPool.length > 0) {
      const scored = designPool.map(b => ({ b, s: keywordScore(b, name, config) }));
      const top = Math.max(...scored.map(x => x.s));
      if (top >= 1.0) {
        const matched = scored.filter(x => x.s >= 0.99).map(x => x.b);
        return {
          bases: matched,
          method: '디자인명 일치(MC 미표기)',
          isEstimate: false,
          isNewModel: false,
          aliasCandidates: []
        };
      }
    }

    return {
      bases: [],
      method: '일치하는 재고 상품 없음',
      isEstimate: false,
      isNewModel: false,
      aliasCandidates: []
    };
  }

  // §6.1 스마트스토어 옵션/추가상품 값 → 부품 종류
  function partOf(label) {
    const l = String(label || '').replace(/\s+/g, '');
    if (!l) return null;
    if (l.includes('핀락')) return '핀락';
    if (l.includes('기어판') || l.includes('기어플레이트')) return '기어판';
    if (l.includes('사이드커버')) return '사이드커버';
    if (l.includes('변색') || l.toUpperCase().replace(/SHADE/g, '쉐이드').includes('쉐이드')) return '변색';

    const pairs = [
      ['클리어', '투명'],
      ['투명', '투명'],
      ['다크스모크', '스모그'],
      ['스모그', '스모그'],
      ['스모크', '스모그'],
      ['골드', '골드'],
      ['실버', '실버'],
      ['블루', '블루'],
      ['파이어레드', '레드'],
      ['레드', '레드']
    ];
    for (const [k, v] of pairs) {
      if (l.includes(k)) return v;
    }
    return null;
  }

  // §6.2 재고 품목명 → 부품 종류
  function invPart(name) {
    const l = String(name || '').replace(/\s+/g, '');
    if (!l) return null;
    if (l.includes('변색핀락')) return '변색핀락';
    if (l.includes('핀락')) return '핀락';
    if (l.includes('기어판') || l.includes('기어플레이트')) return '기어판';
    if (l.includes('사이드커버')) return '사이드커버';
    if (l.includes('변색')) return '변색';

    const pairs = [
      ['안티포그투명', '투명'],
      ['투명(라이트스모그)', '투명'],
      ['라이트스모그', '스모그'],
      ['다크스모그', '스모그'],
      ['투명', '투명'],
      ['클리어', '투명'],
      ['스모그', '스모그'],
      ['골드', '골드'],
      ['실버', '실버'],
      ['블루', '블루'],
      ['파이어레드', '레드'],
      ['레드', '레드']
    ];
    for (const [k, v] of pairs) {
      if (l.includes(k)) return v;
    }
    return null;
  }

  // §7-2.2 그룹명 → 부품 종류
  function groupPart(gname) {
    const g = String(gname || '').replace(/\s+/g, '');
    if (g.includes('핀락')) return '핀락';
    if (g.includes('기어판') || g.includes('기어플레이트')) return '기어판';
    if (g.includes('사이드커버')) return '사이드커버';
    if (g.includes('변색')) return '변색';
    return null;
  }

  function extractShieldCode(text, bracketOnly = false) {
    const m = String(text || '').match(bracketOnly ? SHIELD_CODE_BRACKET_RE : SHIELD_CODE_ANY_RE);
    return m ? m[1].toUpperCase() : null;
  }

  // §6.3 쉴드/부품 후보 탐색
  function findShield(code, part, index) {
    if (!code || !part) {
      return { items: [], method: '코드/부품 식별불가', isEstimate: false };
    }
    const exactRe = new RegExp('(?<![A-Z0-9])' + escapeRegex(code) + '(?![A-Z0-9])', 'i');
    let cand = index.nonHelmetItems.filter(it =>
      exactRe.test(String(it.product_name || '').toUpperCase()) && invPart(it.product_name) === part
    );
    if (cand.length > 0) {
      return { items: cand, method: `코드 일치(${code}/${part})`, isEstimate: false };
    }

    // 유사코드 폴백: 접미 알파벳 1자 허용 (예: HJ-45 → HJ-45B, HJ-34 → HJ-34P)
    const fuzzyRe = new RegExp('(?<![A-Z0-9])' + escapeRegex(code) + '[A-Z](?![A-Z0-9])', 'i');
    cand = index.nonHelmetItems.filter(it =>
      fuzzyRe.test(String(it.product_name || '').toUpperCase()) && invPart(it.product_name) === part
    );
    if (cand.length > 0) {
      return { items: cand, method: `★추정(유사코드 ${code})`, isEstimate: true };
    }

    return { items: [], method: `★매칭실패(${code}/${part})`, isEstimate: false };
  }

  // 단일 상품/파츠 추천 후보 Top 3
  function rankGeneralItemCandidates(queryName, index, topN = 3) {
    const qTokens = (String(queryName || '').toUpperCase().match(/[가-힣A-Z0-9\-]{2,}/g) || [])
      .filter(t => !GENERIC_WORDS.has(t));
    const scored = [];
    for (const it of index.nonHelmetItems) {
      const n = String(it.product_name || '').toUpperCase();
      let hits = 0;
      for (const tok of qTokens) {
        if (n.includes(tok)) hits++;
      }
      const sim = qTokens.length > 0 ? Math.round((hits / qTokens.length) * 80) : 0;
      const strSim = Math.round(similarityRatio(queryName, it.product_name) * 20);
      const pts = sim + strSim;
      if (pts > 0) {
        scored.push({
          name: it.product_name,
          score: Math.min(100, pts),
          totalStore: Number(it.store_stock) || 0,
          hqAny: String(it.hq_stock || '').toUpperCase() === 'O',
          sizes: '-'
        });
      }
    }
    scored.sort((a, b) => b.score - a.score || b.totalStore - a.totalStore);
    return scored.slice(0, topN);
  }

  // 고정재고 예외 확인 (§12.5 fixed_stock)
  function checkFixedStock(config, keys) {
    const fixed = (config && config.fixed_stock) || {};
    for (const k of keys) {
      if (!k) continue;
      if (Object.prototype.hasOwnProperty.call(fixed, k)) {
        const v = Number(fixed[k]);
        if (Number.isFinite(v) && v >= 0) return { key: k, value: Math.floor(v) };
      }
    }
    return null;
  }

  // 옵션·추가상품 수동 매핑 조회 (개별 상품번호::라벨 우선 → 공통::라벨)
  function lookupOptionManualMap(config, index, keys) {
    const map = (config && config.option_manual_map) || {};
    for (const k of keys) {
      if (!k) continue;
      const targetNames = map[k];
      if (!Array.isArray(targetNames) || targetNames.length === 0) continue;
      const matched = index.items.filter(it => targetNames.includes(it.product_name));
      if (matched.length > 0) {
        return {
          items: matched,
          method: k.startsWith('공통::') ? '수동매핑(공통확정)' : '수동매핑(개별확정)',
          isEstimate: false
        };
      }
    }
    return null;
  }

  function isIgnoredOption(config, keys) {
    const set = new Set(((config && config.ignored_options) || []).map(String));
    for (const k of keys) {
      if (k && set.has(k)) return true;
    }
    return false;
  }

  // 오늘출발 보정 수량 조회 (§9)
  function lookupTodayShipMin(todayShipMap, productNo, optionValue) {
    if (!todayShipMap) return null;
    const pno = String(productNo || '').trim();
    const opt = String(optionValue || '').trim();
    if (opt && todayShipMap.has(`${pno}::${opt}`)) return todayShipMap.get(`${pno}::${opt}`);
    if (todayShipMap.has(pno)) return todayShipMap.get(pno);
    return null;
  }

  // §7-2 추가상품(V~Y열) 처리
  function processAddons(row, index, config) {
    const vRaw = String(row.addonNames || '');
    const wRaw = String(row.addonValues || '');
    const xRaw = String(row.addonPrices || '');
    const yRaw = String(row.addonStocks || '');

    if (!vRaw.trim()) {
      return {
        hasAddons: false,
        newY: yRaw,
        structureMismatch: false,
        details: [],
        failCount: 0,
        estimateCount: 0
      };
    }

    const vGroups = vRaw.split('\n');
    const wGroups = wRaw.split('\n');
    const yGroups = yRaw.split('\n');
    const xGroups = xRaw ? xRaw.split('\n') : null;

    let mismatch = (vGroups.length !== wGroups.length) || (vGroups.length !== yGroups.length);
    if (!mismatch && xGroups && xGroups.length !== vGroups.length) mismatch = true;
    if (!mismatch) {
      for (let gi = 0; gi < vGroups.length; gi++) {
        const wc = wGroups[gi].split(',').length;
        const yc = yGroups[gi].split(',').length;
        if (wc !== yc) { mismatch = true; break; }
        if (xGroups && xGroups[gi].split(',').length !== wc) { mismatch = true; break; }
      }
    }

    if (mismatch) {
      return {
        hasAddons: true,
        newY: yRaw, // 구조 불일치 시 원본 유지 (§7-2.1)
        structureMismatch: true,
        details: [{
          productNo: row.productNo,
          productName: row.productName,
          label: '[추가상품 전체]',
          oldStock: 0,
          newStock: 0,
          matchedItems: '-',
          detail: '★구조 불일치 (V/W/X/Y 줄수·쉼표수 불일치 → 원본 유지)',
          status: 'fail',
          isEstimate: false,
          isFail: true
        }],
        failCount: 1,
        estimateCount: 0
      };
    }

    // 대표 코드 산출: 같은 상품 추가상품 전체 값에서 최빈 코드 (§7-2.2)
    const codeCounts = new Map();
    for (const wg of wGroups) {
      const matches = wg.match(SHIELD_CODE_GLOBAL_RE) || [];
      for (const m of matches) {
        const up = m.toUpperCase();
        codeCounts.set(up, (codeCounts.get(up) || 0) + 1);
      }
    }
    let dominantCode = null;
    let maxCnt = 0;
    for (const [cd, cnt] of codeCounts.entries()) {
      if (cnt > maxCnt) {
        maxCnt = cnt;
        dominantCode = cd;
      }
    }
    const productCodeInName = extractShieldCode(row.productName, false);
    const hqDef = config.hq_default_stock;

    const newYGroups = [];
    const details = [];
    let failCount = 0;
    let estimateCount = 0;

    for (let gi = 0; gi < vGroups.length; gi++) {
      const gname = vGroups[gi].trim();
      const vals = wGroups[gi].split(',');
      const olds = yGroups[gi].split(',');
      const newGroupStocks = [];

      for (let vi = 0; vi < vals.length; vi++) {
        const val = vals[vi].trim();
        const oldNum = parseInt(String(olds[vi] || '0').trim(), 10) || 0;
        const label = `[${gname}] ${val}`;

        const part = partOf(val) || groupPart(gname);
        const code = extractShieldCode(val, false)
          || extractShieldCode(gname, false)
          || dominantCode
          || productCodeInName;

        const optIgnored = isIgnoredOption(config, [
          `${row.productNo}::${label}`,
          `공통::${label}`,
          `공통::${val}`
        ]);

        const manualRes = optIgnored ? null : lookupOptionManualMap(config, index, [
          `${row.productNo}::${label}`,
          `공통::${label}`,
          `공통::${val}`
        ]);
        const res = optIgnored ? { items: [], method: '', isEstimate: false } : (manualRes || findShield(code, part, index));
        const matchedNames = res.items.map(it => it.product_name);
        const matchedLabel = optIgnored ? '(매핑 해제 · 기존유지)' : (matchedNames.length > 0 ? matchedNames.join(' / ') : '-');

        // 고정재고 예외 확인
        const fixedKeys = [
          `${row.productNo}:추가상품:${val}`,
          `추가상품:${val}`,
          ...matchedNames.map(n => `추가상품:${n}`),
          ...matchedNames.map(n => `추가상품:${n.replace(/^HJC\s+/i, '')}`)
        ];
        const fixedHit = checkFixedStock(config, fixedKeys);

        let calcNew = oldNum;
        let detailText = '';
        let isFail = false;
        let isEstimate = false;

        if (fixedHit) {
          calcNew = fixedHit.value;
          detailText = `고정재고 예외(${fixedHit.key}=${fixedHit.value})`;
        } else if (optIgnored) {
          calcNew = oldNum;
          detailText = '수동 매핑 해제 (기존재고 유지 · 정상처리)';
        } else if (res.items.length > 0) {
          const st = res.items.reduce((acc, c) => acc + (Number(c.store_stock) || 0), 0);
          const hq = res.items.some(c => String(c.hq_stock || '').toUpperCase() === 'O');
          calcNew = newStock(st, hq, hqDef);
          isEstimate = res.isEstimate;
          if (isEstimate) estimateCount++;
          detailText = `${res.method} (매장:${st}, 본사:${hq ? 'O' : 'X'})`;
        } else {
          calcNew = oldNum;
          isFail = true;
          failCount++;
          detailText = `★매칭실패 (${res.method} → 기존유지)`;
        }

        newGroupStocks.push(String(calcNew));
        details.push({
          productNo: row.productNo,
          productName: row.productName,
          groupName: gname,
          valueName: val,
          label: `[${gname}] ${val}`,
          oldStock: oldNum,
          newStock: calcNew,
          matchedItems: matchedLabel,
          detail: detailText,
          code: code || '',
          part: part || '',
          isEstimate,
          isFail,
          fixedKeyCandidate: matchedNames[0] ? `추가상품:${matchedNames[0].replace(/^HJC\s+/i, '')}` : `추가상품:${val}`
        });
      }

      newYGroups.push(newGroupStocks.join(','));
    }

    return {
      hasAddons: true,
      newY: newYGroups.join('\n'),
      structureMismatch: false,
      details,
      failCount,
      estimateCount
    };
  }

  // 전체 스마트스토어 상품 행 매칭 실행
  function runMatching(productRows, inventoryData, config, options = {}) {
    const cfg = Object.assign({
      hq_default_stock: 100,
      drop_warning_percent: 50,
      models_extra: [],
      aliases: {},
      color_synonyms: {},
      color_fallback: {},
      manual_map: {},
      manual_map_by_name: {},
      option_manual_map: {},
      confirmed_missing_sizes: {},
      fixed_stock: {},
      ignore_products: [],
      ignored_options: []
    }, config || {});

    const index = buildInventoryIndex(inventoryData, cfg);
    const ignoreSet = new Set((cfg.ignore_products || []).map(String));
    const todayShipMap = options.todayShipMap || null;
    const applyTodayShipFloor = Boolean(options.applyTodayShipFloor && todayShipMap);

    const productSummaries = [];
    const optionDetails = [];
    const addonDetails = [];
    const reviewQueue = [];
    const aliasCandidateMap = new Map();
    const dropWarnings = [];
    const cellUpdates = []; // { rowIndex, newM, newS, newY, productNo }

    let oldTotalSum = 0;
    let newTotalSum = 0;
    let statusCounts = { 정상: 0, 주의: 0, 확인필요: 0, 미반영: 0, 제외: 0 };
    let totalAddonProducts = 0;
    let totalAddonItems = 0;
    let totalAddonFail = 0;
    let totalAddonEstimate = 0;
    let todayShipAdjustedCount = 0;

    for (const row of productRows) {
      const pno = String(row.productNo || '').trim();
      const pname = String(row.productName || '').trim();
      const optType = String(row.optionType || '').trim();
      const optName = String(row.optionName || '').trim();
      const optValRaw = String(row.optionValues || '');
      const optStkRaw = String(row.optionStocks || '');
      const oldMNum = parseInt(String(row.totalStock || '0').trim(), 10) || 0;

      // 수동 매핑 해제(제외) 상품 처리 (§12.5 ignore_products → 기존재고 유지 + 정상 처리)
      if (ignoreSet.has(pno)) {
        oldTotalSum += oldMNum;
        newTotalSum += oldMNum;
        statusCounts['정상']++;
        productSummaries.push({
          rowIndex: row.rowIndex,
          productNo: pno,
          productName: pname,
          optionType: optType,
          optionName: optName,
          oldTotal: oldMNum,
          newTotal: oldMNum,
          diff: 0,
          status: '정상',
          failOpts: 0,
          estOpts: 0,
          noSizeOpts: 0,
          addonFail: 0,
          addonEst: 0,
          matchMethod: '수동 매핑 해제 (기존재고 유지)',
          matchedSummary: '(매핑 해제 · 기존유지)',
          isIgnored: true
        });
        cellUpdates.push({
          rowIndex: row.rowIndex,
          productNo: pno,
          newM: String(row.totalStock ?? oldMNum),
          newS: optStkRaw,
          newY: String(row.addonStocks || ''),
          hasOptions: Boolean(optValRaw.trim()),
          hasAddons: Boolean(String(row.addonNames || '').trim())
        });
        continue;
      }

      const hasOptions = Boolean(optValRaw.trim());
      let newOptStocks = [];
      let failOpts = 0;
      let estOpts = 0;
      let noSizeOpts = 0;
      let totalOpts = 0;
      let matchMethod = '';
      let matchedSummary = '-';
      let productTodayShipWarn = false;

      if (!hasOptions) {
        // §7 옵션 없는 단일 상품
        totalOpts = 1;
        const singleRes = matchSingleProduct(row, index, cfg);
        let calcNew = singleRes.newVal;
        matchMethod = singleRes.method;
        matchedSummary = singleRes.matchedLabel;

        if (applyTodayShipFloor) {
          const minShip = lookupTodayShipMin(todayShipMap, pno, '');
          if (minShip !== null && calcNew < minShip) {
            calcNew = minShip;
            productTodayShipWarn = true;
            todayShipAdjustedCount++;
          }
        }

        if (singleRes.isFail) failOpts = 1;
        if (singleRes.isEstimate) estOpts = 1;

        newOptStocks = [calcNew];
        optionDetails.push({
          productNo: pno,
          productName: pname,
          optionValue: '(단일상품)',
          oldStock: oldMNum,
          newStock: calcNew,
          matchedItems: matchedSummary,
          detail: singleRes.detail + (productTodayShipWarn ? ' [오늘출발 하한 보정]' : ''),
          isFail: singleRes.isFail,
          isEstimate: singleRes.isEstimate,
          isNoSize: false
        });

        if (singleRes.isFail || singleRes.isEstimate) {
          reviewQueue.push({
            queueType: singleRes.isFail ? '매칭 실패' : '저신뢰 매칭',
            productNo: pno,
            productName: pname,
            targetType: 'single',
            optionValue: '(단일상품)',
            reason: singleRes.method,
            currentAction: singleRes.isFail ? '기존 재고 유지' : '추정 계산 반영',
            candidates: rankGeneralItemCandidates(pname, index, 3)
          });
        }
      } else if (optName.replace(/\s+/g, '') === '사이즈') {
        // §5 헬멧 매칭 (옵션명 == '사이즈')
        const optVals = optValRaw.split('\n');
        const optStks = optStkRaw.split('\n');
        totalOpts = optVals.length;

        const grp = findHelmetGroup(row, index, cfg);
        matchMethod = grp.method;
        const matchedBases = grp.bases || [];
        matchedSummary = matchedBases.length > 0 ? matchedBases.map(b => b.name).join(' + ') : '-';
        const mergedSizes = mergeBaseSizes(matchedBases);

        // 별칭 학습 후보 수집 (§12.6)
        for (const ac of grp.aliasCandidates || []) {
          const key = `${ac.from}=>${ac.to}`;
          if (!aliasCandidateMap.has(key)) aliasCandidateMap.set(key, ac);
        }

        const missingSizeNames = [];
        const confirmedMissingSet = new Set(
          ((cfg.confirmed_missing_sizes && cfg.confirmed_missing_sizes[pno]) || []).map(s => String(s).toUpperCase())
        );

        for (let i = 0; i < optVals.length; i++) {
          const ov = optVals[i];
          const oldVal = parseInt(String(optStks[i] ?? '0').trim(), 10) || 0;
          const m = ov.toUpperCase().match(START_SIZE_RE);
          const size = m ? m[1].toUpperCase() : (ov.trim().split(/\s+/)[0] || '').toUpperCase();

          let calcNew = oldVal;
          let detail = '';
          let isFail = false;
          let isEst = false;
          let isNoSz = false;

          const fixedHit = checkFixedStock(cfg, [`${pno}:${ov.trim()}`, `${pno}:${size}`]);
          if (fixedHit) {
            calcNew = fixedHit.value;
            detail = `고정재고 예외(${fixedHit.key}=${fixedHit.value})`;
          } else if (matchedBases.length > 0) {
            if (mergedSizes[size]) {
              const [st, hq] = mergedSizes[size];
              calcNew = newStock(st, hq, cfg.hq_default_stock);
              isEst = grp.isEstimate;
              if (isEst) estOpts++;
              detail = `${grp.method} / ${size} (매장:${st}, 본사:${hq ? 'O' : 'X'})`;
            } else {
              calcNew = 0;
              const isManualCompleted = grp.method === '수동매핑(상품번호)';
              if (confirmedMissingSet.has(size) || isManualCompleted) {
                detail = `${isManualCompleted ? '수동매핑 확정' : '확인완료'}: 재고목록에 ${size} 사이즈 없음 → 0`;
              } else {
                isNoSz = true;
                noSizeOpts++;
                missingSizeNames.push(size);
                detail = `주의: 재고목록에 ${size} 사이즈 없음 → 0`;
              }
            }
          } else {
            calcNew = oldVal;
            isFail = true;
            failOpts++;
            detail = `★매칭실패 (${grp.method} → 기존유지)`;
          }

          if (applyTodayShipFloor) {
            const minShip = lookupTodayShipMin(todayShipMap, pno, ov);
            if (minShip !== null && calcNew < minShip) {
              calcNew = minShip;
              productTodayShipWarn = true;
              todayShipAdjustedCount++;
              detail += ` [오늘출발 하한 ${minShip} 보정]`;
            }
          }

          newOptStocks.push(calcNew);
          optionDetails.push({
            productNo: pno,
            productName: pname,
            optionValue: ov,
            oldStock: oldVal,
            newStock: calcNew,
            matchedItems: matchedSummary,
            detail,
            isFail,
            isEstimate: isEst,
            isNoSize: isNoSz
          });
        }

        // 확인 큐 등록 (§12.7)
        if (matchedBases.length === 0 || grp.isEstimate) {
          reviewQueue.push({
            queueType: matchedBases.length === 0 ? (grp.isNewModel ? '재고 미등록 신제품' : '매칭 실패') : '저신뢰 매칭',
            productNo: pno,
            productName: pname,
            targetType: 'helmet',
            optionValue: `옵션 ${totalOpts}개`,
            reason: grp.method,
            currentAction: matchedBases.length === 0 ? '기존 재고 유지' : '추정 계산 반영',
            candidates: rankHelmetCandidates(pname, index, cfg, 3)
          });
        } else if (missingSizeNames.length > 0) {
          reviewQueue.push({
            queueType: '사이즈 없음',
            productNo: pno,
            productName: pname,
            targetType: 'helmet-size',
            optionValue: missingSizeNames.join(', '),
            missingSizes: [...missingSizeNames],
            matchedBaseNames: matchedBases.map(b => b.name),
            reason: `매칭됨(${matchedSummary}) / 미존재 사이즈: ${missingSizeNames.join(', ')}`,
            currentAction: '0 처리 (주의)',
            candidates: rankHelmetCandidates(pname, index, cfg, 3)
          });
        }
      } else {
        // §6 쉴드/핀락/기어판 매칭 (옵션명 == '색상' 등)
        const optVals = optValRaw.split('\n');
        const optStks = optStkRaw.split('\n');
        totalOpts = optVals.length;
        const prodCode = extractShieldCode(pname, false);
        const matchedSet = new Set();
        matchMethod = '쉴드/파츠 코드 매칭';

        for (let i = 0; i < optVals.length; i++) {
          const ov = optVals[i];
          const ovTrim = ov.trim();
          const oldVal = parseInt(String(optStks[i] ?? '0').trim(), 10) || 0;
          const code = extractShieldCode(ov, true) || extractShieldCode(ov, false) || prodCode;
          const part = partOf(ov);

          const optIgnored = isIgnoredOption(cfg, [
            `${pno}::${ovTrim}`,
            `공통::${ovTrim}`
          ]);
          const manualRes = optIgnored ? null : lookupOptionManualMap(cfg, index, [
            `${pno}::${ovTrim}`,
            `공통::${ovTrim}`
          ]);
          const res = optIgnored ? { items: [], method: '', isEstimate: false } : (manualRes || findShield(code, part, index));
          const matchedNames = res.items.map(it => it.product_name);
          const matchedLabel = optIgnored ? '(매핑 해제 · 기존유지)' : (matchedNames.length > 0 ? matchedNames.join(' / ') : '-');
          if (matchedNames.length > 0) matchedNames.forEach(n => matchedSet.add(n));

          const fixedHit = checkFixedStock(cfg, [
            `${pno}:${ov.trim()}`,
            `옵션:${ov.trim()}`,
            ...matchedNames.map(n => `옵션:${n}`)
          ]);

          let calcNew = oldVal;
          let detail = '';
          let isFail = false;
          let isEst = false;

          if (fixedHit) {
            calcNew = fixedHit.value;
            detail = `고정재고 예외(${fixedHit.key}=${fixedHit.value})`;
          } else if (optIgnored) {
            calcNew = oldVal;
            detail = '수동 매핑 해제 (기존재고 유지 · 정상처리)';
          } else if (res.items.length > 0) {
            const st = res.items.reduce((acc, c) => acc + (Number(c.store_stock) || 0), 0);
            const hq = res.items.some(c => String(c.hq_stock || '').toUpperCase() === 'O');
            calcNew = newStock(st, hq, cfg.hq_default_stock);
            isEst = res.isEstimate;
            if (isEst) estOpts++;
            detail = `${res.method} (매장:${st}, 본사:${hq ? 'O' : 'X'})`;
          } else {
            calcNew = oldVal;
            isFail = true;
            failOpts++;
            detail = `★매칭실패 (${res.method} → 기존유지)`;
          }

          if (applyTodayShipFloor) {
            const minShip = lookupTodayShipMin(todayShipMap, pno, ov);
            if (minShip !== null && calcNew < minShip) {
              calcNew = minShip;
              productTodayShipWarn = true;
              todayShipAdjustedCount++;
              detail += ` [오늘출발 하한 ${minShip} 보정]`;
            }
          }

          newOptStocks.push(calcNew);
          optionDetails.push({
            productNo: pno,
            productName: pname,
            optionValue: ov,
            oldStock: oldVal,
            newStock: calcNew,
            matchedItems: matchedLabel,
            detail,
            isFail,
            isEstimate: isEst,
            isNoSize: false
          });

          if (isFail || isEst) {
            reviewQueue.push({
              queueType: isFail ? '신규 쉴드/파츠 코드' : '저신뢰 매칭',
              productNo: pno,
              productName: pname,
              targetType: 'shield-option',
              optionValue: ov,
              reason: res.method,
              currentAction: isFail ? '기존 재고 유지' : '추정 계산 반영',
              candidates: rankGeneralItemCandidates(`${code || ''} ${ov}`, index, 3)
            });
          }
        }
        matchedSummary = matchedSet.size > 0 ? Array.from(matchedSet).slice(0, 3).join(', ') + (matchedSet.size > 3 ? ` 외 ${matchedSet.size - 3}건` : '') : '-';
      }

      // §7-2 추가상품(V~Y열) 처리 (옵션 유무와 무관)
      const addonRes = processAddons(row, index, cfg);
      if (addonRes.hasAddons) {
        totalAddonProducts++;
        totalAddonItems += addonRes.details.length;
        totalAddonFail += addonRes.failCount;
        totalAddonEstimate += addonRes.estimateCount;
        for (const ad of addonRes.details) {
          addonDetails.push(ad);
          if (ad.isFail || ad.isEstimate) {
            reviewQueue.push({
              queueType: ad.isFail ? '추가상품 미매칭' : '저신뢰 매칭',
              productNo: pno,
              productName: pname,
              targetType: 'addon',
              optionValue: ad.label,
              reason: ad.detail,
              currentAction: ad.isFail ? '기존 재고 유지' : '추정 계산 반영',
              candidates: rankGeneralItemCandidates(`${ad.code || ''} ${ad.valueName || ad.label}`, index, 3)
            });
          }
        }
      }

      // M열/S열 계산 (§2, §8.1: 추가상품 재고는 M열 합계에 미포함)
      const newTotal = newOptStocks.reduce((a, b) => a + b, 0);
      const newM = String(newTotal);
      const newS = hasOptions ? newOptStocks.map(String).join('\n') : optStkRaw;

      // 상품 검토상태 판정 (§8.2)
      let status = '정상';
      if (failOpts === totalOpts && totalOpts > 0) {
        status = '미반영';
      } else if (failOpts > 0 || estOpts > 0 || addonRes.failCount > 0 || addonRes.estimateCount > 0 || addonRes.structureMismatch) {
        status = '확인필요';
      } else if (noSizeOpts > 0) {
        status = '주의';
      }

      statusCounts[status] = (statusCounts[status] || 0) + 1;
      oldTotalSum += oldMNum;
      newTotalSum += newTotal;

      // §9 오늘출발 가능수량 대폭 감소 경고
      if (oldMNum > 0 && newTotal < oldMNum) {
        const dropPct = Math.round(((oldMNum - newTotal) / oldMNum) * 100);
        if (dropPct >= cfg.drop_warning_percent) {
          dropWarnings.push({
            productNo: pno,
            productName: pname,
            oldTotal: oldMNum,
            newTotal,
            diff: newTotal - oldMNum,
            dropPercent: dropPct,
            status
          });
        }
      }

      productSummaries.push({
        rowIndex: row.rowIndex,
        productNo: pno,
        productName: pname,
        optionType: optType,
        optionName: optName,
        oldTotal: oldMNum,
        newTotal,
        diff: newTotal - oldMNum,
        status,
        failOpts,
        estOpts,
        noSizeOpts,
        addonFail: addonRes.failCount,
        addonEst: addonRes.estimateCount,
        matchMethod,
        matchedSummary,
        isIgnored: false,
        todayShipAdjusted: productTodayShipWarn
      });

      cellUpdates.push({
        rowIndex: row.rowIndex,
        productNo: pno,
        newM,
        newS,
        newY: addonRes.hasAddons ? addonRes.newY : String(row.addonStocks || ''),
        hasOptions,
        hasAddons: addonRes.hasAddons
      });
    }

    dropWarnings.sort((a, b) => b.dropPercent - a.dropPercent || a.diff - b.diff);

    return {
      meta: {
        storeTime: index.meta.store_time || '-',
        hqTime: index.meta.hq_time || '-',
        hqDefault: cfg.hq_default_stock,
        dropWarningPercent: cfg.drop_warning_percent,
        inventoryItemCount: index.items.length,
        helmetBaseCount: index.bases.length,
        productCount: productRows.length,
        optionCount: optionDetails.length,
        oldTotalSum,
        newTotalSum,
        totalDiff: newTotalSum - oldTotalSum,
        statusCounts,
        totalAddonProducts,
        totalAddonItems,
        totalAddonFail,
        totalAddonEstimate,
        todayShipAdjustedCount
      },
      index,
      productSummaries,
      optionDetails,
      addonDetails,
      reviewQueue,
      aliasCandidates: Array.from(aliasCandidateMap.values()),
      dropWarnings,
      cellUpdates
    };
  }

  // §7 옵션 없는 단일 상품 매칭
  function matchSingleProduct(row, index, cfg) {
    const pno = String(row.productNo || '').trim();
    const pname = String(row.productName || '').trim();
    const oldVal = parseInt(String(row.totalStock || '0').trim(), 10) || 0;
    const sellerCode = String(row.sellerCode || '').trim().toUpperCase();
    const sellerBarcode = String(row.sellerBarcode || '').trim().toUpperCase();

    // 고정재고 체크
    const fixedHit = checkFixedStock(cfg, [pno, `단일:${pname}`]);
    if (fixedHit) {
      return {
        newVal: fixedHit.value,
        method: '고정재고 예외',
        matchedLabel: fixedHit.key,
        detail: `고정재고 예외(${fixedHit.key}=${fixedHit.value})`,
        isFail: false,
        isEstimate: false
      };
    }

    // 1. 고정밀 코드 (§12.8)
    let codeItems = [];
    if (sellerCode && index.byProductCode.has(sellerCode)) codeItems = index.byProductCode.get(sellerCode);
    else if (sellerBarcode && index.byBarcode.has(sellerBarcode)) codeItems = index.byBarcode.get(sellerBarcode);
    else if (sellerCode && index.byBarcode.has(sellerCode)) codeItems = index.byBarcode.get(sellerCode);

    if (codeItems.length > 0) {
      const st = codeItems.reduce((a, c) => a + (Number(c.store_stock) || 0), 0);
      const hq = codeItems.some(c => String(c.hq_stock || '').toUpperCase() === 'O');
      return {
        newVal: newStock(st, hq, cfg.hq_default_stock),
        method: '판매자코드 일치',
        matchedLabel: codeItems.map(c => c.product_name).join(' / '),
        detail: `판매자코드 일치 (매장:${st}, 본사:${hq ? 'O' : 'X'})`,
        isFail: false,
        isEstimate: false
      };
    }

    // 2. 수동 매핑 (상품번호 / 상품명)
    const manualNames = (cfg.manual_map && cfg.manual_map[pno]) || findManualByName(pname, cfg);
    if (Array.isArray(manualNames) && manualNames.length > 0) {
      const matched = index.items.filter(it => manualNames.includes(it.product_name));
      if (matched.length > 0) {
        const st = matched.reduce((a, c) => a + (Number(c.store_stock) || 0), 0);
        const hq = matched.some(c => String(c.hq_stock || '').toUpperCase() === 'O');
        return {
          newVal: newStock(st, hq, cfg.hq_default_stock),
          method: '수동매핑',
          matchedLabel: matched.map(c => c.product_name).join(' / '),
          detail: `수동매핑 (매장:${st}, 본사:${hq ? 'O' : 'X'})`,
          isFail: false,
          isEstimate: false
        };
      }
    }

    // 3. 변색 쉴드 단일 상품 (§7: HJ-42 / HJ-41 등 코드 + '변색')
    const code = extractShieldCode(pname, false);
    if (code && (pname.includes('변색') || pname.toUpperCase().includes('SHADE'))) {
      const res = findShield(code, '변색', index);
      if (res.items.length > 0) {
        const st = res.items.reduce((a, c) => a + (Number(c.store_stock) || 0), 0);
        const hq = res.items.some(c => String(c.hq_stock || '').toUpperCase() === 'O');
        return {
          newVal: newStock(st, hq, cfg.hq_default_stock),
          method: res.method,
          matchedLabel: res.items.map(c => c.product_name).join(' / '),
          detail: `${res.method} (매장:${st}, 본사:${hq ? 'O' : 'X'})`,
          isFail: false,
          isEstimate: res.isEstimate
        };
      }
    }

    // 4. 미매칭 → 기존 유지
    return {
      newVal: oldVal,
      method: '단일상품 매칭실패',
      matchedLabel: '-',
      detail: '★매칭실패 (단일상품 재고 없음 → 기존유지)',
      isFail: true,
      isEstimate: false
    };
  }

  function findManualByName(pname, cfg) {
    const map = (cfg && cfg.manual_map_by_name) || {};
    const up = String(pname || '').toUpperCase();
    for (const [k, v] of Object.entries(map)) {
      if (k && up.includes(String(k).toUpperCase())) return v;
    }
    return null;
  }

  return {
    DEFAULT_MODELS,
    COLORS,
    canon,
    compact,
    buildModelList,
    modelOf,
    mcOf,
    flagsOf,
    colorOf,
    cn,
    keywordScore,
    similarityRatio,
    newStock,
    buildInventoryIndex,
    mergeBaseSizes,
    findHelmetGroup,
    partOf,
    invPart,
    groupPart,
    extractShieldCode,
    findShield,
    rankHelmetCandidates,
    rankGeneralItemCandidates,
    processAddons,
    runMatching
  };
});
