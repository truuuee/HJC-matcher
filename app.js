/**
 * HJC 스마트스토어 재고 매칭 웹앱 UI 컨트롤러
 */
(function () {
  'use strict';

  const Config = window.HJCConfig;
  const Matcher = window.HJCMatcher;
  const Excel = window.HJCExcel;

  // 전역 상태
  const state = {
    config: null,
    inventoryData: null,
    inventorySource: '',
    excelFileName: '',
    excelBuffer: null,
    parsedExcel: null,
    todayShipMap: null,
    errorExcelInfo: null,
    lastResult: null,
    activeTab: 'queue',
    searchQuery: '',
    statusFilter: 'all',
    manualTypeFilter: 'all',
    undoStack: [],
    pickContext: null,
    pickSelected: []
  };

  // DOM 참조
  const el = {
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    themeIcon: document.getElementById('themeIcon'),
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    exportConfigQuickBtn: document.getElementById('exportConfigQuickBtn'),

    invStatusDot: document.getElementById('invStatusDot'),
    invStatusText: document.getElementById('invStatusText'),
    metaStoreTime: document.getElementById('metaStoreTime'),
    metaHqTime: document.getElementById('metaHqTime'),
    metaItemCount: document.getElementById('metaItemCount'),
    metaBaseCount: document.getElementById('metaBaseCount'),
    refreshInvBtn: document.getElementById('refreshInvBtn'),
    inventoryFileInput: document.getElementById('inventoryFileInput'),

    excelDropZone: document.getElementById('excelDropZone'),
    excelFileInput: document.getElementById('excelFileInput'),
    excelFileName: document.getElementById('excelFileName'),
    excelFileSub: document.getElementById('excelFileSub'),
    clearExcelBtn: document.getElementById('clearExcelBtn'),
    runMatchBtn: document.getElementById('runMatchBtn'),

    todayShipFileInput: document.getElementById('todayShipFileInput'),
    applyTodayShipCheck: document.getElementById('applyTodayShipCheck'),
    todayShipStatus: document.getElementById('todayShipStatus'),
    errorExcelFileInput: document.getElementById('errorExcelFileInput'),
    downloadRetryExcelBtn: document.getElementById('downloadRetryExcelBtn'),
    errorExcelStatus: document.getElementById('errorExcelStatus'),

    alertContainer: document.getElementById('alertContainer'),
    resultSection: document.getElementById('resultSection'),
    resultMetaSummary: document.getElementById('resultMetaSummary'),
    downloadUploadExcelBtn: document.getElementById('downloadUploadExcelBtn'),
    downloadReviewExcelBtn: document.getElementById('downloadReviewExcelBtn'),

    kpiTotalProducts: document.getElementById('kpiTotalProducts'),
    kpiAddonsSub: document.getElementById('kpiAddonsSub'),
    kpiOkCount: document.getElementById('kpiOkCount'),
    kpiWarnCount: document.getElementById('kpiWarnCount'),
    kpiCheckCount: document.getElementById('kpiCheckCount'),
    kpiFailCount: document.getElementById('kpiFailCount'),
    kpiStockChange: document.getElementById('kpiStockChange'),
    kpiStockDiff: document.getElementById('kpiStockDiff'),

    aliasLearnBar: document.getElementById('aliasLearnBar'),
    aliasLearnList: document.getElementById('aliasLearnList'),

    badgeQueue: document.getElementById('badgeQueue'),
    badgeSummary: document.getElementById('badgeSummary'),
    badgeOptions: document.getElementById('badgeOptions'),
    badgeAddons: document.getElementById('badgeAddons'),
    badgeDrops: document.getElementById('badgeDrops'),
    badgeManual: document.getElementById('badgeManual'),
    dropThresholdLabel: document.getElementById('dropThresholdLabel'),
    copyDropNosBtn: document.getElementById('copyDropNosBtn'),
    bulkConfirmSizesBtn: document.getElementById('bulkConfirmSizesBtn'),
    undoActionBtn: document.getElementById('undoActionBtn'),
    undoActionBtnManual: document.getElementById('undoActionBtnManual'),
    manualTypeFilter: document.getElementById('manualTypeFilter'),
    clearAllManualBtn: document.getElementById('clearAllManualBtn'),

    tableSearchInput: document.getElementById('tableSearchInput'),
    statusFilterSelect: document.getElementById('statusFilterSelect'),

    queueTableBody: document.getElementById('queueTableBody'),
    summaryTableBody: document.getElementById('summaryTableBody'),
    optionsTableBody: document.getElementById('optionsTableBody'),
    addonsTableBody: document.getElementById('addonsTableBody'),
    dropsTableBody: document.getElementById('dropsTableBody'),
    manualTableBody: document.getElementById('manualTableBody'),

    manualPickModal: document.getElementById('manualPickModal'),
    pickTargetInfo: document.getElementById('pickTargetInfo'),
    pickBulkOptionRow: document.getElementById('pickBulkOptionRow'),
    pickBulkCheck: document.getElementById('pickBulkCheck'),
    pickBulkLabel: document.getElementById('pickBulkLabel'),
    pickSearchInput: document.getElementById('pickSearchInput'),
    pickTypeFilter: document.getElementById('pickTypeFilter'),
    pickSelectedChips: document.getElementById('pickSelectedChips'),
    pickResultList: document.getElementById('pickResultList'),
    clearManualMapBtn: document.getElementById('clearManualMapBtn'),
    confirmManualPickBtn: document.getElementById('confirmManualPickBtn'),

    settingsModal: document.getElementById('settingsModal'),
    cfgInventoryUrl: document.getElementById('cfgInventoryUrl'),
    cfgHqDefault: document.getElementById('cfgHqDefault'),
    cfgDropPct: document.getElementById('cfgDropPct'),
    cfgModelsExtra: document.getElementById('cfgModelsExtra'),
    cfgAliases: document.getElementById('cfgAliases'),
    cfgColorSynonyms: document.getElementById('cfgColorSynonyms'),
    cfgColorFallback: document.getElementById('cfgColorFallback'),
    cfgManualMap: document.getElementById('cfgManualMap'),
    cfgManualMapByName: document.getElementById('cfgManualMapByName'),
    cfgOptionManualMap: document.getElementById('cfgOptionManualMap'),
    cfgConfirmedMissingSizes: document.getElementById('cfgConfirmedMissingSizes'),
    cfgFixedStock: document.getElementById('cfgFixedStock'),
    cfgIgnoreProducts: document.getElementById('cfgIgnoreProducts'),
    cfgIgnoredOptions: document.getElementById('cfgIgnoredOptions'),
    cfgRawJson: document.getElementById('cfgRawJson'),
    cfgExportJsonBtn: document.getElementById('cfgExportJsonBtn'),
    cfgImportJsonInput: document.getElementById('cfgImportJsonInput'),
    cfgResetBtn: document.getElementById('cfgResetBtn'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),

    toast: document.getElementById('toast')
  };

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let toastTimer = null;
  function showToast(msg, ms = 3200, opts = {}) {
    const allowUndo = Boolean(opts && opts.allowUndo && state.undoStack.length > 0);
    el.toast.innerHTML = `<span>${esc(msg)}</span>` + (allowUndo ? `<button type="button" class="toast-undo-btn" id="toastUndoBtn">↩️ 되돌리기</button>` : '');
    if (allowUndo) {
      const btn = el.toast.querySelector('#toastUndoBtn');
      if (btn) btn.addEventListener('click', () => undoLastAction());
    }
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add('hidden'), allowUndo ? Math.max(ms, 5000) : ms);
  }

  function pushUndoSnapshot(label) {
    if (!state.config) return;
    state.undoStack.push({
      label: label || '직전 작업',
      snapshot: Config.deepClone(state.config)
    });
    if (state.undoStack.length > 20) state.undoStack.shift();
    updateUndoButtons();
  }

  function updateUndoButtons() {
    const hasUndo = state.undoStack.length > 0;
    const last = hasUndo ? state.undoStack[state.undoStack.length - 1] : null;
    [el.undoActionBtn, el.undoActionBtnManual].forEach(btn => {
      if (!btn) return;
      btn.classList.toggle('hidden', !hasUndo);
      if (last) btn.title = `되돌리기: ${last.label}`;
    });
  }

  function undoLastAction() {
    if (state.undoStack.length === 0) return;
    const prev = state.undoStack.pop();
    state.config = prev.snapshot;
    Config.saveConfig(state.config);
    updateUndoButtons();
    if (state.lastResult) executeMatching();
    showToast(`↩️ '${prev.label}' 작업을 되돌렸습니다.`);
  }

  function todayYYYYMMDD() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }

  function triggerDownload(uint8ArrayOrString, filename, mimeType) {
    const blob = new Blob([uint8ArrayOrString], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function normalizeInventoryUrl(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    if (/\.json(\?.*)?$/i.test(trimmed)) return trimmed;
    return trimmed.replace(/\/+$/, '') + '/inventory_data.json';
  }

  // 테마 관리
  function initTheme() {
    const saved = localStorage.getItem('hjc_matcher_theme') || 'dark';
    applyTheme(saved);
    el.themeToggleBtn.addEventListener('click', () => {
      const next = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem('hjc_matcher_theme', next);
    });
  }

  function applyTheme(mode) {
    document.body.classList.toggle('theme-dark', mode === 'dark');
    document.body.classList.toggle('theme-light', mode === 'light');
    el.themeIcon.textContent = mode === 'dark' ? '☀️' : '🌙';
  }

  // 재고 데이터 로드 (URL 자동 / 직접 업로드)
  function setInventoryStatus(type, text) {
    el.invStatusDot.className = 'status-dot ' + type;
    el.invStatusText.textContent = text;
  }

  function applyLoadedInventory(data, sourceLabel) {
    if (!data || !Array.isArray(data.items)) {
      throw new Error('올바른 inventory_data.json 형식이 아닙니다 (items 배열 없음).');
    }
    state.inventoryData = data;
    state.inventorySource = sourceLabel;

    const index = Matcher.buildInventoryIndex(data, state.config);
    el.metaStoreTime.textContent = (data.meta && data.meta.store_time) || '-';
    el.metaHqTime.textContent = (data.meta && data.meta.hq_time) || '-';
    el.metaItemCount.textContent = data.items.length.toLocaleString();
    el.metaBaseCount.textContent = index.bases.length.toLocaleString();

    setInventoryStatus('ok', `재고 연동 완료 (${sourceLabel})`);
    updateRunButtonState();

    if (state.parsedExcel) {
      executeMatching();
    }
  }

  async function fetchInventoryFromUrl(rawUrl, silent = false) {
    const url = normalizeInventoryUrl(rawUrl);
    if (!url) return false;
    setInventoryStatus('warn', '재고 데이터 불러오는 중...');
    try {
      const sep = url.includes('?') ? '&' : '?';
      const res = await fetch(`${url}${sep}t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      applyLoadedInventory(data, '원격 자동연동');
      if (!silent) showToast('최신 HJC 재고 데이터를 성공적으로 불러왔습니다.');
      return true;
    } catch (err) {
      setInventoryStatus('err', `연동 실패: ${err.message}`);
      if (!silent) {
        showToast(`재고 URL 로드 실패: ${err.message} (URL 확인 또는 JSON 직접 열기를 이용하세요)`, 4500);
      }
      return false;
    }
  }

  function updateRunButtonState() {
    el.runMatchBtn.disabled = !(state.inventoryData && state.parsedExcel);
  }

  function showAlerts(messages, isDanger = false) {
    if (!messages || messages.length === 0) {
      el.alertContainer.classList.add('hidden');
      el.alertContainer.innerHTML = '';
      return;
    }
    el.alertContainer.classList.remove('hidden');
    el.alertContainer.innerHTML = messages
      .map(m => `<div class="alert-box ${isDanger ? 'danger' : ''}">${esc(m)}</div>`)
      .join('');
  }

  // 스마트스토어 엑셀 파일 로드
  async function handleExcelFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      showToast('스마트스토어 일괄수정 파일(.xlsx)만 업로드할 수 있습니다.');
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const parsed = await Excel.parseSmartStoreExcel(buf);
      state.excelFileName = file.name;
      state.excelBuffer = buf;
      state.parsedExcel = parsed;

      el.excelDropZone.classList.add('loaded');
      el.excelFileName.textContent = `📄 ${file.name} (${parsed.productRows.length.toLocaleString()}개 상품 로드됨)`;
      el.excelFileSub.textContent = `시트명: ${parsed.sheetName} · 다른 파일을 끌어다 놓으면 교체됩니다`;
      el.clearExcelBtn.classList.remove('hidden');

      const warnings = [];
      if (parsed.usedFallbackSheet) {
        warnings.push(`'일괄수정' 시트를 찾지 못해 첫 번째 시트('${parsed.sheetName}')를 사용했습니다.`);
      }
      if (parsed.headerWarnings.length > 0) {
        warnings.push('헤더 확인 필요: ' + parsed.headerWarnings.join(' / '));
      }
      showAlerts(warnings, false);

      updateRunButtonState();
      if (state.inventoryData) {
        executeMatching();
      } else {
        showToast('엑셀 로드 완료! ⚙️ 설정 · 매핑 관리에서 재고 데이터를 연동하면 매칭을 실행할 수 있습니다.');
      }
    } catch (err) {
      console.error(err);
      showAlerts([`엑셀 읽기 오류: ${err.message}`], true);
      showToast('엑셀 파일 읽기에 실패했습니다.');
    }
  }

  // 업로드된 스마트스토어 엑셀 삭제(초기화)
  function clearUploadedExcel() {
    state.excelFileName = '';
    state.excelBuffer = null;
    state.parsedExcel = null;
    state.lastResult = null;

    el.excelDropZone.classList.remove('loaded');
    el.excelFileName.textContent = '스마트스토어 일괄수정 엑셀(.xlsx)을 여기에 끌어다 놓거나 클릭하세요';
    el.excelFileSub.textContent = '스마트스토어센터 > 상품 일괄수정에서 내려받은 파일 (시트명: 일괄수정)';
    el.clearExcelBtn.classList.add('hidden');
    el.resultSection.classList.add('hidden');
    showAlerts([]);
    updateRunButtonState();
    updateRetryButtonState();
    showToast('업로드된 엑셀 파일을 삭제했습니다.');
  }

  // 매칭 실행
  function executeMatching() {
    if (!state.inventoryData || !state.parsedExcel) return;

    const res = Matcher.runMatching(
      state.parsedExcel.productRows,
      state.inventoryData,
      state.config,
      {
        todayShipMap: state.todayShipMap,
        applyTodayShipFloor: el.applyTodayShipCheck.checked
      }
    );

    const integrityErrors = Excel.verifyUpdatesIntegrity(state.parsedExcel.productRows, res.cellUpdates);
    if (integrityErrors.length > 0) {
      showAlerts(['무결성 오류 발견: ' + integrityErrors.join(' | ')], true);
    }

    state.lastResult = res;
    renderResultDashboard(res);
    updateRetryButtonState();
  }

  function updateRetryButtonState() {
    el.downloadRetryExcelBtn.disabled = !(state.lastResult && state.errorExcelInfo && state.errorExcelInfo.failedNos.size > 0);
  }

  // 대시보드 및 테이블 렌더링
  function renderResultDashboard(res) {
    el.resultSection.classList.remove('hidden');
    const m = res.meta;

    el.resultMetaSummary.textContent =
      `기준일시: 매장 ${m.storeTime} / 본사 ${m.hqTime} · HQ_DEFAULT=${m.hqDefault} · 원본 서식 무손상 검증 통과` +
      (m.todayShipAdjustedCount > 0 ? ` · 오늘출발 하한보정 ${m.todayShipAdjustedCount}건` : '');

    if (res.cellUpdates.length > 500) {
      const parts = Math.ceil(res.cellUpdates.length / 500);
      el.downloadUploadExcelBtn.textContent = `📦 재고수정용 ZIP 다운로드 (총 ${res.cellUpdates.length.toLocaleString()}개 · ${parts}개 분할)`;
    } else {
      el.downloadUploadExcelBtn.textContent = '⬇️ 재고수정용 엑셀 다운로드 (업로드용)';
    }

    el.kpiTotalProducts.textContent = `${m.productCount.toLocaleString()} / ${m.optionCount.toLocaleString()}`;
    el.kpiAddonsSub.textContent = `추가상품 ${m.totalAddonProducts}개 상품 (${m.totalAddonItems}항목 · 실패 ${m.totalAddonFail}, 추정 ${m.totalAddonEstimate})`;
    el.kpiOkCount.textContent = (m.statusCounts.정상 || 0).toLocaleString();
    el.kpiWarnCount.textContent = (m.statusCounts.주의 || 0).toLocaleString();
    el.kpiCheckCount.textContent = (m.statusCounts.확인필요 || 0).toLocaleString();
    el.kpiFailCount.textContent = (m.statusCounts.미반영 || 0).toLocaleString();
    el.kpiStockChange.textContent = `${m.oldTotalSum.toLocaleString()} → ${m.newTotalSum.toLocaleString()}`;
    const diffSign = m.totalDiff > 0 ? '+' : '';
    el.kpiStockDiff.textContent = `증감 ${diffSign}${m.totalDiff.toLocaleString()}개`;

    el.badgeQueue.textContent = res.reviewQueue.length;
    el.badgeSummary.textContent = res.productSummaries.length;
    el.badgeOptions.textContent = res.optionDetails.length;
    el.badgeAddons.textContent = res.addonDetails.length;
    el.badgeDrops.textContent = res.dropWarnings.length;
    el.dropThresholdLabel.textContent = m.dropWarningPercent;

    renderAliasLearnBar(res.aliasCandidates);
    renderActiveTabTables();
  }

  function renderAliasLearnBar(candidates) {
    if (!candidates || candidates.length === 0) {
      el.aliasLearnBar.classList.add('hidden');
      return;
    }
    el.aliasLearnBar.classList.remove('hidden');
    el.aliasLearnList.innerHTML = candidates.map((c, idx) => `
      <div class="alias-chip">
        <span><strong>${esc(c.from)}</strong> → <strong>${esc(c.to)}</strong> <small>(유사도 ${Math.round(c.similarity * 100)}%)</small></span>
        <button class="btn btn-primary btn-xs" data-approve-alias="${idx}">승인 추가</button>
      </div>
    `).join('');
  }

  function matchesSearch(fields, q) {
    if (!q) return true;
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = fields.join(' ').toLowerCase();
    return tokens.every(t => hay.includes(t));
  }

  function diffHtml(oldVal, newVal) {
    const d = newVal - oldVal;
    if (d > 0) return `<span class="diff-pos">+${d.toLocaleString()}</span>`;
    if (d < 0) return `<span class="diff-neg">${d.toLocaleString()}</span>`;
    return `<span class="diff-zero">0</span>`;
  }

  function statusBadgeHtml(status) {
    if (status === '정상') return `<span class="badge badge-ok">정상</span>`;
    if (status === '주의') return `<span class="badge badge-warn-pill">주의</span>`;
    if (status === '확인필요') return `<span class="badge badge-warn-pill">확인필요</span>`;
    if (status === '미반영') return `<span class="badge badge-fail-pill">미반영</span>`;
    return `<span class="badge badge-dim">${esc(status)}</span>`;
  }

  function renderActiveTabTables() {
    if (!state.lastResult) return;
    const res = state.lastResult;
    const q = state.searchQuery.trim();
    const stFilter = state.statusFilter;

    // 1. 확인 큐
    const optDupCounts = new Map();
    const helmetSizeQueueItems = [];
    for (const it of res.reviewQueue) {
      if (it.targetType === 'addon' || it.targetType === 'shield-option') {
        const k = `${it.targetType}::${it.optionValue}`;
        optDupCounts.set(k, (optDupCounts.get(k) || 0) + 1);
      } else if (it.targetType === 'helmet-size') {
        helmetSizeQueueItems.push(it);
      }
    }

    if (helmetSizeQueueItems.length >= 1) {
      el.bulkConfirmSizesBtn.classList.remove('hidden');
      el.bulkConfirmSizesBtn.textContent = `✅ '사이즈 없음' ${helmetSizeQueueItems.length}건 일괄 확인 완료`;
    } else {
      el.bulkConfirmSizesBtn.classList.add('hidden');
    }

    const qRows = res.reviewQueue.filter(item =>
      matchesSearch([item.queueType, item.productNo, item.productName, item.optionValue, item.reason], q)
    );
    if (qRows.length === 0) {
      el.queueTableBody.innerHTML = `<tr><td colspan="5" class="empty-row">🎉 확인이 필요한 미매칭·추정 항목이 없습니다!</td></tr>`;
    } else {
      el.queueTableBody.innerHTML = qRows.map(item => {
        const badgeCls = item.queueType.includes('실패') || item.queueType.includes('미매칭') || item.queueType.includes('신제품')
          ? 'badge-fail-pill' : 'badge-warn-pill';
        const isOptTarget = item.targetType === 'addon' || item.targetType === 'shield-option';
        const isMissingSize = item.targetType === 'helmet-size';
        const dupCnt = isOptTarget ? (optDupCounts.get(`${item.targetType}::${item.optionValue}`) || 1) : 1;
        const missingCsv = (item.missingSizes || []).join(',');

        const confirmSizeBtnHtml = isMissingSize ? `
          <button class="confirm-size-btn"
            data-confirm-missing-pno="${esc(item.productNo)}"
            data-confirm-missing-sizes="${esc(missingCsv)}">
            ✅ 매칭 맞음 · 미존재 사이즈(${esc(item.optionValue)}) 0 처리 확인 완료
          </button>` : '';

        const candsHtml = (item.candidates || []).map(c => `
          <div class="cand-row">
            <button class="cand-btn"
              data-quick-map-pno="${esc(item.productNo)}"
              data-quick-map-base="${esc(c.name)}"
              data-quick-map-type="${esc(item.targetType)}"
              data-quick-map-opt="${esc(item.optionValue)}"
              data-quick-map-missing="${esc(missingCsv)}"
              title="클릭하여 이 항목을 '${esc(c.name)}'으로 확정">
              <span>${esc(c.name)}</span>
              <span class="cand-meta">점수 ${c.score} · 매장 ${c.totalStore} · 본사 ${c.hqAny ? 'O' : 'X'}</span>
            </button>
            ${isOptTarget && dupCnt >= 2 ? `
              <button class="cand-bulk-btn"
                data-quick-map-pno="${esc(item.productNo)}"
                data-quick-map-base="${esc(c.name)}"
                data-quick-map-type="${esc(item.targetType)}"
                data-quick-map-opt="${esc(item.optionValue)}"
                data-quick-map-bulk="1"
                title="같은 표기('${esc(item.optionValue)}') ${dupCnt}건을 한 번에 확정">
                동일 ${dupCnt}건 일괄
              </button>` : ''}
          </div>
        `).join('');

        return `
          <tr>
            <td><span class="badge ${badgeCls}">${esc(item.queueType)}</span></td>
            <td><code>${esc(item.productNo)}</code></td>
            <td>
              <strong>${esc(item.productName)}</strong>
              <span class="sub-text">대상: ${esc(item.optionValue)}</span>
            </td>
            <td>
              <div>${esc(item.reason)}</div>
              <span class="sub-text">처리: ${esc(item.currentAction)}</span>
            </td>
            <td>
              ${confirmSizeBtnHtml}
              <div class="cand-list">${candsHtml || '<span class="sub-text">자동 추천 후보 없음</span>'}</div>
              <div class="queue-actions">
                <button class="btn btn-secondary btn-xs"
                  data-open-pick-pno="${esc(item.productNo)}"
                  data-open-pick-name="${esc(item.productName)}"
                  data-open-pick-type="${esc(item.targetType)}"
                  data-open-pick-opt="${esc(item.optionValue)}">🔎 ${isMissingSize ? '다른 재고로 변경 검색' : '재고 직접 검색 지정'}</button>
                <button class="btn btn-ghost btn-xs"
                  data-dismiss-queue-pno="${esc(item.productNo)}"
                  data-dismiss-queue-type="${esc(item.targetType)}"
                  data-dismiss-queue-opt="${esc(item.optionValue)}"
                  title="매칭하지 않고 기존 재고를 유지한 채 정상 처리하여 확인 큐에서 제외합니다">🚫 매칭 해제 (정상처리)</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    // 2. 상품별 요약
    const sRows = res.productSummaries.filter(p => {
      if (stFilter !== 'all' && p.status !== stFilter) return false;
      return matchesSearch([p.productNo, p.productName, p.matchMethod, p.matchedSummary], q);
    });
    if (sRows.length === 0) {
      el.summaryTableBody.innerHTML = `<tr><td colspan="9" class="empty-row">조건에 맞는 상품이 없습니다.</td></tr>`;
    } else {
      el.summaryTableBody.innerHTML = sRows.map(p => {
        const issues = [];
        if (p.failOpts) issues.push(`실패 ${p.failOpts}`);
        if (p.estOpts) issues.push(`추정 ${p.estOpts}`);
        if (p.noSizeOpts) issues.push(`사이즈없음 ${p.noSizeOpts}`);
        if (p.addonFail) issues.push(`추가실패 ${p.addonFail}`);
        if (p.addonEst) issues.push(`추가추정 ${p.addonEst}`);
        return `
          <tr>
            <td><code>${esc(p.productNo)}</code></td>
            <td>
              <strong>${esc(p.productName)}</strong>
              <span class="sub-text">${esc(p.matchMethod)}</span>
            </td>
            <td class="num">${p.oldTotal.toLocaleString()}</td>
            <td class="num"><strong>${p.newTotal.toLocaleString()}</strong></td>
            <td class="num">${diffHtml(p.oldTotal, p.newTotal)}</td>
            <td>${statusBadgeHtml(p.status)}</td>
            <td>${issues.length ? esc(issues.join(' · ')) : '<span class="sub-text">-</span>'}</td>
            <td><span class="sub-text">${esc(p.matchedSummary)}</span></td>
            <td>
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                <button class="btn btn-secondary btn-xs" data-open-pick-pno="${esc(p.productNo)}" data-open-pick-name="${esc(p.productName)}" data-open-pick-type="${p.optionName === '사이즈' ? 'helmet' : 'single'}">매핑</button>
                <button class="btn ${p.isIgnored ? 'btn-primary' : 'btn-ghost'} btn-xs" data-toggle-ignore="${esc(p.productNo)}">${p.isIgnored ? '제외해제' : '제외'}</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    // 3. 옵션별 상세
    const oRows = res.optionDetails.filter(o =>
      matchesSearch([o.productNo, o.productName, o.optionValue, o.matchedItems, o.detail], q)
    );
    if (oRows.length === 0) {
      el.optionsTableBody.innerHTML = `<tr><td colspan="8" class="empty-row">조건에 맞는 옵션이 없습니다.</td></tr>`;
    } else {
      el.optionsTableBody.innerHTML = oRows.slice(0, 1500).map(o => `
        <tr>
          <td><code>${esc(o.productNo)}</code></td>
          <td>${esc(o.productName)}</td>
          <td><strong>${esc(o.optionValue)}</strong></td>
          <td class="num">${o.oldStock.toLocaleString()}</td>
          <td class="num"><strong>${o.newStock.toLocaleString()}</strong></td>
          <td class="num">${diffHtml(o.oldStock, o.newStock)}</td>
          <td><span class="sub-text">${esc(o.matchedItems)}</span></td>
          <td>${o.isFail ? `<span class="badge badge-fail-pill">실패</span> ` : (o.isEstimate || o.isNoSize ? `<span class="badge badge-warn-pill">주의</span> ` : '')}${esc(o.detail)}</td>
        </tr>
      `).join('') + (oRows.length > 1500 ? `<tr><td colspan="8" class="empty-row">표시 성능을 위해 상위 1,500행만 표시합니다 (전체 ${oRows.length.toLocaleString()}행은 검토표 엑셀에 모두 포함됨).</td></tr>` : '');
    }

    // 4. 추가상품 상세
    const aRows = res.addonDetails.filter(a =>
      matchesSearch([a.productNo, a.productName, a.label, a.matchedItems, a.detail], q)
    );
    if (aRows.length === 0) {
      el.addonsTableBody.innerHTML = `<tr><td colspan="9" class="empty-row">표시할 추가상품 항목이 없습니다.</td></tr>`;
    } else {
      const fixedMap = state.config.fixed_stock || {};
      el.addonsTableBody.innerHTML = aRows.slice(0, 1500).map(a => {
        const fKey = a.fixedKeyCandidate || `추가상품:${a.valueName || a.label}`;
        const isFixed = Object.prototype.hasOwnProperty.call(fixedMap, fKey);
        return `
          <tr>
            <td><code>${esc(a.productNo)}</code></td>
            <td>${esc(a.productName)}</td>
            <td><strong>${esc(a.label)}</strong></td>
            <td class="num">${a.oldStock.toLocaleString()}</td>
            <td class="num"><strong>${a.newStock.toLocaleString()}</strong></td>
            <td class="num">${diffHtml(a.oldStock, a.newStock)}</td>
            <td><span class="sub-text">${esc(a.matchedItems)}</span></td>
            <td>${a.isFail ? `<span class="badge badge-fail-pill">실패</span> ` : (a.isEstimate ? `<span class="badge badge-warn-pill">추정</span> ` : '')}${esc(a.detail)}</td>
            <td>
              <button class="btn ${isFixed ? 'btn-danger' : 'btn-ghost'} btn-xs" data-toggle-fixed="${esc(fKey)}">
                ${isFixed ? `해제(${fixedMap[fKey]})` : '0 고정'}
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // 5. 오늘출발 주의
    const dRows = res.dropWarnings.filter(d =>
      matchesSearch([d.productNo, d.productName], q)
    );
    if (dRows.length === 0) {
      el.dropsTableBody.innerHTML = `<tr><td colspan="7" class="empty-row">재고가 대폭 감소(${res.meta.dropWarningPercent}% 이상)한 상품이 없습니다.</td></tr>`;
    } else {
      el.dropsTableBody.innerHTML = dRows.map(d => `
        <tr>
          <td><code>${esc(d.productNo)}</code></td>
          <td><strong>${esc(d.productName)}</strong></td>
          <td class="num">${d.oldTotal.toLocaleString()}</td>
          <td class="num"><strong>${d.newTotal.toLocaleString()}</strong></td>
          <td class="num">${diffHtml(d.oldTotal, d.newTotal)}</td>
          <td class="num"><span class="diff-neg">-${d.dropPercent}%</span></td>
          <td>${statusBadgeHtml(d.status)}</td>
        </tr>
      `).join('');
    }

    // 6. 수동 매핑 내역 (조회 · 개별 삭제)
    renderManualHistoryTable(res, q);
  }

  function buildManualHistoryRows(res) {
    const c = state.config || {};
    const nameByPno = new Map();
    if (res && Array.isArray(res.productSummaries)) {
      for (const p of res.productSummaries) nameByPno.set(String(p.productNo), p.productName);
    }

    const rows = [];

    // 1) 상품 수동 매핑 (manual_map)
    for (const [pno, bases] of Object.entries(c.manual_map || {})) {
      const targetStr = Array.isArray(bases) ? bases.join(' + ') : String(bases || '');
      rows.push({
        type: 'manual_map',
        typeLabel: '상품 수동 매핑',
        badgeCls: 'badge-ok',
        key: pno,
        scope: pno,
        name: nameByPno.get(String(pno)) || '(현재 엑셀 외 저장 상품)',
        detail: targetStr
      });
    }

    // 2) 옵션·추가상품 수동 매핑 (option_manual_map)
    for (const [mapKey, items] of Object.entries(c.option_manual_map || {})) {
      const sepIdx = mapKey.indexOf('::');
      const scopePart = sepIdx >= 0 ? mapKey.slice(0, sepIdx) : '공통';
      const labelPart = sepIdx >= 0 ? mapKey.slice(sepIdx + 2) : mapKey;
      const isCommon = scopePart === '공통';
      const targetStr = Array.isArray(items) ? items.join(' + ') : String(items || '');
      rows.push({
        type: 'option_manual_map',
        typeLabel: '옵션·추가상품 매핑',
        badgeCls: 'badge-ok',
        key: mapKey,
        scope: isCommon ? '공통 전체' : scopePart,
        name: isCommon
          ? `대상: ${labelPart}`
          : `${nameByPno.get(scopePart) || '(현재 엑셀 외 상품)'} · 대상: ${labelPart}`,
        detail: targetStr
      });
    }

    // 3) 사이즈없음 확인 완료 (confirmed_missing_sizes)
    for (const [pno, sizes] of Object.entries(c.confirmed_missing_sizes || {})) {
      const szStr = Array.isArray(sizes) ? sizes.join(', ') : String(sizes || '');
      rows.push({
        type: 'confirmed_missing_sizes',
        typeLabel: '사이즈없음 확인',
        badgeCls: 'badge-warn-pill',
        key: pno,
        scope: pno,
        name: nameByPno.get(String(pno)) || '(현재 엑셀 외 저장 상품)',
        detail: `미존재 사이즈 0 처리 확인: ${szStr}`
      });
    }

    // 4) 상품 매칭 해제 (ignore_products)
    for (const pno of (c.ignore_products || [])) {
      rows.push({
        type: 'ignore_products',
        typeLabel: '상품 매칭 해제',
        badgeCls: 'badge-dim',
        key: String(pno),
        scope: String(pno),
        name: nameByPno.get(String(pno)) || '(현재 엑셀 외 저장 상품)',
        detail: '기존 재고 유지 (정상 처리)'
      });
    }

    // 5) 옵션·추가상품 매칭 해제 (ignored_options)
    for (const optKey of (c.ignored_options || [])) {
      const sepIdx = optKey.indexOf('::');
      const scopePart = sepIdx >= 0 ? optKey.slice(0, sepIdx) : '공통';
      const labelPart = sepIdx >= 0 ? optKey.slice(sepIdx + 2) : optKey;
      const isCommon = scopePart === '공통';
      rows.push({
        type: 'ignored_options',
        typeLabel: '옵션·추가상품 해제',
        badgeCls: 'badge-dim',
        key: optKey,
        scope: isCommon ? '공통 전체' : scopePart,
        name: isCommon
          ? `대상: ${labelPart}`
          : `${nameByPno.get(scopePart) || '(현재 엑셀 외 상품)'} · 대상: ${labelPart}`,
        detail: '기존 재고 유지 (정상 처리)'
      });
    }

    return rows;
  }

  function renderManualHistoryTable(res, q) {
    const allRows = buildManualHistoryRows(res);
    if (el.badgeManual) el.badgeManual.textContent = allRows.length;

    const typeFilter = state.manualTypeFilter || 'all';
    const filtered = allRows.filter(r => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false;
      return matchesSearch([r.typeLabel, r.scope, r.name, r.detail], q);
    });

    if (filtered.length === 0) {
      el.manualTableBody.innerHTML = `<tr><td colspan="5" class="empty-row">${allRows.length === 0 ? '저장된 수동 매핑·해제 내역이 없습니다.' : '검색/필터 조건에 맞는 수동 매핑 내역이 없습니다.'}</td></tr>`;
      return;
    }

    el.manualTableBody.innerHTML = filtered.map(r => `
      <tr>
        <td><span class="badge ${r.badgeCls}">${esc(r.typeLabel)}</span></td>
        <td><code>${esc(r.scope)}</code></td>
        <td><strong>${esc(r.name)}</strong></td>
        <td><span class="sub-text" style="margin:0;color:var(--text-main)">${esc(r.detail)}</span></td>
        <td>
          <button class="btn btn-danger btn-xs"
            data-delete-manual-type="${esc(r.type)}"
            data-delete-manual-key="${esc(r.key)}">↩️ 매핑 삭제</button>
        </td>
      </tr>
    `).join('');
  }

  // 수동 매핑 직접 검색 모달
  function openManualPickModal(productNo, productName, targetType, optionValue = '') {
    if (!state.lastResult) return;
    const isOptTarget = targetType === 'addon' || targetType === 'shield-option';
    state.pickContext = { productNo, productName, targetType, optionValue, isOptTarget };

    if (isOptTarget) {
      const optMap = state.config.option_manual_map || {};
      const existing = optMap[`${productNo}::${optionValue}`] || optMap[`공통::${optionValue}`] || [];
      state.pickSelected = [...existing];
      el.pickTargetInfo.innerHTML = `<strong>${esc(productName)}</strong> <span class="sub-text">상품번호: ${esc(productNo)} · 대상: <strong>${esc(optionValue)}</strong></span>`;
      el.pickBulkOptionRow.classList.remove('hidden');
      el.pickBulkLabel.textContent = `같은 표기('${optionValue}') 전체 상품에 일괄 적용`;
      el.pickBulkCheck.checked = true;
      el.pickTypeFilter.value = 'all';
    } else {
      const existing = (state.config.manual_map && state.config.manual_map[productNo]) || [];
      state.pickSelected = [...existing];
      el.pickTargetInfo.innerHTML = `<strong>${esc(productName)}</strong> <span class="sub-text">상품번호: ${esc(productNo)}</span>`;
      el.pickBulkOptionRow.classList.add('hidden');
      el.pickTypeFilter.value = targetType === 'single' ? 'all' : 'helmet';
    }

    el.pickSearchInput.value = '';
    renderPickModalLists();
    el.manualPickModal.classList.remove('hidden');
    el.pickSearchInput.focus();
  }

  function renderPickModalLists() {
    el.pickSelectedChips.innerHTML = state.pickSelected.length === 0
      ? '<span class="sub-text">선택된 재고 없음</span>'
      : state.pickSelected.map((name, i) => `
          <span class="sel-chip">
            ${esc(name)}
            <button data-remove-pick="${i}" title="제거">&times;</button>
          </span>
        `).join('');

    const q = el.pickSearchInput.value.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    const mode = el.pickTypeFilter.value;
    const index = state.lastResult.index;

    let pool = [];
    if (mode === 'helmet') {
      pool = index.bases.map(b => {
        const stSum = Object.values(b.sizes).reduce((a, [st]) => a + st, 0);
        const hqAny = Object.values(b.sizes).some(([, hq]) => hq);
        return { name: b.name, meta: `사이즈 ${Object.keys(b.sizes).length}종 · 매장합 ${stSum} · 본사 ${hqAny ? 'O' : 'X'}` };
      });
    } else {
      pool = index.items.map(it => ({
        name: it.product_name,
        meta: `코드 ${it.product_code || '-'} · 매장 ${it.store_stock} · 본사 ${it.hq_stock}`
      }));
    }

    const filtered = pool.filter(item => {
      if (tokens.length === 0) return true;
      const hay = item.name.toLowerCase();
      return tokens.every(t => hay.includes(t));
    }).slice(0, 80);

    el.pickResultList.innerHTML = filtered.length === 0
      ? '<div class="empty-row">검색 결과가 없습니다.</div>'
      : filtered.map(item => {
          const isSel = state.pickSelected.includes(item.name);
          return `
            <div class="pick-item ${isSel ? 'selected' : ''}" data-toggle-pick-item="${esc(item.name)}">
              <span>${isSel ? '✅ ' : ''}${esc(item.name)}</span>
              <span class="cand-meta">${esc(item.meta)}</span>
            </div>
          `;
        }).join('');
  }

  // 설정 모달 열기/저장
  function dictToLines(obj) {
    return Object.entries(obj || {}).map(([k, v]) => `${k}=${v}`).join('\n');
  }

  function linesToDict(text, numericValue = false) {
    const out = {};
    for (const line of String(text || '').split(/\r?\n/)) {
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (!k) continue;
      if (numericValue) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n >= 0) out[k] = n;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function arrayMapToLines(obj) {
    return Object.entries(obj || {})
      .map(([k, arr]) => `${k}=${Array.isArray(arr) ? arr.join(' | ') : arr}`)
      .join('\n');
  }

  function linesToArrayMap(text) {
    const out = {};
    for (const line of String(text || '').split(/\r?\n/)) {
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const k = line.slice(0, idx).trim();
      const vals = line.slice(idx + 1).split('|').map(s => s.trim()).filter(Boolean);
      if (k && vals.length > 0) out[k] = vals;
    }
    return out;
  }

  function populateSettingsModal() {
    const c = state.config;
    el.cfgInventoryUrl.value = c.inventory_url || '';
    el.cfgHqDefault.value = c.hq_default_stock;
    el.cfgDropPct.value = c.drop_warning_percent;
    el.cfgModelsExtra.value = (c.models_extra || []).join(', ');
    el.cfgAliases.value = dictToLines(c.aliases);
    el.cfgColorSynonyms.value = dictToLines(c.color_synonyms);
    el.cfgColorFallback.value = dictToLines(c.color_fallback);
    el.cfgManualMap.value = arrayMapToLines(c.manual_map);
    el.cfgManualMapByName.value = arrayMapToLines(c.manual_map_by_name);
    el.cfgOptionManualMap.value = arrayMapToLines(c.option_manual_map);
    el.cfgConfirmedMissingSizes.value = arrayMapToLines(c.confirmed_missing_sizes);
    el.cfgFixedStock.value = dictToLines(c.fixed_stock);
    el.cfgIgnoreProducts.value = (c.ignore_products || []).join('\n');
    el.cfgIgnoredOptions.value = (c.ignored_options || []).join('\n');
    el.cfgRawJson.value = JSON.stringify(c, null, 2);
  }

  function saveSettingsFromModal() {
    const activeMTab = document.querySelector('.modal-tab-btn.active')?.dataset.mtab;
    let nextCfg;
    if (activeMTab === 'json') {
      try {
        const parsed = JSON.parse(el.cfgRawJson.value);
        nextCfg = Config.validateImportedConfig(parsed);
      } catch (err) {
        showToast('JSON 문법 오류: ' + err.message, 4000);
        return;
      }
    } else {
      nextCfg = {
        inventory_url: el.cfgInventoryUrl.value.trim(),
        hq_default_stock: Math.max(0, parseInt(el.cfgHqDefault.value, 10) || 100),
        drop_warning_percent: Math.max(1, Math.min(100, parseInt(el.cfgDropPct.value, 10) || 50)),
        models_extra: el.cfgModelsExtra.value.split(',').map(s => s.trim()).filter(Boolean),
        aliases: linesToDict(el.cfgAliases.value),
        color_synonyms: linesToDict(el.cfgColorSynonyms.value),
        color_fallback: linesToDict(el.cfgColorFallback.value),
        manual_map: linesToArrayMap(el.cfgManualMap.value),
        manual_map_by_name: linesToArrayMap(el.cfgManualMapByName.value),
        option_manual_map: linesToArrayMap(el.cfgOptionManualMap.value),
        confirmed_missing_sizes: linesToArrayMap(el.cfgConfirmedMissingSizes.value),
        fixed_stock: linesToDict(el.cfgFixedStock.value, true),
        ignore_products: el.cfgIgnoreProducts.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
        ignored_options: el.cfgIgnoredOptions.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      };
    }

    const urlChanged = nextCfg.inventory_url !== state.config.inventory_url;
    state.config = nextCfg;
    Config.saveConfig(state.config);
    el.settingsModal.classList.add('hidden');
    showToast('설정이 저장되었습니다.');

    if (urlChanged && state.config.inventory_url) {
      fetchInventoryFromUrl(state.config.inventory_url);
    } else if (state.lastResult) {
      executeMatching();
    }
  }

  function exportConfigFile() {
    const json = JSON.stringify(state.config, null, 2);
    triggerDownload(json, `HJC_스토어매핑설정_${todayYYYYMMDD()}.json`, 'application/json');
    showToast('설정 JSON 파일을 다운로드했습니다.');
  }

  // 이벤트 바인딩
  function bindEvents() {
    // 재고 새로고침 및 로컬 JSON 열기(설정 모달 내)
    el.refreshInvBtn.addEventListener('click', async () => {
      const raw = state.config.inventory_url;
      if (raw) {
        await fetchInventoryFromUrl(raw, false);
      } else {
        await fetchInventoryFromUrl('./inventory_data.json', false);
      }
    });

    el.inventoryFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        applyLoadedInventory(data, `직접 열기: ${file.name}`);
        el.settingsModal.classList.add('hidden');
        showToast(`${file.name} 재고 데이터를 불러왔습니다.`);
      } catch (err) {
        showToast('JSON 읽기 실패: ' + err.message, 4000);
      }
      e.target.value = '';
    });

    // 스마트스토어 엑셀 드래그&드롭 / 클릭 / 삭제(X)
    el.clearExcelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearUploadedExcel();
    });
    el.excelDropZone.addEventListener('click', (e) => {
      if (e.target.closest('#clearExcelBtn')) return;
      el.excelFileInput.click();
    });
    el.excelDropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.excelFileInput.click(); }
    });
    el.excelDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.excelDropZone.classList.add('dragover');
    });
    el.excelDropZone.addEventListener('dragleave', () => el.excelDropZone.classList.remove('dragover'));
    el.excelDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      el.excelDropZone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) handleExcelFile(e.dataTransfer.files[0]);
    });
    el.excelFileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleExcelFile(e.target.files[0]);
      e.target.value = '';
    });

    // 매칭 실행 & HQ_DEFAULT 변경
    el.runMatchBtn.addEventListener('click', () => {
      executeMatching();
      showToast('재고 매칭을 실행했습니다.');
    });

    // 보조 도구 ① 오늘출발 수량 보정
    el.todayShipFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const map = await Excel.parseTodayShipFile(file.name, buf);
        state.todayShipMap = map;
        el.todayShipStatus.textContent = `${file.name} (${map.size}건 로드됨)`;
        el.applyTodayShipCheck.checked = true;
        showToast(`오늘출발 가능수량 ${map.size}건을 불러왔습니다.`);
        if (state.lastResult) executeMatching();
      } catch (err) {
        showToast('오늘출발 파일 읽기 실패: ' + err.message, 4000);
      }
      e.target.value = '';
    });
    el.applyTodayShipCheck.addEventListener('change', () => {
      if (state.lastResult) executeMatching();
    });

    // 보조 도구 ② 실패 엑셀 재추출
    el.errorExcelFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const info = await Excel.parseErrorExcel(buf);
        state.errorExcelInfo = info;
        el.errorExcelStatus.textContent = `실패 상품 ${info.failedNos.size}건 추출됨`;
        updateRetryButtonState();
        showToast(`실패 엑셀에서 ${info.failedNos.size}개 상품번호를 추출했습니다.`);
      } catch (err) {
        showToast('실패 엑셀 읽기 실패: ' + err.message, 4000);
      }
      e.target.value = '';
    });

    el.downloadRetryExcelBtn.addEventListener('click', async () => {
      if (!state.lastResult || !state.errorExcelInfo) return;
      el.downloadRetryExcelBtn.disabled = true;
      try {
        const pkg = await Excel.buildUploadPackage(
          state.excelBuffer,
          state.parsedExcel.productRows,
          state.lastResult.cellUpdates,
          {
            filterProductNos: state.errorExcelInfo.failedNos,
            chunkSize: 500,
            baseFileName: `스마트스토어상품_재업로드용_${todayYYYYMMDD()}`
          }
        );
        triggerDownload(pkg.data, pkg.fileName, pkg.mimeType);
        showToast(
          pkg.isZip
            ? `실패 상품 ${pkg.totalCount.toLocaleString()}건을 500개씩 ${pkg.partCount}개 파일로 분할해 ZIP 다운로드했습니다.`
            : `실패 상품 ${pkg.totalCount.toLocaleString()}건만 추린 재업로드 엑셀을 다운로드했습니다.`
        );
      } catch (err) {
        showToast('재업로드 파일 생성 실패: ' + err.message, 4000);
      } finally {
        updateRetryButtonState();
      }
    });

    // 결과 엑셀 다운로드 (500개 초과 시 500개씩 분할 ZIP)
    el.downloadUploadExcelBtn.addEventListener('click', async () => {
      if (!state.lastResult || !state.excelBuffer) return;
      const origLabel = el.downloadUploadExcelBtn.textContent;
      el.downloadUploadExcelBtn.disabled = true;
      if (state.lastResult.cellUpdates.length > 500) {
        el.downloadUploadExcelBtn.textContent = '⏳ 500개씩 분할 ZIP 생성 중...';
      }
      try {
        const pkg = await Excel.buildUploadPackage(
          state.excelBuffer,
          state.parsedExcel.productRows,
          state.lastResult.cellUpdates,
          {
            chunkSize: 500,
            baseFileName: `스마트스토어상품_재고수정용_${todayYYYYMMDD()}`
          }
        );
        triggerDownload(pkg.data, pkg.fileName, pkg.mimeType);
        showToast(
          pkg.isZip
            ? `총 ${pkg.totalCount.toLocaleString()}개 상품을 500개씩 ${pkg.partCount}개 파일로 분할하여 ZIP 다운로드했습니다.`
            : '업로드용 재고수정 엑셀을 다운로드했습니다 (원본 서식 100% 보존).'
        );
      } catch (err) {
        console.error(err);
        showToast('업로드용 파일 생성 오류: ' + err.message, 5000);
      } finally {
        el.downloadUploadExcelBtn.disabled = false;
        el.downloadUploadExcelBtn.textContent = origLabel;
      }
    });

    el.downloadReviewExcelBtn.addEventListener('click', async () => {
      if (!state.lastResult) return;
      try {
        const bytes = await Excel.generateReviewWorkbook(state.lastResult);
        triggerDownload(
          bytes,
          `재고수정_검토표_${todayYYYYMMDD()}.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        showToast('검토표 엑셀(5개 시트)을 다운로드했습니다.');
      } catch (err) {
        console.error(err);
        showToast('검토표 엑셀 생성 오류: ' + err.message, 5000);
      }
    });

    // 탭 전환
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        state.activeTab = btn.dataset.tab;
        document.getElementById('tab-' + state.activeTab).classList.add('active');
      });
    });

    el.tableSearchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderActiveTabTables();
    });
    el.statusFilterSelect.addEventListener('change', (e) => {
      state.statusFilter = e.target.value;
      renderActiveTabTables();
    });
    if (el.manualTypeFilter) {
      el.manualTypeFilter.addEventListener('change', (e) => {
        state.manualTypeFilter = e.target.value;
        renderActiveTabTables();
      });
    }
    if (el.undoActionBtn) el.undoActionBtn.addEventListener('click', undoLastAction);
    if (el.undoActionBtnManual) el.undoActionBtnManual.addEventListener('click', undoLastAction);
    if (el.clearAllManualBtn) {
      el.clearAllManualBtn.addEventListener('click', () => {
        const total = buildManualHistoryRows(state.lastResult).length;
        if (total === 0) {
          showToast('삭제할 수동 매핑 내역이 없습니다.');
          return;
        }
        if (!confirm(`저장된 수동 매핑·확인완료·매칭해제 내역 ${total}건을 모두 삭제하고 원래 상태(확인 큐)로 되돌릴까요?`)) return;
        pushUndoSnapshot(`수동 매핑 전체 삭제 (${total}건)`);
        state.config.manual_map = {};
        state.config.option_manual_map = {};
        state.config.confirmed_missing_sizes = {};
        state.config.ignore_products = [];
        state.config.ignored_options = [];
        Config.saveConfig(state.config);
        executeMatching();
        showToast(`수동 매핑 내역 ${total}건을 모두 삭제했습니다.`, 4500, { allowUndo: true });
      });
    }

    el.copyDropNosBtn.addEventListener('click', async () => {
      if (!state.lastResult || state.lastResult.dropWarnings.length === 0) return;
      const text = state.lastResult.dropWarnings.map(d => d.productNo).join('\n');
      try {
        await navigator.clipboard.writeText(text);
        showToast(`오늘출발 주의 상품번호 ${state.lastResult.dropWarnings.length}건을 클립보드에 복사했습니다.`);
      } catch (_) {
        showToast('클립보드 복사에 실패했습니다.');
      }
    });

    // 별칭 학습 후보 1클릭 승인
    el.aliasLearnList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-approve-alias]');
      if (!btn || !state.lastResult) return;
      const idx = parseInt(btn.dataset.approveAlias, 10);
      const item = state.lastResult.aliasCandidates[idx];
      if (!item) return;
      pushUndoSnapshot(`별칭 추가 (${item.from}→${item.to})`);
      state.config.aliases[item.from] = item.to;
      Config.saveConfig(state.config);
      showToast(`별칭 '${item.from} → ${item.to}' 추가 완료! 재계산합니다.`, 4000, { allowUndo: true });
      executeMatching();
    });

    // '사이즈 없음' 일괄 확인 완료 버튼
    el.bulkConfirmSizesBtn.addEventListener('click', () => {
      if (!state.lastResult) return;
      const items = state.lastResult.reviewQueue.filter(it => it.targetType === 'helmet-size');
      if (items.length === 0) return;
      pushUndoSnapshot(`사이즈 없음 ${items.length}건 일괄 확인`);
      if (!state.config.confirmed_missing_sizes) state.config.confirmed_missing_sizes = {};
      for (const it of items) {
        const prev = new Set(state.config.confirmed_missing_sizes[it.productNo] || []);
        for (const sz of (it.missingSizes || [])) prev.add(sz);
        state.config.confirmed_missing_sizes[it.productNo] = Array.from(prev);
      }
      Config.saveConfig(state.config);
      showToast(`'사이즈 없음' ${items.length}건 0 처리 일괄 확인 완료!`, 4500, { allowUndo: true });
      executeMatching();
    });

    // 테이블 내 상호작용 위임 (수동매핑 삭제, 추천 후보 클릭, 사이즈없음 확인완료, 직접검색, 제외 토글, 고정재고 토글)
    document.querySelector('.tabs-card').addEventListener('click', (e) => {
      const delManualBtn = e.target.closest('[data-delete-manual-type]');
      if (delManualBtn) {
        const mType = delManualBtn.dataset.deleteManualType;
        const mKey = delManualBtn.dataset.deleteManualKey;
        pushUndoSnapshot(`수동 매핑 삭제 (${mKey})`);
        if (mType === 'manual_map' && state.config.manual_map) {
          delete state.config.manual_map[mKey];
        } else if (mType === 'option_manual_map' && state.config.option_manual_map) {
          delete state.config.option_manual_map[mKey];
        } else if (mType === 'confirmed_missing_sizes' && state.config.confirmed_missing_sizes) {
          delete state.config.confirmed_missing_sizes[mKey];
        } else if (mType === 'ignore_products') {
          state.config.ignore_products = (state.config.ignore_products || []).filter(id => String(id) !== String(mKey));
        } else if (mType === 'ignored_options') {
          state.config.ignored_options = (state.config.ignored_options || []).filter(k => String(k) !== String(mKey));
        }
        Config.saveConfig(state.config);
        executeMatching();
        showToast(`매핑 삭제 완료 — 원래 상태(확인 큐)로 되돌렸습니다.`, 4500, { allowUndo: true });
        return;
      }

      const confirmMissingBtn = e.target.closest('[data-confirm-missing-pno]');
      if (confirmMissingBtn) {
        const pno = confirmMissingBtn.dataset.confirmMissingPno;
        const sizes = (confirmMissingBtn.dataset.confirmMissingSizes || '').split(',').map(s => s.trim()).filter(Boolean);
        pushUndoSnapshot(`상품 ${pno} 사이즈없음 확인`);
        if (!state.config.confirmed_missing_sizes) state.config.confirmed_missing_sizes = {};
        const prev = new Set(state.config.confirmed_missing_sizes[pno] || []);
        sizes.forEach(s => prev.add(s));
        state.config.confirmed_missing_sizes[pno] = Array.from(prev);
        Config.saveConfig(state.config);
        showToast(`상품 ${pno} 미존재 사이즈(${sizes.join(', ')}) 0 처리 확인 완료`, 4500, { allowUndo: true });
        executeMatching();
        return;
      }

      const dismissBtn = e.target.closest('[data-dismiss-queue-pno]');
      if (dismissBtn) {
        const pno = dismissBtn.dataset.dismissQueuePno;
        const targetType = dismissBtn.dataset.dismissQueueType || 'helmet';
        const optVal = dismissBtn.dataset.dismissQueueOpt || '';
        pushUndoSnapshot(`상품 ${pno} 매칭 해제`);
        if (targetType === 'addon' || targetType === 'shield-option') {
          if (state.config.option_manual_map) delete state.config.option_manual_map[`${pno}::${optVal}`];
          const set = new Set(state.config.ignored_options || []);
          set.add(`${pno}::${optVal}`);
          state.config.ignored_options = Array.from(set);
          showToast(`상품 ${pno} '${optVal}' 매칭 해제 (기존재고 유지 · 정상처리)`, 4500, { allowUndo: true });
        } else {
          delete state.config.manual_map[pno];
          const set = new Set((state.config.ignore_products || []).map(String));
          set.add(pno);
          state.config.ignore_products = Array.from(set);
          showToast(`상품 ${pno} 매칭 해제 (기존재고 유지 · 정상처리)`, 4500, { allowUndo: true });
        }
        Config.saveConfig(state.config);
        executeMatching();
        return;
      }

      const quickBtn = e.target.closest('[data-quick-map-pno]');
      if (quickBtn && !quickBtn.disabled) {
        const pno = quickBtn.dataset.quickMapPno;
        const baseName = quickBtn.dataset.quickMapBase;
        const targetType = quickBtn.dataset.quickMapType || 'helmet';
        const optVal = quickBtn.dataset.quickMapOpt || '';
        const isBulk = quickBtn.dataset.quickMapBulk === '1';
        const missingSizes = (quickBtn.dataset.quickMapMissing || '').split(',').map(s => s.trim()).filter(Boolean);
        pushUndoSnapshot(`매핑 확정 (${baseName})`);

        if (targetType === 'addon' || targetType === 'shield-option') {
          if (!state.config.option_manual_map) state.config.option_manual_map = {};
          const mapKey = isBulk ? `공통::${optVal}` : `${pno}::${optVal}`;
          state.config.option_manual_map[mapKey] = [baseName];
          state.config.ignored_options = (state.config.ignored_options || []).filter(k => k !== mapKey && k !== `${pno}::${optVal}`);
          Config.saveConfig(state.config);
          showToast(
            isBulk
              ? `'${optVal}' 동일 항목 전체 → '${baseName}' 일괄 확정 (정상처리)`
              : `상품 ${pno} '${optVal}' → '${baseName}' 확정 (정상처리)`,
            4500,
            { allowUndo: true }
          );
        } else {
          state.config.manual_map[pno] = [baseName];
          state.config.ignore_products = (state.config.ignore_products || []).filter(id => String(id) !== String(pno));
          if (targetType === 'helmet-size' && missingSizes.length > 0) {
            if (!state.config.confirmed_missing_sizes) state.config.confirmed_missing_sizes = {};
            const prev = new Set(state.config.confirmed_missing_sizes[pno] || []);
            missingSizes.forEach(s => prev.add(s));
            state.config.confirmed_missing_sizes[pno] = Array.from(prev);
          }
          Config.saveConfig(state.config);
          showToast(`상품 ${pno} → '${baseName}' 확정 완료 (정상처리 · 확인 큐 해소)`, 4500, { allowUndo: true });
        }
        executeMatching();
        return;
      }

      const pickBtn = e.target.closest('[data-open-pick-pno]');
      if (pickBtn) {
        openManualPickModal(
          pickBtn.dataset.openPickPno,
          pickBtn.dataset.openPickName,
          pickBtn.dataset.openPickType,
          pickBtn.dataset.openPickOpt || ''
        );
        return;
      }

      const ignBtn = e.target.closest('[data-toggle-ignore]');
      if (ignBtn) {
        const pno = ignBtn.dataset.toggleIgnore;
        pushUndoSnapshot(`상품 ${pno} 제외 토글`);
        const list = new Set((state.config.ignore_products || []).map(String));
        if (list.has(pno)) {
          list.delete(pno);
          showToast(`상품 ${pno} 매칭 해제 복원`, 4000, { allowUndo: true });
        } else {
          list.add(pno);
          showToast(`상품 ${pno} 매칭 해제 등록 (기존 재고 유지)`, 4000, { allowUndo: true });
        }
        state.config.ignore_products = Array.from(list);
        Config.saveConfig(state.config);
        executeMatching();
        return;
      }

      const fixBtn = e.target.closest('[data-toggle-fixed]');
      if (fixBtn) {
        const key = fixBtn.dataset.toggleFixed;
        pushUndoSnapshot(`고정재고 변경 (${key})`);
        if (Object.prototype.hasOwnProperty.call(state.config.fixed_stock, key)) {
          delete state.config.fixed_stock[key];
          showToast(`고정재고 예외 해제: ${key}`, 4000, { allowUndo: true });
        } else {
          state.config.fixed_stock[key] = 0;
          showToast(`고정재고 0 지정: ${key}`, 4000, { allowUndo: true });
        }
        Config.saveConfig(state.config);
        executeMatching();
      }
    });

    // 수동 매핑 모달 이벤트
    el.pickSearchInput.addEventListener('input', renderPickModalLists);
    el.pickTypeFilter.addEventListener('change', renderPickModalLists);
    el.pickResultList.addEventListener('click', (e) => {
      const itemEl = e.target.closest('[data-toggle-pick-item]');
      if (!itemEl) return;
      const name = itemEl.dataset.togglePickItem;
      const idx = state.pickSelected.indexOf(name);
      if (idx >= 0) state.pickSelected.splice(idx, 1);
      else state.pickSelected.push(name);
      renderPickModalLists();
    });
    el.pickSelectedChips.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove-pick]');
      if (!rm) return;
      state.pickSelected.splice(parseInt(rm.dataset.removePick, 10), 1);
      renderPickModalLists();
    });
    el.clearManualMapBtn.addEventListener('click', () => {
      if (!state.pickContext) return;
      const { productNo, optionValue, isOptTarget } = state.pickContext;
      pushUndoSnapshot(`상품 ${productNo} 수동 매핑 해제`);
      if (isOptTarget) {
        if (state.config.option_manual_map) {
          delete state.config.option_manual_map[`${productNo}::${optionValue}`];
          if (el.pickBulkCheck.checked) {
            delete state.config.option_manual_map[`공통::${optionValue}`];
          }
        }
        const ignSet = new Set(state.config.ignored_options || []);
        ignSet.add(el.pickBulkCheck.checked ? `공통::${optionValue}` : `${productNo}::${optionValue}`);
        state.config.ignored_options = Array.from(ignSet);
      } else {
        delete state.config.manual_map[productNo];
        const ignSet = new Set((state.config.ignore_products || []).map(String));
        ignSet.add(String(productNo));
        state.config.ignore_products = Array.from(ignSet);
      }
      Config.saveConfig(state.config);
      el.manualPickModal.classList.add('hidden');
      showToast('수동 매핑 해제 완료 (기존재고 유지 · 정상처리 · 확인 큐에서 제외됨)', 4500, { allowUndo: true });
      executeMatching();
    });
    el.confirmManualPickBtn.addEventListener('click', () => {
      if (!state.pickContext) return;
      const { productNo, optionValue, isOptTarget } = state.pickContext;
      pushUndoSnapshot(`상품 ${productNo} 직접 검색 매핑 저장`);
      if (isOptTarget) {
        if (!state.config.option_manual_map) state.config.option_manual_map = {};
        const key = el.pickBulkCheck.checked
          ? `공통::${optionValue}`
          : `${productNo}::${optionValue}`;
        if (state.pickSelected.length === 0) {
          delete state.config.option_manual_map[key];
          const ignSet = new Set(state.config.ignored_options || []);
          ignSet.add(key);
          state.config.ignored_options = Array.from(ignSet);
        } else {
          state.config.option_manual_map[key] = [...state.pickSelected];
          state.config.ignored_options = (state.config.ignored_options || []).filter(k => k !== key && k !== `${productNo}::${optionValue}`);
        }
      } else {
        if (state.pickSelected.length === 0) {
          delete state.config.manual_map[productNo];
          const ignSet = new Set((state.config.ignore_products || []).map(String));
          ignSet.add(String(productNo));
          state.config.ignore_products = Array.from(ignSet);
        } else {
          state.config.manual_map[productNo] = [...state.pickSelected];
          state.config.ignore_products = (state.config.ignore_products || []).filter(id => String(id) !== String(productNo));
        }
      }
      Config.saveConfig(state.config);
      el.manualPickModal.classList.add('hidden');
      showToast(
        state.pickSelected.length === 0 ? '매핑 해제 완료 (기존재고 유지 · 정상처리)' : '수동 매핑 확정 완료 (정상처리 · 즉시 재계산)',
        4500,
        { allowUndo: true }
      );
      executeMatching();
    });

    // 설정 모달 이벤트
    el.openSettingsBtn.addEventListener('click', () => {
      populateSettingsModal();
      el.settingsModal.classList.remove('hidden');
    });
    el.exportConfigQuickBtn.addEventListener('click', exportConfigFile);
    el.cfgExportJsonBtn.addEventListener('click', exportConfigFile);
    el.cfgImportJsonInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        state.config = Config.validateImportedConfig(parsed);
        Config.saveConfig(state.config);
        populateSettingsModal();
        showToast('설정 JSON을 불러왔습니다.');
        if (state.lastResult) executeMatching();
      } catch (err) {
        showToast('설정 불러오기 실패: ' + err.message, 4000);
      }
      e.target.value = '';
    });
    el.cfgResetBtn.addEventListener('click', async () => {
      if (!confirm('내 브라우저에 저장된 개인 매핑/설정을 모두 초기화하고 팀 기본값으로 되돌릴까요?')) return;
      state.config = await Config.resetConfig();
      populateSettingsModal();
      showToast('팀 기본값으로 초기화되었습니다.');
      if (state.lastResult) executeMatching();
    });
    el.saveSettingsBtn.addEventListener('click', saveSettingsFromModal);

    document.querySelectorAll('.modal-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.modal-tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('mtab-' + btn.dataset.mtab).classList.add('active');
        if (btn.dataset.mtab === 'json') {
          el.cfgRawJson.value = JSON.stringify(state.config, null, 2);
        }
      });
    });

    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById(btn.dataset.closeModal).classList.add('hidden');
      });
    });
    document.querySelectorAll('.modal-backdrop').forEach(bg => {
      bg.addEventListener('click', (e) => {
        if (e.target === bg) bg.classList.add('hidden');
      });
    });
  }

  // 초기화
  async function init() {
    initTheme();
    state.config = await Config.loadConfig();
    bindEvents();

    // 저장된 URL이 있으면 자동 로드, 없으면 로컬/상대경로 inventory_data.json 조용히 시도
    if (state.config.inventory_url) {
      await fetchInventoryFromUrl(state.config.inventory_url, true);
    } else {
      await fetchInventoryFromUrl('./inventory_data.json', true);
      if (!state.inventoryData) {
        setInventoryStatus('warn', '⚙️ 설정 · 매핑 관리에서 재고조회 URL 또는 JSON 연동 필요');
      }
    }
  }

  init();
})();
