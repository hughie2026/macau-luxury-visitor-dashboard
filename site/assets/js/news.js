import { $, renderNav, renderFooter, loadJSON, esc, safeUrl, TOPICS, showError } from './common.js';

renderNav('news.html');
renderFooter();

const PAGE_SIZE = 50;
const NO_TOPIC = '_none';
const TOPIC_LABELS = { ...TOPICS, [NO_TOPIC]: '未分類' };
const CHART_IDS = ['chart-topics', 'chart-keywords'];
// GDELT 的 language 欄位是英文全名
const LANGS = {
  English: '英語', Chinese: '中文', Japanese: '日語', Korean: '韓語', Thai: '泰語',
  Vietnamese: '越南語', Indonesian: '印尼語', Malay: '馬來語', Tagalog: '他加祿語',
  French: '法語', German: '德語', Spanish: '西班牙語', Portuguese: '葡萄牙語',
  Italian: '意大利語', Russian: '俄語', Arabic: '阿拉伯語',
};
const STOPWORDS = new Set(`the and for with from that this these those are was were been has have had
  not but its into over after about amid than more most how why what who when where will would could
  should can may new says said say your you our their they his her him she was all one two first year
  years per via out off just also now get gets top big more best here there which while
  macau macao macau's macao's`.split(/\s+/));

const state = { brand: '', country: '', lang: '', topic: '', q: '', page: 0 };
const charts = {};
const hasCharts = typeof window.echarts !== 'undefined';
let articles = [];
let brands = [];
let brandTokens = new Set();
let filtered = [];

init();

function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const hint = (msg) => `<p class="hint">${esc(msg)}</p>`;

async function init() {
  try {
    const [list, b] = await Promise.all([loadJSON('articles.json'), loadJSON('brands.json')]);
    articles = Array.isArray(list) ? list : [];
    brands = b?.brands || [];
  } catch (e) {
    showError($('table-wrap'), e);
    return;
  }

  if (!hasCharts) {
    CHART_IDS.forEach((id) => { $(id).innerHTML = hint('圖表庫（ECharts CDN）載入失敗，請重新整理頁面或檢查網絡。'); });
  }

  if (!articles.length) {
    $('count').textContent = '0 篇';
    const msg = '還沒有文章數據：site/data/articles.json 是空的。' +
      '請到 GitHub Actions 手動運行「Update data and deploy」並勾選 backfill，' +
      '然後在 Fetch sources 日誌中確認出現「文章 N 篇」。只推送代碼不會抓取數據。';
    $('table-wrap').innerHTML = hint(msg);
    if (hasCharts) CHART_IDS.forEach((id) => { $(id).innerHTML = hint('沒有數據'); });
    for (const id of ['f-brand', 'f-country', 'f-lang', 'f-topic', 'f-q', 'prev', 'next']) $(id).disabled = true;
    return;
  }

  try {
    brandTokens = new Set(brands.flatMap((b) =>
      b.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/)));

    const params = new URLSearchParams(location.search);
    for (const k of ['brand', 'country', 'lang', 'topic', 'q']) state[k] = params.get(k) || '';

    setupFilters();
    render();
    window.addEventListener('resize', () => Object.values(charts).forEach((c) => c.resize()));
  } catch (e) {
    showError($('table-wrap'), e);
  }
}

// ---------- 篩選 ----------

