/*
 * Sport- und Balance-Tagebuch
 * Statische Web-App ohne Abhängigkeiten. Läuft auf GitHub Pages oder lokal.
 *
 * Persistenz:
 *  1. Immer: localStorage des Browsers (pro Origin).
 *  2. Optional: lokale JSON-Datei über die File System Access API
 *     (nur Chromium-Browser wie Chrome, Edge, Opera).
 *  3. Immer verfügbar: Export/Import als JSON, Export als CSV.
 *
 * Zusammenführen von Datenständen erfolgt pro Tag und pro Bereich (Sport, Balance)
 * nach dem Zeitstempel updatedAt. Gelöschte Einträge bleiben als Löschmarker
 * erhalten, damit sie beim Zusammenführen nicht wieder auftauchen.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Konstanten
  // ---------------------------------------------------------------------------
  const APP_ID = 'sport-balance-tagebuch';
  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = APP_ID + '.v1';
  const IDB_NAME = APP_ID;
  const IDB_STORE = 'handles';
  const IDB_KEY = 'datafile';
  const DEFAULT_FILE_NAME = 'sport-balance-daten.json';
  const SCALE_MAX = 10;
  const DEFAULT_VALUE = 10;
  const FIELDS = ['sport', 'mood', 'sucht'];
  const SUCHT_MIN = 1;
  const SUCHT_MAX = 10;

  // Richtung jeder Achse in SVG-Koordinaten (y wächst nach unten).
  // Die Schlüssel bleiben intern fest, angezeigt wird der vom Nutzer gewählte Name
  // oder der Standardname. Werte hängen damit an der Position, nicht am Namen.
  const AREAS = [
    { key: 'koerper', defaultLabel: 'Körper', position: 'Oben', dir: [0, -1] },
    { key: 'leistung', defaultLabel: 'Leistung, Arbeit', position: 'Rechts', dir: [1, 0] },
    { key: 'kontakt', defaultLabel: 'Kontakt', position: 'Unten', dir: [0, 1] },
    { key: 'sinn', defaultLabel: 'Sinn', position: 'Links', dir: [-1, 0] }
  ];
  const LABEL_MAX_LENGTH = 30;

  const SERIES = ['ist', 'soll'];
  const SERIES_LABEL = { ist: 'Ist', soll: 'Soll' };

  // Geometrie der großen Raute (viewBox 0 0 820 580)
  const GEO = { cx: 410, cy: 310, r: 200 };

  // Unterbegriffe wie in der Vorlage
  // owner: zu welcher Spitze die Begriffe gehören. Wird eine Spitze umbenannt,
  // werden ihre Unterbegriffe ausgeblendet, weil sie dann nicht mehr passen.
  const SUB_ITEMS = [
    { owner: 'koerper', x: 230, y: 40, lines: ['Gesundheit', 'Ernährung', 'Erholung'] },
    { owner: 'koerper', x: 490, y: 40, lines: ['Entspannung', 'Fitness', 'Lebenserwartung'] },
    { owner: 'sinn', x: 60, y: 186, lines: ['Philosophie', 'Religion', 'Liebe'] },
    { owner: 'leistung', x: 640, y: 186, lines: ['Schöner Beruf', 'Geld', 'Erfolg'] },
    { owner: 'sinn', x: 24, y: 392, lines: ['Erfüllung', 'Zukunftsfragen', 'Selbstverwirklichung'] },
    { owner: 'leistung', x: 640, y: 392, lines: ['Karriere', 'Wohlstand', 'Vermögen'] },
    { owner: 'kontakt', x: 240, y: 540, lines: ['Freunde', 'Familie'] },
    { owner: 'kontakt', x: 500, y: 540, lines: ['Zuwendung', 'Anerkennung'] }
  ];

  // Beschriftungskästen der Spitzen. anchor: 'center' (oben/unten), 'left' (Kasten wächst nach
  // rechts), 'right' (Kasten wächst nach links). maxW: breitester Kasten ohne Überlappung,
  // maxWAlone: wenn die Unterbegriffe daneben ausgeblendet sind.
  const VIEW_W = 820;
  const LABEL_FONT = 22;
  const LABEL_FONT_MIN = 13;
  const LABEL_PAD = 28;
  const LABEL_BOXES = {
    koerper: { anchor: 'center', ax: GEO.cx, y: 52, h: 40, maxW: 168, maxWAlone: 420 },
    leistung: { anchor: 'left', ax: 622, y: GEO.cy - 20, h: 40, maxW: VIEW_W - 622 - 4, maxWAlone: VIEW_W - 622 - 4 },
    kontakt: { anchor: 'center', ax: GEO.cx, y: 528, h: 40, maxW: 168, maxWAlone: 420 },
    sinn: { anchor: 'right', ax: 198, y: GEO.cy - 20, h: 40, maxW: 194, maxWAlone: 194 }
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const dom = {
    storageStatus: $('storage-status'),
    btnFileNew: $('btn-file-new'),
    btnFileOpen: $('btn-file-open'),
    btnFileReconnect: $('btn-file-reconnect'),
    btnFileDisconnect: $('btn-file-disconnect'),
    btnExportJson: $('btn-export-json'),
    btnImportJson: $('btn-import-json'),
    btnExportCsv: $('btn-export-csv'),
    importInput: $('import-input'),
    dateInput: $('date-input'),
    btnPrev: $('btn-prev'),
    btnNext: $('btn-next'),
    btnToday: $('btn-today'),
    weekday: $('weekday'),
    sportText: $('sport-text'),
    sportState: $('sport-state'),
    btnSportSave: $('btn-sport-save'),
    btnSportDelete: $('btn-sport-delete'),
    moodState: $('mood-state'),
    prefillNote: $('prefill-note'),
    raute: $('raute'),
    moodInputsBody: $('mood-inputs-body'),
    moodNote: $('mood-note'),
    btnMoodSave: $('btn-mood-save'),
    btnMoodDelete: $('btn-mood-delete'),
    filterMonth: $('filter-month'),
    filterText: $('filter-text'),
    tableSummary: $('table-summary'),
    overviewBody: $('overview-body'),
    overviewHead: $('overview-head'),
    labelGrid: $('label-grid'),
    btnLabelsSave: $('btn-labels-save'),
    btnLabelsReset: $('btn-labels-reset'),
    toast: $('toast'),
    iosHint: $('ios-hint'),
    storageBadge: $('storage-badge'),
    importDialog: $('import-dialog'),
    importSummary: $('import-summary'),
    importStats: $('import-stats'),
    btnImportAdd: $('btn-import-add'),
    btnImportMerge: $('btn-import-merge'),
    btnImportCancel: $('btn-import-cancel'),
    suchtSelect: $('sucht-select'),
    suchtState: $('sucht-state'),
    suchtPreview: $('sucht-preview'),
    sportPreview: $('sport-preview'),
    moodPreview: $('mood-preview'),
    overviewPreview: $('overview-preview'),
    moodPanel: $('mood-panel'),
    btnIosHintClose: $('btn-ios-hint-close')
  };

  // ---------------------------------------------------------------------------
  // Datum (immer lokale Zeit, nie UTC, sonst springt das Datum nachts um)
  // ---------------------------------------------------------------------------
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const pad = (n) => String(n).padStart(2, '0');
  const toDateStr = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayStr = () => toDateStr(new Date());
  function parseDateStr(s) {
    const parts = s.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  function isValidDateStr(s) {
    return typeof s === 'string' && DATE_RE.test(s) && toDateStr(parseDateStr(s)) === s;
  }
  function addDays(s, n) {
    const d = parseDateStr(s);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }
  const fmtWeekday = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });
  const fmtRowDate = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtDate = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtMonth = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
  const fmtTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // ---------------------------------------------------------------------------
  // Datenmodell
  // ---------------------------------------------------------------------------
  // {
  //   app, version,
  //   settings: { labels: { koerper?, leistung?, kontakt?, sinn? }, updatedAt },   (optional)
  //   entries: {
  //     "YYYY-MM-DD": {
  //       sport: { text, updatedAt } | { deleted: true, updatedAt },
  //       mood:  { ist: {koerper, leistung, kontakt, sinn}, soll: {...}, notiz, updatedAt }
  //              | { deleted: true, updatedAt }
  //     }
  //   }
  // }
  function emptyData() {
    return { app: APP_ID, version: SCHEMA_VERSION, entries: {} };
  }

  function clampValue(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return null;
    return Math.min(SCALE_MAX, Math.max(0, n));
  }

  function normValues(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('Werte fehlen');
    const out = {};
    for (const a of AREAS) {
      const v = clampValue(obj[a.key]);
      if (v === null) throw new Error('Wert für ' + a.key + ' ungültig');
      out[a.key] = v;
    }
    return out;
  }

  function normTimestamp(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** Prüft und bereinigt eingelesene Daten. Ungültige Einzeleinträge werden übersprungen. */
  function normalizeData(raw) {
    if (!raw || typeof raw !== 'object' || !raw.entries || typeof raw.entries !== 'object') {
      throw new Error('Unbekanntes Format: Feld "entries" fehlt.');
    }
    if (raw.app && raw.app !== APP_ID) {
      throw new Error('Datei gehört nicht zu dieser App (app = "' + raw.app + '").');
    }
    if (Number(raw.version) > SCHEMA_VERSION) {
      throw new Error('Datei stammt aus einer neueren Version (' + raw.version + ').');
    }
    const out = emptyData();
    const settings = normSettings(raw.settings);
    if (settings) out.settings = settings;
    let skipped = 0;
    for (const date of Object.keys(raw.entries)) {
      const e = raw.entries[date];
      if (!isValidDateStr(date) || !e || typeof e !== 'object') { skipped++; continue; }
      const entry = {};
      try {
        if (e.sport && typeof e.sport === 'object') {
          const ts = normTimestamp(e.sport.updatedAt);
          entry.sport = e.sport.deleted
            ? { deleted: true, updatedAt: ts }
            : { text: String(e.sport.text == null ? '' : e.sport.text), updatedAt: ts };
        }
        if (e.mood && typeof e.mood === 'object') {
          const ts = normTimestamp(e.mood.updatedAt);
          entry.mood = e.mood.deleted
            ? { deleted: true, updatedAt: ts }
            : {
                ist: normValues(e.mood.ist),
                soll: normValues(e.mood.soll),
                notiz: String(e.mood.notiz == null ? '' : e.mood.notiz),
                updatedAt: ts
              };
        }
        if (e.sucht && typeof e.sucht === 'object') {
          const ts = normTimestamp(e.sucht.updatedAt);
          if (e.sucht.deleted) {
            entry.sucht = { deleted: true, updatedAt: ts };
          } else {
            const v = Math.round(Number(e.sucht.value));
            if (!Number.isFinite(v) || v < SUCHT_MIN || v > SUCHT_MAX) throw new Error('Sucht-Wert ungültig');
            entry.sucht = { value: v, updatedAt: ts };
          }
        }
      } catch (err) {
        skipped++;
        continue;
      }
      if (FIELDS.some((f) => entry[f])) out.entries[date] = entry;
    }
    return { data: out, skipped: skipped };
  }

  function cleanLabel(v) {
    if (typeof v !== 'string') return '';
    return v.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX_LENGTH);
  }

  function normSettings(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const labels = {};
    const rawLabels = raw.labels && typeof raw.labels === 'object' ? raw.labels : {};
    AREAS.forEach((a) => {
      const l = cleanLabel(rawLabels[a.key]);
      if (l && l !== a.defaultLabel) labels[a.key] = l;
    });
    return { labels: labels, updatedAt: normTimestamp(raw.updatedAt) };
  }

  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    return b.updatedAt > a.updatedAt ? b : a;
  }

  /** Führt zwei Datenstände zusammen. Pro Tag und Bereich gewinnt der neuere Zeitstempel. */
  function mergeData(base, incoming) {
    const out = emptyData();
    const dates = new Set(Object.keys(base.entries).concat(Object.keys(incoming.entries)));
    dates.forEach((d) => {
      const a = base.entries[d] || {};
      const b = incoming.entries[d] || {};
      const e = {};
      FIELDS.forEach((f) => {
        const v = newer(a[f], b[f]);
        if (v) e[f] = v;
      });
      if (FIELDS.some((f) => e[f])) out.entries[d] = e;
    });
    const settings = newer(base.settings, incoming.settings);
    if (settings) out.settings = settings;
    return out;
  }

  /**
   * Übernimmt aus incoming nur, was in base fehlt. Vorhandene Einträge in base
   * (auch gelöschte) bleiben unverändert. Gilt pro Tag und Bereich.
   */
  function addMissing(base, incoming) {
    const out = mergeData(base, emptyData()); // Kopie von base
    Object.keys(incoming.entries).forEach((d) => {
      const b = incoming.entries[d];
      FIELDS.forEach((f) => {
        if (!b[f]) return;
        const a = out.entries[d];
        if (a && a[f]) return;
        (out.entries[d] || (out.entries[d] = {}))[f] = b[f];
      });
    });
    if (!out.settings && incoming.settings) out.settings = incoming.settings;
    return out;
  }

  function contentKey(v) {
    if (!v || v.deleted) return null;
    const c = Object.assign({}, v);
    delete c.updatedAt;
    return JSON.stringify(c);
  }

  /** Zählt für den Import-Dialog, was neu, gleich oder abweichend ist. */
  function analyzeImport(base, incoming) {
    const r = { days: 0, neu: 0, gleich: 0, abweichend: 0, abweichendNeuer: 0 };
    Object.keys(incoming.entries).forEach((d) => {
      const b = incoming.entries[d];
      let any = false;
      FIELDS.forEach((f) => {
        const kb = contentKey(b[f]);
        if (kb === null) return;
        any = true;
        const a = base.entries[d] && base.entries[d][f];
        if (!a) { r.neu++; return; }
        if (contentKey(a) === kb) { r.gleich++; return; }
        r.abweichend++;
        if (b[f].updatedAt > a.updatedAt) r.abweichendNeuer++;
      });
      if (any) r.days++;
    });
    return r;
  }

  function activeSucht(date) {
    const e = data.entries[date];
    return e && e.sucht && !e.sucht.deleted ? e.sucht : null;
  }

  function areaLabel(key) {
    const l = data.settings && data.settings.labels && data.settings.labels[key];
    return l || AREAS.find((a) => a.key === key).defaultLabel;
  }

  function isDefaultLabel(key) {
    return !(data.settings && data.settings.labels && data.settings.labels[key]);
  }

  function activeSport(date) {
    const e = data.entries[date];
    return e && e.sport && !e.sport.deleted && e.sport.text.trim() ? e.sport : null;
  }

  function activeMood(date) {
    const e = data.entries[date];
    return e && e.mood && !e.mood.deleted ? e.mood : null;
  }

  function moodDistance(m) {
    return AREAS.reduce((sum, a) => sum + Math.abs(m.ist[a.key] - m.soll[a.key]), 0);
  }

  function setField(date, field, value) {
    const e = data.entries[date] || (data.entries[date] = {});
    e[field] = value;
  }

  function serialize() {
    return JSON.stringify(
      {
        app: APP_ID,
        version: SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        settings: data.settings || undefined,
        entries: sortedEntries()
      },
      null,
      2
    ) + '\n';
  }

  function sortedEntries() {
    const out = {};
    Object.keys(data.entries).sort().forEach((d) => { out[d] = data.entries[d]; });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Zustand
  // ---------------------------------------------------------------------------
  let data = emptyData();
  let currentDate = todayStr();
  let editSeries = 'ist';
  let draft = null;           // { ist, soll, notiz } der aktuell angezeigten Raute
  let prefillFrom = null;     // Datum, aus dem die Raute vorbelegt wurde
  let sportDirty = false;
  let moodDirty = false;

  // Datei
  const fsSupported = (function () {
    try {
      return 'showSaveFilePicker' in window && 'showOpenFilePicker' in window && window.self === window.top;
    } catch (e) {
      return false;
    }
  })();
  let fileHandle = null;      // verbundene Datei mit Schreibrecht
  let pendingHandle = null;   // gemerkte Datei, Berechtigung noch nicht erteilt
  let fileError = null;
  let lastFileWrite = null;
  let writeChain = Promise.resolve();

  // ---------------------------------------------------------------------------
  // localStorage
  // ---------------------------------------------------------------------------
  function loadLocal() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      showToast('Browser-Speicher nicht verfügbar: ' + err.message, true);
      return emptyData();
    }
    if (!raw) return emptyData();
    try {
      return normalizeData(JSON.parse(raw)).data;
    } catch (err) {
      // Defekten Stand sichern, bevor er überschrieben werden könnte.
      try { localStorage.setItem(STORAGE_KEY + '.defekt-' + Date.now(), raw); } catch (e) { /* ignorieren */ }
      showToast('Lokale Daten waren beschädigt und wurden gesichert: ' + err.message, true);
      return emptyData();
    }
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      showToast('Speichern im Browser fehlgeschlagen: ' + err.message, true);
      return false;
    }
  }

  function persist() {
    saveLocal();
    queueFileWrite();
    requestPersistentStorage();
  }

  // Bittet den Browser, die Daten nicht bei Speicherknappheit zu löschen.
  // Nicht garantiert: der Browser darf ablehnen, das Ergebnis wird nur protokolliert.
  let persistRequested = false;
  function requestPersistentStorage() {
    if (persistRequested || !navigator.storage || typeof navigator.storage.persist !== 'function') return;
    persistRequested = true;
    navigator.storage.persisted()
      .then((already) => (already ? true : navigator.storage.persist()))
      .then((granted) => console.info('Dauerhafter Speicher: ' + (granted ? 'gewährt' : 'nicht gewährt')))
      .catch(() => { /* ignorieren */ });
  }

  // ---------------------------------------------------------------------------
  // iPhone / iPad
  // ---------------------------------------------------------------------------
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_STANDALONE = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const LAST_EXPORT_KEY = STORAGE_KEY + '.letzterExport';
  const IOS_HINT_KEY = STORAGE_KEY + '.iosHinweisAus';

  function getLastExport() {
    try { return Number(localStorage.getItem(LAST_EXPORT_KEY)) || 0; } catch (e) { return 0; }
  }
  function setLastExport() {
    try { localStorage.setItem(LAST_EXPORT_KEY, String(Date.now())); } catch (e) { /* ignorieren */ }
    updateStorageStatus();
  }

  function renderIosHint() {
    let off = false;
    try { off = localStorage.getItem(IOS_HINT_KEY) === '1'; } catch (e) { /* ignorieren */ }
    dom.iosHint.hidden = !IS_IOS || IS_STANDALONE || off;
  }

  // ---------------------------------------------------------------------------
  // Datei (File System Access API)
  // ---------------------------------------------------------------------------
  function queueFileWrite() {
    if (!fileHandle) return writeChain;
    const handle = fileHandle;
    const text = serialize();
    writeChain = writeChain
      .then(async () => {
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        lastFileWrite = new Date();
        fileError = null;
      })
      .catch((err) => {
        fileError = err;
        fileHandle = null;
        pendingHandle = handle;
        showToast('Schreiben in die Datei fehlgeschlagen: ' + err.message + '. Daten sind weiterhin im Browser gespeichert.', true);
      })
      .then(updateStorageStatus);
    return writeChain;
  }

  async function hasPermission(handle, ask) {
    const opts = { mode: 'readwrite' };
    if (typeof handle.queryPermission === 'function' && (await handle.queryPermission(opts)) === 'granted') return true;
    if (ask && typeof handle.requestPermission === 'function' && (await handle.requestPermission(opts)) === 'granted') return true;
    return false;
  }

  /** Liest die Datei, führt sie mit dem aktuellen Stand zusammen und schreibt das Ergebnis zurück. */
  async function attachHandle(handle) {
    const file = await handle.getFile();
    const text = await file.text();
    let info = '';
    if (text.trim()) {
      let parsed;
      try {
        parsed = normalizeData(JSON.parse(text));
      } catch (err) {
        throw new Error('"' + handle.name + '" ist keine gültige Datei dieser App (' + err.message + '). Die Datei wurde nicht verändert.');
      }
      data = mergeData(data, parsed.data);
      info = parsed.skipped ? ' ' + parsed.skipped + ' ungültige Einträge übersprungen.' : '';
    }
    fileHandle = handle;
    pendingHandle = null;
    fileError = null;
    try { await idbSet(handle); } catch (e) { /* Merken ist optional */ }
    saveLocal();
    await queueFileWrite();
    loadForms();
    renderAll();
    if (fileHandle) showToast('Verbunden mit Datei "' + handle.name + '".' + info);
  }

  async function connectNewFile() {
    if (!guardDirty()) return;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: DEFAULT_FILE_NAME,
        types: [{ description: 'JSON-Datei', accept: { 'application/json': ['.json'] } }]
      });
      await attachHandle(handle);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      showToast(err.message, true);
    }
  }

  async function openExistingFile() {
    if (!guardDirty()) return;
    try {
      const handles = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'JSON-Datei', accept: { 'application/json': ['.json'] } }]
      });
      const handle = handles[0];
      if (!(await hasPermission(handle, true))) {
        showToast('Ohne Schreibrecht kann die Datei nicht verbunden werden.', true);
        return;
      }
      await attachHandle(handle);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      showToast(err.message, true);
    }
  }

  async function reconnectFile() {
    if (!pendingHandle) return;
    if (!guardDirty()) return;
    try {
      if (!(await hasPermission(pendingHandle, true))) {
        showToast('Berechtigung wurde nicht erteilt.', true);
        return;
      }
      await attachHandle(pendingHandle);
    } catch (err) {
      showToast(err.message, true);
      updateStorageStatus();
    }
  }

  async function disconnectFile() {
    fileHandle = null;
    pendingHandle = null;
    fileError = null;
    try { await idbDel(); } catch (e) { /* ignorieren */ }
    updateStorageStatus();
    showToast('Datei getrennt. Daten bleiben im Browser gespeichert.');
  }

  async function restoreHandle() {
    if (!fsSupported) return;
    let handle = null;
    try { handle = await idbGet(); } catch (e) { return; }
    if (!handle) return;
    pendingHandle = handle;
    try {
      if (await hasPermission(handle, false)) await attachHandle(handle);
    } catch (err) {
      showToast(err.message, true);
    }
    updateStorageStatus();
  }

  // IndexedDB nur zum Merken des Datei-Handles (localStorage kann keine Handles speichern)
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbRun(mode, fn) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const req = fn(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }
  const idbGet = () => idbRun('readonly', (s) => s.get(IDB_KEY));
  const idbSet = (v) => idbRun('readwrite', (s) => s.put(v, IDB_KEY));
  const idbDel = () => idbRun('readwrite', (s) => s.delete(IDB_KEY));

  function updateStorageStatus() {
    const el = dom.storageStatus;
    el.className = 'storage-status';
    if (fileHandle) {
      el.classList.add('ok');
      el.textContent = 'Gespeichert in Datei "' + fileHandle.name + '" und im Browser' +
        (lastFileWrite ? ', zuletzt ' + fmtTime.format(lastFileWrite) : '') + '.';
    } else if (pendingHandle) {
      el.classList.add('warn');
      el.textContent = 'Datei "' + pendingHandle.name + '" ist nicht verbunden. Änderungen landen nur im Browser.';
    } else if (fsSupported) {
      el.textContent = 'Gespeichert nur im Browser. Für eine lokale Datei: "Neue Datei anlegen" oder "Datei öffnen".';
    } else {
      const last = getLastExport();
      el.textContent = 'Gespeichert im Browser. Sicherung per "Export JSON", letzte Sicherung: ' +
        (last ? fmtDate.format(new Date(last)) : 'noch keine') + '.';
      if (Object.keys(data.entries).length && (!last || Date.now() - last > 14 * 864e5)) el.classList.add('warn');
    }
    dom.btnFileNew.hidden = !fsSupported || !!fileHandle;
    dom.btnFileOpen.hidden = !fsSupported || !!fileHandle;
    dom.btnFileReconnect.hidden = !pendingHandle || !!fileHandle;
    if (pendingHandle) dom.btnFileReconnect.textContent = '"' + pendingHandle.name + '" wieder verbinden';
    dom.btnFileDisconnect.hidden = !fileHandle && !pendingHandle;
    document.getElementById('storage-divider').hidden = !fsSupported && !pendingHandle;

    // Kurzfassung in der eingeklappten Zeile
    const badge = dom.storageBadge;
    const last = getLastExport();
    const backupOld = Object.keys(data.entries).length && (!last || Date.now() - last > 14 * 864e5);
    badge.className = 'badge';
    if (fileHandle) {
      badge.textContent = 'Datei verbunden';
      badge.classList.add('ok');
    } else if (pendingHandle) {
      badge.textContent = 'Datei nicht verbunden';
      badge.classList.add('warn');
    } else {
      badge.textContent = last ? 'Letzte Sicherung ' + fmtDate.format(new Date(last)) : 'Noch keine Sicherung';
      if (backupOld) badge.classList.add('warn');
    }
  }

  // ---------------------------------------------------------------------------
  // Export / Import
  // ---------------------------------------------------------------------------
  /**
   * Gibt eine Datei aus. Auf iPhone/iPad über das Teilen-Menü (dort "In Dateien sichern"),
   * weil Downloads in Home-Bildschirm-Apps nicht zuverlässig funktionieren. Sonst klassischer Download.
   * Liefert ein Promise, das bei Abbruch durch den Nutzer mit false endet.
   */
  function download(filename, text, mime) {
    if (IS_IOS && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && typeof File === 'function') {
      const file = new File([text], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: filename })
          .then(() => true)
          .catch((err) => {
            if (err && err.name === 'AbortError') return false;
            anchorDownload(filename, text, mime);
            return true;
          });
      }
    }
    anchorDownload(filename, text, mime);
    return Promise.resolve(true);
  }

  function anchorDownload(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function exportJson() {
    download(APP_ID + '-export-' + todayStr() + '.json', serialize(), 'application/json')
      .then((done) => { if (done) setLastExport(); });
  }

  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // Formel-Injektion in Tabellenkalkulationen verhindern
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    const header = ['Datum', 'Sport', 'Sucht'];
    AREAS.forEach((a) => { header.push(areaLabel(a.key) + ' Ist', areaLabel(a.key) + ' Soll'); });
    header.push('Abstand', 'Notiz');
    const lines = [header.map(csvCell).join(';')];
    visibleDates(false).sort().forEach((d) => {
      const s = activeSport(d);
      const m = activeMood(d);
      const su = activeSucht(d);
      const row = [d, s ? s.text : '', su ? su.value : ''];
      AREAS.forEach((a) => { row.push(m ? m.ist[a.key] : '', m ? m.soll[a.key] : ''); });
      row.push(m ? moodDistance(m) : '', m ? m.notiz : '');
      lines.push(row.map(csvCell).join(';'));
    });
    // BOM, damit Excel UTF-8 erkennt; Semikolon für deutsche Ländereinstellungen
    download(APP_ID + '-' + todayStr() + '.csv', '\uFEFF' + lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  }

  let pendingImport = null;

  async function importJson(file) {
    if (!guardDirty()) return;
    let parsed;
    try {
      parsed = normalizeData(JSON.parse(await file.text()));
    } catch (err) {
      showToast('Import fehlgeschlagen: ' + err.message, true);
      return;
    }
    const r = analyzeImport(data, parsed.data);
    pendingImport = { parsed: parsed, name: file.name };

    if (typeof dom.importDialog.showModal !== 'function') {
      // Sehr alte Browser ohne <dialog>: sicherer Weg, nur ergänzen
      finishImport('add');
      return;
    }
    dom.importSummary.textContent = '"' + file.name + '" enthält Einträge für ' + r.days +
      (r.days === 1 ? ' Tag.' : ' Tage.') +
      (parsed.skipped ? ' ' + parsed.skipped + ' ungültige Einträge werden übersprungen.' : '');
    dom.importStats.textContent = '';
    [
      'Neu (fehlen hier bisher, werden immer übernommen): ' + r.neu,
      'Identisch: ' + r.gleich,
      'Abweichend von deinen Einträgen: ' + r.abweichend +
        (r.abweichend ? ', davon in der Datei neuer: ' + r.abweichendNeuer + '. Nur diese würden beim Zusammenführen ersetzt.' : '')
    ].forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      dom.importStats.appendChild(li);
    });
    dom.btnImportMerge.hidden = r.abweichendNeuer === 0;
    dom.importDialog.showModal();
  }

  function finishImport(mode) {
    const p = pendingImport;
    pendingImport = null;
    if (dom.importDialog.open) dom.importDialog.close();
    if (!p || mode === 'cancel') return;
    const before = analyzeImport(data, p.parsed.data);
    data = mode === 'merge' ? mergeData(data, p.parsed.data) : addMissing(data, p.parsed.data);
    persist();
    loadForms();
    renderAll();
    showToast(mode === 'merge'
      ? 'Zusammengeführt: ' + before.neu + ' neu, ' + before.abweichendNeuer + ' aktualisiert.'
      : 'Ergänzt: ' + before.neu + ' neu. Vorhandene Einträge wurden nicht verändert.');
  }

  // ---------------------------------------------------------------------------
  // Formulare
  // ---------------------------------------------------------------------------
  function guardDirty() {
    if (!sportDirty && !moodDirty) return true;
    return window.confirm('Es gibt ungespeicherte Änderungen für ' + fmtDate.format(parseDateStr(currentDate)) + '. Verwerfen?');
  }

  function findPreviousMood(date) {
    const dates = Object.keys(data.entries).filter((d) => d < date && activeMood(d)).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }

  function uniformValues(v) {
    const out = {};
    AREAS.forEach((a) => { out[a.key] = v; });
    return out;
  }

  function loadForms() {
    loadSportForm();
    loadMoodDraft();
    loadSucht();
  }

  function loadSucht() {
    const v = activeSucht(currentDate);
    dom.suchtSelect.value = v ? String(v.value) : '';
  }

  /** Speichert den Sucht-Wert sofort; leerer Wert entfernt ihn. */
  function saveSucht() {
    const raw = dom.suchtSelect.value;
    const now = Date.now();
    const label = fmtDate.format(parseDateStr(currentDate));
    if (raw) {
      setField(currentDate, 'sucht', { value: Number(raw), updatedAt: now });
      showToast('Sucht ' + raw + ' für ' + label + ' gespeichert.');
    } else if (data.entries[currentDate] && data.entries[currentDate].sucht) {
      setField(currentDate, 'sucht', { deleted: true, updatedAt: now });
      showToast('Sucht-Wert für ' + label + ' entfernt.');
    }
    persist();
    renderAll();
  }

  function loadSportForm() {
    const s = activeSport(currentDate);
    dom.sportText.value = s ? s.text : '';
    sportDirty = false;
  }

  function loadMoodDraft() {
    const m = activeMood(currentDate);
    if (m) {
      draft = { ist: Object.assign({}, m.ist), soll: Object.assign({}, m.soll), notiz: m.notiz };
      prefillFrom = null;
    } else {
      const prev = findPreviousMood(currentDate);
      if (prev) {
        const pm = activeMood(prev);
        draft = { ist: Object.assign({}, pm.ist), soll: Object.assign({}, pm.soll), notiz: '' };
        prefillFrom = prev;
      } else {
        draft = { ist: uniformValues(DEFAULT_VALUE), soll: uniformValues(DEFAULT_VALUE), notiz: '' };
        prefillFrom = null;
      }
    }
    dom.moodNote.value = draft.notiz;
    moodDirty = false;
  }

  function selectDate(date) {
    if (!isValidDateStr(date)) {
      dom.dateInput.value = currentDate;
      return;
    }
    if (date === currentDate) return;
    if (!guardDirty()) {
      dom.dateInput.value = currentDate;
      return;
    }
    currentDate = date;
    loadForms();
    renderAll();
  }

  function saveSport() {
    const text = dom.sportText.value.replace(/\s+$/, '');
    const now = Date.now();
    if (text.trim()) {
      setField(currentDate, 'sport', { text: text, updatedAt: now });
    } else if (data.entries[currentDate] && data.entries[currentDate].sport) {
      setField(currentDate, 'sport', { deleted: true, updatedAt: now });
    }
    sportDirty = false;
    persist();
    renderAll();
    showToast('Sport für ' + fmtDate.format(parseDateStr(currentDate)) + ' gespeichert.');
  }

  function deleteSport() {
    if (!activeSport(currentDate) && !dom.sportText.value.trim()) return;
    if (activeSport(currentDate) && !window.confirm('Sport-Eintrag für diesen Tag löschen?')) return;
    if (data.entries[currentDate] && data.entries[currentDate].sport) {
      setField(currentDate, 'sport', { deleted: true, updatedAt: Date.now() });
      persist();
    }
    dom.sportText.value = '';
    sportDirty = false;
    renderAll();
  }

  function saveMood() {
    draft.notiz = dom.moodNote.value.replace(/\s+$/, '');
    setField(currentDate, 'mood', {
      ist: Object.assign({}, draft.ist),
      soll: Object.assign({}, draft.soll),
      notiz: draft.notiz,
      updatedAt: Date.now()
    });
    prefillFrom = null;
    moodDirty = false;
    persist();
    renderAll();
    showToast('Balance für ' + fmtDate.format(parseDateStr(currentDate)) + ' gespeichert.');
  }

  function deleteMood() {
    if (activeMood(currentDate)) {
      if (!window.confirm('Balance-Eintrag für diesen Tag löschen?')) return;
      setField(currentDate, 'mood', { deleted: true, updatedAt: Date.now() });
      persist();
    }
    loadMoodDraft();
    renderAll();
  }

  function deleteDay(date) {
    if (!window.confirm('Alle Einträge vom ' + fmtDate.format(parseDateStr(date)) + ' löschen?')) return;
    const now = Date.now();
    if (data.entries[date] && data.entries[date].sport) setField(date, 'sport', { deleted: true, updatedAt: now });
    if (data.entries[date] && data.entries[date].mood) setField(date, 'mood', { deleted: true, updatedAt: now });
    if (data.entries[date] && data.entries[date].sucht) setField(date, 'sucht', { deleted: true, updatedAt: now });
    persist();
    if (date === currentDate) loadForms();
    renderAll();
  }

  function setValue(series, key, value) {
    const v = clampValue(value);
    if (v === null || draft[series][key] === v) return;
    draft[series][key] = v;
    moodDirty = true;
    renderMood();
  }

  // ---------------------------------------------------------------------------
  // SVG-Raute
  // ---------------------------------------------------------------------------
  function svgEl(name, attrs, parent) {
    const el = document.createElementNS(SVG_NS, name);
    if (attrs) Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(el);
    return el;
  }

  function point(areaIndex, value, g) {
    const a = AREAS[areaIndex];
    const f = (value / SCALE_MAX) * g.r;
    return [g.cx + a.dir[0] * f, g.cy + a.dir[1] * f];
  }

  function polyPoints(values, g) {
    return AREAS.map((a, i) => point(i, values[a.key], g).map((n) => n.toFixed(1)).join(',')).join(' ');
  }

  const raute = { polys: {}, handles: {}, values: {}, labels: {}, subs: [] };

  /** Setzt Namen, Kastengröße und Schriftgröße der Spitzen passend zum Text. */
  function layoutLabels() {
    raute.subs.forEach((s) => { s.el.style.display = isDefaultLabel(s.owner) ? '' : 'none'; });
    AREAS.forEach((a) => {
      const L = raute.labels[a.key];
      const b = LABEL_BOXES[a.key];
      const maxW = isDefaultLabel(a.key) ? b.maxW : b.maxWAlone;
      const avail = maxW - LABEL_PAD;
      const fit = fitLabel(areaLabel(a.key), avail);

      const lineH = Math.round(fit.font * 1.2);
      const h = fit.lines.length === 1 ? b.h : lineH * fit.lines.length + 14;
      const w = Math.max(64, Math.min(maxW, fit.width + LABEL_PAD));
      const x = b.anchor === 'center' ? b.ax - w / 2 : b.anchor === 'left' ? b.ax : b.ax - w;
      // oben wächst der Kasten nach oben, unten nach unten, seitlich symmetrisch
      const y = a.key === 'koerper' ? b.y + b.h - h : a.key === 'kontakt' ? b.y : b.y + b.h / 2 - h / 2;

      L.rect.setAttribute('x', x.toFixed(1));
      L.rect.setAttribute('y', y.toFixed(1));
      L.rect.setAttribute('width', w.toFixed(1));
      L.rect.setAttribute('height', h);

      const t = L.text;
      t.textContent = '';
      t.setAttribute('font-size', fit.font);
      const cx = x + w / 2;
      const top = y + h / 2 - ((fit.lines.length - 1) * lineH) / 2;
      fit.lines.forEach((line, i) => {
        const span = svgEl('tspan', { x: cx.toFixed(1), y: (top + i * lineH).toFixed(1) }, t);
        span.textContent = line.text;
        if (line.squeeze) {
          span.setAttribute('textLength', avail);
          span.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
      });

      const c = L.corner;
      L.line.setAttribute('x1', c[0]);
      L.line.setAttribute('y1', c[1]);
      L.line.setAttribute('x2', Math.min(Math.max(c[0], x), x + w).toFixed(1));
      L.line.setAttribute('y2', Math.min(Math.max(c[1], y), y + h).toFixed(1));
    });
  }

  /**
   * Reihenfolge: einzeilig in voller Größe, einzeilig leicht verkleinert,
   * zweizeilig an einer Wortgrenze, zuletzt kleinste Schrift plus Stauchen.
   */
  function fitLabel(text, avail) {
    const comfortable = 17;
    const w1 = measureString(text, LABEL_FONT);
    if (w1 <= avail) return { font: LABEL_FONT, width: w1, lines: [{ text: text }] };
    const f1 = Math.floor((LABEL_FONT * avail) / w1);
    if (f1 >= comfortable) {
      return { font: f1, width: measureString(text, f1), lines: [{ text: text }] };
    }

    const words = text.split(' ');
    if (words.length > 1) {
      let best = null;
      for (let i = 1; i < words.length; i++) {
        const l1 = words.slice(0, i).join(' ');
        const l2 = words.slice(i).join(' ');
        const wMax = Math.max(measureString(l1, LABEL_FONT), measureString(l2, LABEL_FONT));
        if (!best || wMax < best.wMax) best = { l1: l1, l2: l2, wMax: wMax };
      }
      const f2 = Math.max(LABEL_FONT_MIN, Math.min(LABEL_FONT, Math.floor((LABEL_FONT * avail) / best.wMax)));
      const lines = [best.l1, best.l2].map((l) => ({ text: l, squeeze: measureString(l, f2) > avail }));
      const width = Math.min(avail, Math.max(measureString(best.l1, f2), measureString(best.l2, f2)));
      return { font: f2, width: width, lines: lines };
    }

    const f = Math.max(LABEL_FONT_MIN, f1);
    const w = measureString(text, f);
    return { font: f, width: Math.min(w, avail), lines: [{ text: text, squeeze: w > avail }] };
  }

  let measureEl = null;
  function measureString(str, fontSize) {
    if (!measureEl) {
      measureEl = svgEl('text', { class: 'r-label', visibility: 'hidden', x: 0, y: -100 }, dom.raute);
    }
    measureEl.setAttribute('font-size', fontSize);
    measureEl.textContent = str;
    let w = 0;
    try { w = measureEl.getComputedTextLength(); } catch (e) { w = 0; }
    // Fallback, falls die Raute gerade nicht gerendert ist
    return w > 0 ? w : str.length * fontSize * 0.56;
  }

  function buildRaute() {
    const svg = dom.raute;
    const g = GEO;
    const corners = AREAS.map((_, i) => point(i, SCALE_MAX, g));

    // Gitter
    for (let v = 2; v < SCALE_MAX; v += 2) {
      svgEl('polygon', { class: 'r-grid', points: polyPoints(uniformValues(v), g) }, svg);
    }
    corners.forEach((c) => svgEl('line', { class: 'r-axis', x1: g.cx, y1: g.cy, x2: c[0], y2: c[1] }, svg));
    svgEl('polygon', { class: 'r-outer', points: polyPoints(uniformValues(SCALE_MAX), g) }, svg);
    for (let v = 2; v <= SCALE_MAX; v += 2) {
      // Skalenwerte auf der Diagonale zwischen zwei Achsen, damit sie nicht mit den Punkten kollidieren
      const f = (v / SCALE_MAX) * g.r;
      const t = svgEl('text', { class: 'r-scale', x: g.cx + f / 2 + 4, y: g.cy + f / 2 + 4 }, svg);
      t.textContent = String(v);
    }

    // Beschriftung der Ecken mit Verbindungslinie; Lage und Größe setzt layoutLabels()
    AREAS.forEach((a, i) => {
      raute.labels[a.key] = {
        corner: corners[i],
        line: svgEl('line', { class: 'r-connector' }, svg),
        rect: svgEl('rect', { class: 'r-label-box', rx: 3 }, svg),
        text: svgEl('text', { class: 'r-label' }, svg)
      };
    });

    SUB_ITEMS.forEach((s) => {
      const t = svgEl('text', { class: 'r-sub', x: s.x, y: s.y }, svg);
      raute.subs.push({ owner: s.owner, el: t });
      s.lines.forEach((line, i) => {
        const span = svgEl('tspan', { x: s.x, dy: i === 0 ? 0 : 20 }, t);
        span.textContent = line;
      });
    });

    // Polygone (Soll unten, Ist oben)
    raute.polys.soll = svgEl('polygon', { class: 'r-poly-soll' }, svg);
    raute.polys.ist = svgEl('polygon', { class: 'r-poly-ist' }, svg);

    ['soll', 'ist'].forEach((series) => {
      raute.handles[series] = AREAS.map(() => svgEl('circle', { class: 'r-handle ' + series, r: 7 }, svg));
      raute.values[series] = AREAS.map(() => svgEl('text', { class: 'r-value ' + series }, svg));
    });

    // Interaktion
    let dragArea = -1;
    function toSvgPoint(evt) {
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const p = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(ctm.inverse());
      return [p.x, p.y];
    }
    function nearestArea(p) {
      const dx = p[0] - g.cx;
      const dy = p[1] - g.cy;
      // Nur innerhalb der Raute (plus kleiner Rand) reagieren, nicht auf Beschriftungen
      if (Math.abs(dx) + Math.abs(dy) > g.r * 1.12) return -1;
      if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 0 : 2;
      return dx > 0 ? 1 : 3;
    }
    function applyPoint(p, areaIndex) {
      const a = AREAS[areaIndex];
      const proj = (p[0] - g.cx) * a.dir[0] + (p[1] - g.cy) * a.dir[1];
      setValue(editSeries, a.key, (proj / g.r) * SCALE_MAX);
    }
    svg.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0) return;
      const p = toSvgPoint(evt);
      if (!p) return;
      const idx = nearestArea(p);
      if (idx < 0) return;
      dragArea = idx;
      svg.setPointerCapture(evt.pointerId);
      svg.classList.add('dragging');
      applyPoint(p, idx);
      evt.preventDefault();
    });
    svg.addEventListener('pointermove', (evt) => {
      if (dragArea < 0) return;
      const p = toSvgPoint(evt);
      if (p) applyPoint(p, dragArea);
    });
    const endDrag = () => { dragArea = -1; svg.classList.remove('dragging'); };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
  }

  function renderRaute() {
    SERIES.forEach((series) => {
      const values = draft[series];
      raute.polys[series].setAttribute('points', polyPoints(values, GEO));
      const active = series === editSeries;
      AREAS.forEach((a, i) => {
        const p = point(i, values[a.key], GEO);
        const h = raute.handles[series][i];
        h.setAttribute('cx', p[0].toFixed(1));
        h.setAttribute('cy', p[1].toFixed(1));
        h.setAttribute('r', active ? 9 : 5);
        h.classList.toggle('active', active);
        h.classList.toggle('inactive', !active);

        // Wert neben dem Punkt, seitlich versetzt (Ist rechts/unten, Soll links/oben)
        const t = raute.values[series][i];
        const side = series === 'ist' ? 1 : -1;
        const off = 20;
        const nx = -a.dir[1] * side;
        const ny = a.dir[0] * side;
        t.setAttribute('x', (p[0] + nx * off).toFixed(1));
        t.setAttribute('y', (p[1] + ny * off).toFixed(1));
        t.textContent = String(values[a.key]);
      });
    });
    // aktive Serie nach oben legen
    const svg = dom.raute;
    svg.appendChild(raute.polys[editSeries]);
    raute.handles[editSeries].forEach((h) => svg.appendChild(h));
    SERIES.forEach((s) => raute.values[s].forEach((t) => svg.appendChild(t)));
  }

  function miniRaute(m) {
    const g = { cx: 28, cy: 28, r: 25 };
    const svg = svgEl('svg', { class: 'mini', viewBox: '0 0 56 56', 'aria-hidden': 'true' });
    svgEl('polygon', { class: 'r-outer', points: polyPoints(uniformValues(SCALE_MAX), g) }, svg);
    svgEl('polygon', { class: 'r-poly-soll', points: polyPoints(m.soll, g), 'stroke-width': 1.4, 'stroke-dasharray': '3 2' }, svg);
    svgEl('polygon', { class: 'r-poly-ist', points: polyPoints(m.ist, g), 'stroke-width': 1.4 }, svg);
    return svg;
  }

  // ---------------------------------------------------------------------------
  // Regler-Tabelle
  // ---------------------------------------------------------------------------
  const sliders = { ist: {}, soll: {} };
  const outputs = { ist: {}, soll: {} };
  const diffCells = {};
  const rowHeaders = {};
  const labelInputs = {};
  let labelsDirty = false;

  function buildMoodInputs() {
    AREAS.forEach((a) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      tr.appendChild(th);
      rowHeaders[a.key] = th;
      SERIES.forEach((series) => {
        const td = document.createElement('td');
        const wrap = document.createElement('div');
        wrap.className = 'slider-cell ' + series;
        const input = document.createElement('input');
        input.type = 'range';
        input.min = '0';
        input.max = String(SCALE_MAX);
        input.step = '1';
        input.dataset.series = series;
        input.addEventListener('input', () => setValue(series, a.key, input.value));
        input.addEventListener('focus', () => setSeries(series));
        const out = document.createElement('output');
        wrap.appendChild(input);
        wrap.appendChild(out);
        td.appendChild(wrap);
        tr.appendChild(td);
        sliders[series][a.key] = input;
        outputs[series][a.key] = out;
      });
      const diff = document.createElement('td');
      diff.className = 'diff';
      tr.appendChild(diff);
      diffCells[a.key] = diff;
      dom.moodInputsBody.appendChild(tr);
    });
  }

  // ---------------------------------------------------------------------------
  // Namen der Spitzen
  // ---------------------------------------------------------------------------
  function buildLabelEditor() {
    AREAS.forEach((a) => {
      const id = 'label-' + a.key;
      const lab = document.createElement('label');
      lab.htmlFor = id;
      lab.textContent = a.position;
      const input = document.createElement('input');
      input.type = 'text';
      input.id = id;
      input.maxLength = LABEL_MAX_LENGTH;
      input.placeholder = a.defaultLabel;
      input.autocomplete = 'off';
      input.addEventListener('input', () => { labelsDirty = true; });
      input.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter') { evt.preventDefault(); saveLabels(); }
      });
      dom.labelGrid.appendChild(lab);
      dom.labelGrid.appendChild(input);
      labelInputs[a.key] = input;
    });
  }

  function fillLabelEditor() {
    if (labelsDirty) return;
    AREAS.forEach((a) => {
      labelInputs[a.key].value = isDefaultLabel(a.key) ? '' : areaLabel(a.key);
    });
  }

  function saveLabels() {
    const labels = {};
    AREAS.forEach((a) => {
      const v = cleanLabel(labelInputs[a.key].value);
      if (v && v !== a.defaultLabel) labels[a.key] = v;
    });
    data.settings = { labels: labels, updatedAt: Date.now() };
    labelsDirty = false;
    persist();
    renderAll();
    showToast(Object.keys(labels).length ? 'Namen der Spitzen gespeichert.' : 'Standardnamen aktiv.');
  }

  function resetLabels() {
    AREAS.forEach((a) => { labelInputs[a.key].value = ''; });
    saveLabels();
  }

  /** Überträgt die aktuellen Namen in Raute, Regler-Tabelle und Übersichtstabelle. */
  function applyLabels() {
    layoutLabels();
    AREAS.forEach((a) => {
      const name = areaLabel(a.key);
      rowHeaders[a.key].textContent = name;
      SERIES.forEach((series) => {
        sliders[series][a.key].setAttribute('aria-label', name + ' ' + SERIES_LABEL[series]);
      });
      const th = dom.overviewHead.querySelector('th[data-area="' + a.key + '"]');
      if (th) {
        th.textContent = name;
        th.appendChild(document.createElement('br'));
        const small = document.createElement('small');
        small.textContent = 'Ist / Soll';
        th.appendChild(small);
      }
    });
    dom.raute.setAttribute('aria-label', 'Work-Life-Balance-Raute mit Ist- und Soll-Werten für ' +
      AREAS.map((a) => areaLabel(a.key)).join(', '));
    fillLabelEditor();
  }

  function setSeries(series) {
    if (editSeries === series) return;
    editSeries = series;
    document.querySelectorAll('.series-toggle .seg').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.series === series));
    });
    renderRaute();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function renderDay() {
    dom.dateInput.value = currentDate;
    const d = parseDateStr(currentDate);
    const label = fmtWeekday.format(d);
    dom.weekday.textContent = currentDate === todayStr() ? label + ' (heute)' : label;
  }

  function renderStates() {
    const stored = activeSport(currentDate);
    if (sportDirty) {
      dom.sportState.textContent = 'Nicht gespeichert';
      dom.sportState.className = 'state dirty';
    } else if (stored) {
      dom.sportState.textContent = 'Gespeichert';
      dom.sportState.className = 'state saved';
    } else {
      dom.sportState.textContent = 'Kein Eintrag';
      dom.sportState.className = 'state';
    }

    const m = activeMood(currentDate);
    if (moodDirty || (prefillFrom && !m)) {
      dom.moodState.textContent = 'Nicht gespeichert';
      dom.moodState.className = 'state dirty';
    } else if (m) {
      dom.moodState.textContent = 'Gespeichert';
      dom.moodState.className = 'state saved';
    } else {
      dom.moodState.textContent = 'Kein Eintrag';
      dom.moodState.className = 'state';
    }

    // Kurzvorschau in den eingeklappten Kopfzeilen
    const firstLine = stored ? stored.text.split('\n')[0] : '';
    dom.sportPreview.textContent = firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;
    dom.moodPreview.textContent = m ? 'Abstand ' + moodDistance(m) + ' von 40' : '';
    const su = activeSucht(currentDate);
    dom.suchtPreview.textContent = su ? 'Wert ' + su.value : '';
    dom.suchtState.textContent = su ? 'Gespeichert' : 'Kein Eintrag';
    dom.suchtState.className = su ? 'state saved' : 'state';

    if (prefillFrom && !m) {
      dom.prefillNote.hidden = false;
      dom.prefillNote.textContent = 'Werte vorbelegt aus dem Eintrag vom ' +
        fmtDate.format(parseDateStr(prefillFrom)) + '. Erst mit "Speichern" wird dieser Tag erfasst.';
    } else {
      dom.prefillNote.hidden = true;
    }
  }

  function renderMood() {
    renderRaute();
    AREAS.forEach((a) => {
      SERIES.forEach((series) => {
        sliders[series][a.key].value = String(draft[series][a.key]);
        outputs[series][a.key].textContent = String(draft[series][a.key]);
      });
      const diff = draft.ist[a.key] - draft.soll[a.key];
      const cell = diffCells[a.key];
      cell.textContent = diff > 0 ? '+' + diff : String(diff);
      cell.className = 'diff' + (diff < 0 ? ' neg' : diff > 0 ? ' pos' : '');
    });
    renderStates();
  }

  function visibleDates(applyFilter) {
    let dates = Object.keys(data.entries).filter((d) => activeSport(d) || activeMood(d) || activeSucht(d));
    if (applyFilter) {
      const month = dom.filterMonth.value;
      const q = dom.filterText.value.trim().toLowerCase();
      if (month) dates = dates.filter((d) => d.slice(0, 7) === month);
      if (q) {
        dates = dates.filter((d) => {
          const s = activeSport(d);
          const m = activeMood(d);
          return (s && s.text.toLowerCase().includes(q)) || (m && m.notiz.toLowerCase().includes(q));
        });
      }
    }
    return dates;
  }

  function renderMonthFilter() {
    const months = Array.from(new Set(visibleDates(false).map((d) => d.slice(0, 7)))).sort().reverse();
    const selected = dom.filterMonth.value;
    dom.filterMonth.textContent = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'Alle Monate';
    dom.filterMonth.appendChild(all);
    months.forEach((m) => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = fmtMonth.format(parseDateStr(m + '-01'));
      dom.filterMonth.appendChild(o);
    });
    dom.filterMonth.value = months.indexOf(selected) >= 0 ? selected : '';
  }

  function td(className, text) {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    if (text != null) cell.textContent = text;
    return cell;
  }

  function renderTable() {
    renderMonthFilter();
    const dates = visibleDates(true).sort().reverse();
    const body = dom.overviewBody;
    body.textContent = '';

    if (!dates.length) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const cell = td('', Object.keys(data.entries).length ? 'Keine Einträge für diesen Filter.' : 'Noch keine Einträge. Wähle oben einen Tag und speichere Sport, Sucht oder Balance.');
      cell.colSpan = 10;
      tr.appendChild(cell);
      body.appendChild(tr);
    }

    let sportDays = 0;
    let moodDays = 0;
    let distSum = 0;
    let suchtDays = 0;
    let suchtSum = 0;

    dates.forEach((d) => {
      const s = activeSport(d);
      const m = activeMood(d);
      const su = activeSucht(d);
      if (su) { suchtDays++; suchtSum += su.value; }
      if (s) sportDays++;
      if (m) { moodDays++; distSum += moodDistance(m); }

      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.title = 'Zum Bearbeiten anklicken';
      if (d === currentDate) tr.className = 'current';
      tr.addEventListener('click', () => { selectDate(d); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      tr.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' && evt.target === tr) { selectDate(d); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      });

      tr.appendChild(td('date-cell', fmtRowDate.format(parseDateStr(d))));

      const sportCell = td('sport-cell');
      if (s) sportCell.textContent = s.text;
      else { sportCell.textContent = 'kein Sport'; sportCell.classList.add('empty'); }
      if (m && m.notiz) {
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = 'Notiz: ' + m.notiz;
        sportCell.appendChild(note);
      }
      tr.appendChild(sportCell);

      const suchtCell = td('num', su ? String(su.value) : '-');
      if (!su) suchtCell.classList.add('empty');
      tr.appendChild(suchtCell);

      AREAS.forEach((a) => {
        const cell = td('num');
        if (m) {
          const ist = document.createElement('span');
          ist.className = 'v-ist';
          ist.textContent = String(m.ist[a.key]);
          const soll = document.createElement('span');
          soll.className = 'v-soll';
          soll.textContent = String(m.soll[a.key]);
          cell.appendChild(ist);
          cell.appendChild(document.createTextNode(' / '));
          cell.appendChild(soll);
          cell.title = areaLabel(a.key) + ': Ist ' + m.ist[a.key] + ', Soll ' + m.soll[a.key];
        } else {
          cell.textContent = '-';
          cell.classList.add('empty');
        }
        tr.appendChild(cell);
      });

      tr.appendChild(td('num', m ? String(moodDistance(m)) : '-'));

      const miniCell = td('');
      if (m) miniCell.appendChild(miniRaute(m));
      tr.appendChild(miniCell);

      const actions = td('actions');
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn small danger';
      del.textContent = 'Löschen';
      del.setAttribute('aria-label', 'Einträge vom ' + fmtDate.format(parseDateStr(d)) + ' löschen');
      del.addEventListener('click', (evt) => { evt.stopPropagation(); deleteDay(d); });
      actions.appendChild(del);
      tr.appendChild(actions);

      body.appendChild(tr);
    });

    const parts = [dates.length + (dates.length === 1 ? ' Tag' : ' Tage') + ' angezeigt',
      sportDays + ' mit Sport', suchtDays + ' mit Sucht-Wert', moodDays + ' mit Balance-Eintrag'];
    if (suchtDays) parts.push('mittlerer Sucht-Wert: ' + (suchtSum / suchtDays).toFixed(1).replace('.', ','));
    if (moodDays) parts.push('mittlerer Abstand Ist zu Soll: ' + (distSum / moodDays).toFixed(1).replace('.', ',') + ' von 40');
    dom.tableSummary.textContent = parts.join(', ') + '.';
    const total = visibleDates(false).length;
    dom.overviewPreview.textContent = total + (total === 1 ? ' Tag erfasst' : ' Tage erfasst');
  }

  function renderAll() {
    applyLabels();
    renderDay();
    renderMood();
    renderTable();
    updateStorageStatus();
  }

  // ---------------------------------------------------------------------------
  // Hinweise
  // ---------------------------------------------------------------------------
  let toastTimer = null;
  function showToast(text, isError) {
    dom.toast.textContent = text;
    dom.toast.className = 'toast' + (isError ? ' error' : '');
    dom.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { dom.toast.hidden = true; }, isError ? 7000 : 3000);
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  function bindEvents() {
    dom.dateInput.addEventListener('change', () => selectDate(dom.dateInput.value));
    dom.btnPrev.addEventListener('click', () => selectDate(addDays(currentDate, -1)));
    dom.btnNext.addEventListener('click', () => selectDate(addDays(currentDate, 1)));
    dom.btnToday.addEventListener('click', () => selectDate(todayStr()));

    dom.sportText.addEventListener('input', () => {
      const stored = activeSport(currentDate);
      sportDirty = dom.sportText.value.replace(/\s+$/, '') !== (stored ? stored.text : '');
      renderStates();
    });
    dom.sportText.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) { evt.preventDefault(); saveSport(); }
    });
    dom.btnSportSave.addEventListener('click', saveSport);
    dom.btnSportDelete.addEventListener('click', deleteSport);

    document.querySelectorAll('.series-toggle .seg').forEach((b) => {
      b.addEventListener('click', () => setSeries(b.dataset.series));
    });
    dom.moodNote.addEventListener('input', () => {
      draft.notiz = dom.moodNote.value;
      moodDirty = true;
      renderStates();
    });
    dom.btnMoodSave.addEventListener('click', saveMood);
    dom.btnMoodDelete.addEventListener('click', deleteMood);
    dom.btnLabelsSave.addEventListener('click', saveLabels);
    dom.suchtSelect.addEventListener('change', saveSucht);
    dom.btnImportAdd.addEventListener('click', () => finishImport('add'));
    dom.btnImportMerge.addEventListener('click', () => finishImport('merge'));
    dom.btnImportCancel.addEventListener('click', () => finishImport('cancel'));
    dom.importDialog.addEventListener('cancel', () => { pendingImport = null; });
    // Beschriftungen der Raute lassen sich nur im sichtbaren Zustand exakt vermessen
    dom.moodPanel.addEventListener('toggle', () => { if (dom.moodPanel.open) layoutLabels(); });
    dom.btnIosHintClose.addEventListener('click', () => {
      try { localStorage.setItem(IOS_HINT_KEY, '1'); } catch (e) { /* ignorieren */ }
      renderIosHint();
    });
    dom.btnLabelsReset.addEventListener('click', resetLabels);

    dom.filterMonth.addEventListener('change', renderTable);
    dom.filterText.addEventListener('input', renderTable);

    dom.btnFileNew.addEventListener('click', connectNewFile);
    dom.btnFileOpen.addEventListener('click', openExistingFile);
    dom.btnFileReconnect.addEventListener('click', reconnectFile);
    dom.btnFileDisconnect.addEventListener('click', disconnectFile);
    dom.btnExportJson.addEventListener('click', exportJson);
    dom.btnExportCsv.addEventListener('click', exportCsv);
    dom.btnImportJson.addEventListener('click', () => dom.importInput.click());
    dom.importInput.addEventListener('change', () => {
      const f = dom.importInput.files && dom.importInput.files[0];
      dom.importInput.value = '';
      if (f) importJson(f);
    });

    // Änderungen aus einem anderen Tab übernehmen
    window.addEventListener('storage', (evt) => {
      if (evt.key !== STORAGE_KEY) return;
      data = mergeData(data, loadLocal());
      if (!sportDirty && !moodDirty) loadForms();
      renderAll();
    });

    window.addEventListener('beforeunload', (evt) => {
      if (sportDirty || moodDirty) { evt.preventDefault(); evt.returnValue = ''; }
    });
  }

  function init() {
    data = loadLocal();
    buildRaute();
    buildMoodInputs();
    buildLabelEditor();
    bindEvents();
    loadForms();
    renderAll();
    renderIosHint();
    restoreHandle();
  }

  init();
})();
