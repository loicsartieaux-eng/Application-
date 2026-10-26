'use strict';

/* ---------- Données ---------- */

// Copie locale des données, pour un affichage immédiat (la référence est Airtable)
const CACHE_KEY = 'numlo-followers-cache';
const TOKEN_KEY = 'numlo-followers-token';
// Couleurs des séries : bleu NumLo en premier, puis 4 teintes validées
// (contraste et daltonisme) sur fond blanc. Au-delà de 5 comptes, les couleurs
// se répètent avec un trait pointillé pour rester distinguables.
const SERIES_COLORS = ['#1391b5', '#d27d14', '#7a5fb0', '#1fa58f', '#d65a3a'];
const MAX_CHART_SERIES = 5;

let state = readJSON(CACHE_KEY, { accounts: [], entries: [] });
let token = readJSON(TOKEN_KEY, null);
let chartSelection = null; // ids des comptes affichés sur le graphique
let chartRange = 'all';

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* stockage indisponible : l'app fonctionne quand même en ligne */ }
}

function save() {
  writeJSON(CACHE_KEY, state);
}

function accountById(id) {
  return state.accounts.find(a => a.id === id);
}

// Nom affiché ; le réseau est ajouté quand deux pages portent le même nom
function labelOf(account) {
  const twin = state.accounts.some(a => a.id !== account.id && a.name === account.name);
  return twin ? `${account.name} (${account.network})` : account.name;
}

function colorOf(account) {
  return SERIES_COLORS[account.colorIndex % SERIES_COLORS.length];
}

function isDashed(account) {
  return account.colorIndex >= SERIES_COLORS.length;
}

function nextColorIndex(accounts = state.accounts) {
  const used = new Set(accounts.map(a => a.colorIndex));
  let i = 0;
  while (used.has(i)) i++;
  return i;
}

function entriesFor(accountId) {
  return state.entries
    .filter(e => e.accountId === accountId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- Airtable ---------- */

const C = AIRTABLE.comptes;
const R = AIRTABLE.releves;

class AuthError extends Error {}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path, { method = 'GET', body, key = token } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE.baseId}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    // Airtable limite à 5 requêtes par seconde : on patiente et on réessaie
    if (res.status === 429 && attempt < 5) { await sleep(1000); continue; }
    if (res.status === 401 || res.status === 403) throw new AuthError('clé refusée');
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error?.message || `Erreur Airtable ${res.status}`);
    return out;
  }
}

async function listAll(table, key) {
  const records = [];
  let offset = '';
  do {
    const out = await api(`${table}?pageSize=100&returnFieldsByFieldId=true${offset ? '&offset=' + offset : ''}`, { key });
    records.push(...out.records);
    offset = out.offset || '';
  } while (offset);
  return records;
}

// Lit toute la base ; les lignes ajoutées à la main dans Airtable sont prises en compte
async function fetchAll(key = token) {
  const [comptes, releves] = await Promise.all([listAll(C.table, key), listAll(R.table, key)]);
  const accounts = [];
  comptes.forEach(r => {
    const name = String(r.fields[C.name] || '').trim();
    if (!name) return;
    const color = r.fields[C.color];
    accounts.push({ id: r.id, name, network: r.fields[C.network] || 'Autre', colorIndex: Number.isInteger(color) ? color : null });
  });
  accounts.forEach(a => { if (a.colorIndex === null) a.colorIndex = nextColorIndex(accounts); });
  const ids = new Set(accounts.map(a => a.id));
  const entries = [];
  releves.forEach(r => {
    const accountId = (r.fields[R.page] || [])[0];
    const date = r.fields[R.date];
    const count = r.fields[R.count];
    if (ids.has(accountId) && date && Number.isFinite(count)) entries.push({ id: r.id, accountId, date, count });
  });
  return { accounts, entries };
}

async function createAccount(name, network) {
  const colorIndex = nextColorIndex();
  const out = await api(C.table, {
    method: 'POST',
    body: { typecast: true, records: [{ fields: { [C.name]: name, [C.network]: network, [C.color]: colorIndex } }] },
  });
  const account = { id: out.records[0].id, name, network, colorIndex };
  state.accounts.push(account);
  return account;
}