function countBy(fn) {
  const m = new Map();
  for (const a of articles) for (const k of fn(a)) if (k) m.set(k, (m.get(k) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

function fillSelect(el, allLabel, entries, key) {
  el.innerHTML = `<option value="">${esc(allLabel)}</option>` +
    entries.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
  el.value = state[key];
  if (el.value !== state[key]) {
    el.value = '';
    state[key] = '';
  }
  el.onchange = (e) => {
    state[key] = e.target.value;
    state.page = 0;
    render();
  };
}

function setupFilters() {
  const brandCounts = Object.fromEntries(countBy((a) => a.brands || []));
  fillSelect($('f-brand'), '全部品牌',
    brands.map((b) => [b.id, `${b.name}（${brandCounts[b.id] || 0}）`]), 'brand');
  fillSelect($('f-country'), '全部國家',
    countBy((a) => [a.country]).map(([c, n]) => [c, `${c}（${n}）`]), 'country');
  fillSelect($('f-lang'), '全部語言',
    countBy((a) => [a.lang]).map(([l, n]) => [l, `${LANGS[l] || l}（${n}）`]), 'lang');
  fillSelect($('f-topic'), '全部主題', Object.entries(TOPIC_LABELS), 'topic');

  const q = $('f-q');
  q.value = state.q;
  q.oninput = debounce(() => {
    state.q = q.value.trim();
    state.page = 0;
    render();
  });

  $('prev').onclick = () => { state.page -= 1; renderTable(); };
  $('next').onclick = () => { state.page += 1; renderTable(); };
}

function matches(a, ignoreTopic = false) {
  const q = state.q.toLowerCase();
  const topics = a.topics || [];
  return (!state.brand || (a.brands || []).includes(state.brand)) &&
    (!state.country || a.country === state.country) &&
    (!state.lang || a.lang === state.lang) &&
    (ignoreTopic || !state.topic ||
      (state.topic === NO_TOPIC ? !topics.length : topics.includes(state.topic))) &&
    (!q || (a.title || '').toLowerCase().includes(q));
}

function render() {
  filtered = articles.filter((a) => matches(a));
  $('count').textContent = `${filtered.length.toLocaleString('zh-Hant')} / ${articles.length.toLocaleString('zh-Hant')} 篇`;
  syncUrl();
  // 先畫表格，即使圖表出錯，文章列表也會顯示
  renderTable();
  if (hasCharts) {
    try {
      renderTopics();
      renderKeywords();
    } catch (e) {
      console.error(e);
      CHART_IDS.forEach((id) => { $(id).innerHTML = hint(`圖表繪製失敗：${e.message}`); });
    }
  }
}

function syncUrl() {
  const params = new URLSearchParams();
  for (const k of ['brand', 'country', 'lang', 'topic', 'q']) if (state[k]) params.set(k, state[k]);
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// ---------- 圖表 ----------

function chart(id) {
  charts[id] ??= echarts.init($(id));
  return charts[id];
}

const emptyTitle = (show, text) => ({
  show, text, left: 'center', top: 'middle', textStyle: { color: '#999', fontSize: 13, fontWeight: 'normal' },
});

function renderTopics() {
  // 主題圖不受主題篩選影響，否則只會剩下一根柱
  const base = articles.filter((a) => matches(a, true));
  const keys = Object.keys(TOPIC_LABELS);
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const a of base) {
    const t = a.topics || [];
    if (!t.length) counts[NO_TOPIC] += 1;
    else t.forEach((k) => { if (k in counts) counts[k] += 1; });
  }

  const c = chart('chart-topics');
  c.setOption({
    title: emptyTitle(!base.length, '沒有數據'),
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 100, right: 30, top: 10, bottom: 30 },
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
  });
  c.off('click');
  c.on('click', (p) => {
    const k = keys[p.dataIndex];
    state.topic = state.topic === k ? '' : k;
    $('f-topic').value = state.topic;
    state.page = 0;
    render();
  });
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
    if (a.lang !== 'English' || !a.title) continue;
    for (const w of tokens(a.title)) counts.set(w, (counts.get(w) || 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25);

  chart('chart-keywords').setOption({
    title: emptyTitle(!top.length, '沒有英文標題'),
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 110, right: 30, top: 10, bottom: 30 },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', inverse: true, data: top.map(([w]) => w), axisLabel: { interval: 0 } },
    series: [{ type: 'bar', data: top.map(([, n]) => n), itemStyle: { color: '#2b8cbe' } }],
  }, true);
}

// ---------- 文章列表 ----------

function renderTable() {
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.page = Math.min(Math.max(state.page, 0), pages - 1);
  const rows = filtered.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
  const brandName = Object.fromEntries(brands.map((b) => [b.id, b.name]));

  if (!rows.length) {
    $('table-wrap').innerHTML = hint('沒有符合條件的文章。');
  } else {
    $('table-wrap').innerHTML = `<table>
      <thead><tr><th>日期</th><th>標題</th><th>來源</th><th>國家</th><th>語言</th><th>品牌</th><th>主題</th></tr></thead>
      <tbody>${rows.map((a) => `<tr>
        <td>${esc(a.date)}</td>
        <td><a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.title || a.url)}</a></td>
        <td>${esc(a.domain)}</td>
        <td>${esc(a.country)}</td>
        <td>${esc(LANGS[a.lang] || a.lang)}</td>
        <td>${(a.brands || []).map((b) => `<span class="tag">${esc(brandName[b] || b)}</span>`).join('')}</td>
        <td>${(a.topics || []).map((t) => `<span class="tag">${esc(TOPICS[t] || t)}</span>`).join('')}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }

  $('page-label').textContent = `第 ${state.page + 1} / ${pages} 頁`;
  $('prev').disabled = state.page === 0;
  $('next').disabled = state.page >= pages - 1;
}
