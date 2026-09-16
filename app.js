/**
 * APP.JS V3 — Cập nhật tiến độ phát triển trạm KH — PC Vũng Tàu
 * 
 * Fixes: no flash on refresh, no scroll jump on expand, default date logic
 * Features: 5-step stats, "Tiến độ cập nhật" grid tab with owner filter
 */

// ============================================================================
// CONFIG
// ============================================================================
const GAS_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
const SHEET_ID = '17tJxLIPGAdxQY3fJlSogvvTinQAAizTVoh2B1fClY5E';
const SHEET_NAME = 'DS PT TRẠM KH';
const GVIZ_BASE = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(SHEET_NAME)}`;

const ACCOUNTS = {
  'ktat':   { password: 'ktat123',   role: 'ktat',   name: 'Phòng KTAT' },
  'dvkh':   { password: 'dvkh123',   role: 'dvkh',   name: 'Đội DVKH' },
  'qlhtdd': { password: 'qlhtdd123', role: 'qlhtdd', name: 'Đội QLHTĐĐ' },
  'vhld':   { password: 'vhld123',   role: 'vhld',   name: 'Đội VHLĐ' }
};

const STEPS = [
  { key: 'deNghi',   label: 'Thỏa thuận đấu nối',         short: 'TTĐN',    owner: 'Phòng KTAT',   ownerKey: 'ktat',   col: 7,  color: '#3b82f6' },
  { key: 'tntkNgay', label: 'Chấp thuận thiết kế',         short: 'CTTK',    owner: 'Phòng KTAT',   ownerKey: 'ktat',   col: 9,  color: '#8b5cf6' },
  { key: 'hopDong',  label: 'Ký hợp đồng mua bán điện',    short: 'Ký HĐ',   owner: 'Đội DVKH',     ownerKey: 'dvkh',   col: 11, color: '#f59e0b' },
  { key: 'doDem',    label: 'Thi công HT đo đếm',          short: 'Đo đếm',  owner: 'Đội QLHTĐĐ',   ownerKey: 'qlhtdd', col: 12, color: '#06b6d4' },
  { key: 'dongDien', label: 'Đóng điện',                    short: 'Đóng Đ',  owner: 'Đội VHLĐ',     ownerKey: 'vhld',   col: 13, color: '#10b981' }
];

const ROLE_STEP = { 'dvkh': 2, 'qlhtdd': 3, 'vhld': 4 };
const DEFAULT_DATE = '01/01/2026';
const REFRESH_MS = 90000;

// ============================================================================
// STATE
// ============================================================================
let currentUser = null;
let allStations = [];
let expandedId = null;
let refreshTimer = null;
let isGASAvailable = false;
let currentTab = 'pending';    // team tab
let mainTab = 'progress';      // KTAT: 'progress' | 'list' (default is 'progress')
let searchQuery = '';
let filterStatus = 'all';
let progressFilter = 'all';    // progress tab filter
let progExpandedId = null;
let lastDataHash = '';

// ============================================================================
// UTILS
// ============================================================================
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

function isDate(s) {
  if (!s) return false;
  s = String(s).trim();
  if (!s || s === '0' || s.toLowerCase().startsWith('chưa')) return false;
  return /\d{1,2}\/\d{1,2}\/\d{4}/.test(s);
}

function inputToSheet(v) {
  if (!v) return '';
  const p = v.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : v;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function hashData(stations) {
  return stations.map(s => `${s.row}|${s.deNghi}|${s.tntkNgay}|${s.hopDong}|${s.doDem}|${s.dongDien}`).join(';');
}

// ============================================================================
// TOAST
// ============================================================================
function toast(msg, type = 'info') {
  const c = $('#toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  t.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${esc(msg)}`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(20px)'; t.style.transition = 'all 0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ============================================================================
