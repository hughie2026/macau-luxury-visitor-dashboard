<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>討論內容｜澳門奢侈品牌 × 國際旅客</title>
  <link rel="stylesheet" href="assets/style.css">
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js"></script>
</head>
<body>
  <nav id="nav"></nav>
  <main class="page">
    <div id="empty"></div>

    <div id="content" hidden>
      <section class="card filters">
        <select id="f-brand" aria-label="品牌"></select>
        <select id="f-market" aria-label="市場"></select>
        <select id="f-lang" aria-label="語言"></select>
        <select id="f-topic" aria-label="主題"></select>
        <select id="f-range" aria-label="時間範圍"></select>
        <input id="f-q" type="search" placeholder="搜尋標題">
        <button id="f-reset" type="button">清除篩選</button>
      </section>

      <p id="range-label" class="hint"></p>
      <section id="kpis" class="kpis"></section>

      <section class="card">
        <h2>每週報道量</h2>
        <p class="hint">按品牌堆疊。一篇文章提及多個品牌時，每個品牌各計一次。</p>
        <div id="chart-trend" class="chart"></div>
      </section>

      <section class="card">
        <h2>品牌 × 市場</h2>
        <p class="hint">每格是該品牌在該市場的報道數，不受品牌和市場篩選影響。點擊格子篩選，再點一次取消。</p>
        <div id="chart-matrix" class="chart tall"></div>
      </section>

      <div class="grid-2">
        <section class="card">
          <h2>主題分布</h2>
          <p class="hint">按標題關鍵詞分類，一篇文章可屬多個主題。點擊長條篩選。</p>
          <div id="chart-topics" class="chart short"></div>
        </section>
        <section class="card">
          <h2>報道語言</h2>
          <p class="hint">點擊扇區篩選。</p>
          <div id="chart-langs" class="chart short"></div>
        </section>
      </div>

      <div class="grid-2">
        <section class="card">
          <h2>主要來源媒體</h2>
          <div id="chart-sources" class="chart"></div>
        </section>
        <section class="card">
          <h2>英文標題高頻詞</h2>
          <p class="hint">已去掉品牌名、「Macau」和常見虛詞。</p>
          <div id="chart-keywords" class="chart"></div>
        </section>
      </div>

      <section class="card">
        <h2>文章</h2>
        <div id="list"></div>
        <div class="pager">
          <button id="prev" type="button">上一頁</button>
          <span id="page-label"></span>
          <button id="next" type="button">下一頁</button>
        </div>
      </section>

      <section id="status" class="card"></section>
    </div>
  </main>
  <footer id="footer"></footer>
  <script type="module" src="assets/js/news.js"></script>
</body>
</html>
