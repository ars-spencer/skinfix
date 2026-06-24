/* ============================================================
   Skinfix — local-only rosacea tracker
   All data (including photos) lives in this browser's IndexedDB.
   Nothing is ever sent anywhere. Export regularly via Settings.
   ============================================================ */

const DB_NAME = 'skin-almanac';
const DB_VERSION = 1;
let db;

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('entries')){
        d.createObjectStore('entries', { keyPath: 'date' });
      }
      if (!d.objectStoreNames.contains('routine')){
        d.createObjectStore('routine', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode){
  return db.transaction(storeName, mode).objectStore(storeName);
}
function dbGet(store, key){
  return new Promise((res, rej) => {
    const r = tx(store, 'readonly').get(key);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}
function dbGetAll(store){
  return new Promise((res, rej) => {
    const r = tx(store, 'readonly').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}
function dbPut(store, value){
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').put(value);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function dbDelete(store, key){
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').delete(key);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}
function dbClear(store){
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

/* ---------------- date helpers ---------------- */
function fmtDate(d){
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function parseDate(s){
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}
function todayStr(){ return fmtDate(new Date()); }
function addDays(d, n){ const r = new Date(d); r.setDate(r.getDate()+n); return r; }

/* ---------------- app state ---------------- */
let allEntries = [];   // array of entry objects, refreshed from DB
let allRoutine = [];
let currentTriggers = new Set();
let currentRating = null;
let currentPhotoDataUrl = null;
let almanacMonthCursor = new Date(); // first of month being viewed
let comparePicks = [];

const els = {};

/* ============================================================
   INIT
   ============================================================ */
async function init(){
  db = await openDB();
  await refreshData();
  cacheEls();
  bindNav();
  bindTodayForm();
  bindAlmanac();
  bindGallery();
  bindRoutine();
  bindSettings();
  bindLightbox();

  els.entryDate.value = todayStr();
  await loadEntryIntoForm(todayStr());
  renderStats();
  renderMiniHeatmap();
  renderAlmanac();
  renderTrend();
  renderTriggerBars();
  renderGallery();
  renderRoutineTimeline();
}

async function refreshData(){
  allEntries = (await dbGetAll('entries')).sort((a,b) => a.date < b.date ? -1 : 1);
  allRoutine = (await dbGetAll('routine')).sort((a,b) => a.date < b.date ? 1 : -1);
}

function cacheEls(){
  els.tabs = document.querySelectorAll('.tab');
  els.views = document.querySelectorAll('.view');

  els.entryForm = document.getElementById('entry-form');
  els.entryFormTitle = document.getElementById('entry-form-title');
  els.entryDate = document.getElementById('entry-date');
  els.dialRow = document.getElementById('rating-dial');
  els.ratingValue = document.getElementById('rating-value');
  els.chipRow = document.getElementById('trigger-chips');
  els.customTriggerInput = document.getElementById('custom-trigger-input');
  els.addCustomTrigger = document.getElementById('add-custom-trigger');
  els.entryNotes = document.getElementById('entry-notes');
  els.entryPhoto = document.getElementById('entry-photo');
  els.photoPreviewWrap = document.getElementById('photo-preview-wrap');
  els.photoPreview = document.getElementById('photo-preview');
  els.photoRemove = document.getElementById('photo-remove');
  els.entryDelete = document.getElementById('entry-delete');
  els.saveStatus = document.getElementById('save-status');

  els.statStreak = document.getElementById('stat-streak');
  els.statAvg14 = document.getElementById('stat-avg14');
  els.statTotal = document.getElementById('stat-total');
  els.miniHeatmap = document.getElementById('mini-heatmap');

  els.heatmap = document.getElementById('heatmap');
  els.monthLabel = document.getElementById('month-label');
  els.monthPrev = document.getElementById('month-prev');
  els.monthNext = document.getElementById('month-next');
  els.trendCanvas = document.getElementById('trend-canvas');
  els.triggerBars = document.getElementById('trigger-bars');

  els.compareMode = document.getElementById('compare-mode');
  els.galleryStrip = document.getElementById('gallery-strip');
  els.galleryHint = document.getElementById('gallery-hint');
  els.comparePanel = document.getElementById('compare-panel');

  els.routineForm = document.getElementById('routine-form');
  els.routineDate = document.getElementById('routine-date');
  els.routineType = document.getElementById('routine-type');
  els.routineProduct = document.getElementById('routine-product');
  els.routineNotes = document.getElementById('routine-notes');
  els.routineTimeline = document.getElementById('routine-timeline');

  els.exportJson = document.getElementById('export-json');
  els.importJson = document.getElementById('import-json');
  els.clearAll = document.getElementById('clear-all');
  els.settingsStatus = document.getElementById('settings-status');

  els.lightbox = document.getElementById('lightbox');
  els.lightboxImg = document.getElementById('lightbox-img');
  els.lightboxCaption = document.getElementById('lightbox-caption');
  els.lightboxClose = document.getElementById('lightbox-close');
}

/* ============================================================
   NAV
   ============================================================ */
function bindNav(){
  els.tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}
function switchTab(name){
  els.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  els.views.forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'almanac'){ renderAlmanac(); renderTrend(); renderTriggerBars(); }
  if (name === 'gallery'){ renderGallery(); }
  if (name === 'routine'){ renderRoutineTimeline(); }
}

/* ============================================================
   TODAY / ENTRY FORM
   ============================================================ */
function bindTodayForm(){
  els.dialRow.querySelectorAll('.dial').forEach(btn => {
    btn.addEventListener('click', () => {
      currentRating = Number(btn.dataset.value);
      els.ratingValue.value = currentRating;
      els.dialRow.querySelectorAll('.dial').forEach(b => b.classList.toggle('selected', b === btn));
    });
  });

  els.chipRow.querySelectorAll('.chip').forEach(chip => bindChip(chip));

  els.addCustomTrigger.addEventListener('click', () => addCustomTriggerChip());
  els.customTriggerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter'){ e.preventDefault(); addCustomTriggerChip(); }
  });

  els.entryPhoto.addEventListener('change', async () => {
    const file = els.entryPhoto.files[0];
    if (!file) return;
    currentPhotoDataUrl = await fileToCompressedDataUrl(file);
    showPhotoPreview(currentPhotoDataUrl);
  });
  els.photoRemove.addEventListener('click', () => {
    currentPhotoDataUrl = null;
    els.entryPhoto.value = '';
    els.photoPreviewWrap.hidden = true;
  });

  els.entryDate.addEventListener('change', () => loadEntryIntoForm(els.entryDate.value));

  els.entryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveEntry();
  });

  els.entryDelete.addEventListener('click', async () => {
    const date = els.entryDate.value;
    if (!confirm(`Delete the entry for ${date}? This can't be undone.`)) return;
    await dbDelete('entries', date);
    await refreshData();
    await loadEntryIntoForm(date);
    renderStats(); renderMiniHeatmap(); renderAlmanac(); renderTrend(); renderTriggerBars(); renderGallery();
    flashStatus(els.saveStatus, 'Entry deleted.');
  });
}

function bindChip(chip){
  chip.addEventListener('click', () => {
    const key = chip.dataset.trigger;
    if (currentTriggers.has(key)){ currentTriggers.delete(key); chip.classList.remove('selected'); }
    else { currentTriggers.add(key); chip.classList.add('selected'); }
  });
}

function addCustomTriggerChip(){
  const raw = els.customTriggerInput.value.trim().toLowerCase();
  if (!raw) return;
  const key = raw.replace(/\s+/g, '-');
  if (!els.chipRow.querySelector(`[data-trigger="${key}"]`)){
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip selected';
    chip.dataset.trigger = key;
    chip.textContent = raw;
    els.chipRow.appendChild(chip);
    bindChip(chip);
  }
  currentTriggers.add(key);
  els.chipRow.querySelector(`[data-trigger="${key}"]`).classList.add('selected');
  els.customTriggerInput.value = '';
}

// downscale photos before storing so IndexedDB doesn't balloon over months of daily photos
function fileToCompressedDataUrl(file, maxDim = 900, quality = 0.82){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim){ height *= maxDim / width; width = maxDim; }
      else if (height > maxDim){ width *= maxDim / height; height = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showPhotoPreview(dataUrl){
  els.photoPreview.src = dataUrl;
  els.photoPreviewWrap.hidden = false;
}

async function loadEntryIntoForm(date){
  const entry = await dbGet('entries', date);
  currentTriggers = new Set();
  currentRating = null;
  currentPhotoDataUrl = null;

  els.entryFormTitle.textContent = date === todayStr() ? 'Log today' : `Log for ${date}`;
  els.entryNotes.value = '';
  els.entryPhoto.value = '';
  els.photoPreviewWrap.hidden = true;
  els.ratingValue.value = '';
  els.dialRow.querySelectorAll('.dial').forEach(b => b.classList.remove('selected'));
  els.chipRow.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
  els.entryDelete.hidden = true;

  if (entry){
    currentRating = entry.rating || null;
    currentPhotoDataUrl = entry.photo || null;
    currentTriggers = new Set(entry.triggers || []);
    els.entryNotes.value = entry.notes || '';
    if (currentRating){
      els.ratingValue.value = currentRating;
      const btn = els.dialRow.querySelector(`[data-value="${currentRating}"]`);
      if (btn) btn.classList.add('selected');
    }
    currentTriggers.forEach(key => {
      let chip = els.chipRow.querySelector(`[data-trigger="${key}"]`);
      if (!chip){
        chip = document.createElement('button');
        chip.type = 'button'; chip.className = 'chip'; chip.dataset.trigger = key; chip.textContent = key.replace(/-/g,' ');
        els.chipRow.appendChild(chip);
        bindChip(chip);
      }
      chip.classList.add('selected');
    });
    if (currentPhotoDataUrl) showPhotoPreview(currentPhotoDataUrl);
    els.entryDelete.hidden = false;
  }
}

async function saveEntry(){
  const date = els.entryDate.value;
  if (!date) return;
  const entry = {
    date,
    rating: currentRating,
    triggers: Array.from(currentTriggers),
    notes: els.entryNotes.value.trim(),
    photo: currentPhotoDataUrl,
    updatedAt: new Date().toISOString()
  };
  await dbPut('entries', entry);
  await refreshData();
  els.entryDelete.hidden = false;
  flashStatus(els.saveStatus, `Saved ${date}.`);
  renderStats(); renderMiniHeatmap(); renderAlmanac(); renderTrend(); renderTriggerBars(); renderGallery();
}

function flashStatus(el, msg){
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
}

/* ============================================================
   STATS + MINI HEATMAP (Today view)
   ============================================================ */
function renderStats(){
  const byDate = new Map(allEntries.map(e => [e.date, e]));
  let streak = 0;
  let cursor = new Date();
  while (true){
    const key = fmtDate(cursor);
    if (byDate.has(key)){ streak++; cursor = addDays(cursor, -1); }
    else break;
  }
  els.statStreak.textContent = streak;

  const cutoff = fmtDate(addDays(new Date(), -13));
  const recentRated = allEntries.filter(e => e.date >= cutoff && typeof e.rating === 'number');
  const avg14 = recentRated.length ? (recentRated.reduce((s,e) => s + e.rating, 0) / recentRated.length) : null;
  els.statAvg14.textContent = avg14 !== null ? avg14.toFixed(1) : '—';

  els.statTotal.textContent = allEntries.length;
}

function ratingClass(rating){
  if (!rating) return '';
  return 'lvl-' + Math.max(1, Math.min(5, Math.round(rating)));
}

function renderMiniHeatmap(){
  els.miniHeatmap.innerHTML = '';
  const byDate = new Map(allEntries.map(e => [e.date, e]));
  const days = [];
  for (let i = 27; i >= 0; i--) days.push(addDays(new Date(), -i));
  days.forEach(d => {
    const key = fmtDate(d);
    const entry = byDate.get(key);
    const cell = document.createElement('div');
    cell.className = 'cell ' + (entry ? ratingClass(entry.rating) : '');
    cell.title = entry ? `${key} — flare ${entry.rating ?? '–'}` : `${key} — no entry`;
    cell.addEventListener('click', () => {
      switchTab('today');
      els.entryDate.value = key;
      loadEntryIntoForm(key);
    });
    els.miniHeatmap.appendChild(cell);
  });
}

/* ============================================================
   ALMANAC (month heatmap + trend + trigger bars)
   ============================================================ */
function bindAlmanac(){
  els.monthPrev.addEventListener('click', () => {
    almanacMonthCursor = new Date(almanacMonthCursor.getFullYear(), almanacMonthCursor.getMonth() - 1, 1);
    renderAlmanac();
  });
  els.monthNext.addEventListener('click', () => {
    almanacMonthCursor = new Date(almanacMonthCursor.getFullYear(), almanacMonthCursor.getMonth() + 1, 1);
    renderAlmanac();
  });
}

function renderAlmanac(){
  const byDate = new Map(allEntries.map(e => [e.date, e]));
  const year = almanacMonthCursor.getFullYear();
  const month = almanacMonthCursor.getMonth();
  els.monthLabel.textContent = almanacMonthCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  els.heatmap.innerHTML = '';
  ['S','M','T','W','T','F','S'].forEach(d => {
    const lab = document.createElement('div');
    lab.className = 'weekday-label';
    lab.textContent = d;
    els.heatmap.appendChild(lab);
  });

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = todayStr();

  for (let i = 0; i < startOffset; i++){
    const blank = document.createElement('div');
    blank.className = 'cell empty';
    els.heatmap.appendChild(blank);
  }
  for (let day = 1; day <= daysInMonth; day++){
    const d = new Date(year, month, day);
    const key = fmtDate(d);
    const entry = byDate.get(key);
    const cell = document.createElement('div');
    cell.className = 'cell ' + (entry ? ratingClass(entry.rating) : '') + (key === todayKey ? ' today' : '');
    const num = document.createElement('span');
    num.className = 'daynum';
    num.textContent = day;
    cell.appendChild(num);
    const trig = entry?.triggers?.length ? ` · ${entry.triggers.join(', ')}` : '';
    cell.title = entry ? `${key} — flare ${entry.rating ?? '–'}${trig}` : `${key} — no entry`;
    cell.addEventListener('click', () => {
      switchTab('today');
      els.entryDate.value = key;
      loadEntryIntoForm(key);
    });
    els.heatmap.appendChild(cell);
  }
}

function renderTrend(){
  const ctx = els.trendCanvas.getContext('2d');
  const W = els.trendCanvas.width, H = els.trendCanvas.height;
  ctx.clearRect(0,0,W,H);

  const rated = allEntries.filter(e => typeof e.rating === 'number');
  const padding = { l: 30, r: 14, t: 16, b: 26 };
  ctx.strokeStyle = '#DCD3C5';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.l, padding.t); ctx.lineTo(padding.l, H - padding.b); ctx.lineTo(W - padding.r, H - padding.b);
  ctx.stroke();

  ctx.fillStyle = '#6B6258';
  ctx.font = '11px IBM Plex Mono, monospace';
  [1,3,5].forEach(v => {
    const y = H - padding.b - ((v-1) / 4) * (H - padding.t - padding.b);
    ctx.fillText(String(v), 8, y + 3);
    ctx.strokeStyle = '#EDE8DF';
    ctx.beginPath(); ctx.moveTo(padding.l, y); ctx.lineTo(W - padding.r, y); ctx.stroke();
  });

  if (rated.length < 2){
    ctx.fillStyle = '#6B6258';
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText('Log a few more rated days to see a trend line here.', padding.l + 10, H/2);
    return;
  }

  const windowSize = Math.min(3, rated.length);
  const rolling = rated.map((e, i) => {
    const start = Math.max(0, i - windowSize + 1);
    const slice = rated.slice(start, i+1);
    return slice.reduce((s,x) => s + x.rating, 0) / slice.length;
  });

  const plotW = W - padding.l - padding.r;
  const plotH = H - padding.t - padding.b;
  const xStep = rated.length > 1 ? plotW / (rated.length - 1) : 0;

  ctx.strokeStyle = '#A8523A';
  ctx.lineWidth = 2;
  ctx.beginPath();
  rolling.forEach((v, i) => {
    const x = padding.l + i * xStep;
    const y = H - padding.b - ((v-1) / 4) * plotH;
    if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();

  ctx.fillStyle = '#C4795C';
  rated.forEach((e, i) => {
    const x = padding.l + i * xStep;
    const y = H - padding.b - ((e.rating-1) / 4) * plotH;
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI*2); ctx.fill();
  });

  ctx.fillStyle = '#6B6258';
  ctx.font = '10.5px IBM Plex Mono, monospace';
  ctx.fillText(rated[0].date, padding.l, H - 8);
  const lastLabel = rated[rated.length-1].date;
  ctx.fillText(lastLabel, W - padding.r - ctx.measureText(lastLabel).width, H - 8);
}

function renderTriggerBars(){
  const rated = allEntries.filter(e => typeof e.rating === 'number');
  const triggerSet = new Set();
  rated.forEach(e => (e.triggers||[]).forEach(t => triggerSet.add(t)));

  els.triggerBars.innerHTML = '';
  if (triggerSet.size === 0 || rated.length === 0){
    els.triggerBars.innerHTML = '<p class="routine-empty">No trigger data yet — log a few days with triggers checked to see patterns.</p>';
    return;
  }

  const rows = Array.from(triggerSet).map(trig => {
    const withT = rated.filter(e => (e.triggers||[]).includes(trig));
    const withoutT = rated.filter(e => !(e.triggers||[]).includes(trig));
    const avgWith = withT.length ? withT.reduce((s,e)=>s+e.rating,0)/withT.length : 0;
    const avgWithout = withoutT.length ? withoutT.reduce((s,e)=>s+e.rating,0)/withoutT.length : 0;
    return { trig, avgWith, avgWithout, n: withT.length };
  }).sort((a,b) => b.avgWith - a.avgWith);

  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'tbar-row';
    row.innerHTML = `
      <span class="tbar-name">${r.trig.replace(/-/g,' ')}</span>
      <div class="tbar-track"><div class="tbar-fill with" style="width:${(r.avgWith/5)*100}%"></div></div>
      <div class="tbar-track"><div class="tbar-fill without" style="width:${(r.avgWithout/5)*100}%"></div></div>
    `;
    els.triggerBars.appendChild(row);
    const countNote = document.createElement('div');
    countNote.className = 'tbar-count';
    countNote.style.gridColumn = '1 / -1';
    countNote.textContent = `${r.n} day(s) with — avg ${r.avgWith.toFixed(1)} · avg ${r.avgWithout.toFixed(1)} without`;
    els.triggerBars.appendChild(countNote);
  });
}

/* ============================================================
   GALLERY
   ============================================================ */
function bindGallery(){
  els.compareMode.addEventListener('change', () => {
    comparePicks = [];
    els.comparePanel.hidden = true;
    els.galleryHint.textContent = els.compareMode.checked
      ? 'Pick any two photos below to compare them side by side.'
      : "Scroll through your photos in order. Toggle compare mode to pick two and view them side by side.";
    renderGallery();
  });
}

function renderGallery(){
  els.galleryStrip.innerHTML = '';
  const withPhotos = allEntries.filter(e => e.photo);
  if (withPhotos.length === 0){
    els.galleryStrip.innerHTML = '<p class="gallery-empty">No photos logged yet. Add one from the Today tab.</p>';
    return;
  }
  withPhotos.forEach(e => {
    const item = document.createElement('div');
    item.className = 'gallery-item' + (comparePicks.includes(e.date) ? ' picked' : '');
    item.innerHTML = `<img src="${e.photo}" alt="skin photo from ${e.date}">
      <div class="g-date">${e.date}</div>
      <div class="g-rating">${e.rating ? 'flare ' + e.rating : ''}</div>`;
    item.addEventListener('click', () => {
      if (els.compareMode.checked){
        if (comparePicks.includes(e.date)) comparePicks = comparePicks.filter(d => d !== e.date);
        else {
          comparePicks.push(e.date);
          if (comparePicks.length > 2) comparePicks.shift();
        }
        renderGallery();
        renderComparePanel();
      } else {
        openLightbox(e.photo, `${e.date}${e.rating ? ' — flare ' + e.rating : ''}`);
      }
    });
    els.galleryStrip.appendChild(item);
  });
}

function renderComparePanel(){
  if (comparePicks.length !== 2){ els.comparePanel.hidden = true; return; }
  els.comparePanel.hidden = false;
  const sorted = [...comparePicks].sort();
  const entries = sorted.map(d => allEntries.find(e => e.date === d));
  els.comparePanel.innerHTML = entries.map(e => `
    <div class="compare-side">
      <img src="${e.photo}" alt="skin photo from ${e.date}">
      <div class="c-meta">${e.date} — ${e.rating ? 'flare ' + e.rating : 'no rating'}${e.triggers?.length ? '<br>' + e.triggers.join(', ') : ''}</div>
    </div>
  `).join('');
}

/* ============================================================
   ROUTINE LOG
   ============================================================ */
function bindRoutine(){
  els.routineDate.value = todayStr();
  els.routineForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!els.routineProduct.value.trim()) return;
    await dbPut('routine', {
      date: els.routineDate.value,
      type: els.routineType.value,
      product: els.routineProduct.value.trim(),
      notes: els.routineNotes.value.trim()
    });
    await refreshData();
    renderRoutineTimeline();
    els.routineForm.reset();
    els.routineDate.value = todayStr();
  });
}