// THEME
// ============================================================================
function initTheme() {
  const saved = localStorage.getItem('tba_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('tba_theme', next);
  updateThemeIcon(next);
}
function updateThemeIcon(theme) {
  const btn = $('#themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ============================================================================
// DATA LOADING — JSONP
// ============================================================================
function fetchViaJSONP() {
  return new Promise((resolve, reject) => {
    const callbackName = '_gvizCb_' + Date.now();
    const script = document.createElement('script');
    window[callbackName] = function (data) { delete window[callbackName]; script.remove(); resolve(data); };
    script.src = GVIZ_BASE + '&tqx=responseHandler:' + callbackName;
    script.onerror = () => { delete window[callbackName]; script.remove(); reject(new Error('Load failed')); };
    setTimeout(() => { if (window[callbackName]) { delete window[callbackName]; script.remove(); reject(new Error('Timeout')); } }, 15000);
    document.head.appendChild(script);
  });
}

function parseGvizResponse(data) {
  const stations = [];
  if (!data || !data.table || !data.table.rows) return stations;
  const rows = data.table.rows;
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].c;
    if (!cells || cells.length < 13) continue;
    const cv = (idx) => {
      if (!cells[idx]) return '';
      if (cells[idx].f) return String(cells[idx].f).trim();
      if (cells[idx].v !== null && cells[idx].v !== undefined) return String(cells[idx].v).trim();
      return '';
    };
    const name = cv(1);
    if (!name) continue;
    stations.push({
      row: i + 2, stt: cv(0), name, address: cv(2), contact: cv(3),
      xayLap: cv(4), kva: cv(5), deNghi: cv(6), tntkSoCV: cv(7),
      tntkNgay: cv(8), ttdn: cv(9), hopDong: cv(10), doDem: cv(11), dongDien: cv(12)
    });
  }
  return stations;
}

async function fetchStations() {
  $('#refreshBar').classList.add('loading');
  if (GAS_URL && !GAS_URL.includes('YOUR_DEPLOYMENT_ID')) {
    try {
      isGASAvailable = true;
      const resp = await fetch(GAS_URL + '?action=get_data&t=' + Date.now());
      const data = await resp.json();
      if (data.status === 'success' && data.stations) { allStations = data.stations; $('#refreshBar').classList.remove('loading'); return; }
    } catch (e) { console.warn('GAS failed:', e); }
  }
  try {
    isGASAvailable = false;
    const data = await fetchViaJSONP();
    allStations = parseGvizResponse(data);
  } catch (e) {
    console.error('JSONP failed:', e);
    toast('Không thể tải dữ liệu.', 'error');
  }
  $('#refreshBar').classList.remove('loading');
}

// ============================================================================
// API
// ============================================================================
async function apiUpdate(row, column, value, role) {
  if (!isGASAvailable) { toast('Chưa deploy API. Vui lòng deploy Google Apps Script.', 'error'); return false; }
  try {
    const r = await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'update_date', row, column, value, role }) });
    const d = await r.json();
    if (d.status === 'success') { toast(d.message || 'Cập nhật thành công!', 'success'); return true; }
    toast(d.message || 'Lỗi', 'error'); return false;
  } catch (e) { toast('Lỗi: ' + e.message, 'error'); return false; }
}

async function apiAddStation(data) {
  if (!isGASAvailable) { toast('Chưa deploy API.', 'error'); return false; }
  try {
    const r = await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'add_station', ...data, role: currentUser.role }) });
    const d = await r.json();
    if (d.status === 'success') { toast(d.message || 'Thêm thành công!', 'success'); return true; }
    toast(d.message || 'Lỗi', 'error'); return false;
  } catch (e) { toast('Lỗi: ' + e.message, 'error'); return false; }
}

// ============================================================================
// AUTH
// ============================================================================
function handleLogin(e) {
  e.preventDefault();
  const u = $('#loginUsername').value.trim().toLowerCase();
  const p = $('#loginPassword').value.trim();
  if (!u || !p) { $('#loginError').textContent = 'Chọn phòng/đội và nhập mật khẩu'; return; }
  const acc = ACCOUNTS[u];
  if (!acc || acc.password !== p) { $('#loginError').textContent = 'Sai mật khẩu!'; $('#loginPassword').value = ''; return; }
  currentUser = { username: u, role: acc.role, name: acc.name };
  sessionStorage.setItem('tba_user', JSON.stringify(currentUser));
  showApp();
}
function logout() {
  currentUser = null; sessionStorage.removeItem('tba_user');
  if (refreshTimer) clearInterval(refreshTimer);
  $('#loginPage').classList.remove('hidden');
  $('#appPage').classList.add('hidden');
  $('#loginPassword').value = ''; $('#loginError').textContent = '';
}
function checkSession() {
  const s = sessionStorage.getItem('tba_user');
  if (s) { try { currentUser = JSON.parse(s); showApp(); } catch (e) { sessionStorage.removeItem('tba_user'); } }
}
async function showApp() {
  $('#loginPage').classList.add('hidden');
  $('#appPage').classList.remove('hidden');
  const initials = currentUser.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  $('#userAvatar').textContent = initials;
  $('#userName').textContent = currentUser.name;
  await loadAndRender();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(silentRefresh, REFRESH_MS);
}

async function loadAndRender() {
  await fetchStations();
  lastDataHash = hashData(allStations);
  render();
}

// Silent refresh — only re-render if data changed (fix flash)
async function silentRefresh() {
  await fetchStations();
  const newHash = hashData(allStations);
  if (newHash !== lastDataHash) {
    lastDataHash = newHash;
    render();
  }
}

// ============================================================================
// STEP STATES (independent check + default date logic)
// ============================================================================
function getStepStates(s) {
  const vals = STEPS.map(st => s[st.key] || '');
  const states = vals.map(v => isDate(v) ? 'done' : 'pending');
  
  // Nếu bước 2 (TNTK) đã có ngày mà bước 1 (Đề nghị) chưa có → coi bước 1 là done
  if (states[1] === 'done' && states[0] === 'pending') {
    states[0] = 'done';
  }
  
  const firstPending = states.indexOf('pending');
  if (firstPending !== -1) states[firstPending] = 'active';
  return states;
}

// Get which step is the current "active" one (first incomplete)
function getActiveStepIndex(s) {
  const states = getStepStates(s);
  const idx = states.indexOf('active');
  return idx !== -1 ? idx : (states.every(x => x === 'done') ? -1 : 0);
}

