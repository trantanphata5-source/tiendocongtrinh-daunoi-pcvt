/**
 * APP.JS V2 — Tiến Độ TBA Khách Hàng — PC Vũng Tàu
 * 
 * ✅ JSONP load (fix CORS khi mở file:// local)
 * ✅ Light/Dark theme toggle
 * ✅ Mobile-first card layout
 * ✅ Vertical tree timeline (click expand)
 * ✅ GAS API cho ghi dữ liệu
 * 
 * ⚠️ THAY GAS_URL sau khi deploy Google Apps Script!
 */

// ============================================================================
// CONFIG
// ============================================================================
const GAS_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';

const SHEET_ID = '17tJxLIPGAdxQY3fJlSogvvTinQAAizTVoh2B1fClY5E';
const SHEET_NAME = 'DS PT TRẠM KH';

// Google Visualization API base URL (no tqx — we build it with responseHandler in fetchViaJSONP)
const GVIZ_BASE = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(SHEET_NAME)}`;

const ACCOUNTS = {
  'ktat':   { password: 'ktat123',   role: 'ktat',   name: 'Phòng KTAT' },
  'dvkh':   { password: 'dvkh123',   role: 'dvkh',   name: 'Đội DVKH' },
  'qlhtdd': { password: 'qlhtdd123', role: 'qlhtdd', name: 'Đội QLHTĐĐ' },
  'vhld':   { password: 'vhld123',   role: 'vhld',   name: 'Đội VHLĐ' }
};

const STEPS = [
  { key: 'deNghi',   label: 'Thỏa thuận đấu nối',   owner: 'Phòng KTAT',   col: 7  },
  { key: 'tntkNgay', label: 'Chấp thuận thiết kế',   owner: 'Phòng KTAT',   col: 9  },
  { key: 'hopDong',  label: 'Ký hợp đồng mua bán điện', owner: 'Đội DVKH',    col: 11 },
  { key: 'doDem',    label: 'Thi công HT đo đếm',    owner: 'Đội QLHTĐĐ',   col: 12 },
  { key: 'dongDien', label: 'Đóng điện',              owner: 'Đội VHLĐ',     col: 13 }
];

const ROLE_STEP = { 'dvkh': 2, 'qlhtdd': 3, 'vhld': 4 };
const REFRESH_MS = 60000;

// ============================================================================
// STATE
// ============================================================================
let currentUser = null;
let allStations = [];
let expandedId = null;    // which station card is expanded
let refreshTimer = null;
let isGASAvailable = false;
let currentTab = 'pending';
let searchQuery = '';
let filterStatus = 'all';

// ============================================================================
// UTILS
// ============================================================================
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; };

function isDate(s) {
  if (!s) return false;
  s = String(s).trim();
  if (!s || s === '0' || s.toLowerCase().startsWith('chưa') || s.toLowerCase() === 'chưa đóng điện') return false;
  return /\d{1,2}\/\d{1,2}\/\d{4}/.test(s);
}

function dateToInput(d) {
  if (!d || !isDate(d)) return '';
  const p = d.split('/');
  return p.length === 3 ? `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}` : '';
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

// ============================================================================
// TOAST
// ============================================================================
function toast(msg, type='info') {
  const c = $('#toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = { success:'✓', error:'✕', info:'ℹ' };
  t.innerHTML = `<span>${icons[type]||'ℹ'}</span> ${esc(msg)}`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateY(20px)'; t.style.transition='all 0.3s'; setTimeout(()=>t.remove(),300); }, 3500);
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
// DATA LOADING — JSONP (fixes CORS for file:// protocol)
// ============================================================================
function fetchViaJSONP() {
  return new Promise((resolve, reject) => {
    const callbackName = '_gvizCb_' + Date.now();
    const script = document.createElement('script');

    window[callbackName] = function(data) {
      delete window[callbackName];
      script.remove();
      resolve(data);
    };

    // CRITICAL: responseHandler must be INSIDE the tqx parameter
    // Format: tqx=responseHandler:callbackName
    script.src = GVIZ_BASE + '&tqx=responseHandler:' + callbackName;

    script.onerror = () => {
      delete window[callbackName];
      script.remove();
      reject(new Error('Script load failed'));
    };

    setTimeout(() => {
      if (window[callbackName]) {
        delete window[callbackName];
        script.remove();
        reject(new Error('Timeout'));
      }
    }, 15000);

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
      // gviz returns {v: value, f: formatted}
      if (cells[idx].f) return String(cells[idx].f).trim();
      if (cells[idx].v !== null && cells[idx].v !== undefined) return String(cells[idx].v).trim();
      return '';
    };

    const name = cv(1);
    if (!name) continue;

    stations.push({
      row: i + 2,
      stt: cv(0),
      name: name,
      address: cv(2),
      contact: cv(3),
      xayLap: cv(4),
      kva: cv(5),
      deNghi: cv(6),
      tntkSoCV: cv(7),
      tntkNgay: cv(8),
      ttdn: cv(9),
      hopDong: cv(10),
      doDem: cv(11),
      dongDien: cv(12)
    });
  }
  return stations;
}

async function fetchStations() {
  $('#refreshBar').classList.add('loading');

  // Try GAS API first
  if (GAS_URL && !GAS_URL.includes('YOUR_DEPLOYMENT_ID')) {
    try {
      isGASAvailable = true;
      const resp = await fetch(GAS_URL + '?action=get_data&t=' + Date.now());
      const data = await resp.json();
      if (data.status === 'success' && data.stations) {
        allStations = data.stations;
        $('#refreshBar').classList.remove('loading');
        return;
      }
    } catch (e) {
      console.warn('GAS failed, falling back to JSONP:', e);
    }
  }

  // Fallback: JSONP from Google Sheets
  try {
    isGASAvailable = false;
    const data = await fetchViaJSONP();
    allStations = parseGvizResponse(data);
  } catch (e) {
    console.error('JSONP failed:', e);
    toast('Không thể tải dữ liệu. Kiểm tra kết nối mạng.', 'error');
  }

  $('#refreshBar').classList.remove('loading');
}

// ============================================================================
// API CALLS (GAS)
// ============================================================================
async function apiUpdate(row, column, value, role) {
  if (!isGASAvailable) {
    toast('Chưa deploy API. Vui lòng deploy Google Apps Script.', 'error');
    return false;
  }
  try {
    const r = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'update_date', row, column, value, role })
    });
    const d = await r.json();
    if (d.status === 'success') { toast(d.message || 'Cập nhật thành công!', 'success'); return true; }
    toast(d.message || 'Lỗi', 'error');
    return false;
  } catch (e) { toast('Lỗi kết nối: ' + e.message, 'error'); return false; }
}

async function apiAddStation(data) {
  if (!isGASAvailable) { toast('Chưa deploy API.', 'error'); return false; }
  try {
    const r = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'add_station', ...data, role: currentUser.role })
    });
    const d = await r.json();
    if (d.status === 'success') { toast(d.message || 'Thêm thành công!', 'success'); return true; }
    toast(d.message || 'Lỗi', 'error');
    return false;
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
  if (!acc || acc.password !== p) { $('#loginError').textContent = 'Sai mật khẩu!'; $('#loginPassword').value=''; return; }
  currentUser = { username: u, role: acc.role, name: acc.name };
  sessionStorage.setItem('tba_user', JSON.stringify(currentUser));
  showApp();
}

function logout() {
  currentUser = null;
  sessionStorage.removeItem('tba_user');
  if (refreshTimer) clearInterval(refreshTimer);
  $('#loginPage').classList.remove('hidden');
  $('#appPage').classList.add('hidden');
  $('#loginPassword').value='';
  $('#loginError').textContent='';
}

function checkSession() {
  const s = sessionStorage.getItem('tba_user');
  if (s) { try { currentUser = JSON.parse(s); showApp(); } catch(e) { sessionStorage.removeItem('tba_user'); } }
}

async function showApp() {
  $('#loginPage').classList.add('hidden');
  $('#appPage').classList.remove('hidden');
  const initials = currentUser.name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
  $('#userAvatar').textContent = initials;
  $('#userName').textContent = currentUser.name;
  await loadAndRender();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadAndRender, REFRESH_MS);
}

async function loadAndRender() {
  await fetchStations();
  render();
}

// ============================================================================
// RENDER ROUTER
// ============================================================================
function render() {
  const m = $('#mainContent');
  if (currentUser.role === 'ktat') renderKTAT(m);
  else renderTeam(m);
}

// ============================================================================
// KTAT DASHBOARD
// ============================================================================
function renderKTAT(el) {
  const total = allStations.length;
  const done = allStations.filter(s => isDate(s.dongDien)).length;
  const notDone = total - done;

  const filtered = applyFilters(allStations);

  el.innerHTML = `
    <!-- Stats -->
    <div class="stats-strip" style="grid-template-columns: repeat(3,1fr);">
      <div class="stat-item"><div class="stat-num total">${total}</div><div class="stat-label">Tổng trạm</div></div>
      <div class="stat-item"><div class="stat-num done">${done}</div><div class="stat-label">Đã đóng điện</div></div>
      <div class="stat-item"><div class="stat-num progress">${notDone}</div><div class="stat-label">Chưa đóng điện</div></div>
    </div>

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" placeholder="Tìm tên, địa chỉ..." id="searchInput" value="${esc(searchQuery)}">
      </div>
      <select class="filter-select" id="filterSelect">
        <option value="all" ${filterStatus==='all'?'selected':''}>Tất cả</option>
        <option value="done" ${filterStatus==='done'?'selected':''}>Đã đóng điện</option>
        <option value="not_done" ${filterStatus==='not_done'?'selected':''}>Chưa đóng điện</option>
      </select>
      <button class="btn btn-primary btn-sm" id="addBtn">+ Thêm</button>
    </div>

    <!-- Station list -->
    <div class="section-title">Danh sách trạm <span class="count-pill">${filtered.length}</span></div>
    <div class="station-list" id="stationList">
      ${filtered.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <div class="empty-title">Không có trạm nào</div>
          <div class="empty-desc">Thay đổi bộ lọc hoặc thêm trạm mới</div>
        </div>
      ` : filtered.map(s => renderStationCard(s)).join('')}
    </div>
  `;

  bindKTATEvents();
}

