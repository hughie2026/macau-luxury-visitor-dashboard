import { $, renderNav, renderFooter, loadJSON, esc, fmt, brandColor, showError } from './common.js';

renderNav('macau.html');
renderFooter();

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const CENTER = [113.56, 22.165];
const NEAR_METERS = 400;
const VENUE_LAYERS = [
  { id: 'hotels', label: '酒店', color: '#0891b2', prop: 'is_hotel', radius: 5 },
  { id: 'casinos', label: '娛樂場', color: '#7c3aed', prop: 'is_casino', radius: 7 },
  { id: 'malls', label: '購物中心', color: '#ea580c', prop: 'is_mall', radius: 6 },
];
const TOGGLES = [
  ...VENUE_LAYERS.map(({ id, label, color }) => ({ id, label, color })),
  { id: 'ports', label: '入境口岸', color: '#dc2626' },
  { id: 'stores', label: '品牌門店', color: '#374151' },
];

const state = { brand: 'all', month: null };
const brandInfo = {};
const nearCache = new Map();
let places, portsData, map;
let venues = [];
let listed = [];
let portTotal = 0;
let ready = false;
const popup = new maplibregl.Popup({ maxWidth: '300px' });

init();

async function init() {
  try {
    const [p, ports, brands] = await Promise.all([
      loadJSON('macau.geojson'), loadJSON('ports.json'), loadJSON('brands.json'),
    ]);
    places = p;
    portsData = ports;
    brands.brands.forEach((b, i) => {
      brandInfo[b.id] = { ...b, color: brandColor(i), stats: recentStats(brands.daily?.[b.id]) };
    });
  } catch (e) {
    showError($('store-list'), e);
    return;
  }

  venues = places.features.filter((f) => {
    const p = f.properties;
    return p.is_mall || p.is_casino || p.is_hotel;
  });
  setupControls();
  renderStoreList();

  map = new maplibregl.Map({
    container: 'map',
    style: STYLE,
    center: CENTER,
    zoom: 12.3,
    attributionControl: { customAttribution: '口岸旅客：DSEC' },
  });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.on('load', addLayers);
}

function addLayers() {
  map.addSource('places', { type: 'geojson', data: places });
  for (const l of VENUE_LAYERS) {
    map.addLayer({
      id: l.id, type: 'circle', source: 'places',
      filter: ['==', ['get', l.prop], true],
      paint: {
        'circle-radius': l.radius,
        'circle-color': l.color,
        'circle-opacity': 0.75,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1,
      },
    });
  }

  map.addSource('ports', { type: 'geojson', data: portsGeoJSON() });
  map.addLayer({
    id: 'ports', type: 'circle', source: 'ports',
    paint: {
      'circle-radius': ['get', 'r'],
      'circle-color': ['case', ['get', 'has_data'], '#dc2626', '#9ca3af'],
      'circle-opacity': 0.5,
      'circle-stroke-color': '#7f1d1d',
      'circle-stroke-width': 1,
    },
  });

  map.addLayer({
    id: 'stores', type: 'circle', source: 'places',
    filter: storeFilter(),
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 8],
      'circle-color': brandMatch(),
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 1.5,
    },
  });

  for (const id of ['hotels', 'casinos', 'malls', 'stores']) {
    map.on('click', id, (e) => {
      const f = e.features[0];
      popup.setLngLat(f.geometry.coordinates).setHTML(placeHTML(f.properties, f.geometry.coordinates)).addTo(map);
    });
  }
  map.on('click', 'ports', (e) => {
    const f = e.features[0];
    popup.setLngLat(f.geometry.coordinates).setHTML(portHTML(f.properties)).addTo(map);
  });
  for (const id of TOGGLES.map((t) => t.id)) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }

  ready = true;
  applyVisibility();
}

// ---------- 控制項 ----------