// Get the date to display, including default date logic
function getStepDate(s, stepIndex) {
  const val = s[STEPS[stepIndex].key] || '';
  if (isDate(val)) return { date: val, isDefault: false };
  // Step 1: if step 2 has date, use default
  if (stepIndex === 0 && isDate(s.tntkNgay)) {
    return { date: DEFAULT_DATE, isDefault: true };
  }
  return { date: '', isDefault: false };
}

// ============================================================================
// RENDER
// ============================================================================
function render() {
  const m = $('#mainContent');
  if (currentUser.role === 'ktat') renderKTAT(m);
  else renderTeam(m);
}

// ============================================================================
// SEMI-DONUT CHART (Biểu đồ vành khăn 1 nửa)
// ============================================================================
function renderSemiDonutChart(total, done, notDone, stepCounts) {
  const cx = 130, cy = 118;
  const R = 90, r = 58;
  const gapDeg = 2.5;
  const numSteps = STEPS.length;
  const totalGaps = (numSteps - 1) * gapDeg;
  const availDeg = 180 - totalGaps;
  
  // Weights based on stepCounts
  const sumCounts = stepCounts.reduce((a, b) => a + b, 0) || 1;
  const rawAngles = stepCounts.map(c => Math.max(10, (c / sumCounts) * availDeg));
  const normSum = rawAngles.reduce((a, b) => a + b, 0);
  const normAngles = rawAngles.map(a => (a / normSum) * availDeg);

  let curAngle = 180;
  const paths = [];

  for (let i = 0; i < numSteps; i++) {
    const a1 = curAngle;
    const a2 = curAngle - normAngles[i];
    curAngle = a2 - gapDeg;

    const rad1 = (a1 * Math.PI) / 180;
    const rad2 = (a2 * Math.PI) / 180;

    const x1_out = (cx + R * Math.cos(rad1)).toFixed(2);
    const y1_out = (cy - R * Math.sin(rad1)).toFixed(2);
    const x2_out = (cx + R * Math.cos(rad2)).toFixed(2);
    const y2_out = (cy - R * Math.sin(rad2)).toFixed(2);

    const x2_in = (cx + r * Math.cos(rad2)).toFixed(2);
    const y2_in = (cy - r * Math.sin(rad2)).toFixed(2);
    const x1_in = (cx + r * Math.cos(rad1)).toFixed(2);
    const y1_in = (cy - r * Math.sin(rad1)).toFixed(2);

    const d = `M ${x1_out} ${y1_out} A ${R} ${R} 0 0 1 ${x2_out} ${y2_out} L ${x2_in} ${y2_in} A ${r} ${r} 0 0 0 ${x1_in} ${y1_in} Z`;
    paths.push(`
      <path class="donut-slice slice-${i}" data-step="${i}" d="${d}" fill="${STEPS[i].color}">
        <title>${STEPS[i].label}: ${stepCounts[i]} trạm</title>
      </path>
    `);
  }

  const pctDone = total > 0 ? Math.round((done / total) * 100) : 0;
  const pctNotDone = 100 - pctDone;

  return `
    <div class="stats-donut-container">
      <div class="donut-chart-wrapper">
        <svg class="donut-svg" viewBox="0 0 260 132" aria-label="Biểu đồ tiến độ vành khăn 1 nửa">
          <g class="donut-slices">
            ${paths.join('')}
          </g>
          <!-- Center total count -->
          <text class="donut-center-num" x="${cx}" y="${cy - 22}" text-anchor="middle">${total}</text>
          <text class="donut-center-label" x="${cx}" y="${cy - 4}" text-anchor="middle">Tổng trạm</text>
        </svg>

        <!-- Sub status under chart -->
        <div class="donut-substats">
          <span class="donut-sub-pill pill-done" title="Đã đóng điện hoàn thành">
            <span class="sub-dot"></span> Đã đóng điện: <strong>${done}</strong> <small>(${pctDone}%)</small>
          </span>
          <span class="donut-sub-pill pill-notdone" title="Chưa đóng điện">
            <span class="sub-dot"></span> Chưa đóng điện: <strong>${notDone}</strong> <small>(${pctNotDone}%)</small>
          </span>
        </div>
      </div>

      <div class="donut-legend">
        ${STEPS.map((st, i) => `
          <div class="donut-legend-item" data-step="${i}">
            <div class="donut-legend-info">
              <span class="donut-legend-dot" style="background:${st.color}"></span>
              <span class="donut-legend-name">${st.label}</span>
            </div>
            <div class="donut-legend-stats">
              <span class="donut-legend-arrow">➜</span>
              <span class="donut-legend-count" style="color:${st.color}">${stepCounts[i]} <span class="unit">trạm</span></span>
              <span class="donut-legend-owner">(${st.owner})</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function bindDonutInteractions(container) {
  const slices = container.querySelectorAll('.donut-slice');
  const items = container.querySelectorAll('.donut-legend-item');
  
  function highlight(idx) {
    slices.forEach(s => s.classList.toggle('active-slice', s.dataset.step === String(idx)));
    items.forEach(it => it.classList.toggle('active-item', it.dataset.step === String(idx)));
  }
  function clear() {
    slices.forEach(s => s.classList.remove('active-slice'));
    items.forEach(it => it.classList.remove('active-item'));
  }

  slices.forEach(s => {
    s.addEventListener('mouseenter', () => highlight(s.dataset.step));
    s.addEventListener('mouseleave', clear);
  });
  items.forEach(it => {
    it.addEventListener('mouseenter', () => highlight(it.dataset.step));
    it.addEventListener('mouseleave', clear);
  });
}

// ============================================================================
// KTAT DASHBOARD
// ============================================================================
function renderKTAT(el) {
  const total = allStations.length;
  const done = allStations.filter(s => isDate(s.dongDien)).length;
  const notDone = total - done;
  
  // Per-step counts
  const stepCounts = STEPS.map((st, i) => {
    return allStations.filter(s => {
      const states = getStepStates(s);
      return states[i] === 'done';
    }).length;
  });

  // Incomplete stations (for progress tab)
  const incomplete = allStations.filter(s => !isDate(s.dongDien));
  
  el.innerHTML = `
    <!-- Semi-donut chart on left, full labels with arrows on right -->
    ${renderSemiDonutChart(total, done, notDone, stepCounts)}

    <!-- Main tabs: Tiến độ cập nhật (LEFT / DEFAULT) | Danh sách trạm (RIGHT) -->
    <div class="main-tabs">
      <button class="main-tab ${mainTab === 'progress' ? 'active' : ''}" data-tab="progress">
        Tiến độ cập nhật <span class="tab-count">${incomplete.length}</span>
      </button>
      <button class="main-tab ${mainTab === 'list' ? 'active' : ''}" data-tab="list">
        Danh sách trạm <span class="tab-count">${total}</span>
      </button>
    </div>

    <div id="tabContent"></div>
  `;

  bindDonutInteractions(el);

  // Bind main tabs
  el.querySelectorAll('.main-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      mainTab = btn.dataset.tab;
      render();
    });
  });

  if (mainTab === 'progress') renderProgressTab(el.querySelector('#tabContent'));
  else renderStationList(el.querySelector('#tabContent'));
}

