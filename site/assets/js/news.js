import { $, renderNav, renderFooter, loadJSON, esc, safeUrl, fmt, brandColor, TOPICS } from './common.js';

renderNav('news.html');
renderFooter();

const PAGE_SIZE = 30;
const NO_TOPIC = '_none';
const TOPIC_LABELS = { ...TOPICS, [NO_TOPIC]: '未分類' };
const LANG_LABELS = {
  en: '英語', zh: '中文', ja: '日語', ko: '韓語', th: '泰語', vi: '越南語', id: '印尼語', ms: '馬來語',
  tl: '他加祿語', fr: '法語', de: '德語', es: '西班牙語', pt: '葡萄牙語', it: '意大利語', ru: '俄語', ar: '阿拉伯語',
};
const RANGES = [['30', '最近 30 天'], ['90', '最近 90 天'], ['365', '最近一年'], ['all', '全部']];
const DEFAULTS = { brand: '', market: '', lang: '', topic: '', range: '90', q: '' };
const FILTER_KEYS = Object.keys(DEFAULTS);
const SELECTS = { brand: 'f-brand', market: 'f-market', lang: 'f-lang', topic: 'f-topic', range: 'f-range' };
const CHART_IDS = ['chart-trend', 'chart-matrix', 'chart-topics', 'chart-langs', 'chart-sources', 'chart-keywords'];
const STOPWORDS = new Set(`the and for with from that this these those are was were been has have had
  not but its into over after about amid than more most how why what who when where will would could
  should can may new says said say your you our their they his her him she all one two first year
  years per via out off just also now get gets top big best here there which while what's
  macau macao`.split(/\s+/));

const state = { ...DEFAULTS, page: 0 };
const charts = {};
const brandById = {};
let data = null;
let articles = [];
let brands = [];
let marketNames = {};
let refDate = '';
let filtered = [];
let hasCharts = false;
let brandTokens = new Set();

init();

// ---------- 工具 ----------

function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const hint = (msg) => `<p class="hint">${esc(msg)}</p>`;
const mName = (iso) => marketNames[iso] || iso;
const langLabel = (l) => LANG_LABELS[l] || l || '未知';

function addDays(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function weekOf(d) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

function tally(keys) {
  const m = new Map();
  for (const k of keys) if (k) m.set(k, (m.get(k) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(src));
    document.head.appendChild(s);
  });
}

// jsdelivr 載入失敗時改用 unpkg
async function ensureEcharts() {
  if (window.echarts) return true;
  try {
    await loadScript('https://unpkg.com/echarts@5.5.1/dist/echarts.min.js');
  } catch {
    return false;
  }
  return Boolean(window.echarts);
}

// ---------- 初始化 ----------

async function init() {
  try {
    data = await loadJSON('news.json');
  } catch (e) {
    showEmpty(`無法載入 news.json（${e.message}）。最新的 workflow 可能還沒完成 Build 和部署。`);
    return;
  }
  articles = (data.articles || []).filter((a) => a && a.date && a.title);
  brands = data.brands || [];
  brands.forEach((b, i) => { brandById[b.id] = { ...b, color: brandColor(i) }; });
  marketNames = data.market_names || {};

  if (!articles.length) {
    showEmpty('目前還沒有任何文章。');
    return;
  }

  refDate = articles.reduce((m, a) => (a.date > m ? a.date : m), '');
  brandTokens = new Set(brands.flatMap((b) =>
    b.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/)));

  readUrl();
  setupFilters();
  $('content').hidden = false;
  $('status').innerHTML = statusHTML();

  hasCharts = await ensureEcharts();
  if (!hasCharts) {
    CHART_IDS.forEach((id) => { $(id).innerHTML = hint('圖表庫載入失敗，請重新整理頁面或檢查網絡。文章列表不受影響。'); });
  }
  render();
  window.addEventListener('resize', debounce(() => Object.values(charts).forEach((c) => c.resize()), 150));
}

