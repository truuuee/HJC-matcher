/**
 * HJC 멀티채널(카페24 · 스마트스토어 · 쿠팡) 엑셀/CSV 입출력 및 OOXML 무손상 패치 모듈 (v3.0)
 * - 카페24: CSV 파싱·직렬화, 품절표시 사용='T' 강제, 총재고량 합계 동기화, 1,000행 단위 분할 ZIP
 * - 스마트스토어: OOXML M/S/Y 셀 무손상 패치, 500개 단위 분할 ZIP, 실패 엑셀 재추출, 오늘출발 보정
 * - 쿠팡: OOXML S열(잔여수량) 무손상 패치(R열 미변경), 1,500옵션 단위 분할 ZIP
 * - 검토표: ExcelJS 기반 채널별 시트 구성 (쿠팡 '노출상품명 상이' 시트 포함)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HJCExcel = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function getJSZip(injected) {
    if (injected) return injected;
    if (typeof window !== 'undefined' && window.JSZip) return window.JSZip;
    if (typeof globalThis !== 'undefined' && globalThis.JSZip) return globalThis.JSZip;
    throw new Error('JSZip 라이브러리가 로드되지 않았습니다.');
  }

  function getExcelJS(injected) {
    if (injected) return injected;
    if (typeof window !== 'undefined' && window.ExcelJS) return window.ExcelJS;
    if (typeof globalThis !== 'undefined' && globalThis.ExcelJS) return globalThis.ExcelJS;
    throw new Error('ExcelJS 라이브러리가 로드되지 않았습니다.');
  }

  // 열 문자 <-> 1-based 인덱스 변환
  function colLettersToNum(letters) {
    let n = 0;
    const s = String(letters || '').toUpperCase();
    for (let i = 0; i < s.length; i++) {
      n = n * 26 + (s.charCodeAt(i) - 64);
    }
    return n;
  }

  function numToColLetters(num) {
    let n = num;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function escapeXml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function unescapeXml(str) {
    return String(str ?? '')
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .replace(/_x000D_/g, '\r');
  }

  function normalizeNewlines(str) {
    return String(str ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  function getAttr(tagStr, attrName) {
    const re = new RegExp(`(?:^|\\s)${attrName}="([^"]*)"`);
    const m = tagStr.match(re);
    return m ? unescapeXml(m[1]) : null;
  }

  // xl/workbook.xml + rels에서 대상 시트 경로 찾기
  async function resolveSheetPath(zip, preferredSheetName = '일괄수정') {
    const wbFile = zip.file('xl/workbook.xml');
    const relsFile = zip.file('xl/_rels/workbook.xml.rels');
    if (!wbFile || !relsFile) {
      throw new Error('유효한 Excel(.xlsx) 파일 구조가 아닙니다.');
    }

    const wbXml = await wbFile.async('string');
    const relsXml = await relsFile.async('string');

    const sheets = [];
    const sheetRe = /<sheet\b[^>]*>/g;
    let m;
    while ((m = sheetRe.exec(wbXml)) !== null) {
      const tag = m[0];
      const name = getAttr(tag, 'name');
      const rId = getAttr(tag, 'r:id') || getAttr(tag, 'id');
      if (name && rId) sheets.push({ name, rId });
    }

    if (sheets.length === 0) {
      throw new Error('워크북에서 시트를 찾을 수 없습니다.');
    }

    const targetSheet = sheets.find(s => s.name === preferredSheetName) || sheets[0];
    const usedFallback = targetSheet.name !== preferredSheetName;

    const relRe = /<Relationship\b[^>]*>/g;
    let targetPath = null;
    while ((m = relRe.exec(relsXml)) !== null) {
      const tag = m[0];
      const id = getAttr(tag, 'Id');
      if (id === targetSheet.rId) {
        let tgt = getAttr(tag, 'Target') || '';
        tgt = tgt.replace(/^\/+/, '');
        if (!tgt.startsWith('xl/')) tgt = 'xl/' + tgt.replace(/^\.\.\//, '');
        targetPath = tgt;
        break;
      }
    }

    if (!targetPath || !zip.file(targetPath)) {
      throw new Error(`시트 XML 경로를 찾을 수 없습니다: ${targetSheet.name}`);
    }

    return {
      sheetName: targetSheet.name,
      sheetPath: targetPath,
      usedFallback,
      allSheetNames: sheets.map(s => s.name)
    };
  }

  // xl/sharedStrings.xml 파싱
  function parseSharedStrings(xml) {
    const list = [];
    if (!xml) return list;
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(xml)) !== null) {
      const inner = m[1];
      let text = '';
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let tm;
      while ((tm = tRe.exec(inner)) !== null) {
        text += unescapeXml(tm[1]);
      }
      list.push(text);
    }
    return list;
  }

  // 시트 XML에서 특정 행 범위의 셀 읽기
  function parseSheetRows(sheetXml, sharedStrings) {
    const rowsMap = new Map();
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    let rm;
    while ((rm = rowRe.exec(sheetXml)) !== null) {
      const rowAttrs = rm[1];
      const rowBody = rm[2] || '';
      const rAttr = getAttr('<row ' + rowAttrs + '>', 'r');
      const rowNum = parseInt(rAttr || '0', 10);
      if (!rowNum) continue;

      const cells = new Map();
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      while ((cm = cellRe.exec(rowBody)) !== null) {
        const cAttrs = cm[1];
        const cBody = cm[2] || '';
        const ref = getAttr('<c ' + cAttrs + '>', 'r');
        const type = getAttr('<c ' + cAttrs + '>', 't') || '';
        if (!ref) continue;
        const colMatch = ref.match(/^([A-Z]+)(\d+)$/i);
        if (!colMatch) continue;
        const colNum = colLettersToNum(colMatch[1]);

        let val = '';
        if (type === 's') {
          const vm = cBody.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
          if (vm) {
            const idx = parseInt(vm[1].trim(), 10);
            val = sharedStrings[idx] ?? '';
          }
        } else if (type === 'inlineStr') {
          let tAcc = '';
          const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
          let tm;
          while ((tm = tRe.exec(cBody)) !== null) {
            tAcc += unescapeXml(tm[1]);
          }
          val = tAcc;
        } else {
          const vm = cBody.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
          if (vm) val = unescapeXml(vm[1]);
        }

        cells.set(colNum, normalizeNewlines(val));
      }

      rowsMap.set(rowNum, cells);
    }
    return rowsMap;
  }

  /**
   * 1. 스마트스토어 일괄수정 엑셀 파싱
   */
  async function parseSmartStoreExcel(arrayBuffer, deps = {}) {
    const JSZipLib = getJSZip(deps.JSZip);
    const zip = await JSZipLib.loadAsync(arrayBuffer);
    const sheetInfo = await resolveSheetPath(zip, '일괄수정');
    const ssFile = zip.file('xl/sharedStrings.xml');
    const sharedStrings = ssFile ? parseSharedStrings(await ssFile.async('string')) : [];
    const sheetXml = await zip.file(sheetInfo.sheetPath).async('string');

    const rowsMap = parseSheetRows(sheetXml, sharedStrings);
    const headerRow2 = rowsMap.get(2) || new Map();

    // 판매자바코드 컬럼 자동 탐색 (§12.8)
    let sellerBarcodeCol = null;
    for (const [colNum, headerText] of headerRow2.entries()) {
      const clean = String(headerText || '').replace(/\s+/g, '');
      if (clean === '판매자바코드') {
        sellerBarcodeCol = colNum;
        break;
      }
    }

    const rowNumbers = Array.from(rowsMap.keys()).filter(r => r >= 3).sort((a, b) => a - b);
    const productRows = [];

    for (const r of rowNumbers) {
      const cells = rowsMap.get(r);
      const productNo = (cells.get(1) || '').trim();
      const productName = (cells.get(4) || '').trim();
      if (!productNo && !productName) continue;

      productRows.push({
        rowIndex: r,
        productNo,
        sellerCode: (cells.get(2) || '').trim(),
        sellerBarcode: sellerBarcodeCol ? (cells.get(sellerBarcodeCol) || '').trim() : '',
        productName,
        totalStock: cells.get(13) ?? '',
        optionType: (cells.get(14) || '').trim(),
        optionName: (cells.get(15) || '').trim(),
        optionValues: cells.get(17) ?? '',
        optionStocks: cells.get(19) ?? '',
        addonNames: cells.get(22) ?? '',
        addonValues: cells.get(23) ?? '',
        addonPrices: cells.get(24) ?? '',
        addonStocks: cells.get(25) ?? ''
      });
    }

    return {
      sheetName: sheetInfo.sheetName,
      sheetPath: sheetInfo.sheetPath,
      usedFallbackSheet: sheetInfo.usedFallback,
      headerWarnings: validateHeaders(headerRow2),
      productRows
    };
  }

  function validateHeaders(headerRow2) {
    const warnings = [];
    const expected = [
      [1, '상품번호'],
      [4, '상품명'],
      [13, '재고수량'],
      [17, '옵션값'],
      [19, '옵션 재고수량']
    ];
    for (const [col, label] of expected) {
      const actual = String(headerRow2.get(col) || '').trim();
      if (actual && !actual.replace(/\s+/g, '').includes(label.replace(/\s+/g, ''))) {
        warnings.push(`${numToColLetters(col)}2 헤더 불일치 (기대: ${label}, 실제: ${actual})`);
      }
    }
    return warnings;
  }

  /**
   * 2. 무결성 검증 (§8.1)
   */
  function verifyUpdatesIntegrity(productRows, cellUpdates) {
    const rowByIdx = new Map(productRows.map(r => [r.rowIndex, r]));
    const errors = [];

    for (const upd of cellUpdates) {
      const orig = rowByIdx.get(upd.rowIndex);
      if (!orig) continue;

      // (1) 옵션 재고 합계 == M열
      if (upd.hasOptions) {
        const origOptCount = String(orig.optionValues || '').split('\n').length;
        const newOptParts = String(upd.newS || '').split('\n');
        if (origOptCount !== newOptParts.length) {
          errors.push(`행 ${upd.rowIndex}(${upd.productNo}): 옵션 개수 불일치 (${origOptCount} vs ${newOptParts.length})`);
        }
        const sumS = newOptParts.reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
        const valM = parseInt(upd.newM, 10) || 0;
        if (sumS !== valM) {
          errors.push(`행 ${upd.rowIndex}(${upd.productNo}): M열(${valM}) != S열 합계(${sumS})`);
        }
      }

      // (2) 추가상품 V/W/Y 줄수·쉼표수 원본 일치
      if (upd.hasAddons && orig.addonStocks) {
        const origGroups = String(orig.addonStocks).split('\n');
        const newGroups = String(upd.newY || '').split('\n');
        if (origGroups.length !== newGroups.length) {
          errors.push(`행 ${upd.rowIndex}(${upd.productNo}): 추가상품 그룹 수 불일치`);
        } else {
          for (let i = 0; i < origGroups.length; i++) {
            if (origGroups[i].split(',').length !== newGroups[i].split(',').length) {
              errors.push(`행 ${upd.rowIndex}(${upd.productNo}): 추가상품 ${i + 1}번 그룹 항목 수 불일치`);
            }
          }
        }
      }
    }

    return errors;
  }

  // <row> XML 문자열 안에서 특정 열(colNum)의 셀을 원본 스타일 유지하며 치환/삽입
  function patchCellInRowXml(rowXml, rowNum, colNum, newStrValue, ssHelper) {
    const colLetters = numToColLetters(colNum);
    const cellRef = `${colLetters}${rowNum}`;
    const cellRegex = new RegExp(`<c\\b([^>]*?\\br="${cellRef}"[^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)`);

    let replacementCell;
    const match = rowXml.match(cellRegex);

    // 기존 셀의 스타일(s="...") 속성 보존
    let styleAttr = '';
    if (match) {
      const sVal = getAttr('<c ' + match[1] + '>', 's');
      if (sVal !== null) styleAttr = ` s="${escapeXml(sVal)}"`;
    }

    if (ssHelper) {
      const ssIdx = ssHelper.getOrAdd(newStrValue);
      replacementCell = `<c r="${cellRef}"${styleAttr} t="s"><v>${ssIdx}</v></c>`;
    } else {
      replacementCell = `<c r="${cellRef}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(newStrValue)}</t></is></c>`;
    }

    if (match) {
      return rowXml.replace(cellRegex, replacementCell);
    }

    // 기존 셀이 없는 경우: self-closing <row .../>를 펼치고 열 번호 순서 위치에 삽입
    if (/\/>$/.test(rowXml)) {
      return rowXml.replace(/\/>$/, `>${replacementCell}</row>`);
    }

    const openEnd = rowXml.indexOf('>') + 1;
    const closeStart = rowXml.lastIndexOf('</row>');
    const prefix = rowXml.slice(0, openEnd);
    const body = rowXml.slice(openEnd, closeStart);
    const suffix = rowXml.slice(closeStart);

    // body 안에서 colNum보다 큰 첫 번째 <c> 앞에 삽입
    const cRe = /<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g;
    let cm;
    let insertPos = body.length;
    while ((cm = cRe.exec(body)) !== null) {
      const ref = getAttr('<c ' + cm[1] + '>', 'r');
      const m = ref && ref.match(/^([A-Z]+)\d+$/i);
      if (m && colLettersToNum(m[1]) > colNum) {
        insertPos = cm.index;
        break;
      }
    }

    return prefix + body.slice(0, insertPos) + replacementCell + body.slice(insertPos) + suffix;
  }

  // 행 번호 재번호 매김 (실패 엑셀 필터링 재추출 시 사용)
  function renumberRowXml(rowXml, newRowNum) {
    let out = rowXml.replace(/(<row\b[^>]*?\br=")\d+(")/, `$1${newRowNum}$2`);
    out = out.replace(/(<c\b[^>]*?\br="[A-Z]+)\d+(")/gi, `$1${newRowNum}$2`);
    return out;
  }

  /**
   * 3. 업로드용 엑셀 생성 (OOXML 원본 무손상 XML 패치)
   * - filterProductNos: Set<string> 전달 시 해당 상품번호 행만 남겨 재업로드용 엑셀 생성 (§9)
   * - filterRowIndices: Set<number> 전달 시 해당 원본 행 번호만 남겨 분할 엑셀 생성
   */
  async function patchSmartStoreExcel(originalBuffer, productRows, cellUpdates, options = {}, deps = {}) {
    if (!options.skipIntegrityCheck) {
      const integrityErrors = verifyUpdatesIntegrity(productRows, cellUpdates);
      if (integrityErrors.length > 0) {
        throw new Error('무결성 검증 실패:\n' + integrityErrors.slice(0, 10).join('\n'));
      }
    }

    const JSZipLib = getJSZip(deps.JSZip);
    const zip = await JSZipLib.loadAsync(originalBuffer);
    const sheetInfo = await resolveSheetPath(zip, '일괄수정');
    let sheetXml = await zip.file(sheetInfo.sheetPath).async('string');

    // sharedStrings.xml 준비 (있으면 기존 방식 그대로 추가/재사용 → Excel/openpyxl/스마트스토어 100% 호환)
    const ssFile = zip.file('xl/sharedStrings.xml');
    let ssXml = ssFile ? await ssFile.async('string') : null;
    let ssHelper = null;

    if (ssXml) {
      const existingStrings = parseSharedStrings(ssXml);
      const stringToIdx = new Map();
      for (let i = 0; i < existingStrings.length; i++) {
        if (!stringToIdx.has(existingStrings[i])) {
          stringToIdx.set(existingStrings[i], i);
        }
      }
      const appendedXml = [];
      let totalCount = existingStrings.length;
      const origCountMatch = ssXml.match(/<sst\b[^>]*?\bcount="(\d+)"/);
      let origCount = origCountMatch ? parseInt(origCountMatch[1], 10) : existingStrings.length;

      ssHelper = {
        getOrAdd(val) {
          const s = String(val ?? '');
          origCount++;
          if (stringToIdx.has(s)) return stringToIdx.get(s);
          const idx = totalCount++;
          stringToIdx.set(s, idx);
          appendedXml.push(`<si><t xml:space="preserve">${escapeXml(s)}</t></si>`);
          return idx;
        },
        finalizeXml() {
          if (appendedXml.length === 0) return ssXml;
          let updated = ssXml.replace(/<\/sst>\s*$/, appendedXml.join('') + '</sst>');
          if (/\buniqueCount="\d+"/.test(updated)) {
            updated = updated.replace(/(<sst\b[^>]*?\buniqueCount=")\d+(")/, `$1${totalCount}$2`);
          }
          if (/\bcount="\d+"/.test(updated)) {
            updated = updated.replace(/(<sst\b[^>]*?\bcount=")\d+(")/, `$1${origCount}$2`);
          }
          return updated;
        }
      };
    }

    const updateByRow = new Map(cellUpdates.map(u => [u.rowIndex, u]));
    const filterSet = options.filterProductNos instanceof Set && options.filterProductNos.size > 0
      ? options.filterProductNos
      : null;
    const filterRowSet = options.filterRowIndices instanceof Set && options.filterRowIndices.size > 0
      ? options.filterRowIndices
      : null;
    const isFiltering = Boolean(filterSet || filterRowSet);

    // sheetData 내부 <row>만 순회하며 정밀 패치
    let keptDataRowCount = 0;
    let nextRowNum = 3;

    sheetXml = sheetXml.replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, (fullMatch, rowAttrs) => {
      const rAttr = getAttr('<row ' + rowAttrs + '>', 'r');
      const rowNum = parseInt(rAttr || '0', 10);
      if (!rowNum || rowNum < 3) return fullMatch;

      const upd = updateByRow.get(rowNum);
      if (filterRowSet) {
        if (!filterRowSet.has(rowNum)) return '';
      } else if (filterSet) {
        if (!upd || !filterSet.has(String(upd.productNo).trim())) {
          return ''; // 필터 대상이 아닌 행 제거
        }
      }

      let patched = fullMatch;
      if (upd) {
        patched = patchCellInRowXml(patched, rowNum, 13, upd.newM, ssHelper);
        if (upd.hasOptions) {
          patched = patchCellInRowXml(patched, rowNum, 19, upd.newS, ssHelper);
        }
        if (upd.hasAddons) {
          patched = patchCellInRowXml(patched, rowNum, 25, upd.newY, ssHelper);
        }
      }

      if (isFiltering) {
        patched = renumberRowXml(patched, nextRowNum);
        nextRowNum++;
        keptDataRowCount++;
      }

      return patched;
    });

    // 필터링으로 행 수가 줄었으면 <dimension ref="A1:CP..."/> 갱신
    if (isFiltering) {
      const lastRow = Math.max(2, 2 + keptDataRowCount);
      sheetXml = sheetXml.replace(
        /(<dimension\b[^>]*?\bref="[A-Z]+\d+:[A-Z]+)\d+(")/i,
        `$1${lastRow}$2`
      );
    }

    zip.file(sheetInfo.sheetPath, sheetXml);
    if (ssHelper && ssFile) {
      zip.file('xl/sharedStrings.xml', ssHelper.finalizeXml());
    }

    const outType = options.outputType || 'uint8array';
    const output = await zip.generateAsync({
      type: outType,
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    return {
      data: output,
      filteredCount: isFiltering ? keptDataRowCount : cellUpdates.length
    };
  }

  /**
   * 3-2. 업로드용 패키지 생성 (chunkSize 초과 시 500개 단위 분할 .xlsx → .zip 압축)
   */
  async function buildUploadPackage(originalBuffer, productRows, cellUpdates, options = {}, deps = {}) {
    const integrityErrors = verifyUpdatesIntegrity(productRows, cellUpdates);
    if (integrityErrors.length > 0) {
      throw new Error('무결성 검증 실패:\n' + integrityErrors.slice(0, 10).join('\n'));
    }

    const chunkSize = Math.max(1, parseInt(options.chunkSize || 500, 10));
    const baseFileName = options.baseFileName || '스마트스토어상품_재고수정용';
    const filterSet = options.filterProductNos instanceof Set && options.filterProductNos.size > 0
      ? options.filterProductNos
      : null;

    const targetUpdates = filterSet
      ? cellUpdates.filter(u => filterSet.has(String(u.productNo).trim()))
      : cellUpdates;

    if (targetUpdates.length <= chunkSize) {
      const patched = await patchSmartStoreExcel(
        originalBuffer,
        productRows,
        cellUpdates,
        { filterProductNos: filterSet, skipIntegrityCheck: true, outputType: 'uint8array' },
        deps
      );
      const fileName = `${baseFileName}.xlsx`;
      return {
        isZip: false,
        data: patched.data,
        fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        totalCount: patched.filteredCount,
        partCount: 1,
        parts: [{ name: fileName, count: patched.filteredCount }]
      };
    }

    const JSZipLib = getJSZip(deps.JSZip);
    const outerZip = new JSZipLib();
    const partCount = Math.ceil(targetUpdates.length / chunkSize);
    const parts = [];

    for (let p = 0; p < partCount; p++) {
      const start = p * chunkSize;
      const slice = targetUpdates.slice(start, start + chunkSize);
      const startNum = start + 1;
      const endNum = start + slice.length;
      const partName = `${baseFileName}_${p + 1}of${partCount}_${startNum}-${endNum}.xlsx`;

      const patched = await patchSmartStoreExcel(
        originalBuffer,
        productRows,
        cellUpdates,
        {
          filterRowIndices: new Set(slice.map(u => u.rowIndex)),
          skipIntegrityCheck: true,
          outputType: 'uint8array'
        },
        deps
      );
      outerZip.file(partName, patched.data);
      parts.push({ name: partName, count: patched.filteredCount });
    }

    const zipData = await outerZip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    return {
      isZip: true,
      data: zipData,
      fileName: `${baseFileName}.zip`,
      mimeType: 'application/zip',
      totalCount: targetUpdates.length,
      partCount,
      parts
    };
  }

  /**
   * 4. 검토표 엑셀 생성 (멀티채널 대응: 스마트스토어 5시트 / 카페24 4시트 / 쿠팡 5시트[노출상품명 상이 포함])
   */
  async function generateReviewWorkbook(result, deps = {}) {
    const ExcelJSLib = getExcelJS(deps.ExcelJS);
    const wb = new ExcelJSLib.Workbook();
    const channel = result.channel || 'smartstore';
    const channelTitleMap = {
      cafe24: '카페24 (자사몰)',
      smartstore: '네이버 스마트스토어',
      coupang: '쿠팡 (Wing)'
    };
    const idColHeader = channel === 'cafe24' ? '상품코드' : (channel === 'coupang' ? '업체상품 ID' : '상품번호');
    const optIdColHeader = channel === 'cafe24' ? '품목코드' : (channel === 'coupang' ? '옵션 ID' : null);

    wb.creator = 'HJC Multi-Channel Inventory Matcher v3.0';
    wb.created = new Date();

    const FILL = {
      header: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } },
      subHeader: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } },
      정상: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } },      // 연녹색
      주의: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },      // 연노랑
      확인필요: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },  // 연노랑
      미반영: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } },    // 연주황
      제외: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } }       // 연회색
    };

    const FONT_HEADER = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    const FONT_BODY = { name: '맑은 고딕', size: 10 };
    const BORDER_THIN = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
    };

    function styleHeaderRow(ws, rowIdx = 1) {
      const row = ws.getRow(rowIdx);
      row.height = 24;
      row.eachCell(cell => {
        cell.fill = FILL.header;
        cell.font = FONT_HEADER;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = BORDER_THIN;
      });
    }

    function applyRowStyle(row, fillObj) {
      row.eachCell({ includeEmpty: true }, cell => {
        cell.font = FONT_BODY;
        cell.border = BORDER_THIN;
        cell.alignment = Object.assign({ vertical: 'middle' }, cell.alignment || {});
        if (fillObj) cell.fill = fillObj;
      });
    }

    // [시트 1] 신규·미매칭 (§12.7)
    const wsQueue = wb.addWorksheet('신규·미매칭');
    wsQueue.columns = [
      { header: '구분', key: 'queueType', width: 18 },
      { header: idColHeader, key: 'productNo', width: 16 },
      { header: '상품명', key: 'productName', width: 42 },
      { header: channel === 'smartstore' ? '옵션/추가상품' : '옵션/대상', key: 'optionValue', width: 26 },
      { header: '사유', key: 'reason', width: 32 },
      { header: '기본 처리', key: 'currentAction', width: 16 },
      { header: '추천 후보 1', key: 'cand1', width: 38 },
      { header: '추천 후보 2', key: 'cand2', width: 38 },
      { header: '추천 후보 3', key: 'cand3', width: 38 }
    ];
    styleHeaderRow(wsQueue, 1);
    wsQueue.views = [{ state: 'frozen', ySplit: 1 }];
    wsQueue.autoFilter = 'A1:I1';

    const formatCand = c => c ? `${c.name} (점수:${c.score}, 매장:${c.totalStore}, 본사:${c.hqAny ? 'O' : 'X'})` : '-';
    for (const q of result.reviewQueue) {
      const row = wsQueue.addRow({
        queueType: q.queueType,
        productNo: q.productNo,
        productName: q.productName,
        optionValue: q.optionValue,
        reason: q.reason,
        currentAction: q.currentAction,
        cand1: formatCand(q.candidates && q.candidates[0]),
        cand2: formatCand(q.candidates && q.candidates[1]),
        cand3: formatCand(q.candidates && q.candidates[2])
      });
      const fill = q.queueType.includes('실패') || q.queueType.includes('신제품') || q.queueType.includes('미매칭')
        ? FILL.미반영 : FILL.확인필요;
      applyRowStyle(row, fill);
    }

    // [시트 2] 적용 기준
    const wsCriteria = wb.addWorksheet('적용 기준');
    wsCriteria.columns = [
      { header: '항목', key: 'k', width: 28 },
      { header: '기준 및 내용', key: 'v', width: 76 }
    ];
    styleHeaderRow(wsCriteria, 1);
    const meta = result.meta;
    const criteriaRows = [
      ['대상 채널', channelTitleMap[channel] || channel],
      ['매장 보유재고 기준일시', meta.storeTime],
      ['HJC 본사 재고 기준일시', meta.hqTime],
      ['검토표 생성 시각', new Date().toLocaleString('ko-KR')],
      ['본사 가용 기본 재고(HQ_DEFAULT)', `${meta.hqDefault}개 (본사 O → max(${meta.hqDefault}, 매장수량) / 본사 X → 매장수량 그대로)`],
      ['매칭 실패 처리', '기존 채널 재고 유지 (임의 품절 방지)'],
      ['사이즈 없음 처리', '매칭된 헬멧 상품에 해당 사이즈가 재고목록에 없으면 0 처리 + "주의" 표시'],
      ['추정 매칭 처리', '색상 유사 대체(화이트→펄화이트 등) 또는 유사코드(HJ-34→HJ-34P) → 계산 반영 + "확인필요"'],
      ['검토상태 - 정상', '실패·추정·사이즈없음 모두 0 (연녹색)'],
      ['검토상태 - 주의', '사이즈없음(0처리) 옵션이 존재 (연노랑)'],
      ['검토상태 - 확인필요', '추정 매칭 또는 일부 옵션 매칭 실패 (연노랑)'],
      ['검토상태 - 미반영', '상품의 모든 옵션이 매칭 실패하여 기존 재고 유지 (연주황)'],
      ['검토 결과 요약', `총 상품 ${meta.productCount}개 / 옵션 ${meta.optionCount}행 (정상 ${meta.statusCounts.정상} / 주의 ${meta.statusCounts.주의} / 확인필요 ${meta.statusCounts.확인필요} / 미반영 ${meta.statusCounts.미반영} / 제외 ${meta.statusCounts.제외 || 0})`],
      ['총 옵션 재고 합계', `${meta.oldTotalSum.toLocaleString()} → ${meta.newTotalSum.toLocaleString()} (증감: ${meta.totalDiff >= 0 ? '+' : ''}${meta.totalDiff.toLocaleString()})`]
    ];
    if (channel === 'smartstore') {
      criteriaRows.push(['추가상품 현황', `${meta.totalAddonProducts}개 상품 / ${meta.totalAddonItems}개 항목 (실패 ${meta.totalAddonFail}, 추정 ${meta.totalAddonEstimate})`]);
    } else if (channel === 'cafe24') {
      criteriaRows.push(['카페24 품절표시 사용', '전체 품목 행의 [품절표시 사용] 컬럼을 무조건 "T"로 지정']);
      criteriaRows.push(['카페24 분할 기준', '1,000행 초과 시 상품코드 경계를 유지해 1,000행 이하 CSV로 자동 분할 ZIP 생성']);
    } else if (channel === 'coupang') {
      criteriaRows.push(['쿠팡 S열 / R열 처리', `S열(잔여수량)만 갱신 (${meta.coupangOnlyChanged === false ? '매칭 확정 전체 행 입력' : '재고 변경 행만 입력'}), R열(판매상태)은 비워둠`]);
      criteriaRows.push(['쿠팡 상품명 매칭 기준', `업체 등록 상품명(H열) 우선 매칭 · 노출상품명(G열) 상이 감지: ${(result.displayNameDiffs || []).length}건 ("노출상품명 상이" 시트 참고)`]);
      criteriaRows.push(['쿠팡 분할 기준', '1,500옵션 초과 시 1,500행 단위로 자동 분할 ZIP 생성 (승인대기/옵션ID 없음 행 보호)']);
    }

    for (const [k, v] of criteriaRows) {
      const r = wsCriteria.addRow({ k, v });
      applyRowStyle(r, null);
      r.getCell(1).font = { name: '맑은 고딕', size: 10, bold: true };
    }

    // [시트 3] 상품별 요약
    const wsSummary = wb.addWorksheet('상품별 요약');
    const summaryCols = [
      { header: idColHeader, key: 'productNo', width: 16 },
      { header: channel === 'coupang' ? '업체 등록 상품명' : '상품명', key: 'productName', width: 45 },
      { header: '기존 총재고', key: 'oldTotal', width: 13 },
      { header: '변경 총재고', key: 'newTotal', width: 13 },
      { header: '증감', key: 'diff', width: 12 },
      { header: '검토상태', key: 'status', width: 14 },
      { header: '실패 옵션', key: 'failOpts', width: 11 },
      { header: '추정 옵션', key: 'estOpts', width: 11 },
      { header: '사이즈없음', key: 'noSizeOpts', width: 11 }
    ];
    if (channel === 'smartstore') {
      summaryCols.push(
        { header: '추가상품 실패', key: 'addonFail', width: 13 },
        { header: '추가상품 추정', key: 'addonEst', width: 13 }
      );
    }
    summaryCols.push(
      { header: '매칭 방식', key: 'matchMethod', width: 24 },
      { header: '매칭 재고 품목', key: 'matchedSummary', width: 38 }
    );
    wsSummary.columns = summaryCols;
    styleHeaderRow(wsSummary, 1);
    wsSummary.views = [{ state: 'frozen', ySplit: 1 }];
    wsSummary.autoFilter = `A1:${numToColLetters(summaryCols.length)}1`;

    result.productSummaries.forEach((p, idx) => {
      const rNum = idx + 2;
      const rowData = {
        productNo: p.productNo,
        productName: p.productName,
        oldTotal: p.oldTotal,
        newTotal: p.newTotal,
        diff: { formula: `D${rNum}-C${rNum}`, result: p.newTotal - p.oldTotal },
        status: p.status === '미반영' ? '미반영(매칭실패)' : p.status,
        failOpts: p.failOpts,
        estOpts: p.estOpts,
        noSizeOpts: p.noSizeOpts,
        matchMethod: p.matchMethod,
        matchedSummary: p.matchedSummary
      };
      if (channel === 'smartstore') {
        rowData.addonFail = p.addonFail;
        rowData.addonEst = p.addonEst;
      }
      const row = wsSummary.addRow(rowData);
      const fill = FILL[p.status] || null;
      applyRowStyle(row, fill);
      row.getCell(3).numFmt = '#,##0';
      row.getCell(4).numFmt = '#,##0';
      row.getCell(5).numFmt = '+#,##0;-#,##0;0';
      row.getCell(6).alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // [시트 4] 옵션별(품목별) 상세
    const wsOpt = wb.addWorksheet(channel === 'cafe24' ? '품목별 상세' : '옵션별 상세');
    const optCols = [
      { header: idColHeader, key: 'productNo', width: 16 }
    ];
    if (optIdColHeader) {
      optCols.push({ header: optIdColHeader, key: 'optionId', width: 16 });
    }
    optCols.push(
      { header: channel === 'coupang' ? '업체 등록 상품명' : '상품명', key: 'productName', width: 42 },
      { header: channel === 'cafe24' ? '품목명' : (channel === 'coupang' ? '등록 옵션명' : '옵션값'), key: 'optionValue', width: 24 },
      { header: '기존 재고', key: 'oldStock', width: 12 },
      { header: '변경 재고', key: 'newStock', width: 12 },
      { header: '증감', key: 'diff', width: 11 },
      { header: '매칭된 재고 품목', key: 'matchedItems', width: 38 },
      { header: '매칭 내역', key: 'detail', width: 40 }
    );
    if (channel === 'coupang') {
      optCols.push({ header: 'S열 반영', key: 'sAction', width: 14 });
    }
    wsOpt.columns = optCols;
    styleHeaderRow(wsOpt, 1);
    wsOpt.views = [{ state: 'frozen', ySplit: 1 }];
    wsOpt.autoFilter = `A1:${numToColLetters(optCols.length)}1`;

    const oldColIdx = optIdColHeader ? 5 : 4;
    const newColIdx = optIdColHeader ? 6 : 5;
    const diffColIdx = optIdColHeader ? 7 : 6;
    const oldColLet = numToColLetters(oldColIdx);
    const newColLet = numToColLetters(newColIdx);

    result.optionDetails.forEach((o, idx) => {
      const rNum = idx + 2;
      const rowData = {
        productNo: o.productNo,
        productName: o.productName,
        optionValue: o.optionValue,
        oldStock: o.oldStock,
        newStock: o.newStock,
        diff: { formula: `${newColLet}${rNum}-${oldColLet}${rNum}`, result: o.newStock - o.oldStock },
        matchedItems: o.matchedItems,
        detail: o.detail
      };
      if (optIdColHeader) rowData.optionId = o.optionId || '';
      if (channel === 'coupang') rowData.sAction = o.sActionLabel || '';
      const row = wsOpt.addRow(rowData);
      const fill = o.isFail ? FILL.미반영 : (o.isEstimate || o.isNoSize ? FILL.주의 : null);
      applyRowStyle(row, fill);
      row.getCell(oldColIdx).numFmt = '#,##0';
      row.getCell(newColIdx).numFmt = '#,##0';
      row.getCell(diffColIdx).numFmt = '+#,##0;-#,##0;0';
    });

    // [시트 5 - 스마트스토어 전용] 추가상품 상세
    if (channel === 'smartstore') {
      const wsAddon = wb.addWorksheet('추가상품 상세');
      wsAddon.columns = [
        { header: '상품번호', key: 'productNo', width: 16 },
        { header: '상품명', key: 'productName', width: 40 },
        { header: '[그룹명] 값', key: 'label', width: 30 },
        { header: '기존 재고', key: 'oldStock', width: 12 },
        { header: '변경 재고', key: 'newStock', width: 12 },
        { header: '증감', key: 'diff', width: 11 },
        { header: '매칭된 재고 품목', key: 'matchedItems', width: 36 },
        { header: '매칭 내역', key: 'detail', width: 40 }
      ];
      styleHeaderRow(wsAddon, 1);
      wsAddon.views = [{ state: 'frozen', ySplit: 1 }];
      wsAddon.autoFilter = 'A1:H1';

      result.addonDetails.forEach((a, idx) => {
        const rNum = idx + 2;
        const row = wsAddon.addRow({
          productNo: a.productNo,
          productName: a.productName,
          label: a.label,
          oldStock: a.oldStock,
          newStock: a.newStock,
          diff: { formula: `E${rNum}-D${rNum}`, result: a.newStock - a.oldStock },
          matchedItems: a.matchedItems,
          detail: a.detail
        });
        const fill = a.isFail ? FILL.미반영 : (a.isEstimate ? FILL.주의 : null);
        applyRowStyle(row, fill);
        row.getCell(4).numFmt = '#,##0';
        row.getCell(5).numFmt = '#,##0';
        row.getCell(6).numFmt = '+#,##0;-#,##0;0';
      });
    }

    // [시트 5 - 쿠팡 전용] 노출상품명 상이 확인 시트
    if (channel === 'coupang') {
      const wsDiff = wb.addWorksheet('노출상품명 상이');
      wsDiff.columns = [
        { header: '상이 구분', key: 'severity', width: 18 },
        { header: '업체상품 ID', key: 'productNo', width: 16 },
        { header: '옵션 ID', key: 'optionId', width: 16 },
        { header: '업체 등록 상품명 (H열)', key: 'registeredName', width: 44 },
        { header: '쿠팡 노출 상품명 (G열)', key: 'displayName', width: 48 },
        { header: '등록 옵션명 (I열)', key: 'optionName', width: 22 },
        { header: '업체등록명 매칭결과', key: 'registeredMatched', width: 36 },
        { header: '노출명 매칭결과', key: 'displayMatched', width: 36 },
        { header: '차이 사유', key: 'reason', width: 36 }
      ];
      styleHeaderRow(wsDiff, 1);
      wsDiff.views = [{ state: 'frozen', ySplit: 1 }];
      wsDiff.autoFilter = 'A1:I1';

      for (const d of (result.displayNameDiffs || [])) {
        const row = wsDiff.addRow({
          severity: d.severity,
          productNo: d.productNo,
          optionId: d.optionId,
          registeredName: d.registeredName,
          displayName: d.displayName,
          optionName: d.optionName,
          registeredMatched: d.registeredMatched,
          displayMatched: d.displayMatched,
          reason: d.reason
        });
        const fill = d.isMatchMismatch ? FILL.미반영 : FILL.주의;
        applyRowStyle(row, fill);
        row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * 5. 네이버 업로드 실패 엑셀(error_excel_*.xlsx) 파싱 (§9)
   * - A열: 실패사유, B열: 상품번호 (헤더 행 자동 스킵)
   */
  async function parseErrorExcel(arrayBuffer, deps = {}) {
    const JSZipLib = getJSZip(deps.JSZip);
    const zip = await JSZipLib.loadAsync(arrayBuffer);
    const sheetInfo = await resolveSheetPath(zip, '일괄수정');
    const ssFile = zip.file('xl/sharedStrings.xml');
    const sharedStrings = ssFile ? parseSharedStrings(await ssFile.async('string')) : [];
    const sheetXml = await zip.file(sheetInfo.sheetPath).async('string');
    const rowsMap = parseSheetRows(sheetXml, sharedStrings);

    const failedNos = new Set();
    const reasonCounts = new Map();
    const items = [];

    const rowNumbers = Array.from(rowsMap.keys()).sort((a, b) => a - b);
    for (const r of rowNumbers) {
      const cells = rowsMap.get(r);
      const colA = String(cells.get(1) || '').trim();
      const colB = String(cells.get(2) || '').trim();
      if (!colB || colB === '상품번호' || !/^\d+$/.test(colB)) continue;
      failedNos.add(colB);
      const reason = colA || '사유 미기재';
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      items.push({ productNo: colB, reason });
    }

    return {
      failedNos,
      items,
      reasonCounts: Array.from(reasonCounts.entries()).map(([reason, count]) => ({ reason, count }))
    };
  }

  /**
   * 6. 오늘출발 가능수량 CSV / XLSX 파싱 (§9)
   * - 컬럼: 상품번호, (선택)옵션값, 오늘출발수량(또는 가능수량/수량)
   */
  async function parseTodayShipFile(fileName, arrayBuffer, deps = {}) {
    const map = new Map();
    const lower = String(fileName || '').toLowerCase();

    let rows = [];
    if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
      const text = new TextDecoder('utf-8').decode(arrayBuffer).replace(/^\uFEFF/, '');
      rows = text.split(/\r?\n/).filter(l => l.trim()).map(line => parseCsvLine(line));
    } else {
      const JSZipLib = getJSZip(deps.JSZip);
      const zip = await JSZipLib.loadAsync(arrayBuffer);
      const sheetInfo = await resolveSheetPath(zip, 'Sheet1');
      const ssFile = zip.file('xl/sharedStrings.xml');
      const sharedStrings = ssFile ? parseSharedStrings(await ssFile.async('string')) : [];
      const sheetXml = await zip.file(sheetInfo.sheetPath).async('string');
      const rowsMap = parseSheetRows(sheetXml, sharedStrings);
      const rNums = Array.from(rowsMap.keys()).sort((a, b) => a - b);
      for (const r of rNums) {
        const c = rowsMap.get(r);
        const maxCol = Math.max(0, ...Array.from(c.keys()));
        const arr = [];
        for (let i = 1; i <= maxCol; i++) arr.push(c.get(i) || '');
        rows.push(arr);
      }
    }

    if (rows.length === 0) return map;

    const header = rows[0].map(h => String(h || '').replace(/\s+/g, ''));
    let pnoIdx = header.findIndex(h => h.includes('상품번호'));
    let optIdx = header.findIndex(h => h.includes('옵션'));
    let qtyIdx = header.findIndex(h => h.includes('오늘출발') || h.includes('가능수량') || h.includes('수량'));

    let startRow = 1;
    if (pnoIdx === -1 && qtyIdx === -1) {
      // 헤더 없는 단순 형식: [상품번호, 수량] 또는 [상품번호, 옵션값, 수량]
      startRow = 0;
      pnoIdx = 0;
      if (rows[0].length >= 3) { optIdx = 1; qtyIdx = 2; }
      else { optIdx = -1; qtyIdx = 1; }
    }

    for (let i = startRow; i < rows.length; i++) {
      const r = rows[i];
      const pno = String(r[pnoIdx] || '').trim();
      const qty = parseInt(String(r[qtyIdx] || '').trim(), 10);
      if (!pno || !Number.isFinite(qty) || qty <= 0) continue;
      const opt = optIdx >= 0 ? String(r[optIdx] || '').trim() : '';
      const key = opt ? `${pno}::${opt}` : pno;
      map.set(key, Math.max(map.get(key) || 0, qty));
    }

    return map;
  }

  function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  /**
   * RFC-4180 멀티라인 안전 CSV 파서
   */
  function parseCsvText(text) {
    const rows = [];
    let row = [];
    let cur = '';
    let inQuotes = false;
    const s = String(text || '').replace(/^\uFEFF/, '');

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(cur);
          cur = '';
        } else if (ch === '\r') {
          if (s[i + 1] === '\n') i++;
          row.push(cur);
          rows.push(row);
          row = [];
          cur = '';
        } else if (ch === '\n') {
          row.push(cur);
          rows.push(row);
          row = [];
          cur = '';
        } else {
          cur += ch;
        }
      }
    }
    if (cur.length > 0 || row.length > 0) {
      row.push(cur);
      rows.push(row);
    }
    return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
  }

  function serializeCsvField(val) {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function serializeCsvRows(headerRow, dataRows) {
    const lines = [headerRow.map(serializeCsvField).join(',')];
    for (const r of dataRows) {
      lines.push(r.map(serializeCsvField).join(','));
    }
    return '\uFEFF' + lines.join('\n') + '\n';
  }

  function decodeCsvBuffer(arrayBuffer) {
    const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const hasUtf8Bom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
    if (hasUtf8Bom) {
      return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8-sig' };
    }
    const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const badChars = (utf8Text.match(/\uFFFD/g) || []).length;
    if (badChars > 3) {
      try {
        return { text: new TextDecoder('euc-kr').decode(bytes), encoding: 'euc-kr' };
      } catch (_) {
        // fallback to utf-8
      }
    }
    return { text: utf8Text, encoding: 'utf-8' };
  }

  /**
   * 7. 카페24 재고 CSV 파싱 (bmotomall_*.csv)
   */
  function parseCafe24Csv(arrayBuffer) {
    const { text, encoding } = decodeCsvBuffer(arrayBuffer);
    const allRows = parseCsvText(text);
    if (allRows.length < 2) {
      throw new Error('카페24 CSV 파일에 데이터가 없습니다.');
    }

    const headers = allRows[0].map(h => String(h || '').trim());
    const findCol = (names, fallbackIdx) => {
      for (const n of names) {
        const idx = headers.findIndex(h => h.replace(/\s+/g, '') === n.replace(/\s+/g, ''));
        if (idx >= 0) return idx;
      }
      return fallbackIdx;
    };

    const colIdx = {
      productCode: findCol(['상품코드'], 0),
      sellerProductCode: findCol(['자체상품코드', '자체 상품코드'], 1),
      productName: findCol(['상품명'], 2),
      salePrice: findCol(['판매가'], 3),
      totalStock: findCol(['총재고량', '총 재고량'], 4),
      itemCode: findCol(['품목코드'], 5),
      itemName: findCol(['품목명'], 6),
      sellerItemCode: findCol(['자체품목코드', '자체 품목코드'], 7),
      useStockMgmt: findCol(['재고관리사용', '재고관리 사용'], 8),
      stockQty: findCol(['재고수량'], 9),
      soldoutDisplay: findCol(['품절표시사용', '품절표시 사용'], 15)
    };

    const headerWarnings = [];
    const requiredChecks = [
      ['상품코드', colIdx.productCode],
      ['상품명', colIdx.productName],
      ['품목코드', colIdx.itemCode],
      ['재고수량', colIdx.stockQty],
      ['품절표시 사용', colIdx.soldoutDisplay]
    ];
    const missingRequired = [];
    for (const [label, idx] of requiredChecks) {
      const actual = headers[idx] || '';
      if (!actual || !actual.replace(/\s+/g, '').includes(label.replace(/\s+/g, ''))) {
        missingRequired.push(`${label}(기대 위치 ${idx + 1}열, 실제 '${actual || '없음'}')`);
      }
    }
    if (missingRequired.length >= 2) {
      throw new Error('카페24 재고 관리 CSV 양식이 아닙니다. 확인 필요: ' + missingRequired.join(', '));
    } else if (missingRequired.length === 1) {
      headerWarnings.push('헤더 확인 필요: ' + missingRequired[0]);
    }

    const colCount = headers.length;
    const rawRows = [];
    const itemRows = [];
    const productSet = new Set();

    for (let i = 1; i < allRows.length; i++) {
      const r = allRows[i].slice();
      while (r.length < colCount) r.push('');
      const pCode = String(r[colIdx.productCode] || '').trim();
      const pName = String(r[colIdx.productName] || '').trim();
      if (!pCode && !pName) continue;

      const dataIdx = rawRows.length;
      rawRows.push(r);
      productSet.add(pCode);

      itemRows.push({
        rowIndex: i + 1,
        dataIdx,
        productNo: pCode,
        sellerCode: String(r[colIdx.sellerProductCode] || '').trim(),
        sellerBarcode: '',
        productName: pName,
        displayProductName: '',
        optionId: String(r[colIdx.itemCode] || '').trim(),
        optionName: String(r[colIdx.itemName] || '').trim(),
        itemSellerCode: String(r[colIdx.sellerItemCode] || '').trim(),
        oldStock: parseInt(String(r[colIdx.stockQty] || '0').trim(), 10) || 0,
        oldTotalStock: parseInt(String(r[colIdx.totalStock] || '0').trim(), 10) || 0,
        soldoutDisplay: String(r[colIdx.soldoutDisplay] || '').trim(),
        isEditable: true
      });
    }

    return {
      channel: 'cafe24',
      encoding,
      headers,
      colIdx,
      rawRows,
      itemRows,
      productCount: productSet.size,
      headerWarnings
    };
  }

  /**
   * 8. 카페24 업로드용 CSV/ZIP 패키지 생성 (1,000행 초과 시 상품코드 경계 유지 1,000행 단위 분할 ZIP)
   * - 재고수량(Col 10) 갱신, 동일 상품코드 총 재고량(Col 5) 합계 동기화, 품절표시 사용(Col 16) 무조건 'T'
   */
  async function buildCafe24UploadPackage(parsedCafe24, rowUpdates, options = {}, deps = {}) {
    const chunkSize = Math.max(1, parseInt(options.chunkSize || 1000, 10));
    const baseFileName = options.baseFileName || '카페24_재고수정용';
    const { headers, colIdx, rawRows } = parsedCafe24;
    const updByDataIdx = new Map(rowUpdates.map(u => [u.dataIdx, u]));

    // 1) 행 복사 + 재고수량 갱신 + 품절표시 사용 = 'T' 무조건 적용
    const updatedRows = rawRows.map((orig, idx) => {
      const r = orig.slice();
      const upd = updByDataIdx.get(idx);
      if (upd) {
        r[colIdx.stockQty] = String(upd.newStock);
      }
      r[colIdx.soldoutDisplay] = 'T';
      return r;
    });

    // 2) 동일 상품코드별 총 재고량 합계 계산 및 동기화
    const sumByProduct = new Map();
    for (const r of updatedRows) {
      const pCode = String(r[colIdx.productCode] || '').trim();
      const qty = parseInt(String(r[colIdx.stockQty] || '0').trim(), 10) || 0;
      sumByProduct.set(pCode, (sumByProduct.get(pCode) || 0) + qty);
    }
    for (const r of updatedRows) {
      const pCode = String(r[colIdx.productCode] || '').trim();
      r[colIdx.totalStock] = String(sumByProduct.get(pCode) ?? 0);
    }

    // 3) 무결성 검증
    for (let i = 0; i < updatedRows.length; i++) {
      if (updatedRows[i][colIdx.soldoutDisplay] !== 'T') {
        throw new Error(`카페24 무결성 오류: ${i + 2}행 품절표시 사용 값이 'T'가 아닙니다.`);
      }
    }

    // 4) 1,000행 이하: 단일 CSV
    if (updatedRows.length <= chunkSize) {
      const csvStr = serializeCsvRows(headers, updatedRows);
      const data = new TextEncoder().encode(csvStr);
      const fileName = `${baseFileName}.csv`;
      return {
        isZip: false,
        data,
        fileName,
        mimeType: 'text/csv;charset=utf-8',
        totalCount: updatedRows.length,
        partCount: 1,
        parts: [{ name: fileName, count: updatedRows.length }]
      };
    }

    // 5) 1,000행 초과: 동일 상품코드 그룹이 깨지지 않도록 1,000행 단위 청크 분할 → ZIP
    const productGroups = [];
    let curGroup = null;
    for (const r of updatedRows) {
      const pCode = String(r[colIdx.productCode] || '').trim();
      if (!curGroup || curGroup.pCode !== pCode) {
        curGroup = { pCode, rows: [r] };
        productGroups.push(curGroup);
      } else {
        curGroup.rows.push(r);
      }
    }

    const chunks = [];
    let curChunk = [];
    for (const grp of productGroups) {
      if (curChunk.length > 0 && curChunk.length + grp.rows.length > chunkSize) {
        chunks.push(curChunk);
        curChunk = [];
      }
      if (grp.rows.length > chunkSize) {
        // 예외적으로 단일 상품이 chunkSize를 초과하는 경우에만 행 단위 슬라이스
        for (let s = 0; s < grp.rows.length; s += chunkSize) {
          chunks.push(grp.rows.slice(s, s + chunkSize));
        }
      } else {
        curChunk.push(...grp.rows);
      }
    }
    if (curChunk.length > 0) chunks.push(curChunk);

    const JSZipLib = getJSZip(deps.JSZip);
    const outerZip = new JSZipLib();
    const parts = [];
    let offset = 0;

    for (let p = 0; p < chunks.length; p++) {
      const slice = chunks[p];
      const startNum = offset + 1;
      const endNum = offset + slice.length;
      offset = endNum;
      const partName = `${baseFileName}_${p + 1}of${chunks.length}_${startNum}-${endNum}.csv`;
      const csvStr = serializeCsvRows(headers, slice);
      outerZip.file(partName, new TextEncoder().encode(csvStr));
      parts.push({ name: partName, count: slice.length });
    }

    const zipData = await outerZip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    return {
      isZip: true,
      data: zipData,
      fileName: `${baseFileName}.zip`,
      mimeType: 'application/zip',
      totalCount: updatedRows.length,
      partCount: chunks.length,
      parts
    };
  }

  /**
   * 9. 쿠팡 Wing 가격/재고 일괄변경 엑셀 파싱 (price_inventory_*.xlsx)
   */
  async function parseCoupangExcel(arrayBuffer, deps = {}) {
    const JSZipLib = getJSZip(deps.JSZip);
    const zip = await JSZipLib.loadAsync(arrayBuffer);
    const sheetInfo = await resolveSheetPath(zip, 'data');
    const ssFile = zip.file('xl/sharedStrings.xml');
    const sharedStrings = ssFile ? parseSharedStrings(await ssFile.async('string')) : [];
    const sheetXml = await zip.file(sheetInfo.sheetPath).async('string');

    const rowsMap = parseSheetRows(sheetXml, sharedStrings);
    const headerRow3 = rowsMap.get(3) || new Map();

    const expected = [
      [1, '업체상품'],
      [3, '옵션'],
      [7, '노출'],
      [8, '등록'],
      [9, '옵션명'],
      [13, '잔여수량'],
      [19, '잔여수량']
    ];
    const headerWarnings = [];
    let mismatchCount = 0;
    for (const [col, kw] of expected) {
      const actual = String(headerRow3.get(col) || '').trim();
      if (!actual || !actual.replace(/\s+/g, '').includes(kw)) {
        mismatchCount++;
        headerWarnings.push(`${numToColLetters(col)}3 헤더 불일치 (기대 포함어: ${kw}, 실제: ${actual || '없음'})`);
      }
    }
    if (mismatchCount >= 4) {
      throw new Error('쿠팡 가격/재고 일괄변경 엑셀 양식(data 시트, 3행 헤더)이 아닙니다.');
    }

    const rowNumbers = Array.from(rowsMap.keys()).filter(r => r >= 4).sort((a, b) => a - b);
    const itemRows = [];
    const productSet = new Set();
    let editableCount = 0;
    let uneditableCount = 0;

    for (const r of rowNumbers) {
      const cells = rowsMap.get(r);
      const productNo = String(cells.get(1) || '').trim();
      const optionId = String(cells.get(3) || '').trim();
      const registeredName = String(cells.get(8) || '').trim();
      const displayName = String(cells.get(7) || '').trim();
      if (!productNo && !optionId && !registeredName) continue;

      const approvalStatus = String(cells.get(15) || '').trim();
      const isEditable = Boolean(optionId) && (!approvalStatus || approvalStatus === '승인완료');
      if (isEditable) editableCount++;
      else uneditableCount++;

      productSet.add(productNo);
      itemRows.push({
        rowIndex: r,
        dataIdx: itemRows.length,
        productNo,
        coupangProductId: String(cells.get(2) || '').trim(),
        optionId,
        itemStatus: String(cells.get(4) || '').trim(),
        sellerBarcode: String(cells.get(5) || '').trim(),
        sellerCode: String(cells.get(6) || '').trim(),
        displayProductName: displayName,
        productName: registeredName || displayName,
        optionName: String(cells.get(9) || '').trim(),
        salePrice: String(cells.get(10) || '').trim(),
        saleStatus: String(cells.get(12) || '').trim(),
        oldStock: parseInt(String(cells.get(13) || '0').trim(), 10) || 0,
        approvalStatus,
        isEditable
      });
    }

    return {
      channel: 'coupang',
      sheetName: sheetInfo.sheetName,
      sheetPath: sheetInfo.sheetPath,
      usedFallbackSheet: sheetInfo.usedFallback,
      headerWarnings,
      itemRows,
      productCount: productSet.size,
      editableCount,
      uneditableCount
    };
  }

  // 숫자 셀 정밀 패치 (쿠팡 S열 잔여수량용 — 원본 스타일 s="..." 유지, null이면 셀 비움)
  function patchNumericCellInRowXml(rowXml, rowNum, colNum, numericOrNull) {
    const colLetters = numToColLetters(colNum);
    const cellRef = `${colLetters}${rowNum}`;
    const cellRegex = new RegExp(`<c\\b([^>]*?\\br="${cellRef}"[^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)`);
    const match = rowXml.match(cellRegex);

    let styleAttr = '';
    if (match) {
      const sVal = getAttr('<c ' + match[1] + '>', 's');
      if (sVal !== null) styleAttr = ` s="${escapeXml(sVal)}"`;
    }

    if (numericOrNull === null || numericOrNull === undefined || numericOrNull === '') {
      if (!match) return rowXml;
      // 기존 셀이 있으면 스타일만 유지한 빈 셀로 정리
      return rowXml.replace(cellRegex, `<c r="${cellRef}"${styleAttr}/>`);
    }

    const numVal = Math.max(0, Math.floor(Number(numericOrNull)));
    const replacementCell = `<c r="${cellRef}"${styleAttr}><v>${numVal}</v></c>`;

    if (match) {
      return rowXml.replace(cellRegex, replacementCell);
    }

    if (/\/>$/.test(rowXml)) {
      return rowXml.replace(/\/>$/, `>${replacementCell}</row>`);
    }

    const openEnd = rowXml.indexOf('>') + 1;
    const closeStart = rowXml.lastIndexOf('</row>');
    const prefix = rowXml.slice(0, openEnd);
    const body = rowXml.slice(openEnd, closeStart);
    const suffix = rowXml.slice(closeStart);

    const cRe = /<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g;
    let cm;
    let insertPos = body.length;
    while ((cm = cRe.exec(body)) !== null) {
      const ref = getAttr('<c ' + cm[1] + '>', 'r');
      const m = ref && ref.match(/^([A-Z]+)\d+$/i);
      if (m && colLettersToNum(m[1]) > colNum) {
        insertPos = cm.index;
        break;
      }
    }

    return prefix + body.slice(0, insertPos) + replacementCell + body.slice(insertPos) + suffix;
  }

  /**
   * 10. 쿠팡 Wing 업로드용 엑셀 OOXML 무손상 패치 (S열 잔여수량만 입력, R열 미변경)
   */
  async function patchCoupangExcel(originalBuffer, rowUpdates, options = {}, deps = {}) {
    const JSZipLib = getJSZip(deps.JSZip);
    const zip = await JSZipLib.loadAsync(originalBuffer);
    const sheetInfo = await resolveSheetPath(zip, 'data');
    let sheetXml = await zip.file(sheetInfo.sheetPath).async('string');

    const onlyChanged = options.onlyChanged !== false;
    const updateByRow = new Map(rowUpdates.map(u => [u.rowIndex, u]));
    const filterRowSet = options.filterRowIndices instanceof Set && options.filterRowIndices.size > 0
      ? options.filterRowIndices
      : null;
    const isFiltering = Boolean(filterRowSet);

    let keptDataRowCount = 0;
    let writtenCount = 0;
    let nextRowNum = 4;

    sheetXml = sheetXml.replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, (fullMatch, rowAttrs) => {
      const rAttr = getAttr('<row ' + rowAttrs + '>', 'r');
      const rowNum = parseInt(rAttr || '0', 10);
      if (!rowNum || rowNum < 4) return fullMatch;

      if (filterRowSet && !filterRowSet.has(rowNum)) return '';

      const upd = updateByRow.get(rowNum);
      let patched = fullMatch;
      if (upd) {
        const shouldWrite = Boolean(upd.canWriteS) && (!onlyChanged || upd.newStock !== upd.oldStock);
        if (shouldWrite) {
          patched = patchNumericCellInRowXml(patched, rowNum, 19, upd.newStock);
          writtenCount++;
        } else {
          patched = patchNumericCellInRowXml(patched, rowNum, 19, null);
        }
      }

      if (isFiltering) {
        patched = renumberRowXml(patched, nextRowNum);
        nextRowNum++;
        keptDataRowCount++;
      }

      return patched;
    });

    if (isFiltering) {
      const lastRow = Math.max(3, 3 + keptDataRowCount);
      sheetXml = sheetXml.replace(
        /(<dimension\b[^>]*?\bref="[A-Z]+\d+:[A-Z]+)\d+(")/i,
        `$1${lastRow}$2`
      );
    }

    zip.file(sheetInfo.sheetPath, sheetXml);

    const outType = options.outputType || 'uint8array';
    const output = await zip.generateAsync({
      type: outType,
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    return {
      data: output,
      filteredCount: isFiltering ? keptDataRowCount : rowUpdates.length,
      writtenCount
    };
  }

  // 쿠팡 Wing 업로드용 파일명 정제 (영문과 숫자만 허용, 한글/특수문자 제거)
  function sanitizeCoupangFileName(name, fallback = 'coupangStock') {
    const cleaned = String(name || '').replace(/[^A-Za-z0-9]/g, '');
    return cleaned || fallback;
  }

  /**
   * 11. 쿠팡 업로드 패키지 생성 (1,500옵션 초과 시 1,500행 단위 분할 ZIP)
   * - 쿠팡 Wing 업로드 정책상 파일명은 영문·숫자([A-Za-z0-9])만 사용
   */
  async function buildCoupangUploadPackage(originalBuffer, rowUpdates, options = {}, deps = {}) {
    const chunkSize = Math.max(1, parseInt(options.chunkSize || 1500, 10));
    const baseFileName = sanitizeCoupangFileName(options.baseFileName, 'coupangStock');
    const onlyChanged = options.onlyChanged !== false;

    if (rowUpdates.length <= chunkSize) {
      const patched = await patchCoupangExcel(
        originalBuffer,
        rowUpdates,
        { onlyChanged, outputType: 'uint8array' },
        deps
      );
      const fileName = `${baseFileName}.xlsx`;
      return {
        isZip: false,
        data: patched.data,
        fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        totalCount: patched.filteredCount,
        writtenCount: patched.writtenCount,
        partCount: 1,
        parts: [{ name: fileName, count: patched.filteredCount, writtenCount: patched.writtenCount }]
      };
    }

    const JSZipLib = getJSZip(deps.JSZip);
    const outerZip = new JSZipLib();
    const partCount = Math.ceil(rowUpdates.length / chunkSize);
    const parts = [];
    let totalWritten = 0;

    for (let p = 0; p < partCount; p++) {
      const start = p * chunkSize;
      const slice = rowUpdates.slice(start, start + chunkSize);
      const partName = `${baseFileName}Part${p + 1}of${partCount}.xlsx`;

      const patched = await patchCoupangExcel(
        originalBuffer,
        rowUpdates,
        {
          onlyChanged,
          filterRowIndices: new Set(slice.map(u => u.rowIndex)),
          outputType: 'uint8array'
        },
        deps
      );
      outerZip.file(partName, patched.data);
      totalWritten += patched.writtenCount;
      parts.push({ name: partName, count: patched.filteredCount, writtenCount: patched.writtenCount });
    }

    const zipData = await outerZip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    return {
      isZip: true,
      data: zipData,
      fileName: `${baseFileName}.zip`,
      mimeType: 'application/zip',
      totalCount: rowUpdates.length,
      writtenCount: totalWritten,
      partCount,
      parts
    };
  }

  return {
    colLettersToNum,
    numToColLetters,
    parseSmartStoreExcel,
    verifyUpdatesIntegrity,
    patchSmartStoreExcel,
    buildUploadPackage,
    parseCafe24Csv,
    buildCafe24UploadPackage,
    parseCoupangExcel,
    patchCoupangExcel,
    sanitizeCoupangFileName,
    buildCoupangUploadPackage,
    generateReviewWorkbook,
    parseErrorExcel,
    parseTodayShipFile
  };
});