// ---- Station List Tab ----
function renderStationList(container) {
  const filtered = applyFilters(allStations);
  container.innerHTML = `
    <div class="toolbar">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" placeholder="Tìm tên, địa chỉ..." id="searchInput" value="${esc(searchQuery)}">
      </div>
      <select class="filter-select" id="filterSelect">
        <option value="all" ${filterStatus === 'all' ? 'selected' : ''}>Tất cả</option>
        <option value="done" ${filterStatus === 'done' ? 'selected' : ''}>Đã đóng điện</option>
        <option value="not_done" ${filterStatus === 'not_done' ? 'selected' : ''}>Chưa đóng điện</option>
      </select>
      <button class="btn btn-primary btn-sm" id="addBtn">+ Thêm</button>
    </div>
    <div class="section-title">Danh sách trạm <span class="count-pill">${filtered.length}</span></div>
    <div class="station-list" id="stationList">
      ${filtered.length === 0 ? `
        <div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">Không có trạm nào</div></div>
      ` : filtered.map(s => renderStationCard(s)).join('')}
    </div>
  `;
  bindStationListEvents(container);
}

function renderStationCard(s) {
  const states = getStepStates(s);
  const completedCount = states.filter(x => x === 'done').length;
  const isExpanded = expandedId === s.row;
  let badgeClass, badgeText;
  if (completedCount === 5) { badgeClass = 'badge-done'; badgeText = '✓ Xong'; }
  else if (completedCount > 0) { badgeClass = 'badge-progress'; badgeText = `${completedCount}/5`; }
  else { badgeClass = 'badge-waiting'; badgeText = '0/5'; }

  return `
    <div class="station-card ${isExpanded ? 'expanded' : ''}" data-row="${s.row}" id="sc-${s.row}">
      <div class="station-card-header" data-row="${s.row}">
        <div class="station-stt">${esc(String(s.stt))}</div>
        <div class="station-info">
          <div class="station-name">${esc(s.name)}</div>
          <div class="station-meta">
            <span class="station-meta-item">📍 ${esc(s.address || '—')}</span>
            ${s.kva ? `<span class="station-meta-item">⚡ ${esc(s.kva)} kVA</span>` : ''}
          </div>
        </div>
        <span class="station-progress-badge ${badgeClass}">${badgeText}</span>
        <span class="expand-icon">▼</span>
      </div>
      ${isExpanded ? renderTimeline(s, states) : ''}
    </div>
  `;
}