function showEmpty(reason) {
  $('empty').innerHTML = `<section class="card empty">
    <h2>還沒有討論內容數據</h2>
    <p>${esc(reason)}</p>
    <p>這個頁面的數據來自 Google News RSS 和 GDELT，由 GitHub Actions 抓取。處理方法：</p>
    <ol>
      <li>到 Actions → Update data and deploy → Run workflow 手動運行一次。</li>
      <li>在 <code>Fetch news</code> 步驟的日誌中確認出現「新增 N 篇」。</li>
      <li>等 <code>deploy-pages</code> 完成後，按 Ctrl+Shift+R 重新整理這個頁面。</li>
      <li>如果 Actions 抓取失敗，在自己電腦運行 <code>cd scripts && python fetch_news.py && python build.py</code>，再提交 <code>data/</code> 和 <code>site/data/</code>。</li>
    </ol>
    ${data ? statusHTML() : ''}
  </section>`;
}

function statusHTML() {
  const prov = data?.providers || {};
  const dates = articles.map((a) => a.date).sort();
  const updated = data?.updated ? new Date(data.updated).toLocaleString('zh-Hant') : '—';
  return `<h2>數據狀態</h2>
    <dl class="status">
      <dt>文章總數</dt><dd>${fmt.int(articles.length)} 篇</dd>
      <dt>Google News RSS</dt><dd>${fmt.int(prov.gnews || 0)} 篇</dd>
      <dt>GDELT</dt><dd>${fmt.int(prov.gdelt || 0)} 篇</dd>
      <dt>日期範圍</dt><dd>${dates.length ? `${esc(dates[0])} 至 ${esc(dates.at(-1))}` : '—'}</dd>
      <dt>生成時間</dt><dd>${esc(updated)}</dd>
    </dl>
    <p class="hint">「市場」對 Google News 文章指地區版本，也就是該地讀者看到的報道；對 GDELT 文章指媒體所在國家。
    品牌按搜尋條件和標題中的品牌名歸類，一篇文章可屬多個品牌和市場。語言按地區版本判斷，香港版和台灣版中也可能有英文報道。</p>`;
}

// ---------- 篩選 ----------

function readUrl() {
  const p = new URLSearchParams(location.search);
  for (const k of FILTER_KEYS) if (p.has(k)) state[k] = p.get(k);
  // 兼容世界地圖傳來的 ?country=
  const c = p.get('country');
  if (c && !state.market) {
    const hit = articles.find((a) => a.country === c || a.iso3 === c);
    if (hit?.iso3) state.market = hit.iso3;
  }
  if (!RANGES.some(([v]) => v === state.range)) state.range = DEFAULTS.range;
}

function fill(id, allLabel, entries, key) {
  const el = $(id);
  el.innerHTML = (allLabel != null ? `<option value="">${esc(allLabel)}</option>` : '') +
    entries.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
  el.value = state[key];
  if (el.value !== state[key]) {
    state[key] = allLabel != null ? '' : entries[0][0];
    el.value = state[key];
  }
  el.onchange = (e) => { state[key] = e.target.value; state.page = 0; render(); };
}

function setupFilters() {
  const bc = new Map(tally(articles.flatMap((a) => a.brands || [])));
  fill('f-brand', '全部品牌', brands.map((b) => [b.id, `${b.name}（${bc.get(b.id) || 0}）`]), 'brand');
  fill('f-market', '全部市場',
    tally(articles.flatMap((a) => a.markets || [])).map(([k, n]) => [k, `${mName(k)}（${n}）`]), 'market');
  fill('f-lang', '全部語言',
    tally(articles.map((a) => a.lang)).map(([k, n]) => [k, `${langLabel(k)}（${n}）`]), 'lang');
  fill('f-topic', '全部主題', Object.entries(TOPIC_LABELS), 'topic');
  fill('f-range', null, RANGES, 'range');

  const q = $('f-q');
  q.value = state.q;
  q.oninput = debounce(() => { state.q = q.value.trim(); state.page = 0; render(); });

  $('f-reset').onclick = () => {
    Object.assign(state, DEFAULTS, { page: 0 });
    syncControls();
    render();
  };
  $('prev').onclick = () => { state.page -= 1; renderList(); };
  $('next').onclick = () => { state.page += 1; renderList(); };
}

function syncControls() {
  for (const [key, id] of Object.entries(SELECTS)) $(id).value = state[key];
  $('f-q').value = state.q;
}