async function deleteRecords(table, ids) {
  for (let i = 0; i < ids.length; i += 10) {
    await api(`${table}?${ids.slice(i, i + 10).map(id => 'records[]=' + id).join('&')}`, { method: 'DELETE' });
  }
}

async function removeAccount(id) {
  await deleteRecords(R.table, state.entries.filter(e => e.accountId === id).map(e => e.id));
  await deleteRecords(C.table, [id]);
  state.accounts = state.accounts.filter(a => a.id !== id);
  state.entries = state.entries.filter(e => e.accountId !== id);
}

// Enregistre des relevés (un seul par page et par jour : l'existant est mis à jour)
async function saveEntries(items) {
  const toUpdate = [];
  const toCreate = [];
  items.forEach(it => {
    const existing = state.entries.find(e => e.accountId === it.accountId && e.date === it.date);
    if (existing) toUpdate.push({ existing, count: it.count });
    else toCreate.push(it);
  });
  for (let i = 0; i < toUpdate.length; i += 10) {
    const batch = toUpdate.slice(i, i + 10);
    await api(R.table, { method: 'PATCH', body: { records: batch.map(u => ({ id: u.existing.id, fields: { [R.count]: u.count } })) } });
    batch.forEach(u => { u.existing.count = u.count; });
  }
  for (let i = 0; i < toCreate.length; i += 10) {
    const batch = toCreate.slice(i, i + 10);
    const out = await api(R.table, {
      method: 'POST',
      body: {
        records: batch.map(it => ({
          fields: {
            [R.label]: `${accountById(it.accountId).name} · ${it.date}`,
            [R.date]: it.date,
            [R.count]: it.count,
            [R.page]: [it.accountId],
          },
        })),
      },
    });
    out.records.forEach((rec, j) => state.entries.push({ id: rec.id, ...batch[j] }));
  }
  return { updated: toUpdate.length, created: toCreate.length };
}

async function removeEntry(id) {
  await deleteRecords(R.table, [id]);
  state.entries = state.entries.filter(e => e.id !== id);
}

/* ---------- Synchronisation ---------- */

const syncEl = document.getElementById('sync');

function setSync(status) {
  const labels = {
    ok: 'Synchronisé avec Airtable',
    loading: 'Synchronisation…',
    offline: 'Hors ligne · lecture seule',
  };
  syncEl.textContent = labels[status];
  syncEl.dataset.status = status;
}

let refreshing = false;
async function refresh() {
  if (!token || refreshing) return;
  refreshing = true;
  setSync('loading');
  try {
    state = await fetchAll();
    save();
    setSync('ok');
    refreshAll();
  } catch (e) {
    if (e instanceof AuthError) lock('La clé Airtable n’est plus valide. Reconnecte-toi.');
    else setSync('offline');
  } finally {
    refreshing = false;
  }
}

// Exécute une écriture vers Airtable et affiche le résultat
async function write(button, action, successMsg) {
  if (button) button.disabled = true;
  try {
    const result = await action();
    save();
    refreshAll();
    setSync('ok');
    const msg = typeof successMsg === 'function' ? successMsg(result) : successMsg;
    if (msg) toast(msg);
    return true;
  } catch (e) {
    if (e instanceof AuthError) lock('La clé Airtable n’est plus valide. Reconnecte-toi.');
    else toast(navigator.onLine ? `Échec : ${e.message}` : 'Pas de connexion : rien n’a été enregistré');
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('online', refresh);
syncEl.addEventListener('click', refresh);

/* ---------- Accès par mot de passe ---------- */

// La clé Airtable est chiffrée avec le mot de passe (PBKDF2 + AES-GCM)
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function encryptToken(tok, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(password, salt), new TextEncoder().encode(tok));
  return b64(salt) + '.' + b64(iv) + '.' + b64(data);
}

async function decryptToken(code, password) {
  const [salt, iv, data] = code.split('.').map(unb64);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await deriveKey(password, salt), data);
  return new TextDecoder().decode(plain);
}

const lockEl = document.getElementById('lock');
const lockForm = document.getElementById('lock-form');
const lockMsg = document.getElementById('lock-msg');
const tokenField = document.getElementById('token-field');