function renderStationCard(s) {
  const states = getStepStates(s);
  const completedCount = states.filter(x => x === 'done').length;
  const isExpanded = expandedId === s.row;
  
  let badgeClass, badgeText;
  if (completedCount === 5) { badgeClass='badge-done'; badgeText='✓ Hoàn thành'; }
  else if (completedCount > 0) { badgeClass='badge-progress'; badgeText=`${completedCount}/5`; }
  else { badgeClass='badge-waiting'; badgeText='Chờ'; }

  return `
    <div class="station-card ${isExpanded ? 'expanded' : ''}" data-row="${s.row}">
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
        <span class="expand-icon">${isExpanded ? '▲' : '▼'}</span>
      </div>
      ${isExpanded ? renderTimeline(s, states) : ''}
    </div>
  `;
}

function renderTimeline(s, states) {
  return `
    <div class="timeline-panel">
      <div class="tree-timeline">
        ${STEPS.map((step, i) => {
          const state = states[i];
          const val = s[step.key] || '';
          const dateDisplay = isDate(val) ? val : '';
          const canEdit = currentUser.role === 'ktat' && (step.col === 7 || step.col === 9);

          return `
            <div class="tree-node ${state}">
              <div class="tree-dot">${state === 'done' ? '✓' : (i + 1)}</div>
              <div class="tree-content">
                <div class="tree-label">${step.label}</div>
                <div class="tree-owner">${step.owner}</div>
                ${dateDisplay ? `<div class="tree-date">${dateDisplay}</div>` :
                  (state === 'active' && canEdit) ? `
                    <div class="tree-date-input">
                      <input type="date" value="${today()}" data-row="${s.row}" data-col="${step.col}">
                      <button class="btn btn-success btn-sm btn-save-timeline" data-row="${s.row}" data-col="${step.col}">Lưu</button>
                    </div>
                  ` : `<div class="tree-date">—</div>`
                }
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function getStepStates(s) {
  // Mỗi bước kiểm tra độc lập: có ngày = done, không = chưa cập nhật
  const vals = STEPS.map(st => s[st.key] || '');
  const states = vals.map(v => isDate(v) ? 'done' : 'pending');
  
  // Tìm bước đầu tiên chưa có ngày để đánh dấu "active" (đang cần cập nhật)
  const firstPending = states.indexOf('pending');
  if (firstPending !== -1) states[firstPending] = 'active';
  
  return states;
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

function bindKTATEvents() {
  // Search
  const si = $('#searchInput');
  if (si) {
    si.addEventListener('input', () => { searchQuery = si.value; render(); });
    // Keep focus after re-render
    setTimeout(() => { si.focus(); si.setSelectionRange(si.value.length, si.value.length); }, 0);
  }

  // Filter
  const fs = $('#filterSelect');
  if (fs) fs.addEventListener('change', () => { filterStatus = fs.value; render(); });

  // Add station
  const ab = $('#addBtn');
  if (ab) ab.addEventListener('click', () => { $('#addStationModal').classList.remove('hidden'); $('#newName').focus(); });

  // Expand/collapse cards
  $$('.station-card-header').forEach(h => {
    h.addEventListener('click', () => {
      const row = parseInt(h.dataset.row);
      expandedId = expandedId === row ? null : row;
      render();
    });
  });

  // Save timeline date
  $$('.btn-save-timeline').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const row = parseInt(btn.dataset.row);
      const col = parseInt(btn.dataset.col);
      const inp = btn.previousElementSibling;
      const val = inputToSheet(inp.value);
      if (!val) { toast('Chọn ngày', 'error'); return; }
      btn.textContent = '...'; btn.disabled = true;
      const ok = await apiUpdate(row, col, val, currentUser.role);
      if (ok) await loadAndRender();
      else { btn.textContent = 'Lưu'; btn.disabled = false; }
    });
  });
}