function inRange(d, shift = 0) {
  if (state.range === 'all') return shift === 0;
  const n = Number(state.range);
  const end = addDays(refDate, -n * shift);
  return d > addDays(end, -n) && d <= end;
}

// ignore：不套用的篩選；shift = 1 表示前一期
function match(a, ignore = [], shift = 0) {
  const on = (k) => !ignore.includes(k) && state[k];
  if (on('brand') && !(a.brands || []).includes(state.brand)) return false;
  if (on('market') && !(a.markets || []).includes(state.market)) return false;
  if (on('lang') && a.lang !== state.lang) return false;
  if (on('topic')) {
    const t = a.topics || [];
    if (state.topic === NO_TOPIC ? t.length : !t.includes(state.topic)) return false;
  }
  if (on('q') && !a.title.toLowerCase().includes(state.q.toLowerCase())) return false;
  if (!ignore.includes('range') && !inRange(a.date, shift)) return false;
  return true;
}

function syncUrl() {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) if (state[k] && state[k] !== DEFAULTS[k]) p.set(k, state[k]);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// ---------- 繪製 ----------

function render() {
  filtered = articles.filter((a) => match(a)).sort((a, b) => b.date.localeCompare(a.date));
  syncUrl();
  renderKpis();
  renderList();
  if (!hasCharts) return;
  const jobs = [
    ['chart-trend', renderTrend], ['chart-matrix', renderMatrix], ['chart-topics', renderTopics],
    ['chart-langs', renderLangs], ['chart-sources', renderSources], ['chart-keywords', renderKeywords],
  ];
  for (const [id, fn] of jobs) {
    try {
      fn();
    } catch (e) {
      console.error(e);
      charts[id]?.dispose();
      delete charts[id];
      $(id).innerHTML = hint(`圖表繪製失敗：${e.message}`);
    }
  }
}

function chart(id) {
  if (!charts[id]) {
    $(id).innerHTML = '';
    charts[id] = echarts.init($(id));
  }
  return charts[id];
}

function emptyChart(id, msg = '沒有符合條件的數據') {
  chart(id).setOption({
    title: { text: msg, left: 'center', top: 'middle', textStyle: { color: '#999', fontSize: 13, fontWeight: 'normal' } },
  }, true);
}

// ---------- 指標卡 ----------

function kpi(label, value, sub = '') {
  return `<div class="kpi"><div class="label">${esc(label)}</div>` +
    `<div class="value">${esc(value)}</div><div class="sub">${sub}</div></div>`;
}

function renderKpis() {
  const rangeText = RANGES.find(([v]) => v === state.range)[1];
  $('range-label').textContent = `${rangeText}，截至 ${refDate}（數據中最新的日期）`;

  const n = filtered.length;
  let delta = '';
  if (state.range !== 'all') {
    const prev = articles.filter((a) => match(a, [], 1)).length;
    if (prev) {
      const d = ((n - prev) / prev) * 100;
      delta = `<span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${d.toFixed(0)}%</span>` +
        `，前 ${esc(state.range)} 天為 ${fmt.int(prev)} 篇`;
    } else {
      delta = '前一期沒有報道';
    }
  }

  const sources = new Set(filtered.map((a) => a.domain || a.source)).size;
  const markets = new Set(filtered.flatMap((a) => a.markets || [])).size;
  const [topBrand] = tally(filtered.flatMap((a) => a.brands || []));
  const [topTopic] = tally(filtered.flatMap((a) => a.topics || []));
  const share = (c) => (n ? `${c} 篇，佔 ${((c / n) * 100).toFixed(0)}%` : '');

  $('kpis').innerHTML = [
    kpi('報道數', fmt.int(n), delta),
    kpi('來源媒體', fmt.int(sources)),
    kpi('覆蓋市場', fmt.int(markets)),
    kpi('最多報道的品牌', topBrand ? brandById[topBrand[0]]?.name || topBrand[0] : '—', topBrand ? share(topBrand[1]) : ''),
    kpi('最常見主題', topTopic ? TOPIC_LABELS[topTopic[0]] : '—', topTopic ? share(topTopic[1]) : ''),
  ].join('');
}

