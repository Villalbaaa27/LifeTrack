/* ═══════════════════════════════════════════
   MACROS APP — app.js
   ═══════════════════════════════════════════ */

const API = 'https://script.google.com/macros/s/AKfycbweIfA3TC-dtBS2XO52wED8OY8ebabXkY6Nqly_ggnadu0LELQkMEoU5pMBIYgLa-pr/exec';
const CIRC = 2 * Math.PI * 32;
const PIN = '1220';

// ── STATE ─────────────────────────────────
let allEntries = [];
let trainedDays = {};   // { 'YYYY-MM': [1,3,…] }
let settings = {
  goalKcal: 2000, goalProt: 150,
  bgColor: '#0a0a0a', surfaceColor: '#141414',
  accentColor: '#c8f557', kcalColor: '#f5a623'
};
let calYear, calMonth;
let selectedCat = 'Desayuno';
let pinEntry = '';
let saveTimer;

// ── DATE HELPERS ──────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }
function toLocalStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return toLocalStr(new Date()); }
function monthKey(y, m) { return `${y}-${pad(m + 1)}`; }

function normalizeFecha(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    return toLocalStr(new Date(Math.round((val - 25569) * 86400000)));
  }
  const d = new Date(String(val));
  if (!isNaN(d)) return toLocalStr(d);
  return String(val).substring(0, 10);
}

// ── THEME ─────────────────────────────────
function applyTheme(s) {
  const r = document.documentElement.style;
  r.setProperty('--bg', s.bgColor);
  r.setProperty('--surface', s.surfaceColor);
  r.setProperty('--surface2', adjustBrightness(s.surfaceColor, 10));
  r.setProperty('--border', adjustBrightness(s.surfaceColor, 30));
  r.setProperty('--accent', s.accentColor);
  r.setProperty('--kcal', s.kcalColor);
  // login bg
  const ls = document.getElementById('login-screen');
  if (ls) ls.style.background = s.bgColor;
}

function adjustBrightness(hex, amt) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + amt);
  const g = Math.min(255, ((num >> 8) & 0xff) + amt);
  const b = Math.min(255, (num & 0xff) + amt);
  return '#' + [r, g, b].map(x => pad(x.toString(16))).join('');
}

const THEMES = [
  { name: 'Dark (default)', bg: '#0a0a0a', surface: '#141414', accent: '#c8f557', kcal: '#f5a623' },
  { name: 'Midnight blue', bg: '#050a14', surface: '#0d1626', accent: '#57c8f5', kcal: '#f5a623' },
  { name: 'Deep purple', bg: '#0a0514', surface: '#140d26', accent: '#c857f5', kcal: '#f5c857' },
  { name: 'Forest', bg: '#050f07', surface: '#0d1f10', accent: '#57f587', kcal: '#f5a623' },
];

// ── INIT ──────────────────────────────────
function init() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();

  document.getElementById('header-date').textContent =
    now.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();

  document.getElementById('form-date').value = todayStr();

  // Load settings from localStorage
  const saved = localStorage.getItem('macro_settings');
  if (saved) settings = { ...settings, ...JSON.parse(saved) };
  applyTheme(settings);
  syncSettingsUI();

  const st = localStorage.getItem('macro_training');
  if (st) trainedDays = JSON.parse(st);

  renderMiniCal();
  fetchAll();
}

// ── FETCH ─────────────────────────────────
async function fetchAll() {
  try {
    const res = await fetch(API + '?action=get');
    const data = await res.json();
    const raw = Array.isArray(data) ? data : [];

    allEntries = [];
    const newTrained = {};

    raw.forEach(row => {
      if (row.tipo === 'entreno') {
        const f = normalizeFecha(row.fecha);
        const mk = f.substring(0, 7);
        const d = parseInt(f.substring(8, 10));
        if (!newTrained[mk]) newTrained[mk] = [];
        if (!newTrained[mk].includes(d)) newTrained[mk].push(d);
      } else if (row.tipo === 'ajuste') {
        // load remote settings
        try {
          const rs = JSON.parse(row.valor || '{}');
          settings = { ...settings, ...rs };
          applyTheme(settings);
          syncSettingsUI();
          localStorage.setItem('macro_settings', JSON.stringify(settings));
        } catch (e) { }
      } else {
        allEntries.push({ ...row, fecha: normalizeFecha(row.fecha) });
      }
    });

    // merge trained
    Object.entries(newTrained).forEach(([mk, days]) => {
      trainedDays[mk] = days;
    });
    localStorage.setItem('macro_training', JSON.stringify(trainedDays));

    updateTodayView();
    updateHistoryView();
    renderMiniCal();
    renderWorkoutCal();
  } catch (e) {
    console.error(e);
    showToast('Error al cargar datos', 'err');
    document.getElementById('today-log-list').innerHTML =
      '<div class="empty"><div class="empty-icon">⚠️</div>Error de conexión</div>';
  }
}

