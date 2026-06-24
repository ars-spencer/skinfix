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

/* ---------------- flare level anchors ---------------- */
// Concrete, physical anchors instead of vague adjectives — meant to make day-to-day
// rating consistent even when it's hard to judge in the moment.
const RATING_GUIDE = [
  { value: 1, name: 'calm', desc: 'Skin tone close to your normal baseline. No burning, stinging, or tightness. No visible bumps.' },
  { value: 2, name: 'mild', desc: 'Slight pink or warmth in your usual spots (cheeks/nose). Skin may feel a little tight or sensitive. No new bumps.' },
  { value: 3, name: 'noticeable', desc: 'Redness clearly beyond your baseline. Maybe 1–2 small bumps. Mild burning, or skin reacts more than usual to products or touch.' },
  { value: 4, name: 'flared', desc: 'Clear redness or visible swelling. Several bumps or pustules. Burning/stinging that\'s hard to ignore.' },
  { value: 5, name: 'severe', desc: 'Widespread redness or heat across the area. Multiple inflamed bumps. Significant discomfort or pain.' },
];

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
let currentSkincare = new Set();
let currentRating = null;
let currentPhotoLeft = null;
let currentPhotoRight = null;
let almanacMonthCursor = new Date(); // first of month being viewed
let comparePicks = [];

// Backward-compatible photo reader: older entries stored a single `photo` field.
function getEntryPhotos(entry){
  if (!entry) return { left: null, right: null };
  if (entry.photos) return { left: entry.photos.left || null, right: entry.photos.right || null };
  return { left: entry.photo || null, right: null };
}

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
  renderSummary();
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
  els.dialHint = document.getElementById('dial-hint');
  els.ratingGuideToggle = document.getElementById('rating-guide-toggle');
  els.ratingGuide = document.getElementById('rating-guide');
  els.ratingValue = document.getElementById('rating-value');
  els.chipRow = document.getElementById('trigger-chips');
  els.customTriggerInput = document.getElementById('custom-trigger-input');
  els.addCustomTrigger = document.getElementById('add-custom-trigger');
  els.skincareChipRow = document.getElementById('skincare-chips');
  els.customSkincareInput = document.getElementById('custom-skincare-input');
  els.addCustomSkincare = document.getElementById('add-custom-skincare');
  els.entryNotes = document.getElementById('entry-notes');
  els.entryPhotoLeft = document.getElementById('entry-photo-left');
  els.entryPhotoRight = document.getElementById('entry-photo-right');
  els.photoPreviewWrapLeft = document.getElementById('photo-preview-wrap-left');
  els.photoPreviewWrapRight = document.getElementById('photo-preview-wrap-right');
  els.photoPreviewLeft = document.getElementById('photo-preview-left');
  els.photoPreviewRight = document.getElementById('photo-preview-right');
  els.photoRemoveLeft = document.getElementById('photo-remove-left');
  els.photoRemoveRight = document.getElementById('photo-remove-right');
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
  els.skincareBars = document.getElementById('skincare-bars');
  els.summaryInsight = document.getElementById('summary-insight');

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
  if (name === 'almanac'){ renderAlmanac(); renderTrend(); }
  if (name === 'summary'){ renderSummary(); }
  if (name === 'gallery'){ renderGallery(); }
  if (name === 'routine'){ renderRoutineTimeline(); }
}

/* ============================================================
   TODAY / ENTRY FORM
   ============================================================ */