// ---------- 圖表 ----------

function renderTrend() {
  if (!filtered.length) return emptyChart('chart-trend');
  const weeks = [];
  for (let w = weekOf(filtered.at(-1).date), last = weekOf(filtered[0].date); w <= last; w = addDays(w, 7)) weeks.push(w);
  const idx = Object.fromEntries(weeks.map((w, i) => [w, i]));
  const shown = state.brand ? brands.filter((b) => b.id === state.brand) : brands;
  const sIdx = Object.fromEntries(shown.map((b, i) => [b.id, i]));
  const series = shown.map((b) => ({
    name: b.name, type: 'bar', stack: 'n', color: brandById[b.id].color,
    emphasis: { focus: 'series' }, data: new Array(weeks.length).fill(0),
  }));
  for (const a of filtered) {
    for (const b of a.brands || []) if (b in sIdx) series[sIdx[b]].data[idx[weekOf(a.date)]] += 1;
  }
  chart('chart-trend').setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 40, right: 16, top: 36, bottom: weeks.length > 26 ? 56 : 30 },
    xAxis: { type: 'category', data: weeks, name: '週（週一）', nameLocation: 'end' },
    yAxis: { type: 'value', minInterval: 1 },
    dataZoom: weeks.length > 26 ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8 }] : [],
    series,
  }, true);
}

function renderMatrix() {
  const base = articles.filter((a) => match(a, ['brand', 'market']));
  const counts = new Map();
  const totals = new Map();
  for (const a of base) {
    for (const m of a.markets || []) {
      totals.set(m, (totals.get(m) || 0) + 1);
      for (const b of a.brands || []) counts.set(`${b}|${m}`, (counts.get(`${b}|${m}`) || 0) + 1);
    }
  }
  const ms = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([m]) => m);
  if (!ms.length) return emptyChart('chart-matrix');

  const cells = [];
  let max = 0;
  ms.forEach((m, x) => brands.forEach((b, y) => {
    const v = counts.get(`${b.id}|${m}`) || 0;
    cells.push([x, y, v]);
    max = Math.max(max, v);
  }));

  const c = chart('chart-matrix');
  c.setOption({
    tooltip: { formatter: (p) => `${esc(mName(ms[p.value[0]]))}｜${esc(brands[p.value[1]].name)}<br>${p.value[2]} 篇` },
    grid: { left: 110, right: 20, top: 10, bottom: 90 },
    xAxis: { type: 'category', data: ms.map(mName), axisLabel: { interval: 0, rotate: 35 }, splitArea: { show: true } },
    yAxis: { type: 'category', data: brands.map((b) => b.name), splitArea: { show: true } },
    visualMap: {
      min: 0, max: Math.max(1, max), calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
      inRange: { color: ['#f7fbff', '#6baed6', '#08306b'] },
    },
    series: [{
      type: 'heatmap', data: cells,
      label: { show: true, formatter: (p) => (p.value[2] ? String(p.value[2]) : '') },
      itemStyle: { borderColor: '#fff', borderWidth: 1 },
    }],
  }, true);
  c.off('click');
  c.on('click', (p) => {
    if (!Array.isArray(p.value)) return;
    const m = ms[p.value[0]];
    const b = brands[p.value[1]].id;
    const same = state.market === m && state.brand === b;
    state.market = same ? '' : m;
    state.brand = same ? '' : b;
    state.page = 0;
    syncControls();
    render();
  });
}

function renderTopics() {
  const base = articles.filter((a) => match(a, ['topic']));
  if (!base.length) return emptyChart('chart-topics');
  const keys = Object.keys(TOPIC_LABELS);
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const a of base) {
    const t = a.topics || [];
    if (!t.length) counts[NO_TOPIC] += 1;
    else t.forEach((k) => { if (k in counts) counts[k] += 1; });
  }
  const c = chart('chart-topics');
  c.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 100, right: 40, top: 10, bottom: 24 },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', inverse: true, data: keys.map((k) => TOPIC_LABELS[k]) },
    series: [{
      type: 'bar',
      data: keys.map((k) => ({
        value: counts[k],
        itemStyle: { color: !state.topic || state.topic === k ? '#b8860b' : '#d1d5db' },
      })),
      label: { show: true, position: 'right' },
    }],
  }, true);
  c.off('click');
  c.on('click', (p) => {
    const k = keys[p.dataIndex];
    state.topic = state.topic === k ? '' : k;
    state.page = 0;
    syncControls();
    render();
  });
}