// ============================================================================
// TEAM DASHBOARD (DVKH, QLHTDD, VHLD)
// ============================================================================
function renderTeam(el) {
  const stepIdx = ROLE_STEP[currentUser.role];
  const step = STEPS[stepIdx];
  const prevStep = STEPS[stepIdx - 1];

  const pending = [], completed = [];
  for (const s of allStations) {
    if (isDate(s[prevStep.key])) {
      if (isDate(s[step.key])) completed.push(s);
      else pending.push(s);
    }
  }
  const total = pending.length + completed.length;
  const showing = currentTab === 'pending' ? pending : completed;

  el.innerHTML = `
    <div class="stats-strip" style="grid-template-columns: repeat(3,1fr);">
      <div class="stat-item"><div class="stat-num total">${total}</div><div class="stat-label">Tổng công trình</div></div>
      <div class="stat-item"><div class="stat-num progress">${pending.length}</div><div class="stat-label">Cần xử lý</div></div>
      <div class="stat-item"><div class="stat-num done">${completed.length}</div><div class="stat-label">Đã hoàn thành</div></div>
    </div>

    <div class="tab-nav">
      <button class="tab-btn ${currentTab==='pending'?'active':''}" data-tab="pending">
        Cần xử lý <span class="tab-count">${pending.length}</span>
      </button>
      <button class="tab-btn ${currentTab==='completed'?'active':''}" data-tab="completed">
        Hoàn thành <span class="tab-count">${completed.length}</span>
      </button>
    </div>

    <div class="toolbar" style="margin-bottom:10px;">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" placeholder="Tìm tên công trình..." id="teamSearch">
      </div>
    </div>

    <div class="section-title">${currentTab==='pending' ? '⏳' : '✅'} ${step.label} <span class="count-pill">${showing.length}</span></div>

    <div id="jobList">
      ${showing.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">${currentTab==='pending' ? '🎉' : '📭'}</div>
          <div class="empty-title">${currentTab==='pending' ? 'Không có job cần xử lý!' : 'Chưa có job hoàn thành'}</div>
        </div>
      ` : showing.map(s => renderJobCard(s, step, currentTab==='completed')).join('')}
    </div>
  `;

  bindTeamEvents(step);
}

function renderJobCard(s, step, isDone) {
  const dateVal = s[step.key] || '';
  return `
    <div class="job-card ${isDone ? 'done-card' : 'pending-card'}">
      <div class="job-title">${esc(s.name)}</div>
      <div class="job-meta">
        <div class="job-meta-row">📍 ${esc(s.address || 'Chưa có địa chỉ')}</div>
        <div class="job-meta-row">⚡ ${s.kva ? esc(s.kva)+' kVA' : '—'}</div>
      </div>
      <div class="job-actions">
        ${isDone ? `
          <div class="job-done-badge">✓ ${isDate(dateVal) ? dateVal : 'Hoàn thành'}</div>
        ` : `
          <input type="date" value="${today()}" data-row="${s.row}" data-col="${step.col}">
          <button class="btn btn-success btn-sm btn-update-job" data-row="${s.row}" data-col="${step.col}">✓ Cập nhật</button>
        `}
      </div>
    </div>
  `;
}

function bindTeamEvents(step) {
  // Tabs
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => {
    currentTab = b.dataset.tab;
    render();
  }));

  // Update job
  $$('.btn-update-job').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = parseInt(btn.dataset.row);
      const col = parseInt(btn.dataset.col);
      const inp = btn.previousElementSibling;
      const val = inputToSheet(inp.value);
      if (!val) { toast('Chọn ngày', 'error'); return; }
      btn.textContent = '...'; btn.disabled = true;
      const ok = await apiUpdate(row, col, val, currentUser.role);
      if (ok) await loadAndRender();
      else { btn.textContent = '✓ Cập nhật'; btn.disabled = false; }
    });
  });

  // Search
  const ts = $('#teamSearch');
  if (ts) ts.addEventListener('input', () => {
    const q = ts.value.toLowerCase();
    $$('.job-card').forEach(c => {
      const t = c.querySelector('.job-title')?.textContent?.toLowerCase() || '';
      c.style.display = t.includes(q) ? '' : 'none';
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
    name,
    address: $('#newAddress').value.trim(),
    kva: $('#newKVA').value.trim(),
    contact: $('#newContact').value.trim(),
    xayLap: $('#newXayLap').value.trim(),
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
