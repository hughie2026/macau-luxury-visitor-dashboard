import { $, renderNav, renderFooter, loadJSON, esc, safeUrl, fmt, quarterOf, showError } from './common.js';

renderNav('index.html');
renderFooter();

const MACAU = [113.55, 22.17];
const GREATER_CHINA = ['CHN', 'HKG', 'TWN'];
const NO_DATA = '#d9d9d9';
const SEQ = ['#f1eef6', '#bdc9e1', '#74a9cf', '#2b8cbe', '#045a8d'];
const DIV = ['#ca0020', '#f4a582', '#f7f7f7', '#92c5de', '#0571b0'];
const TONE_BREAKS = [-3, -1, 1, 3];
// 行：報道強度（低→高）；列：人均非博彩消費（低→高）
const BIV = [
  ['#e8e8e8', '#ace4e4', '#5ac8c8'],
  ['#dfb0d6', '#a5add3', '#5698b9'],
  ['#be64ac', '#8c62aa', '#3b4994'],
];
const METRIC_LABELS = {
  news: '新聞報道強度（GDELT 相對值）',
  tone: '新聞平均情緒（全部品牌）',
  visitors: '月度入境旅客（人次）',
  visitors_year: '年度入境旅客（人次）',
  spending: '人均非博彩消費（澳門元，按季）',
};
const PERIOD_NAMES = {
  news: '月份', tone: '月份', bivariate: '月份', visitors: '月份', visitors_year: '年份', spending: '季度',
};
const BRAND_METRICS = ['news', 'bivariate'];
const VISITOR_METRICS = ['visitors', 'visitors_year'];
const MAX_FLOWS = 30;

const state = { metric: 'news', brand: 'all', periodIdx: 0, excludeGC: false, flows: true, selected: null, timer: null };
const names = {};
const centroids = {};
let world, geo, map;
let ready = false;
let articlesPromise = null;
let panelToken = 0;

init();

async function init() {
  try {
    [world, geo] = await Promise.all([loadJSON('world.json'), loadJSON('countries.geojson')]);
  } catch (e) {
    showError($('panel'), e);
    return;
  }
  for (const f of geo.features) {
    const p = f.properties;
    names[p.iso3] = p.name_zh || p.name;
    if (p.lx != null && p.ly != null) centroids[p.iso3] = [p.lx, p.ly];
  }
  setupControls();

  map = new maplibregl.Map({
    container: 'map',
    style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e6eef5' } }] },
    center: [120, 20],
    zoom: 1.4,
    minZoom: 0.8,
    attributionControl: false,
  });
  map.addControl(new maplibregl.AttributionControl({
    customAttribution: 'Natural Earth | GDELT | DSEC | ECB via Frankfurter | World Bank',
  }));
  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  map.on('load', () => {
    map.addSource('countries', { type: 'geojson', data: geo, promoteId: 'iso3' });
    map.addLayer({
      id: 'fill', type: 'fill', source: 'countries',
      paint: { 'fill-color': ['coalesce', ['feature-state', 'color'], NO_DATA], 'fill-opacity': 0.9 },
    });
    map.addLayer({
      id: 'outline', type: 'line', source: 'countries',
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#111', '#fff'],
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2, 0.4],
      },
    });
    map.addSource('flows', { type: 'geojson', data: featureCollection([]) });
    map.addLayer({
      id: 'flows', type: 'line', source: 'flows', layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#e6550d', 'line-opacity': 0.6, 'line-width': ['get', 'w'] },
    });
    map.addSource('macau', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: MACAU } } });
    map.addLayer({
      id: 'macau', type: 'circle', source: 'macau',
      paint: { 'circle-radius': 6, 'circle-color': '#d62728', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
    });

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map.on('mousemove', 'fill', (e) => {
      const iso = e.features[0].properties.iso3;
      map.getCanvas().style.cursor = 'pointer';
      popup.setLngLat(e.lngLat).setHTML(`<strong>${esc(names[iso] || iso)}</strong><br>${esc(describe(iso))}`).addTo(map);
    });
    map.on('mouseleave', 'fill', () => { map.getCanvas().style.cursor = ''; popup.remove(); });
    map.on('click', 'fill', (e) => selectCountry(e.features[0].properties.iso3));

    ready = true;
    update();
  });
}

// ---------- 控制項和時間軸 ----------