function setupControls() {
  const toggles = $('layer-toggles');
  toggles.innerHTML = TOGGLES.map((t) =>
    `<label class="check"><input type="checkbox" data-layer="${t.id}" checked>` +
    `<span class="dot" style="background:${t.color}"></span>${esc(t.label)}</label>`).join('');
  toggles.onchange = applyVisibility;

  const counts = {};
  for (const f of places.features) {
    if (f.properties.is_store) counts[f.properties.brand_id] = (counts[f.properties.brand_id] || 0) + 1;
  }
  const brandSel = $('brand');
  brandSel.innerHTML = '<option value="all">全部品牌</option>' + Object.values(brandInfo).map((b) =>
    `<option value="${esc(b.id)}">${esc(b.name)}（${counts[b.id] || 0} 間）</option>`).join('');
  brandSel.onchange = (e) => {
    state.brand = e.target.value;
    if (ready) map.setFilter('stores', storeFilter());
    renderStoreList();
  };

  const monthSel = $('port-month');
  const months = [...portsData.months].reverse();
  if (!months.length) {
    monthSel.innerHTML = '<option>尚無數據</option>';
    monthSel.disabled = true;
  } else {
    monthSel.innerHTML = months.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    state.month = months[0];
    monthSel.onchange = (e) => {
      state.month = e.target.value;
      if (ready) map.getSource('ports').setData(portsGeoJSON());
      popup.remove();
    };
  }

  $('store-list').onclick = (e) => {
    const btn = e.target.closest('button[data-i]');
    if (!btn || !ready) return;
    const f = listed[Number(btn.dataset.i)];
    const coords = f.geometry.coordinates;
    map.flyTo({ center: coords, zoom: 17 });
    popup.setLngLat(coords).setHTML(placeHTML(f.properties, coords)).addTo(map);
  };
}

function applyVisibility() {
  if (!ready) return;
  for (const input of $('layer-toggles').querySelectorAll('input[data-layer]')) {
    const id = input.dataset.layer;
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', input.checked ? 'visible' : 'none');
  }
}

function storeFilter() {
  const base = ['==', ['get', 'is_store'], true];
  return state.brand === 'all' ? base : ['all', base, ['==', ['get', 'brand_id'], state.brand]];
}

function brandMatch() {
  const pairs = Object.values(brandInfo).flatMap((b) => [b.id, b.color]);
  return pairs.length ? ['match', ['coalesce', ['get', 'brand_id'], ''], ...pairs, '#666'] : '#666';
}

// ---------- 門店列表 ----------

function renderStoreList() {
  const stores = places.features.filter((f) =>
    f.properties.is_store && (state.brand === 'all' || f.properties.brand_id === state.brand));
  if (!stores.length) {
    $('store-list').innerHTML = '<p class="hint">沒有門店資料。OSM 可能尚未收錄，或尚未運行 fetch_osm.py。</p>';
    return;
  }
  const groups = {};
  for (const f of stores) (groups[f.properties.brand_id] ??= []).push(f);

  listed = [];
  $('store-list').innerHTML = Object.keys(brandInfo).filter((id) => groups[id]).map((id) => {
    const b = brandInfo[id];
    const items = groups[id]
      .map((f) => [f, storeLabel(f)])
      .sort((a, b2) => a[1].localeCompare(b2[1], 'zh-Hant'))
      .map(([f, label]) => {
        listed.push(f);
        return `<button type="button" data-i="${listed.length - 1}">${esc(label)}</button>`;
      }).join('');
    const open = state.brand !== 'all' ? ' open' : '';
    return `<details class="store-group"${open}><summary><span class="dot" style="background:${b.color}"></span>` +
      `${esc(b.name)}（${groups[id].length}）</summary>${items}</details>`;
  }).join('');
}

function storeLabel(f) {
  const near = nearestVenue(f);
  const name = placeName(f.properties);
  return near ? `${near.name}・${name}` : name;
}

// ---------- 彈出視窗 ----------

function placeName(p) {
  return p.name_zh || p.name || p.name_en || '（未命名）';
}