function lock(message = '') {
  token = null;
  writeJSON(TOKEN_KEY, null);
  writeJSON(CACHE_KEY, null);
  state = { accounts: [], entries: [] };
  chartSelection = null;
  const firstSetup = !CODE_CONNEXION;
  tokenField.hidden = !firstSetup;
  document.getElementById('lock-token').required = firstSetup;
  document.getElementById('lock-intro').textContent = firstSetup
    ? 'Première connexion : colle ta clé Airtable et choisis un mot de passe.'
    : 'Entre ton mot de passe.';
  document.getElementById('lock-password').autocomplete = firstSetup ? 'new-password' : 'current-password';
  lockMsg.textContent = message;
  document.getElementById('lock-code').hidden = true;
  lockForm.hidden = false;
  document.body.classList.add('is-locked');
  lockEl.hidden = false;
  refreshAll();
}

function unlock() {
  lockEl.hidden = true;
  document.body.classList.remove('is-locked');
  refreshAll();
  if (!state.accounts.length) showTab('comptes');
}

lockForm.addEventListener('submit', async ev => {
  ev.preventDefault();
  const password = document.getElementById('lock-password').value;
  const button = lockForm.querySelector('button');
  button.disabled = true;
  lockMsg.textContent = 'Connexion…';
  try {
    let key;
    if (CODE_CONNEXION) {
      try {
        key = await decryptToken(CODE_CONNEXION, password);
      } catch (e) {
        lockMsg.textContent = 'Mot de passe incorrect.';
        return;
      }
    } else {
      key = document.getElementById('lock-token').value.trim();
      if (password.length < 8) { lockMsg.textContent = 'Choisis un mot de passe d’au moins 8 caractères.'; return; }
    }
    state = await fetchAll(key);
    token = key;
    writeJSON(TOKEN_KEY, token);
    save();
    setSync('ok');
    document.getElementById('lock-password').value = '';
    document.getElementById('lock-token').value = '';
    if (CODE_CONNEXION) {
      unlock();
    } else {
      // Première connexion : on fournit le code à enregistrer dans config.js
      document.getElementById('lock-code-value').value = await encryptToken(key, password);
      lockForm.hidden = true;
      document.getElementById('lock-code').hidden = false;
    }
  } catch (e) {
    lockMsg.textContent = e instanceof AuthError
      ? 'Clé Airtable refusée. Vérifie qu’elle a bien accès à la base « NumLo Followers ».'
      : 'Impossible de joindre Airtable. Vérifie ta connexion.';
  } finally {
    button.disabled = false;
  }
});

document.getElementById('lock-code-copy').addEventListener('click', async () => {
  const input = document.getElementById('lock-code-value');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch (e) {
    input.select();
    document.execCommand('copy');
  }
  toast('Code copié');
});

document.getElementById('lock-continue').addEventListener('click', unlock);

document.getElementById('logout').addEventListener('click', () => {
  if (confirm('Verrouiller l’application sur cet appareil ? Le mot de passe sera redemandé.')) lock();
});

/* ---------- Format ---------- */

const nf = new Intl.NumberFormat('fr-BE');
const fmt = n => nf.format(n);
const fmtSigned = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + nf.format(Math.abs(n));

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function dateToTime(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fmtDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Date(dateToTime(iso)).toLocaleDateString('fr-BE', { ...opts, timeZone: 'UTC' });
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
}

/* ---------- Onglets ---------- */

function showTab(name) {
  document.querySelectorAll('.tab').forEach(s => { s.hidden = s.id !== 'tab-' + name; });
  document.querySelectorAll('.tabbar button').forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on);
  });
  if (name === 'graphique') renderChartTab();
  window.scrollTo(0, 0);
}

document.querySelectorAll('.tabbar button').forEach(b => {
  b.addEventListener('click', () => showTab(b.dataset.tab));
});

/* ---------- Onglet Encoder ---------- */

const entryForm = document.getElementById('entry-form');
const entryAccount = document.getElementById('entry-account');
const entryCount = document.getElementById('entry-count');
const entryDate = document.getElementById('entry-date');
const entryHint = document.getElementById('entry-hint');

entryDate.value = todayISO();