function setupControls() {
  const metricSel = $('metric');
  const brandSel = $('brand');
  brandSel.innerHTML = '<option value="all">全部品牌</option>' +
    world.brands.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}（${esc(b.name_zh)}）</option>`).join('');

  // 瀏覽器重新整理時可能保留表單狀態，以畫面上的值為準
  state.metric = metricSel.value;
  state.brand = brandSel.value || 'all';
  state.excludeGC = $('exclude-gc').checked;
  state.flows = $('flows').checked;
  brandSel.disabled = !BRAND_METRICS.includes(state.metric);

  metricSel.onchange = (e) => {
    state.metric = e.target.value;
    brandSel.disabled = !BRAND_METRICS.includes(state.metric);
    stopPlay();
    resetPeriod();
    update();
  };
  brandSel.onchange = (e) => { state.brand = e.target.value; update(); };
  $('exclude-gc').onchange = (e) => { state.excludeGC = e.target.checked; update(); };
  $('flows').onchange = (e) => { state.flows = e.target.checked; update(); };
  $('month').oninput = (e) => { state.periodIdx = Number(e.target.value); update(); };
  $('play').onclick = togglePlay;
  resetPeriod();
}

function periods() {
  const key = state.metric === 'bivariate' ? 'news' : state.metric;
  return world.periods?.[key] ?? [];
}

const currentPeriod = () => periods()[state.periodIdx];

function resetPeriod() {
  const n = periods().length;
  const slider = $('month');
  slider.max = Math.max(n - 1, 0);
  state.periodIdx = Math.max(n - 1, 0);
  slider.value = state.periodIdx;
  slider.disabled = n < 2;
  $('period-name').textContent = PERIOD_NAMES[state.metric];
}

function stopPlay() {
  if (!state.timer) return;
  clearInterval(state.timer);
  state.timer = null;
  $('play').textContent = '▶ 播放';
}

function togglePlay() {
  if (state.timer) { stopPlay(); return; }
  if (periods().length < 2) return;
  if (state.periodIdx >= periods().length - 1) {
    state.periodIdx = 0;
    $('month').value = 0;
    update();
  }
  $('play').textContent = '⏸ 暫停';
  state.timer = setInterval(() => {
    if (state.periodIdx >= periods().length - 1) { stopPlay(); return; }
    state.periodIdx += 1;
    $('month').value = state.periodIdx;
    update();
  }, 1200);
}

// ---------- 數值 ----------

const included = (iso) => iso !== 'MAC' && !(state.excludeGC && GREATER_CHINA.includes(iso));
const featureCollection = (features) => ({ type: 'FeatureCollection', features });

function valueOf(iso, metric, period) {
  const c = world.countries[iso];
  if (!c || !period) return null;
  switch (metric) {
    case 'news': return c.news?.[state.brand]?.[period] ?? null;
    case 'tone': return c.tone?.[period] ?? null;
    case 'visitors': return c.visitors?.[period] ?? null;
    case 'visitors_year': return c.visitors_year?.[period] ?? null;
    case 'spending': return c.spending?.[period] ?? null;
    default: return null;
  }
}

function latest(series) {
  const k = Object.keys(series || {}).sort().at(-1);
  return k ? [k, series[k]] : [null, null];
}

// 佔當期總入境旅客的比例
function shareText(v, period) {
  const total = world.totals?.[period];
  return v != null && total ? `（佔 ${fmt.num((v / total) * 100, 1)}%）` : '';
}

function quantileBreaks(values, k) {
  if (!values.length) return [];
  const v = [...values].sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < k; i++) out.push(v[Math.floor((i * v.length) / k)]);
  return out;
}

function classify(x, breaks) {
  let i = 0;
  while (i < breaks.length && x >= breaks[i]) i++;
  return i;
}

function formatValue(metric, v) {
  if (['visitors', 'visitors_year', 'spending'].includes(metric)) return fmt.int(v);
  if (metric === 'tone') return fmt.num(v, 2);
  return fmt.num(v, 3);
}

function describe(iso) {
  const p = currentPeriod();
  if (state.metric === 'bivariate') {
    const q = p ? quarterOf(p) : null;
    return `報道強度 ${fmt.num(valueOf(iso, 'news', p), 3)}｜人均非博彩消費（${q ?? '—'}）${fmt.int(valueOf(iso, 'spending', q))} 澳門元`;
  }
  const v = valueOf(iso, state.metric, p);
  const share = VISITOR_METRICS.includes(state.metric) ? shareText(v, p) : '';
  return `${METRIC_LABELS[state.metric]}：${formatValue(state.metric, v)}${share}`;
}

// ---------- 更新地圖 ----------

function update() {
  if (!ready) return;
  const period = currentPeriod();
  $('month-label').textContent = period ?? '尚無數據';
  const isos = Object.keys(world.countries).filter(included);
  const colors = {};
  let legend;

  if (state.metric === 'bivariate') {
    const q = period ? quarterOf(period) : null;
    const rows = isos.map((i) => [i, valueOf(i, 'news', period), valueOf(i, 'spending', q)])
      .filter(([, a, b]) => a != null && b != null);
    const bA = quantileBreaks(rows.map((r) => r[1]), 3);
    const bB = quantileBreaks(rows.map((r) => r[2]), 3);
    rows.forEach(([i, a, b]) => { colors[i] = BIV[classify(a, bA)][classify(b, bB)]; });
    legend = bivariateLegend(rows.length, q);
  } else {
    const rows = isos.map((i) => [i, valueOf(i, state.metric, period)]).filter(([, v]) => v != null);
    if (state.metric === 'tone') {
      rows.forEach(([i, v]) => { colors[i] = DIV[classify(v, TONE_BREAKS)]; });
      legend = classLegend(DIV, TONE_BREAKS, 'tone', rows.length);
    } else {
      const breaks = quantileBreaks(rows.map((r) => r[1]), SEQ.length);
      rows.forEach(([i, v]) => { colors[i] = SEQ[classify(v, breaks)]; });
      legend = classLegend(SEQ, breaks, state.metric, rows.length);
    }
    if (state.metric === 'spending') legend += overallNote(period);
    if (VISITOR_METRICS.includes(state.metric)) legend += visitorsNote(period);
  }
  $('legend').innerHTML = legend;

  map.removeFeatureState({ source: 'countries' });
  for (const [iso, color] of Object.entries(colors)) {
    if (names[iso]) map.setFeatureState({ source: 'countries', id: iso }, { color });
  }
  if (state.selected) map.setFeatureState({ source: 'countries', id: state.selected }, { selected: true });

  map.getSource('flows').setData(buildFlows());
  if (state.selected) renderPanel(state.selected);
}

// ---------- 圖例 ----------

const legendRow = (color, label) =>
  `<div class="legend-row"><span class="swatch" style="background:${color}"></span>${esc(label)}</div>`;
const noDataRow = () => legendRow(NO_DATA, '無數據');

function classLegend(colors, breaks, metric, n) {
  const title = `<p class="hint">${esc(METRIC_LABELS[metric])}</p>`;
  if (!n || breaks.length < colors.length - 1) {
    return title + noDataRow() + '<p class="hint">這個時期沒有數據。</p>';
  }
  const f = (v) => formatValue(metric, v);
  const rows = colors.map((c, i) => {
    let label;
    if (i === 0) label = `< ${f(breaks[0])}`;
    else if (i === colors.length - 1) label = `≥ ${f(breaks[i - 1])}`;
    else label = `${f(breaks[i - 1])} – ${f(breaks[i])}`;
    return legendRow(c, label);
  });
  const note = metric === 'tone' ? '大於 0 偏正面，小於 0 偏負面' : '按五等分位分級';
  return title + rows.join('') + noDataRow() + `<p class="hint">${n} 個國家／地區有數據，${note}。</p>`;
}

function bivariateLegend(n, q) {
  let cells = '';
  for (let r = 2; r >= 0; r--) {
    for (let c = 0; c < 3; c++) cells += `<div style="background:${BIV[r][c]}"></div>`;
  }
  return `<div class="biv-wrap"><div>↑ 報道強度</div><div class="biv">${cells}</div>` +
    '<div style="margin-left:28px">人均非博彩消費 →</div></div>' + noDataRow() +
    `<p class="hint">消費用新聞月份所在的季度（${esc(q ?? '—')}）。${n} 個國家／地區兩項都有數據。` +
    '左上：討論多、消費少；右下：討論少、消費多。</p>';
}

function overallNote(q) {
  const o = world.spending_overall || {};
  const parts = [];
  if (o.per_capita_total_non_gaming?.[q] != null) parts.push(`人均非博彩消費 ${fmt.int(o.per_capita_total_non_gaming[q])} 澳門元`);
  if (o.per_capita_shopping?.[q] != null) parts.push(`人均購物 ${fmt.int(o.per_capita_shopping[q])} 澳門元`);
  if (o.shopping_share_of_total?.[q] != null) parts.push(`購物佔 ${fmt.num(o.shopping_share_of_total[q], 1)}%`);
  const overall = parts.length ? `全體旅客（${esc(q)}）：${parts.join('，')}。` : '';
  return `<p class="hint">${overall}DSEC 沒有按客源地公布購物消費，所以地圖用人均非博彩消費。</p>`;
}

function visitorsNote(period) {
  let html = '';
  const total = world.totals?.[period];
  if (total) html += `<p class="hint">當期總入境旅客 ${fmt.int(total)} 人次。</p>`;
  if (state.metric === 'visitors') {
    const ps = periods();
    const missing = Object.keys(world.totals || {})
      .filter((p) => p.length === 7 && ps.length && p >= ps[0] && p <= ps.at(-1) && !ps.includes(p))
      .sort();
    if (missing.length) html += `<p class="hint">${esc(missing.join('、'))} 只有總人次，沒有分客源地數據。</p>`;
  }
  return html + '<p class="hint">DSEC 按旅行證件簽發地統計客源地。</p>';
}

// ---------- 客流飛線 ----------

// 旅客指標用當期數據，其他指標用最新年度數據
function flowSource() {
  if (VISITOR_METRICS.includes(state.metric)) return { field: state.metric, period: currentPeriod() };
  return { field: 'visitors_year', period: world.periods?.visitors_year?.at(-1) };
}

function buildFlows() {
  const note = $('flow-note');
  if (!state.flows) { note.textContent = ''; return featureCollection([]); }
  const { field, period } = flowSource();
  if (!period) { note.textContent = '沒有旅客數據'; return featureCollection([]); }

  const rows = Object.keys(world.countries).filter(included)
    .map((iso) => [iso, valueOf(iso, field, period)])
    .filter(([iso, v]) => v > 0 && centroids[iso])
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_FLOWS);
  note.textContent = `飛線：${period}${field === 'visitors_year' ? ' 年' : ''}入境旅客，前 ${rows.length} 個客源地`;
  if (!rows.length) return featureCollection([]);

  const max = Math.sqrt(rows[0][1]);
  return featureCollection(rows.map(([iso, v]) => ({
    type: 'Feature',
    properties: { iso3: iso, w: 1 + (9 * Math.sqrt(v)) / max },
    geometry: { type: 'LineString', coordinates: arc(centroids[iso], MACAU) },
  })));
}

// 二次貝茲曲線；跨越 180° 經線時走較短的一邊
function arc(from, to, steps = 48) {
  let [x0, y0] = from;
  const [x1, y1] = to;
  if (x1 - x0 > 180) x0 += 360;
  else if (x0 - x1 > 180) x0 -= 360;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const k = 0.2 * (Math.sign(dx) || 1);
  const cx = (x0 + x1) / 2 - dy * k;
  const cy = Math.min((y0 + y1) / 2 + dx * k, 80);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = (1 - t) ** 2, b = 2 * (1 - t) * t, c = t ** 2;
    pts.push([a * x0 + b * cx + c * x1, a * y0 + b * cy + c * y1]);
  }
  return pts;
}

// ---------- 國家詳情 ----------

function selectCountry(iso) {
  if (state.selected) map.setFeatureState({ source: 'countries', id: state.selected }, { selected: false });
  state.selected = iso;
  map.setFeatureState({ source: 'countries', id: iso }, { selected: true });
  renderPanel(iso);
}

function getArticles() {
  articlesPromise ??= loadJSON('articles.json').catch((e) => { articlesPromise = null; throw e; });
  return articlesPromise;
}

const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;

async function renderPanel(iso) {
  const token = ++panelToken;
  const c = world.countries[iso] || {};
  const period = currentPeriod();
  let html = `<h2>${esc(names[iso] || iso)}</h2>`;

  // 入境旅客：歷年 + 最新月度
  const years = Object.keys(c.visitors_year || {}).sort();
  const [vm, vmValue] = latest(c.visitors);
  html += '<h2>入境旅客（人次）</h2>';
  if (years.length || vm) {
    html += '<dl>' + years.map((y) =>
      row(`${esc(y)} 年`, fmt.int(c.visitors_year[y]) + shareText(c.visitors_year[y], y))).join('');
    if (vm) html += row(`最新月度（${esc(vm)}）`, fmt.int(vmValue) + shareText(vmValue, vm));
    html += '</dl><p class="hint">括號內是佔當期總入境旅客的比例。</p>';
  } else {
    html += '<p class="hint">DSEC 沒有單獨公布這個客源地。</p>';
  }

  // 消費：按當前季度，否則用最新季度
  let q;
  if (state.metric === 'spending') q = period;
  else if (state.metric === 'bivariate' && period) q = quarterOf(period);
  else q = latest(c.spending)[0];
  html += '<h2>人均非博彩消費</h2>' + (q
    ? `<dl>${row(esc(q), `${fmt.int(c.spending?.[q])} 澳門元`)}</dl>`
    : '<p class="hint">DSEC 沒有公布這個客源地的數據。</p>');

  // 新聞：新聞類指標用當前月份，否則用最新月份
  const newsMonth = ['news', 'tone', 'bivariate'].includes(state.metric) ? period : world.periods?.news?.at(-1);
  html += `<h2>新聞（${esc(newsMonth ?? '—')}）</h2><dl>
    ${row('平均情緒', fmt.num(c.tone?.[newsMonth], 2))}
    ${row('報道強度（全部品牌）', fmt.num(c.news?.all?.[newsMonth], 3))}
  </dl>`;
  const brandRows = world.brands
    .map((b) => [b, c.news?.[b.id]?.[newsMonth]])
    .filter(([, v]) => v != null && v > 0)
    .sort((a, b) => b[1] - a[1]);
  html += brandRows.length
    ? '<dl>' + brandRows.map(([b, v]) => row(esc(b.name), fmt.num(v, 3))).join('') + '</dl>'
    : '<p class="hint">這個月沒有品牌報道。</p>';

  if (c.fx) {
    const unit = c.fx.hkd_per_unit < 0.01 ? 1000 : c.fx.hkd_per_unit < 0.1 ? 100 : 1;
    html += `<h2>匯率</h2><dl>
      ${row(`${unit} ${esc(c.fx.currency)}`, `${fmt.num(c.fx.hkd_per_unit * unit, 3)} 港幣`)}
      ${row('一年變化', fmt.pct(c.fx.change_1y_pct))}
    </dl><p class="hint">正值表示來澳門購物變便宜。比較 ${esc(c.fx.compare_date)} 與 ${esc(c.fx.date)}。</p>`;
  }

  if (c.wb) {
    const wb = c.wb;
    const year = (k) => (wb[k]?.year ? `（${esc(wb[k].year)}）` : '');
    html += `<h2>經濟指標</h2><dl>
      ${row(`人均 GDP${year('gdp_pc')}`, `${fmt.int(wb.gdp_pc?.value)} 美元`)}
      ${row(`出境旅遊支出${year('outbound_exp')}`, fmt.usd100m(wb.outbound_exp?.value))}
      ${row(`出境人次${year('departures')}`, fmt.wan(wb.departures?.value))}
    </dl>`;
  }

  html += '<h2>代表新聞</h2><div id="panel-articles"><p class="hint">載入中…</p></div>';
  $('panel').innerHTML = html;

  try {
    const list = await getArticles();
    if (token !== panelToken) return;
    const picks = list
      .filter((a) => a.iso3 === iso && (state.brand === 'all' || a.brands?.includes(state.brand)))
      .slice(0, 5);
    if (!picks.length) {
      $('panel-articles').innerHTML = '<p class="hint">沒有來自這個國家的文章。</p>';
      return;
    }
    const params = new URLSearchParams({ country: picks[0].country });
    if (state.brand !== 'all') params.set('brand', state.brand);
    $('panel-articles').innerHTML = '<ul>' + picks.map((a) =>
      `<li><a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.title || a.url)}</a>` +
      `<br><span class="hint">${esc(a.date)}｜${esc(a.domain)}</span></li>`).join('') + '</ul>' +
      `<p><a href="news.html?${esc(params.toString())}">查看全部文章 →</a></p>`;
  } catch (e) {
    if (token === panelToken) showError($('panel-articles'), e);
  }
}