function bindTodayForm(){
  renderRatingGuide();
  els.ratingGuideToggle.addEventListener('click', () => {
    const open = els.ratingGuide.hidden;
    els.ratingGuide.hidden = !open;
    els.ratingGuideToggle.setAttribute('aria-expanded', String(open));
    els.ratingGuideToggle.textContent = open ? 'hide the guide' : "what counts as each number?";
  });

  els.dialRow.querySelectorAll('.dial').forEach(btn => {
    btn.addEventListener('click', () => {
      currentRating = Number(btn.dataset.value);
      els.ratingValue.value = currentRating;
      els.dialRow.querySelectorAll('.dial').forEach(b => b.classList.toggle('selected', b === btn));
      updateDialHint(currentRating);
    });
  });

  els.chipRow.querySelectorAll('.chip').forEach(chip => bindChip(chip));

  els.addCustomTrigger.addEventListener('click', () => addCustomTriggerChip());
  els.customTriggerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter'){ e.preventDefault(); addCustomTriggerChip(); }
  });

  els.skincareChipRow.querySelectorAll('.chip').forEach(chip => bindSkincareChip(chip));

  els.addCustomSkincare.addEventListener('click', () => addCustomSkincareChip());
  els.customSkincareInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter'){ e.preventDefault(); addCustomSkincareChip(); }
  });

  bindPhotoSlot('left');
  bindPhotoSlot('right');

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
    renderStats(); renderMiniHeatmap(); renderAlmanac(); renderTrend(); renderSummary(); renderGallery();
    flashStatus(els.saveStatus, 'Entry deleted.');
  });
}

function bindPhotoSlot(side){
  const input = side === 'left' ? els.entryPhotoLeft : els.entryPhotoRight;
  const removeBtn = side === 'left' ? els.photoRemoveLeft : els.photoRemoveRight;
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const dataUrl = await fileToCompressedDataUrl(file);
    if (side === 'left') currentPhotoLeft = dataUrl; else currentPhotoRight = dataUrl;
    showPhotoPreview(side, dataUrl);
  });
  removeBtn.addEventListener('click', () => {
    if (side === 'left') currentPhotoLeft = null; else currentPhotoRight = null;
    input.value = '';
    (side === 'left' ? els.photoPreviewWrapLeft : els.photoPreviewWrapRight).hidden = true;
  });
}

function renderRatingGuide(){
  els.ratingGuide.innerHTML = RATING_GUIDE.map(g => `
    <div class="rg-row">
      <span class="rg-num">${g.value}</span>
      <span>
        <span class="rg-name">${g.name}</span>
        <span class="rg-desc">${g.desc}</span>
      </span>
    </div>
  `).join('');
}