function placeHTML(p, coords) {
  const title = placeName(p);
  const others = [...new Set([p.name, p.name_en].filter((n) => n && n !== title))];
  const kinds = [p.is_mall && '購物中心', p.is_hotel && '酒店', p.is_casino && '娛樂場'].filter(Boolean);

  let html = `<strong>${esc(title)}</strong>`;
  if (others.length) html += `<br><span class="hint">${esc(others.join(' / '))}</span>`;
  if (kinds.length) html += `<br>${esc(kinds.join('、'))}`;

  const b = p.is_store ? brandInfo[p.brand_id] : null;
  if (b) {
    const near = nearestVenue({ properties: p, geometry: { coordinates: coords } });
    if (near) html += `<br>位於／鄰近：${esc(near.name)}（約 ${Math.round(near.d)} 米）`;
    html += `<hr><span class="dot" style="background:${b.color}"></span><strong>${esc(b.name)}</strong>（${esc(b.name_zh)}）`;
    if (b.stats) {
      html += `<br>最近 30 天「澳門 + 品牌」新聞：<br>報道強度 ${fmt.num(b.stats.volume, 3)}｜情緒 ${fmt.num(b.stats.tone, 2)}`;
      if (b.stats.to) html += `<br><span class="hint">截至 ${esc(b.stats.to)}</span>`;
    }
    html += `<br><a href="brands.html">品牌對比</a>｜<a href="news.html?brand=${encodeURIComponent(b.id)}">相關新聞</a>`;
  }
  if (p.osm) {
    html += `<br><a href="https://www.openstreetmap.org/${esc(p.osm)}" target="_blank" rel="noopener noreferrer">在 OSM 查看或修正</a>`;
  }
  return html;
}

function portHTML(p) {
  let html = `<strong>${esc(p.name_zh)}</strong><br><span class="hint">${esc(p.name_en)}</span><br>`;
  if (!state.month) return html + '尚無口岸旅客數據';
  if (!p.has_data) return html + `${esc(state.month)}：沒有數據`;
  const share = portTotal ? `（佔 ${fmt.num((p.visitors / portTotal) * 100, 1)}%）` : '';
  return html + `${esc(state.month)} 入境旅客：${fmt.int(p.visitors)} 人次${share}`;
}

// ---------- 口岸 ----------

function portsGeoJSON() {
  const vals = portsData.ports.map((p) => portsData.arrivals[p.id]?.[state.month] ?? null);
  const present = vals.filter((v) => v != null);
  const max = Math.max(0, ...present);
  portTotal = present.reduce((a, b) => a + b, 0);
  return {
    type: 'FeatureCollection',
    features: portsData.ports.map((p, i) => {
      const v = vals[i];
      const props = { id: p.id, name_zh: p.name_zh, name_en: p.name_en, has_data: v != null, r: 6 };
      if (v != null) {
        props.visitors = v;
        if (max > 0) props.r = 6 + 22 * Math.sqrt(v / max);
      }
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: props };
    }),
  };
}

// ---------- 計算 ----------

function recentStats(d) {
  if (!d) return null;
  const avg = (arr) => {
    const vals = (arr || []).slice(-30).map((x) => x[1]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const volume = avg(d.volume);
  const tone = avg(d.tone);
  if (volume == null && tone == null) return null;
  return { volume, tone, to: d.volume?.at(-1)?.[0] ?? d.tone?.at(-1)?.[0] ?? null };
}

function distance([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 找出 NEAR_METERS 內最近的商場、酒店或娛樂場
function nearestVenue(f) {
  const key = f.properties.osm;
  if (key && nearCache.has(key)) return nearCache.get(key);
  let best = null;
  for (const v of venues) {
    const d = distance(f.geometry.coordinates, v.geometry.coordinates);
    if (d <= NEAR_METERS && (!best || d < best.d)) best = { d, name: placeName(v.properties) };
  }
  if (key) nearCache.set(key, best);
  return best;
}