function renderTimeline(s, states, highlightStepIdx) {
  return `
    <div class="timeline-panel">
      <div class="tree-timeline">
        ${STEPS.map((step, i) => {
          const state = states[i];
          const dateInfo = getStepDate(s, i);
          const canEdit = currentUser.role === 'ktat' && (step.col === 7 || step.col === 9);
          const isHighlighted = highlightStepIdx !== undefined && i === highlightStepIdx;

          return `
            <div class="tree-node ${state} ${isHighlighted ? 'highlight-owner' : ''}">
              <div class="tree-dot">${state === 'done' ? '✓' : (i + 1)}</div>
              <div class="tree-content">
                <div class="tree-label">${step.label}</div>
                <div class="tree-owner">${step.owner}</div>
                ${dateInfo.date ? `
                  <div class="tree-date">${dateInfo.date} ${dateInfo.isDefault ? '<span class="tree-date-note">(ngày mặc định)</span>' : ''}</div>
                ` : (state === 'active' && canEdit) ? `
                  <div class="tree-date-input">
                    <input type="date" value="${today()}" data-row="${s.row}" data-col="${step.col}">
                    <button class="btn btn-success btn-sm btn-save-timeline" data-row="${s.row}" data-col="${step.col}">Lưu</button>
                  </div>
                ` : `<div class="tree-date">—</div>`}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function applyFilters(list) {
  let r = list;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    r = r.filter(s => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q) || String(s.stt).includes(q));
  }
  if (filterStatus === 'done') r = r.filter(s => isDate(s.dongDien));
  else if (filterStatus === 'not_done') r = r.filter(s => !isDate(s.dongDien));
  return r;
}

function bindStationListEvents(container) {
  const si = container.querySelector('#searchInput');
  if (si) {
    si.addEventListener('input', () => { searchQuery = si.value; renderStationList(container); });
    if (searchQuery) setTimeout(() => { si.focus(); si.setSelectionRange(si.value.length, si.value.length); }, 0);
  }

  const fs = container.querySelector('#filterSelect');
  if (fs) fs.addEventListener('change', () => { filterStatus = fs.value; renderStationList(container); });

  const ab = container.querySelector('#addBtn');
  if (ab) ab.addEventListener('click', () => { $('#addStationModal').classList.remove('hidden'); $('#newName').focus(); });

  // Expand/collapse — DOM manipulation instead of full re-render (fix scroll jump)
  container.querySelectorAll('.station-card-header').forEach(h => {
    h.addEventListener('click', () => {
      const row = parseInt(h.dataset.row);
      const card = container.querySelector(`#sc-${row}`);
      if (!card) return;
      
      // Collapse previously expanded
      if (expandedId && expandedId !== row) {
        const prev = container.querySelector(`#sc-${expandedId}`);
        if (prev) {
          prev.classList.remove('expanded');
          const oldPanel = prev.querySelector('.timeline-panel');
          if (oldPanel) oldPanel.remove();
          const oldIcon = prev.querySelector('.expand-icon');
          if (oldIcon) oldIcon.textContent = '▼';
        }
      }

      if (expandedId === row) {
        // Collapse current
        card.classList.remove('expanded');
        const panel = card.querySelector('.timeline-panel');
        if (panel) panel.remove();
        card.querySelector('.expand-icon').textContent = '▼';
        expandedId = null;
      } else {
        // Expand
        expandedId = row;
        card.classList.add('expanded');
        card.querySelector('.expand-icon').textContent = '▲';
        const s = allStations.find(x => x.row === row);
        if (s) {
          const states = getStepStates(s);
          const html = renderTimeline(s, states);
          card.insertAdjacentHTML('beforeend', html);
          bindTimelineSaveButtons(card);
          // Smooth scroll into view
          setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
        }
      }
    });
  });

  // Bind save buttons on already-expanded cards
  bindTimelineSaveButtons(container);
}

function bindTimelineSaveButtons(container) {
  container.querySelectorAll('.btn-save-timeline').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const row = parseInt(btn.dataset.row);
      const col = parseInt(btn.dataset.col);
      const inp = btn.previousElementSibling;
      const val = inputToSheet(inp.value);
      if (!val) { toast('Chọn ngày', 'error'); return; }
      btn.textContent = '...'; btn.disabled = true;
      const ok = await apiUpdate(row, col, val, currentUser.role);
      if (ok) { expandedId = row; await loadAndRender(); }
      else { btn.textContent = 'Lưu'; btn.disabled = false; }
    });
  });
}

// ---- Progress Tab (Tiến độ cập nhật) ----
function renderProgressTab(container) {
  let incomplete = allStations.filter(s => !isDate(s.dongDien));

  // Apply step filter: trạm đang ở bước nào (active step)
  if (progressFilter !== 'all') {
    const stepIdx = parseInt(progressFilter);
    incomplete = incomplete.filter(s => getActiveStepIndex(s) === stepIdx);
  }

  container.innerHTML = `
    <div class="toolbar">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" placeholder="Tìm trạm, địa chỉ..." id="progSearch">
      </div>
      <select class="filter-select" id="progFilter">
        <option value="all" ${progressFilter === 'all' ? 'selected' : ''}>Tất cả các bước</option>
        <option value="0" ${progressFilter === '0' ? 'selected' : ''}>Thỏa thuận đấu nối</option>
        <option value="1" ${progressFilter === '1' ? 'selected' : ''}>Chấp thuận thiết kế</option>
        <option value="2" ${progressFilter === '2' ? 'selected' : ''}>Ký hợp đồng mua bán điện</option>
        <option value="3" ${progressFilter === '3' ? 'selected' : ''}>Thi công HT đo đếm</option>
        <option value="4" ${progressFilter === '4' ? 'selected' : ''}>Đóng điện</option>
      </select>
    </div>
    <div class="section-title">Trạm chưa hoàn thành <span class="count-pill">${incomplete.length}</span></div>
    <div class="progress-grid" id="progressGrid">
      ${incomplete.length === 0 ? `
        <div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🎉</div><div class="empty-title">Không có trạm nào trong danh mục này!</div></div>
      ` : incomplete.map(s => renderProgressCard(s)).join('')}
    </div>
  `;

  bindProgressEvents(container);
}