// ── TODAY VIEW ────────────────────────────
function updateTodayView() {
  const today = todayStr();
  const entries = allEntries.filter(e => e.fecha === today);
  const totK = entries.reduce((s, e) => s + (parseFloat(e.kcal) || 0), 0);
  const totP = entries.reduce((s, e) => s + (parseFloat(e.proteina) || 0), 0);
  const gK = settings.goalKcal;
  const gP = settings.goalProt;

  // rings
  const pK = Math.min(totK / gK, 1);
  const pP = Math.min(totP / gP, 1);
  document.getElementById('ring-kcal-fill').setAttribute('stroke-dasharray', `${pK * CIRC} ${CIRC}`);
  document.getElementById('ring-prot-fill').setAttribute('stroke-dasharray', `${pP * CIRC} ${CIRC}`);
  document.getElementById('rv-kcal').textContent = Math.round(totK);
  document.getElementById('rv-prot').textContent = Math.round(totP);

  // stats
  document.getElementById('st-count').textContent = entries.length;
  document.getElementById('st-kcal-l').innerHTML = `${Math.round(gK - totK)} <span class="u">kcal</span>`;
  document.getElementById('st-prot-l').innerHTML = `${(gP - totP).toFixed(1)} <span class="u">g</span>`;

  // bars
  document.getElementById('bar-kcal-fill').style.width = (pK * 100) + '%';
  document.getElementById('bar-prot-fill').style.width = (pP * 100) + '%';
  document.getElementById('bar-kcal-lbl').textContent = `${Math.round(totK)} / ${gK} kcal`;
  document.getElementById('bar-prot-lbl').textContent = `${totP.toFixed(1)} / ${gP} g`;

  // list
  const list = document.getElementById('today-log-list');
  if (!entries.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">🍽️</div>Sin registros hoy</div>';
  } else {
    list.innerHTML = entries.slice().reverse().map(logHTML).join('');
  }

  renderMiniCal();
}

function logHTML(e) {
  const cls = 'dot-' + (e.categoria || 'otro').toLowerCase().replace(/\s+/g, '-');
  return `<div class="log-item">
    <div class="log-dot ${cls}"></div>
    <div class="log-info">
      <div class="log-name">${e.alimento || '—'}</div>
      <div class="log-cat">${e.categoria || ''}</div>
    </div>
    <div class="log-nums">
      <div class="log-k">${Math.round(e.kcal || 0)} kcal</div>
      <div class="log-p">${parseFloat(e.proteina || 0).toFixed(1)}g prot</div>
    </div>
  </div>`;
}