function renderAccountSelect() {
  const current = entryAccount.value;
  if (!state.accounts.length) {
    entryAccount.innerHTML = '<option value="">Ajoute d’abord une page (onglet Comptes)</option>';
    entryAccount.disabled = true;
    return;
  }
  entryAccount.disabled = false;
  entryAccount.innerHTML = state.accounts
    .map(a => `<option value="${a.id}">${escapeHTML(a.name)} · ${escapeHTML(a.network)}</option>`)
    .join('');
  if (accountById(current)) entryAccount.value = current;
}

function updateHint() {
  const id = entryAccount.value;
  const list = id ? entriesFor(id) : [];
  if (!list.length) {
    entryHint.textContent = id ? 'Premier relevé pour cette page.' : '';
    return;
  }
  const last = list[list.length - 1];
  entryHint.innerHTML = `Dernier relevé : <strong>${fmt(last.count)}</strong> le ${fmtDate(last.date)}`;
}

function renderHistory() {
  const el = document.getElementById('history');
  if (!state.entries.length) {
    el.innerHTML = '<li class="empty">Aucun relevé pour l’instant.</li>';
    return;
  }
  // Variation par rapport au relevé précédent du même compte
  const prevCount = new Map();
  state.accounts.forEach(a => {
    const list = entriesFor(a.id);
    list.forEach((e, i) => { if (i > 0) prevCount.set(e.id, list[i - 1].count); });
  });
  const sorted = [...state.entries].sort((a, b) => b.date.localeCompare(a.date));
  el.innerHTML = sorted.slice(0, 50).map(e => {
    const acc = accountById(e.accountId);
    if (!acc) return '';
    const prev = prevCount.get(e.id);
    const delta = prev === undefined ? '' : `<span class="delta">${fmtSigned(e.count - prev)}</span>`;
    return `<li>
      <span class="dot" style="background:${colorOf(acc)}"></span>
      <div class="main">
        <div class="title">${escapeHTML(acc.name)}</div>
        <div class="sub">${escapeHTML(acc.network)} · ${fmtDate(e.date)}</div>
      </div>
      <div class="value">${fmt(e.count)}${delta}</div>
      <button class="icon-btn" data-del-entry="${e.id}" aria-label="Supprimer ce relevé">×</button>
    </li>`;
  }).join('');
}

entryAccount.addEventListener('change', updateHint);

entryForm.addEventListener('submit', async ev => {
  ev.preventDefault();
  const accountId = entryAccount.value;
  const count = parseInt(entryCount.value, 10);
  const date = entryDate.value;
  if (!accountById(accountId)) { toast('Choisis un compte'); return; }
  if (!Number.isFinite(count) || count < 0) { toast('Nombre invalide'); return; }
  if (!date) { toast('Date manquante'); return; }

  const ok = await write(entryForm.querySelector('button'),
    () => saveEntries([{ accountId, date, count }]),
    r => (r.updated ? 'Relevé mis à jour' : 'Relevé enregistré'));
  if (ok) entryCount.value = '';
});

document.getElementById('history').addEventListener('click', ev => {
  const btn = ev.target.closest('[data-del-entry]');
  if (!btn) return;
  if (!confirm('Supprimer ce relevé ?')) return;
  write(btn, () => removeEntry(btn.dataset.delEntry), 'Relevé supprimé');
});

/* ---------- Onglet Comptes ---------- */

function renderAccountList() {
  const el = document.getElementById('account-list');
  if (!state.accounts.length) {
    el.innerHTML = '<li class="empty">Aucune page. Ajoute ta première page ci-dessus.</li>';
    return;
  }
  el.innerHTML = state.accounts.map(a => {
    const n = state.entries.filter(e => e.accountId === a.id).length;
    return `<li>
      <span class="dot" style="background:${colorOf(a)}"></span>
      <div class="main">
        <div class="title">${escapeHTML(a.name)}</div>
        <div class="sub">${escapeHTML(a.network)} · ${n} relevé${n > 1 ? 's' : ''}</div>
      </div>
      <button class="icon-btn" data-del-account="${a.id}" aria-label="Supprimer ${escapeHTML(a.name)}">×</button>
    </li>`;
  }).join('');
}

document.getElementById('account-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const input = document.getElementById('account-name');
  const name = input.value.trim();
  const network = document.getElementById('account-network').value;
  if (!name) return;
  if (state.accounts.some(a => a.name === name && a.network === network)) { toast('Cette page existe déjà'); return; }
  let account;
  const ok = await write(ev.target.querySelector('button'), async () => { account = await createAccount(name, network); }, `« ${name} » ajoutée`);
  if (ok) {
    input.value = '';
    entryAccount.value = account.id;
    updateHint();
  }
});

