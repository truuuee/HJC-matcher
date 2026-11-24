/**
 * HJC 멀티채널(카페24 · 네이버 스마트스토어 · 쿠팡) 재고 매칭 웹앱 UI 컨트롤러 (v3.0)
 */
(function () {
  'use strict';

  const Config = window.HJCConfig;
  const Matcher = window.HJCMatcher;
  const Excel = window.HJCExcel;

  const CHANNEL_UI = {
    cafe24: {
      id: 'cafe24',
      name: '카페24',
      badge: 'HJC · CAFE24',
      icon: '📄',
      idLabel: '상품코드',
      accept: '.csv',
      ext: '.csv',
      dropTitle: '카페24 재고관리 CSV 파일(.csv)을 여기에 끌어다 놓거나 클릭하세요',
      dropSub: '카페24 관리자 > 상품관리 > 재고관리에서 내려받은 CSV 파일 (bmotomall_*.csv)',
      chunkSize: 1000,
      stockLabel: '총 품목 재고 합계',
      dropsTabLabel: '⚠️ 재고 대폭감소',
      dropsTitle: '⚠️ 카페24 재고 대폭 감소 상품 점검 안내',
      dropsDescPrefix: '재고가 기존 대비 크게 감소(',
      dropsDescSuffix: '% 이상)한 상품입니다. 품절표시 사용은 전 행 \'T\'로 적용됩니다.',
      reviewSheetLabel: '4개 시트',
      filePrefix: '카페24'
    },
    smartstore: {
      id: 'smartstore',
      name: '네이버 스마트스토어',
      badge: 'HJC · SMARTSTORE',
      icon: '📊',
      idLabel: '상품번호',
      accept: '.xlsx',
      ext: '.xlsx',
      dropTitle: '스마트스토어 일괄수정 엑셀(.xlsx)을 여기에 끌어다 놓거나 클릭하세요',
      dropSub: '스마트스토어센터 > 상품 일괄수정에서 내려받은 파일 (시트명: 일괄수정)',
      chunkSize: 500,
      stockLabel: '총 옵션 재고 합계 (M열)',
      dropsTabLabel: '⚠️ 오늘출발 주의',
      dropsTitle: '⚠️ 오늘출발 가능수량 오류 예방 안내 (§9)',
      dropsDescPrefix: '재고가 기존 대비 크게 감소(',
      dropsDescSuffix: '% 이상)한 상품입니다. 네이버 스마트스토어센터의 오늘출발 가능수량보다 새 재고가 작으면 업로드가 실패할 수 있습니다.',
      reviewSheetLabel: '5개 시트',
      filePrefix: '스마트스토어'
    },
    coupang: {
      id: 'coupang',
      name: '쿠팡',
      badge: 'HJC · COUPANG',
      icon: '📦',
      idLabel: '업체상품 ID',
      accept: '.xlsx',
      ext: '.xlsx',
      dropTitle: '쿠팡 가격/재고 일괄변경 엑셀(.xlsx)을 여기에 끌어다 놓거나 클릭하세요',
      dropSub: '쿠팡 Wing > 상품조회/수정 > 엑셀 다운로드에서 내려받은 파일 (price_inventory_*.xlsx)',
      chunkSize: 1500,
      stockLabel: '총 옵션 잔여수량 합계',
      dropsTabLabel: '⚠️ 재고 대폭감소',
      dropsTitle: '⚠️ 쿠팡 잔여수량 대폭 감소 상품 점검 안내',
      dropsDescPrefix: '재고가 기존 대비 크게 감소(',
      dropsDescSuffix: '% 이상)한 상품입니다. S열(잔여수량)에 0 입력 시 자동 품절되며 R열(판매상태)은 비워둡니다.',
      reviewSheetLabel: '5개 시트(노출상품명 상이 포함)',
      filePrefix: '쿠팡'
    }
  };

  function createSession(chId) {
    return {
      channel: chId,
      fileName: '',
      fileBuffer: null,
      parsed: null,
      lastResult: null,
      activeTab: 'queue',
      searchQuery: '',
      statusFilter: 'all',
      manualTypeFilter: 'all',
      undoStack: [],
      alerts: [],
      alertsDanger: false,
      todayShipMap: null,
      applyTodayShip: false,
      errorExcelInfo: null,
      coupangOnlyChanged: true
    };
  }

  // 전역 상태
  const state = {
    activeChannel: 'cafe24',
    config: null,
    inventoryData: null,
    inventorySource: '',
    sessions: {
      cafe24: createSession('cafe24'),
      smartstore: createSession('smartstore'),
      coupang: createSession('coupang')
    },
    settingsEditChannel: 'cafe24',
    pickContext: null,
    pickSelected: []
  };

  function curSession() {
    return state.sessions[state.activeChannel];
  }

  function curChannelMeta() {
    return CHANNEL_UI[state.activeChannel];
  }

  function curChannelBag(chId = state.activeChannel) {
    return Config.ensureChannelBag(state.config, chId);
  }

  // DOM 참조
  const el = {
    brandBadge: document.getElementById('brandBadge'),
    appVersionBadge: document.getElementById('appVersionBadge'),
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
    dropIcon: document.getElementById('dropIcon'),
    excelFileName: document.getElementById('excelFileName'),
    excelFileSub: document.getElementById('excelFileSub'),
    clearExcelBtn: document.getElementById('clearExcelBtn'),
    runMatchBtn: document.getElementById('runMatchBtn'),

    auxCafe24Bar: document.getElementById('auxCafe24Bar'),
    auxCoupangBar: document.getElementById('auxCoupangBar'),
    coupangOnlyChangedCheck: document.getElementById('coupangOnlyChangedCheck'),
    auxSmartstoreDetails: document.getElementById('auxSmartstoreDetails'),

    todayShipFileInput: document.getElementById('todayShipFileInput'),
    applyTodayShipCheck: document.getElementById('applyTodayShipCheck'),
    todayShipStatus: document.getElementById('todayShipStatus'),
    errorExcelFileInput: document.getElementById('errorExcelFileInput'),
    downloadRetryExcelBtn: document.getElementById('downloadRetryExcelBtn'),
    errorExcelStatus: document.getElementById('errorExcelStatus'),

    alertContainer: document.getElementById('alertContainer'),
    resultSection: document.getElementById('resultSection'),
    downloadTitle: document.getElementById('downloadTitle'),
    resultMetaSummary: document.getElementById('resultMetaSummary'),
    downloadUploadExcelBtn: document.getElementById('downloadUploadExcelBtn'),
    downloadReviewExcelBtn: document.getElementById('downloadReviewExcelBtn'),

    kpiTotalProducts: document.getElementById('kpiTotalProducts'),
    kpiAddonsSub: document.getElementById('kpiAddonsSub'),
    kpiOkCount: document.getElementById('kpiOkCount'),
    kpiWarnCount: document.getElementById('kpiWarnCount'),
    kpiCheckCount: document.getElementById('kpiCheckCount'),
    kpiFailCount: document.getElementById('kpiFailCount'),
    kpiStockLabel: document.getElementById('kpiStockLabel'),
    kpiStockChange: document.getElementById('kpiStockChange'),
    kpiStockDiff: document.getElementById('kpiStockDiff'),

    aliasLearnBar: document.getElementById('aliasLearnBar'),
    aliasLearnList: document.getElementById('aliasLearnList'),

    tabBtnAddons: document.getElementById('tabBtnAddons'),
    tabBtnDisplayDiff: document.getElementById('tabBtnDisplayDiff'),
    tabBtnDropsLabel: document.getElementById('tabBtnDropsLabel'),
    dropsNoticeTitle: document.getElementById('dropsNoticeTitle'),
    dropsNoticeDesc: document.getElementById('dropsNoticeDesc'),

    badgeQueue: document.getElementById('badgeQueue'),
    badgeSummary: document.getElementById('badgeSummary'),
    badgeOptions: document.getElementById('badgeOptions'),
    badgeAddons: document.getElementById('badgeAddons'),
    badgeDisplayDiff: document.getElementById('badgeDisplayDiff'),
    badgeDrops: document.getElementById('badgeDrops'),
    badgeManual: document.getElementById('badgeManual'),
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
    displayDiffTableBody: document.getElementById('displayDiffTableBody'),
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
    cfgChannelSelect: document.getElementById('cfgChannelSelect'),
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
    const sess = curSession();
    const allowUndo = Boolean(opts && opts.allowUndo && sess.undoStack.length > 0);
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
    const sess = curSession();
    sess.undoStack.push({
      label: label || '직전 작업',
      snapshot: Config.deepClone(state.config)
    });
    if (sess.undoStack.length > 20) sess.undoStack.shift();
    updateUndoButtons();
  }

  function updateUndoButtons() {
    const sess = curSession();
    const hasUndo = sess.undoStack.length > 0;
    const last = hasUndo ? sess.undoStack[sess.undoStack.length - 1] : null;
    [el.undoActionBtn, el.undoActionBtnManual].forEach(btn => {
      if (!btn) return;
      btn.classList.toggle('hidden', !hasUndo);
      if (last) btn.title = `되돌리기: ${last.label}`;
    });
  }

  function undoLastAction() {
    const sess = curSession();
    if (sess.undoStack.length === 0) return;
    const prev = sess.undoStack.pop();
    state.config = prev.snapshot;
    Config.saveConfig(state.config);
    updateUndoButtons();
    if (sess.parsed && state.inventoryData) executeMatching();
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

  // 채널 상태 배지 갱신
  function updateChannelTabPills() {
    for (const ch of Config.CHANNELS) {
      const pill = document.getElementById(`chStatus-${ch}`);
      if (!pill) continue;
      const s = state.sessions[ch];
      if (s.lastResult) {
        const m = s.lastResult.meta;
        pill.textContent = `${m.productCount.toLocaleString()}상품 · 큐 ${s.lastResult.reviewQueue.length}`;
        pill.classList.add('loaded');
      } else if (s.parsed) {
        const cnt = ch === 'smartstore' ? s.parsed.productRows.length : s.parsed.productCount;
        pill.textContent = `${cnt.toLocaleString()}상품 로드됨`;
        pill.classList.add('loaded');
      } else {
        pill.textContent = '대기';
        pill.classList.remove('loaded');
      }
    }
  }

  // 메인 채널 전환
  function switchChannel(chId) {
    if (!CHANNEL_UI[chId]) return;
    state.activeChannel = chId;
    const meta = curChannelMeta();
    const sess = curSession();

    // 메인 탭 활성화
    document.querySelectorAll('.channel-tab-btn').forEach(btn => {
      const isAct = btn.dataset.channel === chId;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-selected', isAct ? 'true' : 'false');
    });

    el.brandBadge.textContent = meta.badge;
    el.excelFileInput.accept = meta.accept;
    el.dropIcon.textContent = meta.icon;

    // 채널별 보조 도구 토글
    el.auxCafe24Bar.classList.toggle('hidden', chId !== 'cafe24');
    el.auxSmartstoreDetails.classList.toggle('hidden', chId !== 'smartstore');
    el.auxCoupangBar.classList.toggle('hidden', chId !== 'coupang');

    // 채널별 결과 탭 가시성
    el.tabBtnAddons.classList.toggle('hidden', chId !== 'smartstore');
    el.tabBtnDisplayDiff.classList.toggle('hidden', chId !== 'coupang');
    el.tabBtnDropsLabel.textContent = meta.dropsTabLabel;
    el.kpiStockLabel.textContent = meta.stockLabel;
    el.copyDropNosBtn.textContent = `📋 ${meta.idLabel} 일괄 복사`;

    // 테이블 ID 헤더 라벨 동기화
    document.querySelectorAll('.col-id-label').forEach(th => {
      th.textContent = meta.idLabel;
    });

    // 드롭존 상태 복원
    if (sess.parsed) {
      el.excelDropZone.classList.add('loaded');
      el.clearExcelBtn.classList.remove('hidden');
      if (chId === 'smartstore') {
        el.excelFileName.textContent = `📄 ${sess.fileName} (${sess.parsed.productRows.length.toLocaleString()}개 상품 로드됨)`;
        el.excelFileSub.textContent = `시트명: ${sess.parsed.sheetName} · 다른 파일을 끌어다 놓으면 교체됩니다`;
      } else if (chId === 'cafe24') {
        el.excelFileName.textContent = `📄 ${sess.fileName} (${sess.parsed.productCount.toLocaleString()}개 상품 / ${sess.parsed.itemRows.length.toLocaleString()}품목 로드됨)`;
        el.excelFileSub.textContent = `인코딩: ${sess.parsed.encoding} · 다른 CSV 파일을 끌어다 놓으면 교체됩니다`;
      } else {
        el.excelFileName.textContent = `📦 ${sess.fileName} (${sess.parsed.productCount.toLocaleString()}개 상품 / ${sess.parsed.itemRows.length.toLocaleString()}옵션 로드됨)`;
        el.excelFileSub.textContent = `시트명: ${sess.parsed.sheetName} (수정가능 ${sess.parsed.editableCount}건) · 다른 파일을 끌어다 놓으면 교체됩니다`;
      }
    } else {
      el.excelDropZone.classList.remove('loaded');
      el.excelFileName.textContent = meta.dropTitle;
      el.excelFileSub.textContent = meta.dropSub;
      el.clearExcelBtn.classList.add('hidden');
    }

    // 쿠팡/스마트스토어 체크박스 상태 복원
    el.coupangOnlyChangedCheck.checked = sess.coupangOnlyChanged;
    el.applyTodayShipCheck.checked = sess.applyTodayShip;

    // 검색/필터 복원
    el.tableSearchInput.value = sess.searchQuery;
    el.statusFilterSelect.value = sess.statusFilter;
    if (el.manualTypeFilter) el.manualTypeFilter.value = sess.manualTypeFilter;

    // 알림 복원
    renderAlerts(sess.alerts, sess.alertsDanger);
    updateRunButtonState();
    updateRetryButtonState();
    updateUndoButtons();

    // 결과 대시보드 복원
    if (sess.lastResult) {
      renderResultDashboard(sess.lastResult);
      // 현재 세션의 활성 탭 유효성 확인
      if ((sess.activeTab === 'addons' && chId !== 'smartstore') || (sess.activeTab === 'displaydiff' && chId !== 'coupang')) {
        sess.activeTab = 'queue';
      }
      activateResultTab(sess.activeTab);
    } else {
      el.resultSection.classList.add('hidden');
    }
  }

  function activateResultTab(tabName) {
    const sess = curSession();
    sess.activeTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tabName));
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

    const index = Matcher.buildInventoryIndex(data, Config.getEffectiveConfig(state.config, state.activeChannel));
    el.metaStoreTime.textContent = (data.meta && data.meta.store_time) || '-';
    el.metaHqTime.textContent = (data.meta && data.meta.hq_time) || '-';
    el.metaItemCount.textContent = data.items.length.toLocaleString();
    el.metaBaseCount.textContent = index.bases.length.toLocaleString();

    setInventoryStatus('ok', `재고 연동 완료 (${sourceLabel})`);
    updateRunButtonState();

    // 이미 파일이 로드되어 있는 채널들은 재계산
    for (const ch of Config.CHANNELS) {
      if (state.sessions[ch].parsed) {
        executeMatchingForChannel(ch);
      }
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
    const sess = curSession();
    el.runMatchBtn.disabled = !(state.inventoryData && sess.parsed);
  }

  function renderAlerts(messages, isDanger = false) {
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

  function showAlerts(messages, isDanger = false) {
    const sess = curSession();
    sess.alerts = messages || [];
    sess.alertsDanger = Boolean(isDanger);
    renderAlerts(sess.alerts, sess.alertsDanger);
  }

  // 채널별 파일 업로드 처리
  async function handleUploadedFile(file) {
    if (!file) return;
    const ch = state.activeChannel;
    const meta = curChannelMeta();
    const sess = curSession();
    const lower = file.name.toLowerCase();

    if (!lower.endsWith(meta.ext)) {
      showToast(`[${meta.name}] 탭에서는 ${meta.ext} 파일만 업로드할 수 있습니다.`);
      return;
    }

    try {
      const buf = await file.arrayBuffer();
      let parsed;
      const warnings = [];

      if (ch === 'cafe24') {
        parsed = Excel.parseCafe24Csv(buf);
        if (parsed.headerWarnings.length > 0) warnings.push(...parsed.headerWarnings);
      } else if (ch === 'smartstore') {
        parsed = await Excel.parseSmartStoreExcel(buf);
        if (parsed.usedFallbackSheet) {
          warnings.push(`'일괄수정' 시트를 찾지 못해 첫 번째 시트('${parsed.sheetName}')를 사용했습니다.`);
        }
        if (parsed.headerWarnings.length > 0) {
          warnings.push('헤더 확인 필요: ' + parsed.headerWarnings.join(' / '));
        }
      } else {
        parsed = await Excel.parseCoupangExcel(buf);
        if (parsed.usedFallbackSheet) {
          warnings.push(`'data' 시트를 찾지 못해 첫 번째 시트('${parsed.sheetName}')를 사용했습니다.`);
        }
        if (parsed.headerWarnings.length > 0) {
          warnings.push('헤더 확인 필요: ' + parsed.headerWarnings.join(' / '));
        }
        if (parsed.uneditableCount > 0) {
          warnings.push(`수정 불가 행(승인대기/옵션ID 없음) ${parsed.uneditableCount}건은 안전을 위해 자동 보호(S열 빈칸)됩니다.`);
        }
      }

      sess.fileName = file.name;
      sess.fileBuffer = buf;
      sess.parsed = parsed;
      sess.alerts = warnings;
      sess.alertsDanger = false;

      switchChannel(ch); // 드롭존 텍스트 및 알림 갱신
      updateChannelTabPills();

      if (state.inventoryData) {
        executeMatching();
      } else {
        showToast(`[${meta.name}] 파일 로드 완료! ⚙️ 설정에서 재고 데이터를 연동하면 매칭을 실행할 수 있습니다.`);
      }
    } catch (err) {
      console.error(err);
      showAlerts([`[${meta.name}] 파일 읽기 오류: ${err.message}`], true);
      showToast('파일 읽기에 실패했습니다. 현재 선택한 채널과 양식이 맞는지 확인하세요.', 4500);
    }
  }

  function clearUploadedFile() {
    const sess = curSession();
    const meta = curChannelMeta();
    sess.fileName = '';
    sess.fileBuffer = null;
    sess.parsed = null;
    sess.lastResult = null;
    sess.alerts = [];
    sess.alertsDanger = false;

    switchChannel(state.activeChannel);
    updateChannelTabPills();
    showToast(`[${meta.name}] 업로드된 파일을 삭제했습니다.`);
  }

  function executeMatchingForChannel(chId) {
    const sess = state.sessions[chId];
    if (!state.inventoryData || !sess.parsed) return;

    const effCfg = Config.getEffectiveConfig(state.config, chId);
    let res;

    if (chId === 'smartstore') {
      res = Matcher.runMatching(
        sess.parsed.productRows,
        state.inventoryData,
        effCfg,
        {
          todayShipMap: sess.todayShipMap,
          applyTodayShipFloor: sess.applyTodayShip
        }
      );
      const integrityErrors = Excel.verifyUpdatesIntegrity(sess.parsed.productRows, res.cellUpdates);
      if (integrityErrors.length > 0) {
        sess.alerts = ['무결성 오류 발견: ' + integrityErrors.join(' | ')];
        sess.alertsDanger = true;
      }
    } else {
      res = Matcher.runChannelMatching(
        chId,
        sess.parsed.itemRows,
        state.inventoryData,
        effCfg,
        { coupangOnlyChanged: sess.coupangOnlyChanged }
      );
    }

    sess.lastResult = res;
    updateChannelTabPills();

    if (chId === state.activeChannel) {
      renderAlerts(sess.alerts, sess.alertsDanger);
      renderResultDashboard(res);
      updateRetryButtonState();
    }
  }

  function executeMatching() {
    executeMatchingForChannel(state.activeChannel);
  }

  function updateRetryButtonState() {
    const ss = state.sessions.smartstore;
    el.downloadRetryExcelBtn.disabled = !(ss.lastResult && ss.errorExcelInfo && ss.errorExcelInfo.failedNos.size > 0);
  }

  // 대시보드 및 테이블 렌더링
  function renderResultDashboard(res) {
    el.resultSection.classList.remove('hidden');
    const ch = res.channel || state.activeChannel;
    const meta = CHANNEL_UI[ch];
    const m = res.meta;

    el.downloadTitle.textContent = `✅ [${meta.name}] 매칭 완료 — 업로드용 파일 & 검토표 준비됨`;

    if (ch === 'cafe24') {
      el.resultMetaSummary.textContent =
        `기준일시: 매장 ${m.storeTime} / 본사 ${m.hqTime} · HQ_DEFAULT=${m.hqDefault} · 품절표시 사용 전 행 'T' 적용 · 총 재고량 자동 합산`;
      if (res.rowUpdates.length > meta.chunkSize) {
        const parts = Math.ceil(res.rowUpdates.length / meta.chunkSize);
        el.downloadUploadExcelBtn.textContent = `📦 카페24 재고수정용 ZIP 다운로드 (총 ${res.rowUpdates.length.toLocaleString()}행 · 1,000행 단위 분할)`;
      } else {
        el.downloadUploadExcelBtn.textContent = '⬇️ 카페24 재고수정용 CSV 다운로드 (업로드용)';
      }
      el.kpiAddonsSub.textContent = `품절표시 사용 전 행 'T' 고정 (${m.optionCount.toLocaleString()}품목)`;
    } else if (ch === 'smartstore') {
      el.resultMetaSummary.textContent =
        `기준일시: 매장 ${m.storeTime} / 본사 ${m.hqTime} · HQ_DEFAULT=${m.hqDefault} · 원본 서식 무손상 검증 통과` +
        (m.todayShipAdjustedCount > 0 ? ` · 오늘출발 하한보정 ${m.todayShipAdjustedCount}건` : '');
      if (res.cellUpdates.length > meta.chunkSize) {
        const parts = Math.ceil(res.cellUpdates.length / meta.chunkSize);
        el.downloadUploadExcelBtn.textContent = `📦 스마트스토어 ZIP 다운로드 (총 ${res.cellUpdates.length.toLocaleString()}개 · ${parts}개 분할)`;
      } else {
        el.downloadUploadExcelBtn.textContent = '⬇️ 스마트스토어 재고수정용 엑셀 다운로드';
      }
      el.kpiAddonsSub.textContent = `추가상품 ${m.totalAddonProducts}개 상품 (${m.totalAddonItems}항목 · 실패 ${m.totalAddonFail}, 추정 ${m.totalAddonEstimate})`;
    } else {
      el.resultMetaSummary.textContent =
        `기준일시: 매장 ${m.storeTime} / 본사 ${m.hqTime} · HQ_DEFAULT=${m.hqDefault} · S열 반영 대상 ${m.coupangWriteCount.toLocaleString()}행 (${m.coupangOnlyChanged ? '변경분만' : '확정 전체'}) · 노출상품명 상이 ${m.displayDiffCount}건`;
      if (res.rowUpdates.length > meta.chunkSize) {
        const parts = Math.ceil(res.rowUpdates.length / meta.chunkSize);
        el.downloadUploadExcelBtn.textContent = `📦 쿠팡 재고수정용 ZIP 다운로드 (총 ${res.rowUpdates.length.toLocaleString()}행 · ${parts}개 분할)`;
      } else {
        el.downloadUploadExcelBtn.textContent = `⬇️ 쿠팡 재고수정용 엑셀 다운로드 (S열 ${m.coupangWriteCount.toLocaleString()}행 반영)`;
      }
      el.kpiAddonsSub.textContent = `S열 입력 ${m.coupangWriteCount.toLocaleString()}행 · 노출상품명 상이 ${m.displayDiffCount}건`;
    }

    el.downloadReviewExcelBtn.textContent = `📑 검토표 엑셀 다운로드 (${meta.reviewSheetLabel})`;

    el.kpiTotalProducts.textContent = `${m.productCount.toLocaleString()} / ${m.optionCount.toLocaleString()}`;
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
    el.badgeAddons.textContent = (res.addonDetails || []).length;
    el.badgeDisplayDiff.textContent = (res.displayNameDiffs || []).length;
    el.badgeDrops.textContent = res.dropWarnings.length;

    el.dropsNoticeTitle.textContent = meta.dropsTitle;
    el.dropsNoticeDesc.innerHTML = `${esc(meta.dropsDescPrefix)}<strong>${m.dropWarningPercent}</strong>${esc(meta.dropsDescSuffix)}`;

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
    const sess = curSession();
    if (!sess.lastResult) return;
    const res = sess.lastResult;
    const ch = state.activeChannel;
    const q = sess.searchQuery.trim();
    const stFilter = sess.statusFilter;

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
      el.queueTableBody.innerHTML = qRows.slice(0, 500).map(item => {
        const badgeCls = item.queueType.includes('실패') || item.queueType.includes('미매칭') || item.queueType.includes('신제품')
          ? 'badge-fail-pill' : 'badge-warn-pill';
        const isOptTarget = item.targetType === 'addon' || item.targetType === 'shield-option';
        const isMissingSize = item.targetType === 'helmet-size';
        const dupCnt = isOptTarget ? (optDupCounts.get(`${item.targetType}::${item.optionValue}`) || 1) : 1;
        const missingCsv = (item.missingSizes || []).join(',');
        const confirmKey = item.confirmKey || item.productNo;

        const confirmSizeBtnHtml = isMissingSize ? `
          <button class="confirm-size-btn"
            data-confirm-missing-key="${esc(confirmKey)}"
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
              data-quick-map-confirm-key="${esc(confirmKey)}"
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
      }).join('') + (qRows.length > 500 ? `<tr><td colspan="5" class="empty-row">상위 500건만 표시합니다 (전체 ${qRows.length.toLocaleString()}건은 검색 필터 또는 검토표 엑셀 확인).</td></tr>` : '');
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
      matchesSearch([o.productNo, o.optionId || '', o.productName, o.optionValue, o.matchedItems, o.detail], q)
    );
    if (oRows.length === 0) {
      el.optionsTableBody.innerHTML = `<tr><td colspan="8" class="empty-row">조건에 맞는 옵션이 없습니다.</td></tr>`;
    } else {
      el.optionsTableBody.innerHTML = oRows.slice(0, 1500).map(o => `
        <tr>
          <td>
            <code>${esc(o.productNo)}</code>
            ${o.optionId ? `<span class="sub-text">${esc(o.optionId)}</span>` : ''}
          </td>
          <td>${esc(o.productName)}</td>
          <td><strong>${esc(o.optionValue)}</strong></td>
          <td class="num">${o.oldStock.toLocaleString()}</td>
          <td class="num"><strong>${o.newStock.toLocaleString()}</strong></td>
          <td class="num">${diffHtml(o.oldStock, o.newStock)}</td>
          <td><span class="sub-text">${esc(o.matchedItems)}</span></td>
          <td>
            ${o.isFail ? `<span class="badge badge-fail-pill">실패</span> ` : (o.isEstimate || o.isNoSize ? `<span class="badge badge-warn-pill">주의</span> ` : '')}
            ${o.sActionLabel ? `<span class="badge badge-dim">${esc(o.sActionLabel)}</span> ` : ''}
            ${esc(o.detail)}
          </td>
        </tr>
      `).join('') + (oRows.length > 1500 ? `<tr><td colspan="8" class="empty-row">표시 성능을 위해 상위 1,500행만 표시합니다 (전체 ${oRows.length.toLocaleString()}행은 검토표 엑셀에 모두 포함됨).</td></tr>` : '');
    }

    // 4. 추가상품 상세 (스마트스토어 전용)
    if (ch === 'smartstore') {
      const aRows = (res.addonDetails || []).filter(a =>
        matchesSearch([a.productNo, a.productName, a.label, a.matchedItems, a.detail], q)
      );
      if (aRows.length === 0) {
        el.addonsTableBody.innerHTML = `<tr><td colspan="9" class="empty-row">표시할 추가상품 항목이 없습니다.</td></tr>`;
      } else {
        const fixedMap = curChannelBag().fixed_stock || {};
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
    }

    // 4-B. 노출상품명 상이 (쿠팡 전용)
    if (ch === 'coupang') {
      const diffRows = (res.displayNameDiffs || []).filter(d =>
        matchesSearch([d.severity, d.productNo, d.optionId, d.registeredName, d.displayName, d.optionName, d.reason], q)
      );
      if (diffRows.length === 0) {
        el.displayDiffTableBody.innerHTML = `<tr><td colspan="6" class="empty-row">🎉 쿠팡 노출 상품명과 업체 등록 상품명이 상이한 항목이 없습니다.</td></tr>`;
      } else {
        el.displayDiffTableBody.innerHTML = diffRows.slice(0, 1000).map(d => `
          <tr>
            <td><span class="badge ${d.isMatchMismatch ? 'badge-fail-pill' : 'badge-warn-pill'}">${esc(d.severity)}</span></td>
            <td>
              <code>${esc(d.productNo)}</code>
              <span class="sub-text">${esc(d.optionId)}</span>
            </td>
            <td>
              <div class="diff-name-pair">
                <div><span class="diff-name-tag reg">등록명</span><strong>${esc(d.registeredName)}</strong></div>
                <div><span class="diff-name-tag disp">노출명</span><span>${esc(d.displayName)}</span></div>
              </div>
            </td>
            <td><strong>${esc(d.optionName)}</strong></td>
            <td>
              <div class="diff-name-pair">
                <span class="sub-text" style="margin:0">등록: ${esc(d.registeredMatched)}</span>
                <span class="sub-text" style="margin:0">노출: ${esc(d.displayMatched)}</span>
              </div>
            </td>
            <td><span class="sub-text" style="margin:0">${esc(d.reason)}</span></td>
          </tr>
        `).join('');
      }
    }

    // 5. 재고 대폭 감소 / 오늘출발 주의
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

    // 6. 현재 채널 수동 매핑 내역
    renderManualHistoryTable(res, q);
  }

  function buildManualHistoryRows(res) {
    const c = curChannelBag();
    const nameByPno = new Map();
    if (res && Array.isArray(res.productSummaries)) {
      for (const p of res.productSummaries) nameByPno.set(String(p.productNo), p.productName);
    }

    const rows = [];
    for (const [pno, bases] of Object.entries(c.manual_map || {})) {
      const targetStr = Array.isArray(bases) ? bases.join(' + ') : String(bases || '');
      rows.push({
        type: 'manual_map',
        typeLabel: '상품 수동 매핑',
        badgeCls: 'badge-ok',
        key: pno,
        scope: pno,
        name: nameByPno.get(String(pno)) || '(현재 파일 외 저장 상품)',
        detail: targetStr
      });
    }

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
          : `${nameByPno.get(scopePart) || '(현재 파일 외 상품)'} · 대상: ${labelPart}`,
        detail: targetStr
      });
    }

    for (const [pno, sizes] of Object.entries(c.confirmed_missing_sizes || {})) {
      const szStr = Array.isArray(sizes) ? sizes.join(', ') : String(sizes || '');
      rows.push({
        type: 'confirmed_missing_sizes',
        typeLabel: '사이즈없음 확인',
        badgeCls: 'badge-warn-pill',
        key: pno,
        scope: pno,
        name: nameByPno.get(String(pno).split('::')[0]) || '(현재 파일 외 저장 상품)',
        detail: `미존재 사이즈 0 처리 확인: ${szStr}`
      });
    }

    for (const pno of (c.ignore_products || [])) {
      rows.push({
        type: 'ignore_products',
        typeLabel: '상품 매칭 해제',
        badgeCls: 'badge-dim',
        key: String(pno),
        scope: String(pno),
        name: nameByPno.get(String(pno)) || '(현재 파일 외 저장 상품)',
        detail: '기존 재고 유지 (정상 처리)'
      });
    }

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
          : `${nameByPno.get(scopePart) || '(현재 파일 외 상품)'} · 대상: ${labelPart}`,
        detail: '기존 재고 유지 (정상 처리)'
      });
    }

    return rows;
  }

  function renderManualHistoryTable(res, q) {
    const sess = curSession();
    const allRows = buildManualHistoryRows(res);
    if (el.badgeManual) el.badgeManual.textContent = allRows.length;

    const typeFilter = sess.manualTypeFilter || 'all';
    const filtered = allRows.filter(r => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false;
      return matchesSearch([r.typeLabel, r.scope, r.name, r.detail], q);
    });

    if (filtered.length === 0) {
      el.manualTableBody.innerHTML = `<tr><td colspan="5" class="empty-row">${allRows.length === 0 ? '현재 채널에 저장된 수동 매핑·해제 내역이 없습니다.' : '검색/필터 조건에 맞는 수동 매핑 내역이 없습니다.'}</td></tr>`;
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
    const sess = curSession();
    if (!sess.lastResult) return;
    const bag = curChannelBag();
    const meta = curChannelMeta();
    const isOptTarget = targetType === 'addon' || targetType === 'shield-option' || targetType === 'helmet-group';
    const isHelmetGroup = targetType === 'helmet-group';
    state.pickContext = { productNo, productName, targetType, optionValue, isOptTarget, isHelmetGroup };

    if (isOptTarget) {
      const optMap = bag.option_manual_map || {};
      const existing = optMap[`${productNo}::${optionValue}`] || optMap[`공통::${optionValue}`] || [];
      state.pickSelected = [...existing];
      el.pickTargetInfo.innerHTML = `<strong>${esc(productName)}</strong> <span class="sub-text">[${esc(meta.name)}] ${esc(meta.idLabel)}: ${esc(productNo)} · 대상: <strong>${esc(optionValue)}</strong></span>`;
      if (isHelmetGroup) {
        el.pickBulkOptionRow.classList.add('hidden');
        el.pickBulkCheck.checked = false;
        el.pickTypeFilter.value = 'helmet';
      } else {
        el.pickBulkOptionRow.classList.remove('hidden');
        el.pickBulkLabel.textContent = `같은 표기('${optionValue}') 전체 상품에 일괄 적용`;
        el.pickBulkCheck.checked = true;
        el.pickTypeFilter.value = 'all';
      }
    } else {
      const existing = (bag.manual_map && bag.manual_map[productNo]) || [];
      state.pickSelected = [...existing];
      el.pickTargetInfo.innerHTML = `<strong>${esc(productName)}</strong> <span class="sub-text">[${esc(meta.name)}] ${esc(meta.idLabel)}: ${esc(productNo)}</span>`;
      el.pickBulkOptionRow.classList.add('hidden');
      el.pickTypeFilter.value = targetType === 'single' ? 'all' : 'helmet';
    }

    el.pickSearchInput.value = '';
    renderPickModalLists();
    el.manualPickModal.classList.remove('hidden');
    el.pickSearchInput.focus();
  }

  function renderPickModalLists() {
    const sess = curSession();
    if (!sess.lastResult) return;
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
    const index = sess.lastResult.index;

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

  // 설정 모달 유틸
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

  function populateChannelFieldsInModal(chId) {
    state.settingsEditChannel = chId;
    el.cfgChannelSelect.value = chId;
    const chCfg = curChannelBag(chId);
    el.cfgManualMap.value = arrayMapToLines(chCfg.manual_map);
    el.cfgManualMapByName.value = arrayMapToLines(chCfg.manual_map_by_name);
    el.cfgOptionManualMap.value = arrayMapToLines(chCfg.option_manual_map);
    el.cfgConfirmedMissingSizes.value = arrayMapToLines(chCfg.confirmed_missing_sizes);
    el.cfgFixedStock.value = dictToLines(chCfg.fixed_stock);
    el.cfgIgnoreProducts.value = (chCfg.ignore_products || []).join('\n');
    el.cfgIgnoredOptions.value = (chCfg.ignored_options || []).join('\n');
  }

  function flushCurrentModalChannelToObj(targetRoot) {
    const bag = Config.ensureChannelBag(targetRoot, state.settingsEditChannel);
    bag.manual_map = linesToArrayMap(el.cfgManualMap.value);
    bag.manual_map_by_name = linesToArrayMap(el.cfgManualMapByName.value);
    bag.option_manual_map = linesToArrayMap(el.cfgOptionManualMap.value);
    bag.confirmed_missing_sizes = linesToArrayMap(el.cfgConfirmedMissingSizes.value);
    bag.fixed_stock = linesToDict(el.cfgFixedStock.value, true);
    bag.ignore_products = el.cfgIgnoreProducts.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    bag.ignored_options = el.cfgIgnoredOptions.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
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
    populateChannelFieldsInModal(state.activeChannel);
    el.cfgRawJson.value = JSON.stringify(c, null, 2);
  }

  function saveSettingsFromModal() {
    const activeMTab = document.querySelector('.modal-tab-btn.active')?.dataset.mtab;
    let nextCfg;
    if (activeMTab === 'json') {
      try {
        const parsed = JSON.parse(el.cfgRawJson.value);
        nextCfg = Config.validateImportedConfig(parsed, state.config);
      } catch (err) {
        showToast('JSON 문법 오류: ' + err.message, 4000);
        return;
      }
    } else {
      nextCfg = Config.deepClone(state.config);
      nextCfg.inventory_url = el.cfgInventoryUrl.value.trim();
      nextCfg.hq_default_stock = Math.max(0, parseInt(el.cfgHqDefault.value, 10) || 100);
      nextCfg.drop_warning_percent = Math.max(1, Math.min(100, parseInt(el.cfgDropPct.value, 10) || 50));
      nextCfg.models_extra = el.cfgModelsExtra.value.split(',').map(s => s.trim()).filter(Boolean);
      nextCfg.aliases = linesToDict(el.cfgAliases.value);
      nextCfg.color_synonyms = linesToDict(el.cfgColorSynonyms.value);
      nextCfg.color_fallback = linesToDict(el.cfgColorFallback.value);
      flushCurrentModalChannelToObj(nextCfg);
    }

    const urlChanged = nextCfg.inventory_url !== state.config.inventory_url;
    state.config = nextCfg;
    Config.saveConfig(state.config);
    el.settingsModal.classList.add('hidden');
    showToast('설정이 저장되었습니다.');

    if (urlChanged && state.config.inventory_url) {
      fetchInventoryFromUrl(state.config.inventory_url);
    } else {
      for (const ch of Config.CHANNELS) {
        if (state.sessions[ch].parsed && state.inventoryData) {
          executeMatchingForChannel(ch);
        }
      }
    }
  }

  function exportConfigFile() {
    const json = JSON.stringify(state.config, null, 2);
    triggerDownload(json, `HJC_멀티채널매핑설정_v3_${todayYYYYMMDD()}.json`, 'application/json');
    showToast('전체 채널 매핑 설정 JSON 파일을 다운로드했습니다.');
  }

  // 이벤트 바인딩
  function bindEvents() {
    // 메인 채널 탭 전환
    document.querySelectorAll('.channel-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        switchChannel(btn.dataset.channel);
      });
    });

    // 재고 새로고침 및 로컬 JSON 열기
    el.refreshInvBtn.addEventListener('click', async () => {
      const raw = state.config.inventory_url;
      if (raw) await fetchInventoryFromUrl(raw, false);
      else await fetchInventoryFromUrl('./inventory_data.json', false);
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

    // 드래그&드롭 / 클릭 / 삭제(X)
    el.clearExcelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearUploadedFile();
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
      if (e.dataTransfer.files[0]) handleUploadedFile(e.dataTransfer.files[0]);
    });
    el.excelFileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleUploadedFile(e.target.files[0]);
      e.target.value = '';
    });

    // 매칭 실행
    el.runMatchBtn.addEventListener('click', () => {
      executeMatching();
      showToast(`[${curChannelMeta().name}] 재고 매칭을 실행했습니다.`);
    });

    // 쿠팡 S열 변경분만 입력 옵션
    el.coupangOnlyChangedCheck.addEventListener('change', () => {
      state.sessions.coupang.coupangOnlyChanged = el.coupangOnlyChangedCheck.checked;
      if (state.sessions.coupang.parsed && state.inventoryData) {
        executeMatchingForChannel('coupang');
      }
    });

    // 스마트스토어 보조 도구 ① 오늘출발 수량 보정
    el.todayShipFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const map = await Excel.parseTodayShipFile(file.name, buf);
        state.sessions.smartstore.todayShipMap = map;
        state.sessions.smartstore.applyTodayShip = true;
        el.todayShipStatus.textContent = `${file.name} (${map.size}건 로드됨)`;
        el.applyTodayShipCheck.checked = true;
        showToast(`오늘출발 가능수량 ${map.size}건을 불러왔습니다.`);
        if (state.sessions.smartstore.parsed && state.inventoryData) executeMatchingForChannel('smartstore');
      } catch (err) {
        showToast('오늘출발 파일 읽기 실패: ' + err.message, 4000);
      }
      e.target.value = '';
    });
    el.applyTodayShipCheck.addEventListener('change', () => {
      state.sessions.smartstore.applyTodayShip = el.applyTodayShipCheck.checked;
      if (state.sessions.smartstore.parsed && state.inventoryData) executeMatchingForChannel('smartstore');
    });

    // 스마트스토어 보조 도구 ② 실패 엑셀 재추출
    el.errorExcelFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const info = await Excel.parseErrorExcel(buf);
        state.sessions.smartstore.errorExcelInfo = info;
        el.errorExcelStatus.textContent = `실패 상품 ${info.failedNos.size}건 추출됨`;
        updateRetryButtonState();
        showToast(`실패 엑셀에서 ${info.failedNos.size}개 상품번호를 추출했습니다.`);
      } catch (err) {
        showToast('실패 엑셀 읽기 실패: ' + err.message, 4000);
      }
      e.target.value = '';
    });

    el.downloadRetryExcelBtn.addEventListener('click', async () => {
      const ss = state.sessions.smartstore;
      if (!ss.lastResult || !ss.errorExcelInfo) return;
      el.downloadRetryExcelBtn.disabled = true;
      try {
        const pkg = await Excel.buildUploadPackage(
          ss.fileBuffer,
          ss.parsed.productRows,
          ss.lastResult.cellUpdates,
          {
            filterProductNos: ss.errorExcelInfo.failedNos,
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

    // 결과 업로드용 파일 다운로드 (채널별 자동 분기 & 자동 분할 ZIP)
    el.downloadUploadExcelBtn.addEventListener('click', async () => {
      const ch = state.activeChannel;
      const sess = curSession();
      const meta = curChannelMeta();
      if (!sess.lastResult || !sess.fileBuffer) return;

      const origLabel = el.downloadUploadExcelBtn.textContent;
      el.downloadUploadExcelBtn.disabled = true;
      el.downloadUploadExcelBtn.textContent = '⏳ 업로드용 파일 생성 중...';

      try {
        let pkg;
        if (ch === 'cafe24') {
          pkg = await Excel.buildCafe24UploadPackage(
            sess.parsed,
            sess.lastResult.rowUpdates,
            {
              chunkSize: 1000,
              baseFileName: `카페24_재고수정용_${todayYYYYMMDD()}`
            }
          );
          triggerDownload(pkg.data, pkg.fileName, pkg.mimeType);
          showToast(
            pkg.isZip
              ? `카페24 총 ${pkg.totalCount.toLocaleString()}행을 1,000행 단위 ${pkg.partCount}개 CSV로 분할해 ZIP 다운로드했습니다 (품절표시='T' 고정).`
              : `카페24 재고수정용 CSV(${pkg.totalCount.toLocaleString()}행, 품절표시='T' 고정)를 다운로드했습니다.`
          );
        } else if (ch === 'smartstore') {
          pkg = await Excel.buildUploadPackage(
            sess.fileBuffer,
            sess.parsed.productRows,
            sess.lastResult.cellUpdates,
            {
              chunkSize: 500,
              baseFileName: `스마트스토어상품_재고수정용_${todayYYYYMMDD()}`
            }
          );
          triggerDownload(pkg.data, pkg.fileName, pkg.mimeType);
          showToast(
            pkg.isZip
              ? `총 ${pkg.totalCount.toLocaleString()}개 상품을 500개씩 ${pkg.partCount}개 파일로 분할하여 ZIP 다운로드했습니다.`
              : '스마트스토어 업로드용 재고수정 엑셀을 다운로드했습니다 (원본 서식 100% 보존).'
          );
        } else {
          pkg = await Excel.buildCoupangUploadPackage(
            sess.fileBuffer,
            sess.lastResult.rowUpdates,
            {
              chunkSize: 1500,
              onlyChanged: sess.coupangOnlyChanged,
              baseFileName: `coupangStock${todayYYYYMMDD()}`
            }
          );
          triggerDownload(pkg.data, pkg.fileName, pkg.mimeType);
          showToast(
            pkg.isZip
              ? `쿠팡 총 ${pkg.totalCount.toLocaleString()}옵션을 1,500행 단위 ${pkg.partCount}개 파일로 분할해 ZIP 다운로드했습니다 (S열 ${pkg.writtenCount.toLocaleString()}행 반영).`
              : `쿠팡 재고수정용 엑셀을 다운로드했습니다 (S열 ${pkg.writtenCount.toLocaleString()}행 반영 · R열 미변경).`
          );
        }
      } catch (err) {
        console.error(err);
        showToast(`[${meta.name}] 업로드용 파일 생성 오류: ${err.message}`, 5000);
      } finally {
        el.downloadUploadExcelBtn.disabled = false;
        el.downloadUploadExcelBtn.textContent = origLabel;
      }
    });

    // 검토표 다운로드
    el.downloadReviewExcelBtn.addEventListener('click', async () => {
      const sess = curSession();
      const meta = curChannelMeta();
      if (!sess.lastResult) return;
      try {
        const bytes = await Excel.generateReviewWorkbook(sess.lastResult);
        triggerDownload(
          bytes,
          `${meta.filePrefix}_재고수정_검토표_${todayYYYYMMDD()}.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        showToast(`[${meta.name}] 검토표 엑셀(${meta.reviewSheetLabel})을 다운로드했습니다.`);
      } catch (err) {
        console.error(err);
        showToast('검토표 엑셀 생성 오류: ' + err.message, 5000);
      }
    });

    // 결과 서브 탭 전환
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activateResultTab(btn.dataset.tab);
      });
    });

    el.tableSearchInput.addEventListener('input', (e) => {
      curSession().searchQuery = e.target.value;
      renderActiveTabTables();
    });
    el.statusFilterSelect.addEventListener('change', (e) => {
      curSession().statusFilter = e.target.value;
      renderActiveTabTables();
    });
    if (el.manualTypeFilter) {
      el.manualTypeFilter.addEventListener('change', (e) => {
        curSession().manualTypeFilter = e.target.value;
        renderActiveTabTables();
      });
    }
    if (el.undoActionBtn) el.undoActionBtn.addEventListener('click', undoLastAction);
    if (el.undoActionBtnManual) el.undoActionBtnManual.addEventListener('click', undoLastAction);
    if (el.clearAllManualBtn) {
      el.clearAllManualBtn.addEventListener('click', () => {
        const sess = curSession();
        const meta = curChannelMeta();
        const total = buildManualHistoryRows(sess.lastResult).length;
        if (total === 0) {
          showToast('삭제할 수동 매핑 내역이 없습니다.');
          return;
        }
        if (!confirm(`[${meta.name}] 채널에 저장된 수동 매핑·확인완료·매칭해제 내역 ${total}건을 모두 삭제할까요? (다른 채널 설정은 유지됩니다)`)) return;
        pushUndoSnapshot(`[${meta.name}] 수동 매핑 전체 삭제 (${total}건)`);
        const bag = curChannelBag();
        bag.manual_map = {};
        bag.option_manual_map = {};
        bag.confirmed_missing_sizes = {};
        bag.ignore_products = [];
        bag.ignored_options = [];
        Config.saveConfig(state.config);
        executeMatching();
        showToast(`[${meta.name}] 수동 매핑 내역 ${total}건을 모두 삭제했습니다.`, 4500, { allowUndo: true });
      });
    }

    el.copyDropNosBtn.addEventListener('click', async () => {
      const sess = curSession();
      const meta = curChannelMeta();
      if (!sess.lastResult || sess.lastResult.dropWarnings.length === 0) return;
      const text = sess.lastResult.dropWarnings.map(d => d.productNo).join('\n');
      try {
        await navigator.clipboard.writeText(text);
        showToast(`${meta.idLabel} ${sess.lastResult.dropWarnings.length}건을 클립보드에 복사했습니다.`);
      } catch (_) {
        showToast('클립보드 복사에 실패했습니다.');
      }
    });

    // 별칭 학습 후보 1클릭 승인 (3개 채널 공통)
    el.aliasLearnList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-approve-alias]');
      const sess = curSession();
      if (!btn || !sess.lastResult) return;
      const idx = parseInt(btn.dataset.approveAlias, 10);
      const item = sess.lastResult.aliasCandidates[idx];
      if (!item) return;
      pushUndoSnapshot(`공통 별칭 추가 (${item.from}→${item.to})`);
      state.config.aliases[item.from] = item.to;
      Config.saveConfig(state.config);
      showToast(`공통 별칭 '${item.from} → ${item.to}' 추가 완료! 재계산합니다.`, 4000, { allowUndo: true });
      executeMatching();
    });

    // '사이즈 없음' 일괄 확인 완료
    el.bulkConfirmSizesBtn.addEventListener('click', () => {
      const sess = curSession();
      if (!sess.lastResult) return;
      const items = sess.lastResult.reviewQueue.filter(it => it.targetType === 'helmet-size');
      if (items.length === 0) return;
      pushUndoSnapshot(`사이즈 없음 ${items.length}건 일괄 확인`);
      const bag = curChannelBag();
      if (!bag.confirmed_missing_sizes) bag.confirmed_missing_sizes = {};
      for (const it of items) {
        const cKey = it.confirmKey || it.productNo;
        const prev = new Set(bag.confirmed_missing_sizes[cKey] || []);
        for (const sz of (it.missingSizes || [])) prev.add(sz);
        bag.confirmed_missing_sizes[cKey] = Array.from(prev);
      }
      Config.saveConfig(state.config);
      showToast(`'사이즈 없음' ${items.length}건 0 처리 일괄 확인 완료!`, 4500, { allowUndo: true });
      executeMatching();
    });

    // 테이블 내 상호작용 위임
    document.querySelector('.tabs-card').addEventListener('click', (e) => {
      const bag = curChannelBag();

      const delManualBtn = e.target.closest('[data-delete-manual-type]');
      if (delManualBtn) {
        const mType = delManualBtn.dataset.deleteManualType;
        const mKey = delManualBtn.dataset.deleteManualKey;
        pushUndoSnapshot(`수동 매핑 삭제 (${mKey})`);
        if (mType === 'manual_map' && bag.manual_map) delete bag.manual_map[mKey];
        else if (mType === 'option_manual_map' && bag.option_manual_map) delete bag.option_manual_map[mKey];
        else if (mType === 'confirmed_missing_sizes' && bag.confirmed_missing_sizes) delete bag.confirmed_missing_sizes[mKey];
        else if (mType === 'ignore_products') bag.ignore_products = (bag.ignore_products || []).filter(id => String(id) !== String(mKey));
        else if (mType === 'ignored_options') bag.ignored_options = (bag.ignored_options || []).filter(k => String(k) !== String(mKey));
        Config.saveConfig(state.config);
        executeMatching();
        showToast('매핑 삭제 완료 — 원래 상태(확인 큐)로 되돌렸습니다.', 4500, { allowUndo: true });
        return;
      }

      const confirmMissingBtn = e.target.closest('[data-confirm-missing-key]');
      if (confirmMissingBtn) {
        const cKey = confirmMissingBtn.dataset.confirmMissingKey;
        const sizes = (confirmMissingBtn.dataset.confirmMissingSizes || '').split(',').map(s => s.trim()).filter(Boolean);
        pushUndoSnapshot(`${cKey} 사이즈없음 확인`);
        if (!bag.confirmed_missing_sizes) bag.confirmed_missing_sizes = {};
        const prev = new Set(bag.confirmed_missing_sizes[cKey] || []);
        sizes.forEach(s => prev.add(s));
        bag.confirmed_missing_sizes[cKey] = Array.from(prev);
        Config.saveConfig(state.config);
        showToast(`${cKey} 미존재 사이즈(${sizes.join(', ')}) 0 처리 확인 완료`, 4500, { allowUndo: true });
        executeMatching();
        return;
      }

      const dismissBtn = e.target.closest('[data-dismiss-queue-pno]');
      if (dismissBtn) {
        const pno = dismissBtn.dataset.dismissQueuePno;
        const targetType = dismissBtn.dataset.dismissQueueType || 'helmet';
        const optVal = dismissBtn.dataset.dismissQueueOpt || '';
        pushUndoSnapshot(`상품 ${pno} 매칭 해제`);
        if (targetType === 'addon' || targetType === 'shield-option' || targetType === 'helmet-group') {
          if (bag.option_manual_map) delete bag.option_manual_map[`${pno}::${optVal}`];
          const set = new Set(bag.ignored_options || []);
          set.add(`${pno}::${optVal}`);
          bag.ignored_options = Array.from(set);
          showToast(`상품 ${pno} '${optVal}' 매칭 해제 (기존재고 유지 · 정상처리)`, 4500, { allowUndo: true });
        } else {
          delete bag.manual_map[pno];
          const set = new Set((bag.ignore_products || []).map(String));
          set.add(pno);
          bag.ignore_products = Array.from(set);
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
        const confirmKey = quickBtn.dataset.quickMapConfirmKey || pno;
        const isBulk = quickBtn.dataset.quickMapBulk === '1';
        const missingSizes = (quickBtn.dataset.quickMapMissing || '').split(',').map(s => s.trim()).filter(Boolean);
        pushUndoSnapshot(`매핑 확정 (${baseName})`);

        if (targetType === 'addon' || targetType === 'shield-option' || targetType === 'helmet-group') {
          if (!bag.option_manual_map) bag.option_manual_map = {};
          const mapKey = isBulk ? `공통::${optVal}` : `${pno}::${optVal}`;
          bag.option_manual_map[mapKey] = [baseName];
          bag.ignored_options = (bag.ignored_options || []).filter(k => k !== mapKey && k !== `${pno}::${optVal}`);
          Config.saveConfig(state.config);
          showToast(
            isBulk
              ? `'${optVal}' 동일 항목 전체 → '${baseName}' 일괄 확정`
              : `상품 ${pno} '${optVal}' → '${baseName}' 확정 완료`,
            4500,
            { allowUndo: true }
          );
        } else {
          bag.manual_map[pno] = [baseName];
          bag.ignore_products = (bag.ignore_products || []).filter(id => String(id) !== String(pno));
          if (targetType === 'helmet-size' && missingSizes.length > 0) {
            if (!bag.confirmed_missing_sizes) bag.confirmed_missing_sizes = {};
            const prev = new Set(bag.confirmed_missing_sizes[confirmKey] || []);
            missingSizes.forEach(s => prev.add(s));
            bag.confirmed_missing_sizes[confirmKey] = Array.from(prev);
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
        const list = new Set((bag.ignore_products || []).map(String));
        if (list.has(pno)) {
          list.delete(pno);
          showToast(`상품 ${pno} 매칭 해제 복원`, 4000, { allowUndo: true });
        } else {
          list.add(pno);
          showToast(`상품 ${pno} 매칭 해제 등록 (기존 재고 유지)`, 4000, { allowUndo: true });
        }
        bag.ignore_products = Array.from(list);
        Config.saveConfig(state.config);
        executeMatching();
        return;
      }

      const fixBtn = e.target.closest('[data-toggle-fixed]');
      if (fixBtn) {
        const key = fixBtn.dataset.toggleFixed;
        pushUndoSnapshot(`고정재고 변경 (${key})`);
        if (Object.prototype.hasOwnProperty.call(bag.fixed_stock, key)) {
          delete bag.fixed_stock[key];
          showToast(`고정재고 예외 해제: ${key}`, 4000, { allowUndo: true });
        } else {
          bag.fixed_stock[key] = 0;
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
      const bag = curChannelBag();
      const { productNo, optionValue, isOptTarget, isHelmetGroup } = state.pickContext;
      pushUndoSnapshot(`상품 ${productNo} 수동 매핑 해제`);
      if (isOptTarget) {
        const useBulk = !isHelmetGroup && el.pickBulkCheck.checked;
        if (bag.option_manual_map) {
          delete bag.option_manual_map[`${productNo}::${optionValue}`];
          if (useBulk) delete bag.option_manual_map[`공통::${optionValue}`];
        }
        const ignSet = new Set(bag.ignored_options || []);
        ignSet.add(useBulk ? `공통::${optionValue}` : `${productNo}::${optionValue}`);
        bag.ignored_options = Array.from(ignSet);
      } else {
        delete bag.manual_map[productNo];
        const ignSet = new Set((bag.ignore_products || []).map(String));
        ignSet.add(String(productNo));
        bag.ignore_products = Array.from(ignSet);
      }
      Config.saveConfig(state.config);
      el.manualPickModal.classList.add('hidden');
      showToast('수동 매핑 해제 완료 (기존재고 유지 · 정상처리)', 4500, { allowUndo: true });
      executeMatching();
    });
    el.confirmManualPickBtn.addEventListener('click', () => {
      if (!state.pickContext) return;
      const bag = curChannelBag();
      const { productNo, optionValue, isOptTarget, isHelmetGroup } = state.pickContext;
      pushUndoSnapshot(`상품 ${productNo} 직접 검색 매핑 저장`);
      if (isOptTarget) {
        if (!bag.option_manual_map) bag.option_manual_map = {};
        const useBulk = !isHelmetGroup && el.pickBulkCheck.checked;
        const key = useBulk ? `공통::${optionValue}` : `${productNo}::${optionValue}`;
        if (state.pickSelected.length === 0) {
          delete bag.option_manual_map[key];
          const ignSet = new Set(bag.ignored_options || []);
          ignSet.add(key);
          bag.ignored_options = Array.from(ignSet);
        } else {
          bag.option_manual_map[key] = [...state.pickSelected];
          bag.ignored_options = (bag.ignored_options || []).filter(k => k !== key && k !== `${productNo}::${optionValue}`);
        }
      } else {
        if (state.pickSelected.length === 0) {
          delete bag.manual_map[productNo];
          const ignSet = new Set((bag.ignore_products || []).map(String));
          ignSet.add(String(productNo));
          bag.ignore_products = Array.from(ignSet);
        } else {
          bag.manual_map[productNo] = [...state.pickSelected];
          bag.ignore_products = (bag.ignore_products || []).filter(id => String(id) !== String(productNo));
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
    el.cfgChannelSelect.addEventListener('change', (e) => {
      // 모달 내 채널 전환 시 직전 채널 편집 내용을 임시 반영 후 전환
      flushCurrentModalChannelToObj(state.config);
      populateChannelFieldsInModal(e.target.value);
    });
    el.exportConfigQuickBtn.addEventListener('click', exportConfigFile);
    el.cfgExportJsonBtn.addEventListener('click', exportConfigFile);
    el.cfgImportJsonInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        state.config = Config.validateImportedConfig(parsed, state.config);
        Config.saveConfig(state.config);
        populateSettingsModal();
        showToast('설정 JSON을 불러왔습니다 (v2.0 백업도 자동 호환).');
        for (const ch of Config.CHANNELS) {
          if (state.sessions[ch].parsed && state.inventoryData) executeMatchingForChannel(ch);
        }
      } catch (err) {
        showToast('설정 불러오기 실패: ' + err.message, 4000);
      }
      e.target.value = '';
    });
    el.cfgResetBtn.addEventListener('click', async () => {
      if (!confirm('내 브라우저에 저장된 전체 채널 매핑/설정을 모두 초기화하고 팀 기본값으로 되돌릴까요?')) return;
      state.config = await Config.resetConfig();
      populateSettingsModal();
      showToast('팀 기본값으로 초기화되었습니다.');
      for (const ch of Config.CHANNELS) {
        if (state.sessions[ch].parsed && state.inventoryData) executeMatchingForChannel(ch);
      }
    });
    el.saveSettingsBtn.addEventListener('click', saveSettingsFromModal);

    document.querySelectorAll('.modal-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.modal-tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('mtab-' + btn.dataset.mtab).classList.add('active');
        if (btn.dataset.mtab === 'json') {
          flushCurrentModalChannelToObj(state.config);
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
    if (el.appVersionBadge && Config.APP_VERSION) {
      el.appVersionBadge.textContent = 'v' + Config.APP_VERSION;
    }
    state.config = await Config.loadConfig();
    bindEvents();
    switchChannel('cafe24');
    updateChannelTabPills();

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