function renderProgressCard(s) {
  const states = getStepStates(s);
  const activeIdx = getActiveStepIndex(s);
  const activeStep = activeIdx >= 0 ? STEPS[activeIdx] : null;
  const isExpanded = progExpandedId === s.row;

  return `
    <div class="progress-card ${isExpanded ? 'prog-expanded' : ''}" data-row="${s.row}" id="pc-${s.row}">
      <div class="progress-card-top">
        <div class="progress-card-name">${esc(s.name)}</div>
        <div class="progress-card-top-right">
          ${activeStep ? `<div class="progress-card-owner owner-${activeStep.ownerKey}">${activeStep.owner}</div>` : ''}
          <span class="prog-expand-icon">${isExpanded ? '▲' : '▼'}</span>
        </div>
      </div>
      <div class="progress-card-meta">
        <span>📍 ${esc(s.address || '—')}</span>
        ${s.kva ? `<span>⚡ ${esc(s.kva)} kVA</span>` : ''}
      </div>
      <div class="progress-dots">
        ${states.map(st => `<div class="progress-dot dot-${st}"></div>`).join('')}
      </div>
      ${isExpanded ? renderTimeline(s, states, activeIdx) : ''}
    </div>
  `;
}

function bindProgressEvents(container) {
  const ps = container.querySelector('#progSearch');
  if (ps) {
    ps.addEventListener('input', () => {
      const q = ps.value.toLowerCase();
      container.querySelectorAll('.progress-card').forEach(c => {
        const text = c.textContent.toLowerCase();
        c.style.display = text.includes(q) ? '' : 'none';
      });
    });
  }

  const pf = container.querySelector('#progFilter');
  if (pf) {
    pf.addEventListener('change', () => {
      progressFilter = pf.value;
      renderProgressTab(container);
    });
  }

  // Fast event delegation on progressGrid — click anywhere on card to expand/collapse
  const grid = container.querySelector('#progressGrid');
  if (grid) {
    grid.addEventListener('click', (e) => {
      // Don't toggle if clicking inside input or button in timeline
      if (e.target.closest('input, button, .tree-date-input, .btn-save-timeline, a')) return;

      const card = e.target.closest('.progress-card');
      if (!card) return;
      const row = parseInt(card.dataset.row);
      if (!row) return;

      // If already expanded -> collapse
      if (progExpandedId === row) {
        card.classList.remove('prog-expanded');
        const panel = card.querySelector('.timeline-panel');
        if (panel) panel.remove();
        const icon = card.querySelector('.prog-expand-icon');
        if (icon) icon.textContent = '▼';
        progExpandedId = null;
        return;
      }

      // Collapse previously expanded card if any
      if (progExpandedId) {
        const prev = grid.querySelector(`#pc-${progExpandedId}`);
        if (prev) {
          prev.classList.remove('prog-expanded');
          const oldPanel = prev.querySelector('.timeline-panel');
          if (oldPanel) oldPanel.remove();
          const oldIcon = prev.querySelector('.prog-expand-icon');
          if (oldIcon) oldIcon.textContent = '▼';
        }
      }

      // Expand this card
      progExpandedId = row;
      card.classList.add('prog-expanded');
      const icon = card.querySelector('.prog-expand-icon');
      if (icon) icon.textContent = '▲';

      const s = allStations.find(x => x.row === row);
      if (s) {
        const states = getStepStates(s);
        const activeIdx = getActiveStepIndex(s);
        const html = renderTimeline(s, states, activeIdx);
        card.insertAdjacentHTML('beforeend', html);
        bindTimelineSaveButtons(card);

        // Only scroll if card top is out of view (removes delay when already visible)
        requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          if (rect.top < 65 || rect.bottom > window.innerHeight) {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });
      }
    });
  }
}

// ============================================================================
// TEAM DASHBOARD (DVKH, QLHTDD, VHLD)
// ============================================================================
function sheetToInput(v) {
  if (!v) return today();
  const p = String(v).split('/');
  if (p.length === 3) return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
  return today();
}

