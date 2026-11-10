"""把 data/raw 和 data/manual 整理成前端用的 JSON，輸出到 site/data/。"""
import csv
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from statistics import mean

from common import MANUAL, RAW, SITE_DATA, config, load_json, save_json

TOPIC_WORDS = {
    "duty_free": ["duty free", "duty-free", "tax free", "tax-free", "免稅", "免税", "면세", "ปลอดภาษี", "bebas bea"],
    "opening": ["opening", "opens", "launch", "flagship", "boutique", "pop-up", "popup",
                "開業", "開幕", "旗艦", "開店", "开业", "开幕", "旗舰", "オープン", "출점", "오픈", "เปิดตัว"],
    "price": ["price", "pricing", "expensive", "discount", "價格", "漲價", "价格", "涨价",
              "値上げ", "価格", "가격", "인상", "ราคา"],
    "policy": ["visa", "policy", "border", "tourism", "tourist", "簽證", "政策", "通關", "旅客",
               "签证", "通关", "旅游", "観光", "ビザ", "관광", "비자", "นักท่องเที่ยว"],
    "gaming": ["casino", "gaming", "resort", "integrated resort", "博彩", "娛樂場", "度假村",
               "赌场", "カジノ", "카지노", "คาสิโน"],
    "earnings": ["sales", "revenue", "earnings", "profit", "業績", "營收", "业绩", "营收",
                 "売上", "決算", "매출", "실적", "ยอดขาย"],
}
GDELT_LANG = {
    "English": "en", "Chinese": "zh", "Japanese": "ja", "Korean": "ko", "Thai": "th",
    "Vietnamese": "vi", "Indonesian": "id", "Malay": "ms", "Tagalog": "tl", "French": "fr",
    "German": "de", "Spanish": "es", "Portuguese": "pt", "Italian": "it", "Russian": "ru", "Arabic": "ar",
}

YEAR = r"\d{4}"
MONTH = r"\d{4}-\d{2}"
QUARTER = r"\d{4}Q[1-4]"
ISO3 = r"[A-Z]{3}"
INT = r"[\d,]+"
DEC = r"[\d,]+(\.\d+)?"
OVERALL_METRICS = ["per_capita_shopping", "per_capita_total_non_gaming", "shopping_share_of_total"]


def monthly(daily, digits=4):
    buckets = defaultdict(list)
    for d, v in (daily or {}).items():
        if v is not None:
            buckets[d[:7]].append(v)
    return {m: round(mean(vs), digits) for m, vs in sorted(buckets.items())}


def number(s):
    return float(s.replace(",", ""))


def read_csv(name, patterns):
    """讀取 data/manual 的 CSV，只檢查 patterns 中的欄位，多出的欄位（例如 source_url）會保留但不檢查。"""
    path = MANUAL / name
    if not path.exists():
        print(f"提示：沒有 {name}，略過")
        return []
    rows, seen = [], set()
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        missing = [k for k in patterns if k not in (reader.fieldnames or [])]
        if missing:
            print(f"警告：{name} 缺少欄位 {', '.join(missing)}，整個檔案略過")
            return []
        for line_no, row in enumerate(reader, start=2):
            row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
            if not any(row.values()):
                continue
            bad = [k for k, p in patterns.items() if not re.fullmatch(p, row.get(k, ""))]
            if bad:
                print(f"警告：{name} 第 {line_no} 行欄位格式錯誤（{', '.join(bad)}），已略過")
                continue
            key = tuple(row[k] for k in list(patterns)[:-1])
            if key in seen:
                print(f"警告：{name} 第 {line_no} 行重複（{', '.join(key)}），以最後一行為準")
            seen.add(key)
            rows.append(row)
    print(f"{name}：{len(rows)} 行")
    return rows


def topics_of(title):
    t = title.lower()
    return [k for k, words in TOPIC_WORDS.items() if any(w in t for w in words)]


