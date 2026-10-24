'use strict';

/* ---------- Données ---------- */

const STORAGE_KEY = 'numlo-followers-v1';
// Couleurs des séries : bleu NumLo en premier, puis 4 teintes validées
// (contraste et daltonisme) sur fond blanc. Au-delà de 5 comptes, les couleurs
// se répètent avec un trait pointillé pour rester distinguables.
const SERIES_COLORS = ['#1391b5', '#d27d14', '#7a5fb0', '#1fa58f', '#d65a3a'];
const MAX_CHART_SERIES = 5;

let state = load();
let chartSelection = null; // ids des comptes affichés sur le graphique
let chartRange = 'all';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.accounts) && Array.isArray(data.entries)) return data;
    }
  } catch (e) { /* stockage indisponible : on repart de zéro */ }
  return { accounts: [], entries: [] };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Impossible d’enregistrer sur cet appareil');
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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

function nextColorIndex() {
  const used = new Set(state.accounts.map(a => a.colorIndex));
  let i = 0;
  while (used.has(i)) i++;
  return i;
}

function entriesFor(accountId) {
  return state.entries
    .filter(e => e.accountId === accountId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

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
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2200);
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
  const sorted = [...state.entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
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

entryForm.addEventListener('submit', ev => {
  ev.preventDefault();
  const accountId = entryAccount.value;
  const count = parseInt(entryCount.value, 10);
  const date = entryDate.value;
  if (!accountById(accountId)) { toast('Choisis un compte'); return; }
  if (!Number.isFinite(count) || count < 0) { toast('Nombre invalide'); return; }
  if (!date) { toast('Date manquante'); return; }

  // Un seul relevé par compte et par jour : on remplace s'il existe déjà
  const existing = state.entries.find(e => e.accountId === accountId && e.date === date);
  if (existing) {
    existing.count = count;
    toast('Relevé mis à jour');
  } else {
    state.entries.push({ id: uid(), accountId, date, count, createdAt: Date.now() });
    toast('Relevé enregistré');
  }
  save();
  entryCount.value = '';
  renderHistory();
  updateHint();
});

document.getElementById('history').addEventListener('click', ev => {
  const id = ev.target.closest('[data-del-entry]')?.dataset.delEntry;
  if (!id) return;
  if (!confirm('Supprimer ce relevé ?')) return;
  state.entries = state.entries.filter(e => e.id !== id);
  save();
  renderHistory();
  updateHint();
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

document.getElementById('account-form').addEventListener('submit', ev => {
  ev.preventDefault();
  const name = document.getElementById('account-name').value.trim();
  const network = document.getElementById('account-network').value;
  if (!name) return;
  const account = { id: uid(), name, network, colorIndex: nextColorIndex() };
  state.accounts.push(account);
  save();
  document.getElementById('account-name').value = '';
  refreshAll();
  entryAccount.value = account.id;
  updateHint();
  toast(`« ${name} » ajoutée`);
});

document.getElementById('account-list').addEventListener('click', ev => {
  const id = ev.target.closest('[data-del-account]')?.dataset.delAccount;
  if (!id) return;
  const acc = accountById(id);
  if (!confirm(`Supprimer « ${acc.name} » et tous ses relevés ?`)) return;
  state.accounts = state.accounts.filter(a => a.id !== id);
  state.entries = state.entries.filter(e => e.accountId !== id);
  if (chartSelection) chartSelection = chartSelection.filter(x => x !== id);
  save();
  refreshAll();
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

document.getElementById('import-json').addEventListener('change', async ev => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.accounts) || !Array.isArray(data.entries)) throw new Error('format');
    if (!confirm('Remplacer les données actuelles par cette sauvegarde ?')) return;
    state = data;
    chartSelection = null;
    save();
    refreshAll();
    toast('Sauvegarde importée');
  } catch (e) {
    toast('Fichier de sauvegarde invalide');
  }
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

refreshAll();
if (!state.accounts.length) showTab('comptes');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