function renderLangs() {
  const base = articles.filter((a) => match(a, ['lang']));
  const rows = tally(base.map((a) => a.lang || 'unknown'));
  if (!rows.length) return emptyChart('chart-langs');
  const c = chart('chart-langs');
  c.setOption({
    tooltip: { trigger: 'item', formatter: (p) => `${esc(p.name)}：${p.value} 篇（${p.percent}%）` },
    series: [{
      type: 'pie', radius: ['40%', '70%'],
      data: rows.map(([k, v]) => ({
        name: langLabel(k), value: v,
        itemStyle: state.lang && state.lang !== k ? { opacity: 0.35 } : {},
      })),
      label: { formatter: '{b}\n{d}%' },
    }],
  }, true);
  c.off('click');
  c.on('click', (p) => {
    const k = rows[p.dataIndex][0];
    state.lang = state.lang === k ? '' : k;
    state.page = 0;
    syncControls();
    render();
  });
}

function renderSources() {
  const rows = tally(filtered.map((a) => a.source || a.domain)).slice(0, 15);
  if (!rows.length) return emptyChart('chart-sources');
  chart('chart-sources').setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 150, right: 40, top: 10, bottom: 24 },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: {
      type: 'category', inverse: true, data: rows.map(([s]) => s),
      axisLabel: { interval: 0, width: 140, overflow: 'truncate' },
    },
    series: [{ type: 'bar', data: rows.map(([, n]) => n), itemStyle: { color: '#6b7280' }, label: { show: true, position: 'right' } }],
  }, true);
}

function tokens(title) {
  const words = title.toLowerCase().replace(/’/g, "'").match(/[a-z][a-z'-]*[a-z]/g) || [];
  return new Set(words
    .map((w) => w.replace(/'s$/, ''))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !brandTokens.has(w)));
}

function renderKeywords() {
  const counts = new Map();
  for (const a of filtered) {
    if (a.lang !== 'en') continue;
    for (const w of tokens(a.title)) counts.set(w, (counts.get(w) || 0) + 1);
  }
  const top = [...counts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (!top.length) return emptyChart('chart-keywords', '英文標題太少');
  chart('chart-keywords').setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 100, right: 40, top: 10, bottom: 24 },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', inverse: true, data: top.map(([w]) => w), axisLabel: { interval: 0 } },
    series: [{ type: 'bar', data: top.map(([, n]) => n), itemStyle: { color: '#2b8cbe' }, label: { show: true, position: 'right' } }],
  }, true);
}

// ---------- 文章列表 ----------

function renderList() {
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.page = Math.min(Math.max(state.page, 0), pages - 1);
  const rows = filtered.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

  $('list').innerHTML = rows.length ? rows.map((a) => {
    const brandTags = (a.brands || []).map((id) => {
      const b = brandById[id];
      return `<span class="tag"><span class="dot" style="background:${b?.color || '#999'}"></span>${esc(b?.name || id)}</span>`;
    }).join('');
    const marketTags = (a.markets || []).map((m) => `<span class="tag market">${esc(mName(m))}</span>`).join('');
    const topicTags = (a.topics || []).map((t) => `<span class="tag">${esc(TOPICS[t] || t)}</span>`).join('');
    return `<article class="item">
      <div class="item-meta">${esc(a.date)}｜${esc(a.source || a.domain)}｜${esc(langLabel(a.lang))}</div>
      <a class="item-title" href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>
      <div>${brandTags}${marketTags}${topicTags}</div>
    </article>`;
  }).join('') : hint('沒有符合條件的文章。可以放寬時間範圍或清除篩選。');

  $('page-label').textContent = `第 ${state.page + 1} / ${pages} 頁，共 ${fmt.int(filtered.length)} 篇`;
  $('prev').disabled = state.page === 0;
  $('next').disabled = state.page >= pages - 1;
}