function renderRoutineTimeline(){
  els.routineTimeline.innerHTML = '';
  if (allRoutine.length === 0){
    els.routineTimeline.innerHTML = '<p class="routine-empty">No routine changes logged yet.</p>';
    return;
  }
  allRoutine.forEach(r => {
    const item = document.createElement('div');
    item.className = 'routine-item';
    item.innerHTML = `
      <span class="r-date">${r.date}</span><span class="r-type ${r.type}">${r.type}</span>
      <div class="r-product">${r.product}</div>
      ${r.notes ? `<div class="r-notes">${r.notes}</div>` : ''}
      <button class="r-delete">remove</button>
    `;
    item.querySelector('.r-delete').addEventListener('click', async () => {
      await dbDelete('routine', r.id);
      await refreshData();
      renderRoutineTimeline();
    });
    els.routineTimeline.appendChild(item);
  });
}

/* ============================================================
   SETTINGS — export / import / clear
   ============================================================ */
function bindSettings(){
  els.exportJson.addEventListener('click', async () => {
    const payload = { exportedAt: new Date().toISOString(), entries: allEntries, routine: allRoutine };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `skinfix-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flashStatus(els.settingsStatus, 'Backup downloaded.');
  });

  els.importJson.addEventListener('change', async () => {
    const file = els.importJson.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!confirm(`Import ${data.entries?.length || 0} entries and ${data.routine?.length || 0} routine logs? Existing entries with the same date will be overwritten.`)) return;
      for (const e of (data.entries || [])) await dbPut('entries', e);
      for (const r of (data.routine || [])){ const { id, ...rest } = r; await dbPut('routine', rest); }
      await refreshData();
      renderStats(); renderMiniHeatmap(); renderAlmanac(); renderTrend(); renderTriggerBars(); renderGallery(); renderRoutineTimeline();
      flashStatus(els.settingsStatus, 'Import complete.');
    } catch (err){
      flashStatus(els.settingsStatus, 'Could not read that file — is it a Skinfix backup?');
    }
    els.importJson.value = '';
  });

  els.clearAll.addEventListener('click', async () => {
    if (!confirm('This erases every entry, photo, and routine log in this browser. Export a backup first if you want to keep anything. Continue?')) return;
    await dbClear('entries');
    await dbClear('routine');
    await refreshData();
    await loadEntryIntoForm(els.entryDate.value);
    renderStats(); renderMiniHeatmap(); renderAlmanac(); renderTrend(); renderTriggerBars(); renderGallery(); renderRoutineTimeline();
    flashStatus(els.settingsStatus, 'All local data erased.');
  });
}

/* ============================================================
   LIGHTBOX
   ============================================================ */
function bindLightbox(){
  els.lightboxClose.addEventListener('click', closeLightbox);
  els.lightbox.addEventListener('click', (e) => { if (e.target === els.lightbox) closeLightbox(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
}
function openLightbox(src, caption){
  els.lightboxImg.src = src;
  els.lightboxCaption.textContent = caption;
  els.lightbox.hidden = false;
}
function closeLightbox(){ els.lightbox.hidden = true; }

/* ============================================================ */
init();
