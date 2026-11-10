# 澳門奢侈品牌 × 國際旅客 Dashboard

用新聞報道、維基百科瀏覽量和澳門官方統計，呈現國際旅客對澳門奢侈品牌的關注、態度和討論。
所有數據來源都不需要註冊或申請 API key。

## 部署

1. 建立 repo，推送本專案。
2. Settings → Pages → Source 選 **GitHub Actions**。
3. Settings → Actions → General → Workflow permissions 選 **Read and write permissions**。
4. Actions → Update data and deploy → Run workflow，勾選 `backfill`，抓取最近 3 個月的 GDELT 文章。
5. 之後每天 UTC 02:17 自動更新。

## 手動數據（DSEC）

從 [澳門統計暨普查局](https://www.dsec.gov.mo) 下載以下統計，填入 `data/manual/`：

| 檔案 | 欄位 | DSEC 來源 |
|---|---|---|
| `visitors_by_origin.csv` | `month`（2024-05）, `iso3`（JPN）, `visitors` | 入境旅客統計：按居住地 |
| `spending_by_origin.csv` | `quarter`（2024Q2）, `iso3`, `per_capita_shopping_mop` | 旅客消費調查：按居住地的人均購物消費 |
| `arrivals_by_port.csv` | `month`, `port_id`（見 config/ports.json）, `visitors` | 入境旅客統計：按口岸 |

推送後 workflow 會自動重建網站。格式錯誤的行會在日誌中顯示並略過。

## 本地運行

```bash
pip install -r requirements.txt
cd scripts
python fetch_static.py && python fetch_gdelt.py && python fetch_wiki.py
python fetch_osm.py && python fetch_fx.py && python fetch_worldbank.py
python build.py
cd .. && python -m http.server -d site 8000
```

## 第一次運行後要檢查

- `data/raw/gdelt/unmapped_countries.json`：未對上 ISO3 的 GDELT 國家名，補進 `config/gdelt_countries.json`。
- `fetch_wiki.py` 的輸出：若有「找不到條目」警告，修正 `config/brands.json` 的 `wiki_en`。
- `config/ports.json` 的座標是近似值，請在 OpenStreetMap 上核對。
- `data/raw/osm/macau.geojson`：OSM 門店資料由志願者維護，品牌比對用名稱子字串，可能有誤判。
