import { $, renderNav, renderFooter, loadJSON, esc, safeUrl, fmt, quarterOf, showError } from './common.js';

renderNav('index.html');
renderFooter();

const MACAU = [113.55, 22.17];
const GREATER_CHINA = ['CHN', 'HKG', 'TWN'];
const NO_DATA = '#d9d9d9';
const SEQ = ['#f1eef6', '#bdc9e1', '#74a9cf', '#2b8cbe', '#045a8d'];
const DIV = ['#ca0020', '#f4a582', '#f7f7f7', '#92c5de', '#0571b0'];
const TONE_BREAKS = [-3, -1, 1, 3];
// 行：報道強度（低→高）；列：人均購物（低→高）
const BIV = [
  ['#e8e8e8', '#ace4e4', '#5ac8c8'],
  ['#dfb0d6', '#a5add3', '#5698b9'],
  ['#be64ac', '#8c62aa', '#3b4994'],
];
const METRIC_LABELS = {
  news: '新聞報道強度（GDELT 相對值）',
  visitors: '入境旅客（人次）',
  spending: '人均購物消費（澳門元，按季）',
  tone: '新聞平均情緒（全部品牌）',
};

const state = { metric: 'news', brand: 'all', monthIdx: 0, excludeGC: false, flows: true, selected: null, timer: null };
const names = {};
const centroids = {};
let world, geo, map, ready = false, articles = null;

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

function setupControls() {
  const brandSel = $('brand');
  brandSel.innerHTML = '<option value="all">全部品牌</option>' +
    world.brands.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}（${esc(b.name_zh)}）</option>`).join('');

  $('metric').onchange = (e) => {
    state.metric = e.target.value;
    brandSel.disabled = !['news', 'bivariate'].includes(state.metric);
    update();
  };
  brandSel.onchange = (e) => { state.brand = e.target.value; update(); };
  $('exclude-gc').onchange = (e) => { state.excludeGC = e.target.checked; update(); };
  $('flows').onchange = (e) => { state.flows = e.target.checked; update(); };

  const slider = $('month');
  slider.max = Math.max(world.months.length - 1, 0);
  slider.value = slider.max;
  state.monthIdx = Number(slider.max);
  slider.oninput = (e) => { state.monthIdx = Number(e.target.value); update(); };
  $('play').onclick = togglePlay;
}

function togglePlay() {
  const btn = $('play');
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
    btn.textContent = '▶ 播放';
    return;
  }
  if (world.months.length < 2) return;
  if (state.monthIdx >= world.months.length - 1) state.monthIdx = 0;
  btn.textContent = '⏸ 暫停';
  state.timer = setInterval(() => {
    if (state.monthIdx >= world.months.length - 1) { togglePlay(); return; }
    state.monthIdx += 1;
    $('month').value = state.monthIdx;
    update();
  }, 1200);
}

const currentMonth = () => world.months[state.monthIdx];
const included = (iso) => iso !== 'MAC' && !(state.excludeGC && GREATER_CHINA.includes(iso));

function valueOf(iso, metric, month) {
  const c = world.countries[iso];
  if (!c || !month) return null;
  switch (metric) {
    case 'news': return c.news?.[state.brand]?.[month] ?? null;
    case 'visitors': return c.visitors?.[month] ?? null;
    case 'spending': return c.spending?.[quarterOf(month)] ?? null;
    case 'tone': return c.tone?.[month] ?? null;
    default: return null;
  }
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
  if (metric === 'visitors' || metric === 'spending') return fmt.int(v);
  if (metric === 'tone') return fmt.num(v, 2);
  return fmt.num(v, 3);
}

function describe(iso) {
  const month = currentMonth();
  if (state.metric === 'bivariate') {
    return `報道強度 ${fmt.num(valueOf(iso, 'news', month), 3)}｜人均購物 ${fmt.int(valueOf(iso, 'spending', month))} 澳門元`;
  }
  const v = valueOf(iso, state.metric, month);
  return `${METRIC_LABELS[state.metric]}：${formatValue(state.metric, v)}`;
}

function update() {
  if (!ready) return;
  const month = currentMonth();
  $('month-label').textContent = month ?? '—';
  const isos = Object.keys(world.countries).filter(included);
  const colors = {};

  if (state.metric === 'bivariate') {
    const rows = isos.map((i) => [i, valueOf(i, 'news', month), valueOf(i, 'spending', month)])
      .filter(([, a, b]) => a != null && b != null);
    const bA = quantileBreaks(rows.map((r) => r[1]), 3);
    const bB = quantileBreaks(rows.map((r) => r[2]), 3);
    rows.forEach(([i, a, b]) => { colors[i] = BIV[classify(a, bA)][classify(b, bB)]; });
    $('legend').innerHTML = bivariateLegend(rows.length);
  } else {
    const rows = isos.