function renderTeam(el) {
  const stepIdx = ROLE_STEP[currentUser.role];
  const step = STEPS[stepIdx];
  const prevStep = STEPS[stepIdx - 1];

  const pending = [], completed = [];
  for (const s of allStations) {
    const states = getStepStates(s);
    if (states[stepIdx - 1] === 'done') {
      if (states[stepIdx] === 'done') completed.push(s);
      else pending.push(s);
    }
  }
  const total = pending.length + completed.length;
  const showing = currentTab === 'pending' ? pending : completed;
  const pctComplete = total > 0 ? Math.round((completed.length / total) * 100) : 0;

  el.innerHTML = `
    <!-- Team Hero Card with Progress & Stats -->
    <div class="team-hero-card">
      <div class="team-hero-header">
        <div class="team-hero-info">
          <div class="team-role-badge role-${step.ownerKey}">
            <span class="role-dot"></span> ${currentUser.name}
          </div>
          <h2 class="team-hero-title">${step.label}</h2>
          <div class="team-hero-desc">Theo dõi và cập nhật tiến độ công trình trong phạm vi phụ trách</div>
        </div>
        <div class="team-pct-pill">
          <span class="team-pct-num">${pctComplete}%</span>
          <span class="team-pct-label">Hoàn thành</span>
        </div>
      </div>

      <div class="team-progress-bar-wrap">
        <div class="team-progress-bar" style="width: ${pctComplete}%"></div>
      </div>

      <div class="team-stats-grid">
        <div class="team-stat-box box-total">
          <div class="team-stat-icon">📁</div>
          <div class="team-stat-data">
            <div class="team-stat-num">${total}</div>
            <div class="team-stat-label">Tổng công trình</div>
          </div>
        </div>
        <div class="team-stat-box box-pending ${pending.length > 0 ? 'has-pending' : ''}">
          <div class="team-stat-icon">⏳</div>
          <div class="team-stat-data">
            <div class="team-stat-num">${pending.length}</div>
            <div class="team-stat-label">Cần xử lý</div>
          </div>
        </div>
        <div class="team-stat-box box-done">
          <div class="team-stat-icon">✅</div>
          <div class="team-stat-data">
            <div class="team-stat-num">${completed.length}</div>
            <div class="team-stat-label">Đã hoàn thành</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Navigation Tabs -->
    <div class="main-tabs">
      <button class="main-tab ${currentTab === 'pending' ? 'active tab-pending' : ''}" data-tab="pending">
        ⏳ Cần xử lý <span class="tab-count">${pending.length}</span>
      </button>
      <button class="main-tab ${currentTab === 'completed' ? 'active tab-done' : ''}" data-tab="completed">
        ✅ Đã hoàn thành <span class="tab-count">${completed.length}</span>
      </button>
    </div>

    <!-- Search Toolbar -->
    <div class="toolbar">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" placeholder="Tìm tên công trình, địa chỉ..." id="teamSearch">
      </div>
    </div>

    <div class="section-title">
      ${currentTab === 'pending' ? '⏳ Công trình cần xử lý' : '✅ Công trình đã hoàn thành'}
      <span class="count-pill">${showing.length}</span>
    </div>

    <!-- Job List -->
    <div id="jobList" class="job-list">
      ${showing.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">${currentTab === 'pending' ? '🎉' : '📭'}</div>
          <div class="empty-title">${currentTab === 'pending' ? 'Không có công trình nào cần xử lý!' : 'Chưa có công trình hoàn thành'}</div>
          <div class="empty-desc">${currentTab === 'pending' ? 'Tất cả công trình đến bước này đã được cập nhật.' : ''}</div>
        </div>
      ` : showing.map(s => renderJobCard(s, step, prevStep, currentTab === 'completed')).join('')}
    </div>
  `;
  bindTeamEvents(step);
}

function renderJobCard(s, step, prevStep, isDone) {
  const dateVal = s[step.key] || '';
  const prevDateInfo = getStepDate(s, ROLE_STEP[currentUser.role] - 1);

  return `
    <div class="job-card ${isDone ? 'done-card' : 'pending-card'}" id="job-${s.row}">
      <div class="job-card-header">
        <div class="job-stt">${esc(String(s.stt || ''))}</div>
        <div class="job-title-box">
          <div class="job-title">${esc(s.name)}</div>
          <div class="job-meta">
            <span class="job-meta-item">📍 ${esc(s.address || '—')}</span>
            ${s.kva ? `<span class="job-meta-item">⚡ ${esc(s.kva)} kVA</span>` : ''}
            ${s.contact ? `<span class="job-meta-item">📞 ${esc(s.contact)}</span>` : ''}
          </div>
        </div>
        <div class="job-status-badge ${isDone ? 'badge-done' : 'badge-pending'}">
          ${isDone ? '✓ Hoàn thành' : '⏳ Cần xử lý'}
        </div>
      </div>

      ${prevDateInfo.date ? `
        <div class="job-prev-step">
          <span class="prev-step-icon">↳</span>
          <span>Bước trước (<strong>${prevStep.label}</strong>): <strong class="prev-date">${prevDateInfo.date}</strong></span>
        </div>
      ` : ''}

      <div class="job-actions-panel">
        ${isDone ? `
          <div class="job-done-info" id="done-info-${s.row}">
            <span class="done-check-icon">✓</span>
            <span class="done-text">Ngày hoàn thành: <strong>${dateVal}</strong></span>
            <button class="btn-edit-date" data-row="${s.row}" title="Chỉnh sửa ngày">✏️ Đổi ngày</button>
          </div>
          <div class="job-edit-box hidden" id="edit-box-${s.row}">
            <input type="date" value="${dateVal ? sheetToInput(dateVal) : today()}" class="job-date-input" id="edit-input-${s.row}">
            <button class="btn btn-primary btn-sm btn-save-edit" data-row="${s.row}" data-col="${step.col}">Lưu</button>
            <button class="btn btn-outline btn-sm btn-cancel-edit" data-row="${s.row}">Hủy</button>
          </div>
        ` : `
          <div class="job-update-form">
            <div class="job-input-label">Cập nhật ngày hoàn thành:</div>
            <div class="job-input-group">
              <input type="date" value="${today()}" data-row="${s.row}" data-col="${step.col}" class="job-date-input">
              <button class="btn btn-success btn-sm btn-update-job" data-row="${s.row}" data-col="${step.col}">
                ✓ Cập nhật ngày
              </button>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

function bindTeamEvents(step) {
  // Tabs
  $$('.tab-btn, .main-tab').forEach(b => b.addEventListener('click', () => {
    currentTab = b.dataset.tab;
    render();
  }));

  // Update button in pending tab
  $$('.btn-update-job').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = parseInt(btn.dataset.row);
      const col = parseInt(btn.dataset.col);
      const inp = btn.previousElementSibling;
      const val = inputToSheet(inp.value);
      if (!val) { toast('Vui lòng chọn ngày', 'error'); return; }
      btn.textContent = '⏳ Đang lưu...'; btn.disabled = true;
      const ok = await apiUpdate(row, col, val, currentUser.role);
      if (ok) await loadAndRender();
      else { btn.textContent = '✓ Cập nhật ngày'; btn.disabled = false; }
    });
  });

  // Edit date buttons in completed tab
  $$('.btn-edit-date').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.dataset.row;
      const infoBox = $(`#done-info-${row}`);
      const editBox = $(`#edit-box-${row}`);
      if (infoBox && editBox) {
        infoBox.classList.add('hidden');
        editBox.classList.remove('hidden');
      }
    });
  });

  $$('.btn-cancel-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.dataset.row;
      const infoBox = $(`#done-info-${row}`);
      const editBox = $(`#edit-box-${row}`);
      if (infoBox && editBox) {
        infoBox.classList.remove('hidden');
        editBox.classList.add('hidden');
      }
    });
  });

  $$('.btn-save-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = parseInt(btn.dataset.row);
      const col = parseInt(btn.dataset.col);
      const inp = $(`#edit-input-${row}`);
      const val = inputToSheet(inp.value);
      if (!val) { toast('Vui lòng chọn ngày', 'error'); return; }
      btn.textContent = '...'; btn.disabled = true;
      const ok = await apiUpdate(row, col, val, currentUser.role);
      if (ok) await loadAndRender();
      else { btn.textContent = 'Lưu'; btn.disabled = false; }
    });
  });

  // Search
  const ts = $('#teamSearch');
  if (ts) ts.addEventListener('input', () => {
    const q = ts.value.toLowerCase();
    $$('.job-card').forEach(c => {
      const text = c.textContent.toLowerCase();
      c.style.display = text.includes(q) ? '' : 'none';
    });
  });
}

