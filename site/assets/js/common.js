// 各頁共用：導航、數據載入、格式化、轉義

const PAGES = [
  ['index.html', '世界地圖'],
  ['macau.html', '澳門地圖'],
  ['brands.html', '品牌對比'],
  ['news.html', '討論內容'],
  ['about.html', '數據說明'],
];

export const TOPICS = {
  duty_free: '免稅',
  opening: '開店／新品',
  price: '價格',
  policy: '旅遊政策',
  gaming: '度假村／博彩',
  earnings: '業績',
};

export const LANG_NAMES = {
  en: '英語', zh: '中文', ja: '日語', ko: '韓語', th: '泰語', vi: '越南語',
  id: '印尼語', ms: '馬來語', tl: '他加祿語', fr: '法語', de: '德語', ru: '俄語',
};

const PALETTE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b',
  '#e377c2', '#17becf', '#7f7f7f', '#bcbd22'];
export const brandColor = (i) => PALETTE[i % PALETTE.length];

export const $ = (id) => document.getElementById(id);

export function renderNav(active) {
  $('nav').innerHTML =
    '<a class="logo" href="index.html">澳門奢侈品牌 × 國際旅客</a>' +
    PAGES.map(([href, label]) =>
      `<a href="${href}"${href === active ? ' class="active"' : ''}>${label}</a>`).join('');
}

export async function renderFooter() {
  const el = $('footer');
  if (!el) return;
  try {
    const meta = await loadJSON('meta.json');
    el.textContent = `數據更新：${new Date(meta.updated).toLocaleString('zh-Hant')}｜來源和方法見「數據說明」`;
  } catch {
    el.textContent = '尚未生成數據';
  }
}

export async function loadJSON(name) {
  const r = await fetch(`data/${name}`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`無法載入 ${name}（HTTP ${r.status}）`);
  return r.json();
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 只允許 http/https 連結，避免 javascript: 之類的 URL
export function safeUrl(u) {
  try {
    const url = new URL(u);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
}

const isNum = (n) => n != null && !Number.isNaN(Number(n));
export const fmt = {
  int: (n) => (isNum(n) ? Math.round(n).toLocaleString('zh-Hant') : '—'),
  num: (n, d = 2) => (isNum(n) ? Number(n).toFixed(d) : '—'),
  pct: (n, d = 1) => (isNum(n) ? `${n > 0 ? '+' : ''}${Number(n).toFixed(d)}%` : '—'),
  usd100m: (n) => (isNum(n) ? `${(n / 1e8).toLocaleString('zh-Hant', { maximumFractionDigits: 0 })} 億美元` : '—'),
  wan: (n) => (isNum(n) ? `${(n / 1e4).toLocaleString('zh-Hant', { maximumFractionDigits: 0 })} 萬` : '—'),
};

export function quarterOf(month) {
  const [y, m] = month.split('-').map(Number);
  return `${y}Q${Math.ceil(m / 3)}`;
}

export function showError(el, err) {
  el.innerHTML = `<p class="error">${esc(err.message || err)}</p>`;
  console.error(err);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