def build_world(brands, settings, geo_isos):
    countries = defaultdict(dict)

    news_months, tone_months = set(), set()
    for bid, per_iso in load_json(RAW / "gdelt" / "country_volume.json", {}).items():
        for iso, daily in per_iso.items():
            series = monthly(daily)
            countries[iso].setdefault("news", {})[bid] = series
            news_months.update(series)

    for iso, daily in load_json(RAW / "gdelt" / "market_tone.json", {}).items():
        series = monthly(daily, 3)
        countries[iso]["tone"] = series
        tone_months.update(series)

    for r in read_csv("visitors_by_origin.csv", {"month": MONTH, "iso3": ISO3, "visitors": INT}):
        countries[r["iso3"]].setdefault("visitors", {})[r["month"]] = int(number(r["visitors"]))

    for r in read_csv("visitors_by_origin_annual.csv", {"year": YEAR, "iso3": ISO3, "visitors": INT}):
        countries[r["iso3"]].setdefault("visitors_year", {})[r["year"]] = int(number(r["visitors"]))

    for r in read_csv("spending_by_origin.csv",
                      {"quarter": QUARTER, "iso3": ISO3, "per_capita_non_gaming_mop": DEC}):
        countries[r["iso3"]].setdefault("spending", {})[r["quarter"]] = round(
            number(r["per_capita_non_gaming_mop"]), 1)

    totals = {}
    for r in read_csv("visitors_total.csv", {"period": rf"{YEAR}(-\d{{2}})?", "visitors": INT}):
        totals[r["period"]] = int(number(r["visitors"]))

    overall = defaultdict(dict)
    for r in read_csv("spending_overall.csv", {
        "period": rf"{YEAR}(Q[1-4])?",
        "metric": "(?:" + "|".join(OVERALL_METRICS) + ")",
        "value": DEC,
    }):
        overall[r["metric"]][r["period"]] = number(r["value"])

    fx = load_json(RAW / "fx.json", {}).get("currencies", {})
    for cur, isos in settings["currencies"].items():
        if cur in fx:
            for iso in isos:
                countries[iso]["fx"] = {"currency": cur, **fx[cur]}

    for iso, indicators in load_json(RAW / "worldbank.json", {}).items():
        if iso in geo_isos:
            countries[iso]["wb"] = indicators

    def periods_of(field):
        return sorted({p for c in countries.values() for p in c.get(field, {})})

    return {
        "brands": [{"id": b["id"], "name": b["name"], "name_zh": b["name_zh"]} for b in brands],
        "months": sorted(news_months | tone_months),
        "periods": {
            "news": sorted(news_months),
            "tone": sorted(tone_months),
            "visitors": periods_of("visitors"),
            "visitors_year": periods_of("visitors_year"),
            "spending": periods_of("spending"),
        },
        "totals": totals,
        "spending_overall": dict(overall),
        "countries": dict(countries),
    }


def build_brands(brands, settings):
    volume = load_json(RAW / "gdelt" / "volume.json", {})
    tone = load_json(RAW / "gdelt" / "tone.json", {})
    daily = {}
    for bid in ["all"] + [b["id"] for b in brands]:
        daily[bid] = {
            "volume": [[d, round(v, 4)] for d, v in sorted(volume.get(bid, {}).items())],
            "tone": [[d, round(v, 3)] for d, v in sorted(tone.get(bid, {}).items())],
        }
    return {
        "brands": [{"id": b["id"], "name": b["name"], "name_zh": b["name_zh"]} for b in brands],
        "daily": daily,
        "wiki": load_json(RAW / "wiki" / "pageviews.json", {}),
        "wiki_langs": settings["wiki_languages"],
    }


def norm_title(t):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", t)).strip().lower()


