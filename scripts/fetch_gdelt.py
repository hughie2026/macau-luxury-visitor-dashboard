"""從 GDELT DOC 2.0 API 抓取「澳門 + 品牌」新聞的報道強度、情緒、來源國家和文章。

GDELT 只提供最近 3 個月的資料，所以每次的結果都合併進 data/raw/gdelt/，逐步累積歷史。
- GDELT 要求每 5 秒最多 1 次請求。
- 環境變數 GDELT_BACKFILL=true 時，文章列表抓 3 個月，否則只抓 7 天。
- 環境變數 GDELT_BUDGET_MIN 是總時間上限（分鐘，預設 12）。時間用完或連續失敗時，
  會停止並保存已抓到的結果。
"""
import os
import sys
import time

from common import RAW, FetchError, budget_from_env, config, get_json, load_json, log, save_json

API = "https://api.gdeltproject.org/api/v2/doc/doc"
MACAU = "(Macau OR Macao)"
PAUSE = 6       # 兩次請求之間至少間隔的秒數
MAX_FAILS = 3   # 連續失敗幾次就停止
OUT = RAW / "gdelt"


class Stop(Exception):
    pass


class Gdelt:
    def __init__(self, deadline):
        self.deadline = deadline
        self.fails = 0
        self.ok = 0
        self.last = 0.0

    def get(self, query, mode, timespan="3m", **extra):
        """成功回傳 dict，失敗回傳 None；時間用完或連續失敗時拋出 Stop。"""
        if self.fails >= MAX_FAILS:
            raise Stop(f"連續 {self.fails} 次失敗，GDELT 可能正在限流或維護")
        if time.monotonic() > self.deadline:
            raise Stop("超過時間上限")
        wait = PAUSE - (time.monotonic() - self.last)
        if wait > 0:
            time.sleep(wait)
        params = {"query": query, "mode": mode, "format": "json", "timespan": timespan, **extra}
        try:
            resp = get_json(API, params=params, retries=2, timeout=(10, 40),
                            backoff=15, deadline=self.deadline)
            self.fails = 0
            self.ok += 1
            return resp or {}
        except FetchError as e:
            self.fails += 1
            log(f"  {mode} 失敗：{e}")
            return None
        finally:
            self.last = time.monotonic()


def day(s):
    """'20240101T000000Z' → '2024-01-01'"""
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


def timeline(resp):
    """{'timeline': [{'series': 名稱, 'data': [...]}]} → {名稱: {日期: 值}}"""
    out = {}
    for s in resp.get("timeline", []):
        name = s.get("series", "").replace(" Volume Intensity", "").strip()
        out[name] = {day(p["date"]): p["value"] for p in s.get("data", []) if p.get("date")}
    return out


def first_series(resp):
    return next(iter(timeline(resp).values()), {})


def add_articles(articles, resp, bid):
    n = 0
    for a in resp.get("articles", []):
        url, seen = a.get("url"), a.get("seendate")
        if not url or not seen:
            continue
        rec = articles.setdefault(url, {
            "url": url,
            "title": a.get("title", ""),
            "date": day(seen),
            "domain": a.get("domain", ""),
            "lang": a.get("language", ""),
            "country": a.get("sourcecountry", ""),
            "brands": [],
        })
        if bid not in rec["brands"]:
            rec["brands"].append(bid)
        n += 1
    return n


def main():
    brands = config("brands.json")
    settings = config("settings.json")
    country_map = config("gdelt_countries.json")
    backfill = os.environ.get("GDELT_BACKFILL", "").lower() == "true"
    api = Gdelt(budget_from_env("GDELT_BUDGET_MIN", 12))

    volume = load_json(OUT / "volume.json", {})
    tone = load_json(OUT / "tone.json", {})
    by_country = load_json(OUT / "country_volume.json", {})
    market_tone = load_json(OUT / "market_tone.json", {})
    articles = {a["url"]: a for a in load_json(OUT / "articles.json", [])}
    unmapped = set(load_json(OUT / "unmapped_countries.json", []))

    def save():
        kept = sorted(articles.values(), key=lambda a: a["date"], reverse=True)[: settings["articles_keep"]]
        save_json(OUT / "volume.json", volume)
        save_json(OUT / "tone.json", tone)
        save_json(OUT / "country_volume.json", by_country)
        save_json(OUT / "market_tone.json", market_tone)
        save_json(OUT / "articles.json", kept)
        save_json(OUT / "unmapped_countries.json", sorted(unmapped), pretty=True)

    all_query = f"{MACAU} (" + " OR ".join(b["gdelt"] for b in brands) + ")"
    targets = [("all", all_query)] + [(b["id"], f"{MACAU} {b['gdelt']}") for b in brands]
    markets = settings["gdelt_markets"]

    try:
        for i, (bid, query) in enumerate(targets, 1):
            log(f"[{i}/{len(targets)}] GDELT {bid}")
            r = api.get(query, "timelinevol")
            if r is not None:
                volume.setdefault(bid, {}).update(first_series(r))
            r = api.get(query, "timelinetone")
            if r is not None:
                tone.setdefault(bid, {}).update(first_series(r))
            r = api.get(query, "timelinesourcecountry")
            if r is not None:
                for name, values in timeline(r).items():
                    iso3 = country_map.get(name)
                    if not iso3:
                        unmapped.add(name)
                        continue
                    by_country.setdefault(bid, {}).setdefault(iso3, {}).update(values)
            if bid != "all":
                r = api.get(query, "artlist", timespan="3m" if backfill else "7d",
                            maxrecords=250, sort="DateDesc")
                if r is not None:
                    log(f"  文章 {add_articles(articles, r, bid)} 篇")
            save()

        for i, m in enumerate(markets, 1):
            log(f"[{i}/{len(markets)}] GDELT 情緒 {m['iso3']}")
            r = api.get(f"{all_query} sourcecountry:{m['fips']}", "timelinetone")
            if r is not None:
                market_tone.setdefault(m["iso3"], {}).update(first_series(r))
    except Stop as e:
        log(f"GDELT 提前結束：{e}。已抓到的結果會保存，下次運行會繼續累積。")
    finally:
        save()

    log(f"GDELT 結束：成功 {api.ok} 次請求，文章總數 {len(articles)}")
    if unmapped:
        log("未對照的國家名（請補進 config/gdelt_countries.json）：", sorted(unmapped))
    if api.ok == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