function updateDialHint(rating){
  if (!rating){ els.dialHint.textContent = "Tap a number, or check the guide if you're not sure which one fits."; return; }
  const g = RATING_GUIDE.find(r => r.value === rating);
  els.dialHint.textContent = g ? `${g.value} · ${g.name} — ${g.desc}` : '';
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

function bindSkincareChip(chip){
  chip.addEventListener('click', () => {
    const key = chip.dataset.skincare;
    if (currentSkincare.has(key)){ currentSkincare.delete(key); chip.classList.remove('selected'); }
    else { currentSkincare.add(key); chip.classList.add('selected'); }
  });
}

function addCustomSkincareChip(){
  const raw = els.customSkincareInput.value.trim();
  if (!raw) return;
  const key = raw.toLowerCase().replace(/\s+/g, '-');
  if (!els.skincareChipRow.querySelector(`[data-skincare="${key}"]`)){
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip selected';
    chip.dataset.skincare = key;
    chip.textContent = raw;
    els.skincareChipRow.appendChild(chip);
    bindSkincareChip(chip);
  }
  currentSkincare.add(key);
  els.skincareChipRow.querySelector(`[data-skincare="${key}"]`).classList.add('selected');
  els.customSkincareInput.value = '';
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

function showPhotoPreview(side, dataUrl){
  if (side === 'left'){ els.photoPreviewLeft.src = dataUrl; els.photoPreviewWrapLeft.hidden = false; }
  else { els.photoPreviewRight.src = dataUrl; els.photoPreviewWrapRight.hidden = false; }
}

async function loadEntryIntoForm(date){
  const entry = await dbGet('entries', date);
  currentTriggers = new Set();
  currentSkincare = new Set();
  currentRating = null;
  currentPhotoLeft = null;
  currentPhotoRight = null;

  els.entryFormTitle.textContent = date === todayStr() ? 'Log today' : `Log for ${date}`;
  els.entryNotes.value = '';
  els.entryPhotoLeft.value = '';
  els.entryPhotoRight.value = '';
  els.photoPreviewWrapLeft.hidden = true;
  els.photoPreviewWrapRight.hidden = true;
  els.ratingValue.value = '';
  els.dialRow.querySelectorAll('.dial').forEach(b => b.classList.remove('selected'));
  updateDialHint(null);
  els.chipRow.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
  els.skincareChipRow.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
  els.entryDelete.hidden = true;

  if (entry){
    currentRating = entry.rating || null;
    const photos = getEntryPhotos(entry);
    currentPhotoLeft = photos.left;
    currentPhotoRight = photos.right;
    currentTriggers = new Set(entry.triggers || []);
    currentSkincare = new Set(entry.skincare || []);
    els.entryNotes.value = entry.notes || '';
    if (currentRating){
      els.ratingValue.value = currentRating;
      const btn = els.dialRow.querySelector(`[data-value="${currentRating}"]`);
      if (btn) btn.classList.add('selected');
      updateDialHint(currentRating);
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
    currentSkincare.forEach(key => {
      let chip = els.skincareChipRow.querySelector(`[data-skincare="${key}"]`);
      if (!chip){
        chip = document.createElement('button');
        chip.type = 'button'; chip.className = 'chip'; chip.dataset.skincare = key; chip.textContent = key.replace(/-/g,' ');
        els.skincareChipRow.appendChild(chip);
        bindSkincareChip(chip);
      }
      chip.classList.add('selected');
    });
    if (currentPhotoLeft) showPhotoPreview('left', currentPhotoLeft);
    if (currentPhotoRight) showPhotoPreview('right', currentPhotoRight);
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
    skincare: Array.from(currentSkincare),
    notes: els.entryNotes.value.trim(),
    photos: { left: currentPhotoLeft, right: currentPhotoRight },
    updatedAt: new Date().toISOString()
  };
  await dbPut('entries', entry);
  await refreshData();
  els.entryDelete.hidden = false;
  flashStatus(els.saveStatus, `Saved ${date}.`);
  renderStats(); renderMiniHeatmap(); renderAlmanac(); renderTrend(); renderSummary(); renderGallery();
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

  // mark days a routine change was logged, so shifts in the line can be eyeballed against them
  const seenRoutineDates = new Set();
  allRoutine.forEach(r => {
    if (seenRoutineDates.has(r.date)) return;
    seenRoutineDates.add(r.date);
    let idx = rated.findIndex(e => e.date >= r.date);
    if (idx === -1) idx = rated.length - 1;
    const x = padding.l + idx * xStep;
    ctx.save();
    ctx.strokeStyle = '#C7A368';
    ctx.lineWidth = 1;
    ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(x, padding.t); ctx.lineTo(x, H - padding.b); ctx.stroke();
    ctx.restore();
  });

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

/* ============================================================
   SUMMARY — trigger patterns, what helped, and a plain-language insight
   ============================================================ */

// shared correlation calc: for each tag found under `key` (triggers or skincare),
// average flare level on days it was present vs. absent.
function correlationRows(rated, key){
  const set = new Set();
  rated.forEach(e => (e[key]||[]).forEach(t => set.add(t)));
  return Array.from(set).map(item => {
    const withIt = rated.filter(e => (e[key]||[]).includes(item));
    const withoutIt = rated.filter(e => !(e[key]||[]).includes(item));
    const avgWith = withIt.length ? withIt.reduce((s,e)=>s+e.rating,0)/withIt.length : 0;
    const avgWithout = withoutIt.length ? withoutIt.reduce((s,e)=>s+e.rating,0)/withoutIt.length : 0;
    return { item, avgWith, avgWithout, n: withIt.length };
  });
}

function renderBarRows(container, rows, emptyMsg){
  container.innerHTML = '';
  if (rows.length === 0){
    container.innerHTML = `<p class="routine-empty">${emptyMsg}</p>`;
    return;
  }
  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'tbar-row';
    row.innerHTML = `
      <span class="tbar-name">${r.item.replace(/-/g,' ')}</span>
      <div class="tbar-track"><div class="tbar-fill with" style="width:${(r.avgWith/5)*100}%"></div></div>
      <div class="tbar-track"><div class="tbar-fill without" style="width:${(r.avgWithout/5)*100}%"></div></div>
    `;
    container.appendChild(row);
    const countNote = document.createElement('div');
    countNote.className = 'tbar-count';
    countNote.textContent = `${r.n} day(s) with — avg ${r.avgWith.toFixed(1)} · avg ${r.avgWithout.toFixed(1)} without`;
    container.appendChild(countNote);
  });
}

function renderTriggerBars(){
  const rated = allEntries.filter(e => typeof e.rating === 'number');
  const rows = correlationRows(rated, 'triggers').sort((a,b) => b.avgWith - a.avgWith);
  renderBarRows(els.triggerBars, rows, 'No trigger data yet — log a few days with triggers checked to see patterns.');
}

function renderSkincareBars(){
  const rated = allEntries.filter(e => typeof e.rating === 'number');
  const rows = correlationRows(rated, 'skincare').sort((a,b) => a.avgWith - b.avgWith);
  renderBarRows(els.skincareBars, rows, 'No skincare data yet — log what you used on a few rated days to see patterns.');
}

function renderSummaryInsight(){
  const rated = allEntries.filter(e => typeof e.rating === 'number').sort((a,b) => a.date < b.date ? -1 : 1);
  const last14Cutoff = fmtDate(addDays(new Date(), -13));
  const prev14Cutoff = fmtDate(addDays(new Date(), -27));
  const last14 = rated.filter(e => e.date >= last14Cutoff);
  const prev14 = rated.filter(e => e.date >= prev14Cutoff && e.date < last14Cutoff);

  let lines = [];

  if (last14.length < 3){
    els.summaryInsight.textContent = "Keep logging — once you've got a couple of weeks of rated days in, this will start telling you something.";
    return;
  }

  const avgLast = last14.reduce((s,e)=>s+e.rating,0) / last14.length;
  if (prev14.length >= 3){
    const avgPrev = prev14.reduce((s,e)=>s+e.rating,0) / prev14.length;
    const diff = avgLast - avgPrev;
    let trendWord = 'holding pretty steady';
    if (diff <= -0.4) trendWord = 'trending calmer';
    else if (diff >= 0.4) trendWord = 'trending more flared';
    lines.push(`Over the last 14 days your average flare was ${avgLast.toFixed(1)}, vs. ${avgPrev.toFixed(1)} the 14 days before that — ${trendWord}.`);
  } else {
    lines.push(`Your average flare over the last 14 days is ${avgLast.toFixed(1)}.`);
  }

  const trigRows = correlationRows(rated, 'triggers').filter(r => r.n >= 3).sort((a,b) => b.avgWith - a.avgWith);
  if (trigRows.length){
    const top = trigRows[0];
    lines.push(`The trigger most associated with worse days so far is ${top.item.replace(/-/g,' ')} (avg ${top.avgWith.toFixed(1)} vs ${top.avgWithout.toFixed(1)} without).`);
  }

  const skinRows = correlationRows(rated, 'skincare').filter(r => r.n >= 3).sort((a,b) => a.avgWith - b.avgWith);
  if (skinRows.length){
    const top = skinRows[0];
    lines.push(`Days using ${top.item.replace(/-/g,' ')} have run calmer on average (${top.avgWith.toFixed(1)} vs ${top.avgWithout.toFixed(1)} without) — worth watching, not proof.`);
  }

  els.summaryInsight.textContent = lines.join(' ');
}

function renderSummary(){
  renderSummaryInsight();
  renderTriggerBars();
  renderSkincareBars();
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
  const withPhotos = allEntries.filter(e => { const p = getEntryPhotos(e); return p.left || p.right; });
  if (withPhotos.length === 0){
    els.galleryStrip.innerHTML = '<p class="gallery-empty">No photos logged yet. Add one from the Today tab.</p>';
    return;
  }
  withPhotos.forEach(e => {
    const { left, right } = getEntryPhotos(e);
    const item = document.createElement('div');
    item.className = 'gallery-item' + (comparePicks.includes(e.date) ? ' picked' : '');

    const photosWrap = document.createElement('div');
    photosWrap.className = 'g-photos';
    photosWrap.appendChild(makeThumb(left, `left side, ${e.date}`));
    photosWrap.appendChild(makeThumb(right, `right side, ${e.date}`));
    item.appendChild(photosWrap);

    const dateEl = document.createElement('div');
    dateEl.className = 'g-date';
    dateEl.textContent = e.date;
    item.appendChild(dateEl);

    const ratingEl = document.createElement('div');
    ratingEl.className = 'g-rating';
    ratingEl.textContent = e.rating ? 'flare ' + e.rating : '';
    item.appendChild(ratingEl);

    if (els.compareMode.checked){
      item.addEventListener('click', () => {
        if (comparePicks.includes(e.date)) comparePicks = comparePicks.filter(d => d !== e.date);
        else {
          comparePicks.push(e.date);
          if (comparePicks.length > 2) comparePicks.shift();
        }
        renderGallery();
        renderComparePanel();
      });
    }
    els.galleryStrip.appendChild(item);
  });
}

function makeThumb(src, label){
  if (!src){
    const empty = document.createElement('div');
    empty.className = 'g-thumb-empty';
    empty.textContent = '—';
    return empty;
  }
  const img = document.createElement('img');
  img.className = 'g-thumb';
  img.src = src;
  img.alt = label;
  if (!els.compareMode.checked){
    img.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(src, label); });
  }
  return img;
}