def build_news(brands, settings, geo_names):
    """合併 GDELT 和 Google News 的文章，按標題 + 媒體去重。"""
    country_map = config("gdelt_countries.json")
    brand_ids = {b["id"] for b in brands}
    merged = {}

    def add(rec, provider):
        key = norm_title(rec["title"])[:200] + "|" + rec["domain"]
        cur = merged.get(key)
        if cur is None:
            rec["providers"] = [provider]
            rec["topics"] = topics_of(rec["title"])
            merged[key] = rec
            return
        for field in ("markets", "brands"):
            cur[field] = sorted(set(cur[field]) | set(rec[field]))
        if provider not in cur["providers"]:
            cur["providers"].append(provider)
        if not cur.get("iso3") and rec.get("iso3"):
            cur["iso3"], cur["country"] = rec["iso3"], rec["country"]
        cur["date"] = min(cur["date"], rec["date"])

    for a in load_json(RAW / "gdelt" / "articles.json", []):
        if not a.get("title") or not a.get("date"):
            continue
        iso3 = country_map.get(a.get("country", ""))
        lang = a.get("lang") or ""
        add({
            "title": a["title"], "url": a["url"], "date": a["date"],
            "domain": a.get("domain", ""), "source": a.get("domain", ""),
            "lang": GDELT_LANG.get(lang, lang[:2].lower()),
            "country": a.get("country", ""), "iso3": iso3,
            "markets": [iso3] if iso3 else [],
            "brands": [b for b in a.get("brands", []) if b in brand_ids],
        }, "gdelt")

    for a in load_json(RAW / "news" / "gnews.json", []):
        if not a.get("title") or not a.get("date"):
            continue
        markets = list(a.get("markets", []))
        first = markets[0] if markets else None
        add({
            "title": a["title"], "url": a["url"], "date": a["date"],
            "domain": a.get("domain", ""), "source": a.get("source") or a.get("domain", ""),
            "lang": a.get("lang", ""),
            "country": first or "", "iso3": first,
            "markets": markets,
            "brands": [b for b in a.get("brands", []) if b in brand_ids],
        }, "gnews")

    out = sorted(merged.values(), key=lambda a: a["date"], reverse=True)[: settings["articles_publish"]]

    providers = defaultdict(int)
    for a in out:
        for p in a["providers"]:
            providers[p] += 1

    names = {m["iso3"]: m["name_zh"] for m in settings.get("news_markets", [])}
    for a in out:
        for iso in a["markets"]:
            names.setdefault(iso, geo_names.get(iso, iso))

    payload = {
        "brands": [{"id": b["id"], "name": b["name"], "name_zh": b["name_zh"]} for b in brands],
        "market_names": names,
        "providers": dict(providers),
        "articles": out,
    }
    return out, payload


def build_ports():
    ports = config("ports.json")
    known = {p["id"] for p in ports}
    arrivals = defaultdict(dict)
    for r in read_csv("arrivals_by_port.csv", {"year": YEAR, "port_id": r"[a-z_]+", "visitors": INT}):
        if r["port_id"] not in known:
            print(f"警告：arrivals_by_port.csv 的 port_id「{r['port_id']}」不在 config/ports.json，已略過")
            continue
        arrivals[r["port_id"]][r["year"]] = int(number(r["visitors"]))
    years = sorted({y for v in arrivals.values() for y in v})
    return {"ports": ports, "arrivals": dict(arrivals), "years": years}


def main():
    brands = config("brands.json")
    settings = config("settings.json")
    geo = load_json(SITE_DATA / "countries.geojson", {"features": []})
    geo_isos = {f["properties"]["iso3"] for f in geo["features"]}
    geo_names = {f["properties"]["iso3"]: f["properties"].get("name_zh") or f["properties"].get("name")
                 for f in geo["features"]}
    updated = datetime.now(timezone.utc).isoformat(timespec="seconds")

    world = build_world(brands, settings, geo_isos)
    articles, news = build_news(brands, settings, geo_names)
    macau = load_json(RAW / "osm" / "macau.geojson", {"type": "FeatureCollection", "features": []})

    save_json(SITE_DATA / "world.json", world)
    save_json(SITE_DATA / "brands.json", build_brands(brands, settings))
    save_json(SITE_DATA / "articles.json", articles)
    save_json(SITE_DATA / "news.json", {**news, "updated": updated})
    save_json(SITE_DATA / "ports.json", build_ports())
    save_json(SITE_DATA / "macau.geojson", macau)
    save_json(SITE_DATA / "meta.json", {
        "updated": updated,
        "months": [world["months"][0], world["months"][-1]] if world["months"] else [],
        "articles": len(articles),
        "places": len(macau["features"]),
    }, pretty=True)
    p = world["periods"]
    print(f"完成：新聞 {len(p['news'])} 個月，年度旅客 {len(p['visitors_year'])} 年，"
          f"月度旅客 {len(p['visitors'])} 個月，消費 {len(p['spending'])} 季，"
          f"文章 {len(articles)} 篇（{dict(news['providers'])}），{len(macau['features'])} 個澳門地點")


if __name__ == "__main__":
    main()
