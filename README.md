# 澳門奢侈品牌 × 國際旅客 Dashboard

用新聞報道、維基百科瀏覽量和澳門官方統計，呈現國際旅客對澳門奢侈品牌的關注、態度和討論。
所有數據來源都不需要註冊或申請 API key。

## 頁面

| 頁面 | 內容 |
|---|---|
| 世界地圖 `index.html` | 各國新聞報道強度和情緒、年度／月度入境旅客、人均非博彩消費、雙變量著色、客流飛線 |
| 澳門地圖 `macau.html` | 品牌門店、購物中心、酒店、娛樂場、入境口岸 |
| 品牌對比 `brands.html` | 各品牌報道強度和情緒時間線、各語言維基百科瀏覽量 |
| 討論內容 `news.html` | 文章列表、主題分布、標題高頻詞 |
| 數據說明 `about.html` | 來源、計算方法、已知限制 |

## 部署

1. 建立 repo，推送本專案。
2. Settings → Pages → Source 選 **GitHub Actions**。
3. Settings → Actions → General → Workflow permissions 選 **Read and write permissions**。
4. Actions → Update data and deploy → Run workflow，勾選 `backfill`，抓取最近 3 個月的 GDELT 文章。
5. 之後每天 UTC 02:17 自動更新。

## 手動數據（DSEC）

以下檔案放在 `data/manual/`，由人工從澳門年鑑、DSEC 和政府新聞局公告整理：

| 檔案 | 欄位 | 內容 |
|---|---|---|
| `visitors_by_origin_annual.csv` | `year`, `iso3`, `visitors` | 年度按客源地入境旅客（澳門年鑑附錄 20） |
| `visitors_by_origin.csv` | `month`, `iso3`, `visitors` | 月度按客源地入境旅客（DSEC 公告） |
| `visitors_total.csv` | `period`（2025 或 2026-01）, `visitors` | 年度或月度總入境旅客 |
| `spending_by_origin.csv` | `quarter`, `iso3`, `per_capita_non_gaming_mop`, `source_url` | 按客源地人均非博彩消費 |
| `spending_overall.csv` | `period`, `metric`, `value`, `source_url` | 全體旅客：人均購物、人均非博彩消費、購物佔比 |
| `arrivals_by_port.csv` | `year`, `port_id`, `visitors`, `source_url` | 年度按口岸入境旅客，`port_id` 需與 `config/ports.json` 一致 |

填寫規則：

- 用 UTF-8 編碼，數字不加千分位逗號。
- 找不到的數據不寫那一行，不要填 0。
- 推送到 `main` 後 workflow 會自動重建網站。格式錯誤或重複的行會在 `Build` 步驟的日誌中顯示。

目前數據的覆蓋範圍：

- 2019–2025 年只有年度客源地數據；2026 年 3、6、9 月只有總人次。
- DSEC 沒有按客源地公布購物消費，所以地圖用人均非博彩消費。
- 口岸只有 2022 年關閘和橫琴兩個。
- 這些數字尚未逐筆與 DSEC 原表重新核對。

## 本地運行

```bash
pip install -r requirements.txt
cd scripts
python fetch_static.py && python fetch_gdelt.py && python fetch_wiki.py
python fetch_osm.py && python fetch_fx.py && python fetch_worldbank.py
python build.py
cd .. && python -m http.server -d site 8000
```

然後打開 http://localhost:8000 。不要直接雙擊 HTML 檔案，瀏覽器會擋住數據載入。

只修改了 `data/manual/` 時，不需要重新抓取，執行 `cd scripts && python build.py` 即可。

## 第一次運行後要檢查

- `data/raw/gdelt/unmapped_countries.json`：未對上 ISO3 的 GDELT 國家名，補進 `config/gdelt_countries.json`。
- `fetch_wiki.py` 的輸出：若有「找不到條目」警告，修正 `config/brands.json` 的 `wiki_en`。
- `config/ports.json` 的座標是近似值，請在 OpenStreetMap 上核對。
- `data/raw/osm/macau.geojson`：OSM 門店資料由志願者維護，品牌比對用名稱子字串，可能有誤判。