// ============================================================================
// ADD STATION MODAL
// ============================================================================
function handleAddStation(e) {
  e.preventDefault();
  const name = $('#newName').value.trim();
  if (!name) { toast('Nhập tên công trình', 'error'); return; }
  const data = {
    name, address: $('#newAddress').value.trim(), kva: $('#newKVA').value.trim(),
    contact: $('#newContact').value.trim(), xayLap: $('#newXayLap').value.trim(),
    deNghi: $('#newDeNghi').value ? inputToSheet($('#newDeNghi').value) : ''
  };
  const btn = $('#submitStationBtn');
  btn.disabled = true; btn.textContent = '⏳ Đang thêm...';
  apiAddStation(data).then(ok => {
    btn.disabled = false; btn.textContent = '✓ Thêm trạm';
    if (ok) { $('#addStationModal').classList.add('hidden'); $('#addStationForm').reset(); loadAndRender(); }
  });
}

// ============================================================================
// INIT
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#logoutBtn').addEventListener('click', logout);
  $('#themeToggle').addEventListener('click', toggleTheme);
  $('#closeModalBtn').addEventListener('click', () => $('#addStationModal').classList.add('hidden'));
  $('#cancelModalBtn').addEventListener('click', () => $('#addStationModal').classList.add('hidden'));
  $('#addStationForm').addEventListener('submit', handleAddStation);
  $('#addStationModal').addEventListener('click', e => { if (e.target === $('#addStationModal')) $('#addStationModal').classList.add('hidden'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#addStationModal').classList.add('hidden'); });
  checkSession();
});
