"""從 GDELT DOC 2.0 API 抓取「澳門 + 品牌」新聞的報道強度、情緒、來源國家和文章。

GDELT 只提供最近 3 個月的資料，所以每次的結果都合併進 data/raw/gdelt/，逐步累積歷史。
GDELT 要求每 5 秒最多 1 次請求。
環境變數 GDELT_BACKFILL=true 時，文章列表抓 3 個月，否則只抓 7 天。
"""
import os
import time

from common import RAW, config, get_json, load_json, save_json

API = "https://api.gdeltproject.org/api/v2/doc/doc"
MACAU = "(Macau OR Macao)"
PAUSE = 6
OUT = RAW / "gdelt"


def gdelt(query, mode, timespan="3m", **extra):
    params = {"query": query, "mode": mode, "format": "json", "timespan": timespan, **extra}
    try:
        return get_json(API, params=params) or {}
    finally:
        time.sleep(PAUSE)


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
    series = timeline(resp)
    return next(iter(series.values()), {})


def main():
    brands = config("brands.json")
    settings = config("settings.json")
    country_map = config("gdelt_countries.json")
    backfill = os.environ.get("GDELT_BACKFILL", "").lower() == "true"

    volume = load_json(OUT / "volume.json", {})
    tone = load_json(OUT / "tone.json", {})
    by_country = load_json(OUT / "country_volume.json", {})
    market_tone = load_json(OUT / "market_tone.json", {})
    articles = {a["url"]: a for a in load_json(OUT / "articles.json", [])}
    unmapped = set(load_json(OUT / "unmapped_countries.json", []))

    all_query = f"{MACAU} (" + " OR ".join(b["gdelt"] for b in brands) + ")"
    targets = [("all", all_query)] + [(b["id"], f"{MACAU} {b['gdelt']}") for b in brands]

    for bid, query in targets:
        print("GDELT", bid)
        try:
            volume.setdefault(bid, {}).update(first_series(gdelt(query, "timelinevol")))
            tone.setdefault(bid, {}).update(first_series(gdelt(query, "timelinetone")))
            for name, values in timeline(gdelt(query, "timelinesourcecountry")).items():
                iso3 = country_map.get(name)
                if not iso3:
                    unmapped.add(name)
                    continue
                by_country.setdefault(bid, {}).setdefault(iso3, {}).update(values)

            if bid == "all":
                continue
            resp = gdelt(query, "artlist", timespan="3m" if backfill else "7d",
                         maxrecords=250, sort="DateDesc")
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
        except RuntimeError as e:
            print(f"警告：{bid} 抓取失敗，保留舊資料。{e}")

    for m in settings["gdelt_markets"]:
        print("GDELT tone", m["iso3"])
        try:
            values = first_series(gdelt(f"{all_query} sourcecountry:{m['fips']}", "timelinetone"))
            market_tone.setdefault(m["iso3"], {}).update(values)
        except RuntimeError as e:
            print(f"警告：{m['iso3']} 情緒抓取失敗。{e}")

    kept = sorted(articles.values(), key=lambda a: a["date"], reverse=True)[: settings["articles_keep"]]

    save_json(OUT / "volume.json", volume)
    save_json(OUT / "tone.json", tone)
    save_json(OUT / "country_volume.json", by_country)
    save_json(OUT / "market_tone.json", market_tone)
    save_json(OUT / "articles.json", kept)
    save_json(OUT / "unmapped_countries.json", sorted(unmapped), pretty=True)
    if unmapped:
        print("未對照的國家名（請補進 config/gdelt_countries.json）：", sorted(unmapped))


if __name__ == "__main__":
    main()