function renderComparePanel(){
  if (comparePicks.length !== 2){ els.comparePanel.hidden = true; return; }
  els.comparePanel.hidden = false;
  const sorted = [...comparePicks].sort();
  const entries = sorted.map(d => allEntries.find(e => e.date === d));
  const photoPairs = entries.map(e => getEntryPhotos(e));

  const cell = (src, label) => src
    ? `<img src="${src}" alt="${label}">`
    : `<div class="cg-empty">no photo</div>`;

  els.comparePanel.innerHTML = `
    <div class="compare-grid">
      <span class="cg-corner"></span>
      <span class="cg-col-label">${entries[0].date}</span>
      <span class="cg-col-label">${entries[1].date}</span>

      <span class="cg-row-label">left</span>
      ${cell(photoPairs[0].left, 'left side, ' + entries[0].date)}
      ${cell(photoPairs[1].left, 'left side, ' + entries[1].date)}

      <span class="cg-row-label">right</span>
      ${cell(photoPairs[0].right, 'right side, ' + entries[0].date)}
      ${cell(photoPairs[1].right, 'right side, ' + entries[1].date)}
    </div>
    <div class="compare-meta">
      ${entries[0].date}: ${entries[0].rating ? 'flare ' + entries[0].rating : 'no rating'}${entries[0].triggers?.length ? ' · ' + entries[0].triggers.join(', ') : ''}
      &nbsp;vs.&nbsp;
      ${entries[1].date}: ${entries[1].rating ? 'flare ' + entries[1].rating : 'no rating'}${entries[1].triggers?.length ? ' · ' + entries[1].triggers.join(', ') : ''}
    </div>
  `;
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
      renderStats(); renderMiniHeatmap(); renderAlmanac(); renderTrend(); renderSummary(); renderGallery(); renderRoutineTimeline();
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
    renderStats(); renderMiniHeatmap(); renderAlmanac(); renderTrend(); renderSummary(); renderGallery(); renderRoutineTimeline();
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