// ── MINI CAL (Home) ───────────────────────
function renderMiniCal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const mk = monthKey(y, m);
  const trained = trainedDays[mk] || [];
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDaysInMonth = new Date(y, m, 0).getDate();
  const todayD = now.getDate();

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  document.getElementById('mini-cal-month').textContent = monthNames[m];

  let firstDay = new Date(y, m, 1).getDay();
  firstDay = firstDay === 0 ? 6 : firstDay - 1;

  let html = '';
  for (let i = firstDay - 1; i >= 0; i--) {
     html += `<div class="mc-day other-m">${prevDaysInMonth - i}</div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    let cls = 'mc-day';
    if (trained.includes(d)) cls += ' trained';
    if (d === todayD) cls += ' today-m';
    html += `<div class="${cls}">${d}</div>`;
  }
  const currentTotal = firstDay + daysInMonth;
  const remainingCells = 42 - currentTotal;
  for(let i = 1; i <= remainingCells; i++) {
     html += `<div class="mc-day other-m">${i}</div>`;
  }
  document.getElementById('mini-cal-grid').innerHTML = html;
}

// ── HISTORY VIEW ──────────────────────────
function updateHistoryView() {
  const container = document.getElementById('history-container');
  if (!allEntries.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">📋</div>Sin datos aún</div>';
    return;
  }
  const groups = {};
  allEntries.forEach(e => {
    if (!groups[e.fecha]) groups[e.fecha] = [];
    groups[e.fecha].push(e);
  });
  const dates = Object.keys(groups).sort().reverse();
  container.innerHTML = dates.map(date => {
    const ents = groups[date];
    const totK = ents.reduce((s, e) => s + (parseFloat(e.kcal) || 0), 0);
    const totP = ents.reduce((s, e) => s + (parseFloat(e.proteina) || 0), 0);
    return `<div class="hist-group">
      <div class="hist-date-row">
        <span>${fmtDate(date)}</span>
        <span><span class="ht-k">${Math.round(totK)} kcal</span><span class="ht-p">${totP.toFixed(1)}g prot</span></span>
      </div>
      <div class="log-list">${ents.slice().reverse().map(logHTML).join('')}</div>
    </div>`;
  }).join('');
}

function fmtDate(str) {
  const d = new Date(str + 'T12:00:00');
  if (str === todayStr()) return 'Hoy';
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (str === toLocalStr(yest)) return 'Ayer';
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ── ADD ENTRY ─────────────────────────────
function selectCat(btn) {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
  selectedCat = btn.dataset.cat;
}

async function addEntry() {
  const fecha = document.getElementById('form-date').value;
  const alimento = document.getElementById('form-food').value.trim();
  const kcal = parseFloat(document.getElementById('form-kcal').value) || 0;
  const proteina = parseFloat(document.getElementById('form-prot').value) || 0;

  if (!alimento) { showToast('Escribe el alimento', 'err'); return; }
  if (!fecha) { showToast('Selecciona una fecha', 'err'); return; }

  const btn = document.getElementById('btn-add');
  btn.disabled = true; btn.textContent = 'Guardando...';

  const p = new URLSearchParams({ action: 'add', tipo: 'comida', fecha, categoria: selectedCat, alimento, kcal, proteina });
  try {
    await fetch(API + '?' + p, { method: 'GET', mode: 'no-cors' });
    allEntries.push({ fecha, categoria: selectedCat, alimento, kcal, proteina });
    updateTodayView(); updateHistoryView();
    showToast('✓ Guardado', 'ok');
    document.getElementById('form-food').value = '';
    document.getElementById('form-kcal').value = '';
    document.getElementById('form-prot').value = '';
    setTimeout(() => showView('today'), 600);
  } catch (e) { showToast('Error al guardar', 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Guardar entrada'; }
}

// ── WORKOUT CAL ───────────────────────────
function renderWorkoutCal() {
  const mk = monthKey(calYear, calMonth);
  const trained = trainedDays[mk] || [];
  const today = new Date();
  const isCurr = calYear === today.getFullYear() && calMonth === today.getMonth();
  const todayD = today.getDate();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const prevDaysInMonth = new Date(calYear, calMonth, 0).getDate();

  const mNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  document.getElementById('month-lbl').textContent = `${mNames[calMonth]} ${calYear}`;

  // stats
  document.getElementById('sv-count').textContent = trained.length;
  document.getElementById('sv-pct').textContent = Math.round((trained.length / daysInMonth) * 100) + '%';

  // week count
  const wkStart = new Date(today);
  wkStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  let wkC = 0;
  if (isCurr) trained.forEach(d => {
    const dt = new Date(calYear, calMonth, d);
    if (dt >= wkStart && dt <= today) wkC++;
  });
  document.getElementById('sv-week').textContent = wkC;

  let firstDay = new Date(calYear, calMonth, 1).getDay();
  firstDay = firstDay === 0 ? 6 : firstDay - 1;

  let html = '';
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="wk-day other-m">${prevDaysInMonth - i}</div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    let cls = 'wk-day';
    if (trained.includes(d)) cls += ' trained';
    if (isCurr && d === todayD) cls += ' today-m';
    html += `<div class="${cls}" onclick="toggleDay(${d})">${d}</div>`;
  }
  const currentTotal = firstDay + daysInMonth;
  const remainingCells = 42 - currentTotal;
  for(let i = 1; i <= remainingCells; i++) {
     html += `<div class="wk-day other-m">${i}</div>`;
  }
  document.getElementById('wk-cal-grid').innerHTML = html;
}

function changeMonth(delta) {
  calMonth += delta;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderWorkoutCal();
}

async function toggleDay(day) {
  const mk = monthKey(calYear, calMonth);
  if (!trainedDays[mk]) trainedDays[mk] = [];
  const idx = trainedDays[mk].indexOf(day);
  const adding = idx === -1;
  if (adding) trainedDays[mk].push(day);
  else trainedDays[mk].splice(idx, 1);

  localStorage.setItem('macro_training', JSON.stringify(trainedDays));
  renderWorkoutCal();
  renderMiniCal();

  clearTimeout(saveTimer);
  const ind = document.getElementById('save-ind');
  ind.textContent = 'Guardando...';
  saveTimer = setTimeout(async () => {
    const fecha = `${calYear}-${pad(calMonth + 1)}-${pad(day)}`;
    const action = adding ? 'add_entreno' : 'remove_entreno';
    try {
      await fetch(API + '?' + new URLSearchParams({ action, fecha, tipo: 'entreno' }), { method: 'GET', mode: 'no-cors' });
      ind.textContent = '✓ Guardado';
      setTimeout(() => ind.textContent = '', 2000);
    } catch (e) { ind.textContent = 'Error al guardar'; }
  }, 800);
}

// ── CONFIG PANEL ──────────────────────────
function openConfig() {
  document.getElementById('cfg-panel').classList.add('open');
}
function closeConfig() {
  document.getElementById('cfg-panel').classList.remove('open');
}

function syncSettingsUI() {
  document.getElementById('cfg-kcal').value = settings.goalKcal;
  document.getElementById('cfg-prot').value = settings.goalProt;
  document.getElementById('cfg-bg').value = settings.bgColor;
  document.getElementById('cfg-surface').value = settings.surfaceColor;
  document.getElementById('cfg-accent').value = settings.accentColor;
  document.getElementById('cfg-kcalc').value = settings.kcalColor;
}

function applyThemePreset(idx) {
  const t = THEMES[idx];
  settings.bgColor = t.bg;
  settings.surfaceColor = t.surface;
  settings.accentColor = t.accent;
  settings.kcalColor = t.kcal;
  syncSettingsUI();
  applyTheme(settings);
  document.querySelectorAll('.theme-btn').forEach((b, i) => b.classList.toggle('active-theme', i === idx));
}

function onColorChange() {
  settings.bgColor = document.getElementById('cfg-bg').value;
  settings.surfaceColor = document.getElementById('cfg-surface').value;
  settings.accentColor = document.getElementById('cfg-accent').value;
  settings.kcalColor = document.getElementById('cfg-kcalc').value;
  applyTheme(settings);
}

async function saveSettings() {
  settings.goalKcal = parseFloat(document.getElementById('cfg-kcal').value) || 2000;
  settings.goalProt = parseFloat(document.getElementById('cfg-prot').value) || 150;
  settings.bgColor = document.getElementById('cfg-bg').value;
  settings.surfaceColor = document.getElementById('cfg-surface').value;
  settings.accentColor = document.getElementById('cfg-accent').value;
  settings.kcalColor = document.getElementById('cfg-kcalc').value;

  applyTheme(settings);
  localStorage.setItem('macro_settings', JSON.stringify(settings));
  updateTodayView();

  // Save to Sheets
  const p = new URLSearchParams({ action: 'save_settings', tipo: 'ajuste', valor: JSON.stringify(settings) });
  try {
    await fetch(API + '?' + p, { method: 'GET', mode: 'no-cors' });
    showToast('✓ Ajustes guardados', 'ok');
  } catch (e) { showToast('Guardado solo local', 'ok'); }
  closeConfig();
}

// ── NAV ───────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  const idx = ['today', 'add', 'workout', 'history'].indexOf(name);
  document.querySelectorAll('nav button')[idx].classList.add('active');
  if (name === 'workout') renderWorkoutCal();
  if (name === 'history') updateHistoryView();
}

// ── TOAST ─────────────────────────────────
let toastTmr;
function showToast(msg, type = '') {
  const t = document.querySelector('.toast');
  t.textContent = msg; t.className = 'toast show ' + type;
  clearTimeout(toastTmr);
  toastTmr = setTimeout(() => t.classList.remove('show'), 2400);
}

// ── LOGIN ─────────────────────────────────
function pinPress(d) {
  if (pinEntry.length >= 4) return;
  pinEntry += d; updateDots();
  if (pinEntry.length === 4) checkPin();
}
function pinDel() { pinEntry = pinEntry.slice(0, -1); updateDots(); }
function updateDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('dot-' + i);
    dot.classList.toggle('filled', i < pinEntry.length);
    dot.classList.remove('error');
  }
}
function checkPin() {
  if (pinEntry === PIN) {
    sessionStorage.setItem('macro_auth', '1');
    document.getElementById('login-screen').style.display = 'none';
    init();
  } else {
    for (let i = 0; i < 4; i++) document.getElementById('dot-' + i).classList.add('error');
    document.getElementById('login-err').classList.add('show');
    setTimeout(() => {
      pinEntry = ''; updateDots();
      document.getElementById('login-err').classList.remove('show');
    }, 900);
  }
}

// ── BOOT ──────────────────────────────────
if (sessionStorage.getItem('macro_auth') === '1') {
  document.getElementById('login-screen').style.display = 'none';
  init();
}
