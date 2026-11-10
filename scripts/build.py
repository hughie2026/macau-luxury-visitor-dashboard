"""把 data/raw 和 data/manual 整理成前端用的 JSON，輸出到 site/data/。"""
import csv
import re
from collections import defaultdict
from datetime import datetime, timezone
from statistics import mean

from common import MANUAL, RAW, SITE_DATA, config, load_json, save_json

TOPIC_WORDS = {
    "duty_free": ["duty free", "duty-free", "tax free", "tax-free", "免稅"],
    "opening": ["opening", "opens", "launch", "flagship", "boutique", "pop-up", "開業", "開幕", "旗艦"],
    "price": ["price", "pricing", "expensive", "discount", "價格", "漲價"],
    "policy": ["visa", "policy", "border", "tourism", "tourist", "簽證", "政策", "通關", "旅客"],
    "gaming": ["casino", "gaming", "resort", "integrated resort", "博彩", "娛樂場", "度假村"],
    "earnings": ["sales", "revenue", "earnings", "profit", "業績", "營收"],
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


def build_articles(settings):
    country_map = config("gdelt_countries.json")
    out = []
    for a in load_json(RAW / "gdelt" / "articles.json", []):
        out.append({**a, "iso3": country_map.get(a.get("country", "")), "topics": topics_of(a.get("title", ""))})
    out.sort(key=lambda a: a["date"], reverse=True)
    return out[: settings["articles_publish"]]


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

    world = build_world(brands, settings, geo_isos)
    articles = build_articles(settings)
    macau = load_json(RAW / "osm" / "macau.geojson", {"type": "FeatureCollection", "features": []})

    save_json(SITE_DATA / "world.json", world)
    save_json(SITE_DATA / "brands.json", build_brands(brands, settings))
    save_json(SITE_DATA / "articles.json", articles)
    save_json(SITE_DATA / "ports.json", build_ports())
    save_json(SITE_DATA / "macau.geojson", macau)
    save_json(SITE_DATA / "meta.json", {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "months": [world["months"][0], world["months"][-1]] if world["months"] else [],
        "articles": len(articles),
        "places": len(macau["features"]),
    }, pretty=True)
    p = world["periods"]
    print(f"完成：新聞 {len(p['news'])} 個月，年度旅客 {len(p['visitors_year'])} 年，"
          f"月度旅客 {len(p['visitors'])} 個月，消費 {len(p['spending'])} 季，"
          f"{len(articles)} 篇文章，{len(macau['features'])} 個澳門地點")


if __name__ == "__main__":
    main()