document.getElementById('account-list').addEventListener('click', ev => {
  const btn = ev.target.closest('[data-del-account]');
  if (!btn) return;
  const acc = accountById(btn.dataset.delAccount);
  if (!confirm(`Supprimer « ${acc.name} » et tous ses relevés ?`)) return;
  if (chartSelection) chartSelection = chartSelection.filter(x => x !== acc.id);
  write(btn, () => removeAccount(acc.id), `« ${acc.name} » supprimée`);
});

/* ---------- Sauvegarde ---------- */

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('export-json').addEventListener('click', () => {
  download(`numlo-followers-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
});

document.getElementById('export-csv').addEventListener('click', () => {
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [['Page', 'Réseau', 'Date', 'Followers'].join(';')];
  [...state.entries].sort((a, b) => a.date.localeCompare(b.date)).forEach(e => {
    const acc = accountById(e.accountId);
    if (acc) rows.push([q(acc.name), q(acc.network), e.date, e.count].join(';'));
  });
  // BOM pour qu'Excel lise correctement les accents
  download(`numlo-followers-${todayISO()}.csv`, '﻿' + rows.join('\n'), 'text/csv');
});

// Ajoute le contenu d'une sauvegarde à la base (sans rien effacer)
document.getElementById('import-json').addEventListener('change', async ev => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!Array.isArray(data.accounts) || !Array.isArray(data.entries)) throw new Error('format');
  } catch (e) {
    toast('Fichier de sauvegarde invalide');
    return;
  }
  if (!confirm(`Ajouter ${data.entries.length} relevé(s) de ${data.accounts.length} page(s) à la base ?`)) return;
  await write(null, async () => {
    const ids = new Map();
    for (const a of data.accounts) {
      const same = state.accounts.find(x => x.name === a.name && x.network === a.network);
      ids.set(a.id, (same || await createAccount(a.name, a.network)).id);
    }
    const items = data.entries
      .filter(e => ids.has(e.accountId))
      .map(e => ({ accountId: ids.get(e.accountId), date: e.date, count: e.count }));
    return saveEntries(items);
  }, r => `Import terminé : ${r.created} ajouté(s), ${r.updated} mis à jour`);
});

/* ---------- Onglet Graphique ---------- */

function renderChartTab() {
  const withData = state.accounts.filter(a => entriesFor(a.id).length);
  if (chartSelection === null || !chartSelection.length) chartSelection = withData.slice(0, MAX_CHART_SERIES).map(a => a.id);
  chartSelection = chartSelection.filter(id => accountById(id));

  document.getElementById('chart-accounts').innerHTML = state.accounts.map(a => `
    <button type="button" class="chip" data-chip="${a.id}" aria-pressed="${chartSelection.includes(a.id)}">
      <span class="swatch" style="background:${colorOf(a)}"></span>${escapeHTML(labelOf(a))}
    </button>`).join('');

  const series = chartSelection.map(id => {
    const account = accountById(id);
    let points = entriesFor(id);
    if (chartRange !== 'all') {
      const from = dateToTime(todayISO()) - Number(chartRange) * 86400000;
      points = points.filter(p => dateToTime(p.date) >= from);
    }
    return { account, points };
  }).filter(s => s.points.length);

  renderStats(series);
  renderChart(series);
  renderTable(series);
}

document.getElementById('chart-accounts').addEventListener('click', ev => {
  const id = ev.target.closest('[data-chip]')?.dataset.chip;
  if (!id) return;
  if (chartSelection.includes(id)) {
    chartSelection = chartSelection.filter(x => x !== id);
  } else {
    if (chartSelection.length >= MAX_CHART_SERIES) {
      toast(`Maximum ${MAX_CHART_SERIES} pages à la fois`);
      return;
    }
    chartSelection.push(id);
  }
  renderChartTab();
});

document.getElementById('chart-range').addEventListener('click', ev => {
  const btn = ev.target.closest('[data-range]');
  if (!btn) return;
  chartRange = btn.dataset.range;
  document.querySelectorAll('#chart-range button').forEach(b => b.classList.toggle('is-on', b === btn));
  renderChartTab();
});

function renderStats(series) {
  document.getElementById('stats').innerHTML = series.map(({ account, points }) => {
    const first = points[0];
    const last = points[points.length - 1];
    const diff = last.count - first.count;
    const pct = first.count ? ` (${fmtSigned(Math.round(diff / first.count * 1000) / 10)} %)` : '';
    const change = points.length > 1
      ? `${fmtSigned(diff)}${pct} depuis le ${fmtDate(first.date, { day: 'numeric', month: 'short' })}`
      : `le ${fmtDate(last.date)}`;
    return `<div class="stat">
      <div class="label"><span class="swatch" style="background:${colorOf(account)}"></span><span>${escapeHTML(labelOf(account))}</span></div>
      <div class="big">${fmt(last.count)}</div>
      <div class="change">${change}</div>
    </div>`;
  }).join('');
}

function niceTicks(min, max, count) {
  if (min === max) { min = Math.max(0, min - 10); max = max + 10; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function compact(n) {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toLocaleString('fr-BE', { maximumFractionDigits: 1 }) + ' M';
  if (Math.abs(n) >= 1e4) return (n / 1e3).toLocaleString('fr-BE', { maximumFractionDigits: 1 }) + ' k';
  return fmt(n);
}

function renderChart(series) {
  const chart = document.getElementById('chart');
  const legend = document.getElementById('chart-legend');

  if (!series.length) {
    chart.innerHTML = `<div class="empty">${state.entries.length
      ? 'Aucun relevé pour cette sélection et cette période.'
      : 'Encode tes premiers relevés pour voir apparaître le graphique.'}</div>`;
    legend.innerHTML = '';
    return;
  }

  const W = Math.max(300, chart.clientWidth || 340);
  const H = Math.round(Math.min(360, Math.max(240, W * 0.7)));
  const m = { top: 16, right: 64, bottom: 28, left: 48 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;

  const all = series.flatMap(s => s.points);
  let tMin = Math.min(...all.map(p => dateToTime(p.date)));
  let tMax = Math.max(...all.map(p => dateToTime(p.date)));
  if (tMin === tMax) { tMin -= 3 * 86400000; tMax += 3 * 86400000; }
  const yTicks = niceTicks(Math.min(...all.map(p => p.count)), Math.max(...all.map(p => p.count)), 4);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];

  const x = t => m.left + (t - tMin) / (tMax - tMin) * iw;
  const y = v => m.top + ih - (v - yMin) / (yMax - yMin) * ih;

  // Graduations de dates (4 max)
  const xTickCount = Math.min(4, Math.max(2, Math.floor(iw / 80)));
  const xTicks = [];
  for (let i = 0; i <= xTickCount - 1; i++) xTicks.push(tMin + (tMax - tMin) * i / (xTickCount - 1));
  const spanDays = (tMax - tMin) / 86400000;
  const xFmt = t => new Date(t).toLocaleDateString('fr-BE', spanDays > 300
    ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
    : { day: 'numeric', month: 'short', timeZone: 'UTC' });

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution du nombre de followers">`;
  svg += '<g class="grid">' + yTicks.map(v => `<line x1="${m.left}" x2="${m.left + iw}" y1="${y(v)}" y2="${y(v)}"/>`).join('') + '</g>';
  svg += '<g class="axis">';
  svg += yTicks.map(v => `<text x="${m.left - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`).join('');
  svg += xTicks.map((t, i) => {
    const anchor = i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle';
    return `<text x="${x(t)}" y="${H - 8}" text-anchor="${anchor}">${xFmt(t)}</text>`;
  }).join('');
  svg += '</g>';

  // Étiquettes de fin de courbe, espacées pour ne pas se chevaucher
  const labels = series.map(s => {
    const last = s.points[s.points.length - 1];
    return { s, y: y(last.count) };
  }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  }

  series.forEach(({ account, points }) => {
    const c = colorOf(account);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(dateToTime(p.date)).toFixed(1)},${y(p.count).toFixed(1)}`).join('');
    const dash = isDashed(account) ? ' stroke-dasharray="6 4"' : '';
    svg += `<g class="series"><path d="${d}" stroke="${c}"${dash}/>`;
    const showDots = points.length <= 40;
    points.forEach((p, i) => {
      if (showDots || i === points.length - 1) {
        svg += `<circle cx="${x(dateToTime(p.date))}" cy="${y(p.count)}" r="${i === points.length - 1 ? 4.5 : 3}" fill="${c}"/>`;
      }
    });
    svg += '</g>';
  });

  labels.forEach(({ s, y: ly }) => {
    const last = s.points[s.points.length - 1];
    svg += `<text class="end-label" x="${x(dateToTime(last.date)) + 8}" y="${ly + 4}">${compact(last.count)}</text>`;
  });

  svg += `<line class="crosshair" x1="0" x2="0" y1="${m.top}" y2="${m.top + ih}" visibility="hidden"/>`;
  svg += `<rect class="hit" x="${m.left}" y="${m.top}" width="${iw}" height="${ih}" fill="transparent"/>`;
  svg += '</svg>';

  chart.innerHTML = svg + '<div class="tooltip" hidden></div>';
  legend.innerHTML = series.length > 1
    ? series.map(({ account }) => `<span><i style="border-color:${colorOf(account)};${isDashed(account) ? 'border-top-style:dashed' : ''}"></i>${escapeHTML(labelOf(account))}</span>`).join('')
    : '';

  attachHover(chart, series, { x, y, W, m, iw });
}

// Infobulle : au toucher/survol, on affiche le relevé le plus proche
function attachHover(chart, series, { x, W, m, iw }) {
  const svg = chart.querySelector('svg');
  const hit = svg.querySelector('.hit');
  const cross = svg.querySelector('.crosshair');
  const tip = chart.querySelector('.tooltip');

  const dates = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();

  function move(clientX) {
    const rect = svg.getBoundingClientRect();
    const px = (clientX - rect.left) * (W / rect.width);
    let best = dates[0];
    let bestDist = Infinity;
    dates.forEach(d => {
      const dist = Math.abs(x(dateToTime(d)) - px);
      if (dist < bestDist) { bestDist = dist; best = d; }
    });
    const cx = x(dateToTime(best));
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');

    const rows = series.map(({ account, points }) => {
      const p = points.find(pt => pt.date === best);
      return p ? `<div class="t-row"><i style="background:${colorOf(account)}"></i>${escapeHTML(labelOf(account))}<b>${fmt(p.count)}</b></div>` : '';
    }).join('');
    tip.innerHTML = `<div class="t-date">${fmtDate(best)}</div>${rows}`;
    tip.hidden = false;
    const left = cx * (rect.width / W);
    const half = tip.offsetWidth / 2;
    tip.style.left = Math.min(Math.max(left, half), rect.width - half) + 'px';
  }

  function hide() {
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  }

  hit.addEventListener('pointermove', e => move(e.clientX));
  hit.addEventListener('pointerdown', e => move(e.clientX));
  hit.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
}

// Toucher en dehors du graphique : on masque l'infobulle
document.addEventListener('pointerdown', e => {
  const chart = document.getElementById('chart');
  if (chart.contains(e.target)) return;
  chart.querySelector('.crosshair')?.setAttribute('visibility', 'hidden');
  const tip = chart.querySelector('.tooltip');
  if (tip) tip.hidden = true;
});

function renderTable(series) {
  const el = document.getElementById('chart-table');
  if (!series.length) { el.innerHTML = ''; return; }
  const dates = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort().reverse();
  const head = '<tr><th>Date</th>' + series.map(s => `<th>${escapeHTML(labelOf(s.account))}</th>`).join('') + '</tr>';
  const body = dates.map(d => '<tr><td>' + fmtDate(d) + '</td>' + series.map(s => {
    const p = s.points.find(pt => pt.date === d);
    return `<td>${p ? fmt(p.count) : '–'}</td>`;
  }).join('') + '</tr>').join('');
  el.innerHTML = `<div class="scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!document.getElementById('tab-graphique').hidden) renderChartTab();
  }, 150);
});

/* ---------- Démarrage ---------- */

function refreshAll() {
  renderAccountSelect();
  updateHint();
  renderHistory();
  renderAccountList();
  if (!document.getElementById('tab-graphique').hidden) renderChartTab();
}

if (token) {
  unlock();
  refresh();
} else {
  lock();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
