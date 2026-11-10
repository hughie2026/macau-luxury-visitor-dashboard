import { $, renderNav, renderFooter, loadJSON, esc, brandColor, LANG_NAMES, showError } from './common.js';

renderNav('brands.html');
renderFooter();

const charts = {};
let data;

init();

async function init() {
  try {
    data = await loadJSON('brands.json');
  } catch (e) {
    showError($('chart-volume'), e);
    return;
  }
  renderDaily('chart-volume', 'volume', 3);
  renderDaily('chart-tone', 'tone', 2);
  renderWikiShare();
  setupWikiTrend();
  window.addEventListener('resize', () => Object.values(charts).forEach((c) => c.resize()));
}

function chart(id) {
  charts[id] ??= echarts.init($(id));
  return charts[id];
}

function empty(id, msg) {
  if (charts[id]) {
    charts[id].dispose();
    delete charts[id];
  }
  $(id).innerHTML = `<p class="hint">${esc(msg)}</p>`;
}

const langLabel = (l) => (LANG_NAMES[l] ? `${LANG_NAMES[l]}（${l}）` : l);

// 7 日移動平均，輸入輸出都是 [[日期, 值], ...]
function rolling(points, n = 7) {
  return points.map((p, i) => {
    const win = points.slice(Math.max(0, i - n + 1), i + 1).map((x) => x[1]).filter((v) => v != null);
    return [p[0], win.length ? win.reduce((a, b) => a + b, 0) / win.length : null];
  });
}

// ---------- 新聞報道強度和情緒 ----------

function renderDaily(id, key, digits) {
  const series = data.brands.map((b, i) => ({
    name: b.name,
    type: 'line',
    showSymbol: false,
    color: brandColor(i),
    data: rolling(data.daily[b.id]?.[key] ?? []).map(([d, v]) => [d, v == null ? null : Number(v.toFixed(digits + 1))]),
  })).filter((s) => s.data.length);

  if (!series.length) {
    empty(id, '尚無數據。GDELT 抓取後會出現。');
    return;
  }
  if (key === 'tone') {
    series[0].markLine = {
      silent: true, symbol: 'none', label: { show: false },
      lineStyle: { color: '#999', type: 'dashed' }, data: [{ yAxis: 0 }],
    };
  }
  chart(id).setOption({
    tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? '—' : Number(v).toFixed(digits)) },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 50, right: 20, top: 40, bottom: 60 },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', scale: key === 'tone' },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 10 }],
    series,
  });
}

// ---------- 維基百科 ----------

function wikiMonths() {
  const s = new Set();
  for (const perLang of Object.values(data.wiki || {})) {
    for (const series of Object.values(perLang)) Object.keys(series).forEach((m) => s.add(m));
  }
  return [...s].sort();
}

function renderWikiShare() {
  const months = wikiMonths().slice(-12);
  const brands = data.brands.filter((b) => data.wiki?.[b.id]);
  const langs = data.wiki_langs.filter((l) => brands.some((b) => data.wiki[b.id][l]));
  if (!months.length || !brands.length || !langs.length) {
    empty('chart-wiki', '尚無維基百科數據。');
    return;
  }

  const sum = (bid, lang) => months.reduce((t, m) => t + (data.wiki[bid]?.[lang]?.[m] ?? 0), 0);
  const cells = [];
  let max = 0;
  langs.forEach((lang, x) => {
    const totals = brands.map((b) => sum(b.id, lang));
    const total = totals.reduce((a, b) => a + b, 0);
    if (!total) return;
    totals.forEach((v, y) => {
      const pct = Number(((v / total) * 100).toFixed(1));
      cells.push([x, y, pct]);
      max = Math.max(max, pct);
    });
  });

  chart('chart-wiki').setOption({
    title: {
      text: `${months[0]} 至 ${months.at(-1)}`,
      right: 10, top: 0, textStyle: { fontSize: 12, color: '#6b7280', fontWeight: 'normal' },
    },
    tooltip: {
      formatter: (p) => `${esc(langLabel(langs[p.value[0]]))}<br>${esc(brands[p.value[1]].name)}：${p.value[2]}%`,
    },
    grid: { left: 110, right: 20, top: 30, bottom: 80 },
    xAxis: { type: 'category', data: langs.map(langLabel), splitArea: { show: true }, axisLabel: { interval: 0, rotate: 30 } },
    yAxis: { type: 'category', data: brands.map((b) => b.name), splitArea: { show: true } },
    visualMap: {
      min: 0, max: Math.max(1, Math.ceil(max)), calculable: true,
      orient: 'horizontal', left: 'center', bottom: 0,
      inRange: { color: ['#f7fbff', '#6baed6', '#08306b'] },
    },
    series: [{ type: 'heatmap', data: cells, label: { show: true, formatter: (p) => `${p.value[2]}%` } }],
  });
}

function setupWikiTrend() {
  const sel = $('wiki-target');
  const options = data.brands
    .filter((b) => data.wiki?.[b.id])
    .map((b) => [b.id, `${b.name}（${b.name_zh}）`]);
  if (data.wiki?._macau) options.push(['_macau', '澳門（Macau）']);

  if (!options.length) {
    sel.disabled = true;
    empty('chart-wiki-trend', '尚無維基百科數據。');
    return;
  }
  sel.innerHTML = options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  sel.onchange = () => renderWikiTrend(sel.value);
  renderWikiTrend(options[0][0]);
}

function renderWikiTrend(key) {
  const perLang = data.wiki[key] || {};
  const months = wikiMonths();
  const series = data.wiki_langs.filter((l) => perLang[l]).map((l) => ({
    name: langLabel(l),
    type: 'line',
    showSymbol: false,
    // 對數刻度不能顯示 0，改成缺值
    data: months.map((m) => (perLang[l][m] > 0 ? perLang[l][m] : null)),
  }));
  chart('chart-wiki-trend').setOption({
    tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? '—' : Number(v).toLocaleString('zh-Hant')) },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 70, right: 20, top: 40, bottom: 60 },
    xAxis: { type: 'category', data: months },
    yAxis: { type: 'log', name: '瀏覽量（對數刻度）', min: 1 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 10 }],
    series,
  }, true);
}
