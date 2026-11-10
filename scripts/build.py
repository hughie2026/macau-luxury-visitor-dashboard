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


def monthly(daily, digits=4):
    buckets = defaultdict(list)
    for d, v in (daily or {}).items():
        if v is not None:
            buckets[d[:7]].append(v)
    return {m: round(mean(vs), digits) for m, vs in sorted(buckets.items())}


def number(s):
    return float(s.replace(",", ""))


def read_csv(name, patterns):
    path = MANUAL / name
    if not path.exists():
        return []
    rows = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for line_no, row in enumerate(csv.DictReader(f), start=2):
            row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
            if not any(row.values()):
                continue
            bad = [k for k, p in patterns.items() if not re.fullmatch(p, row.get(k, ""))]
            if bad:
                print(f"警告：{name} 第 {line_no} 行欄位格式錯誤（{', '.join(bad)}），已略過")
                continue
            rows.append(row)
    return rows


def topics_of(title):
    t = title.lower()
    return [k for k, words in TOPIC_WORDS.items() if any(w in t for w in words)]


def build_world(brands, settings, geo_isos):
    countries = defaultdict(dict)

    for bid, per_iso in load_json(RAW / "gdelt" / "country_volume.json", {}).items():
        for iso, daily in per_iso.items():
            countries[iso].setdefault("news", {})[bid] = monthly(daily)

    for iso, daily in load_json(RAW / "gdelt" / "market_tone.json", {}).items():
        countries[iso]["tone"] = monthly(daily, 3)

    for r in read_csv("visitors_by_origin.csv",
                      {"month": r"\d{4}-\d{2}", "iso3": r"[A-Z]{3}", "visitors": r"[\d,]+"}):
        countries[r["iso3"]].setdefault("visitors", {})[r["month"]] = int(number(r["visitors"]))

    for r in read_csv("spending_by_origin.csv",
                      {"quarter": r"\d{4}Q[1-4]", "iso3": r"[A-Z]{3}",
                       "per_capita_shopping_mop": r"[\d,]+(\.\d+)?"}):
        countries[r["iso3"]].setdefault("spending", {})[r["quarter"]] = round(
            number(r["per_capita_shopping_mop"]), 1)

    fx = load_json(RAW / "fx.json", {}).get("currencies", {})
    for cur, isos in settings["currencies"].items():
        if cur in fx:
            for iso in isos:
                countries[iso]["fx"] = {"currency": cur, **fx[cur]}

    for iso, indicators in load_json(RAW / "worldbank.json", {}).items():
        if iso in geo_isos:
            countries[iso]["wb"] = indicators

    months = set()
    for c in countries.values():
        for series in c.get("news", {}).values():
            months.update(series)
        months.update(c.get("tone", {}))
        months.update(c.get("visitors", {}))

    return {
        "brands": [{"id": b["id"], "name": b["name"], "name_zh": b["name_zh"]} for b in brands],
        "months": sorted(months),
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
    arrivals = defaultdict(dict)
    for r in read_csv("arrivals_by_port.csv",
                      {"month": r"\d{4}-\d{2}", "port_id": r"[a-z_]+", "visitors": r"[\d,]+"}):
        arrivals[r["port_id"]][r["month"]] = int(number(r["visitors"]))
    months = sorted({m for v in arrivals.values() for m in v})
    return {"ports": config("ports.json"), "arrivals": dict(arrivals), "months": months}


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
    print(f"完成：{len(world['months'])} 個月份，{len(articles)} 篇文章，{len(macau['features'])} 個澳門地點")


if __name__ == "__main__":
    main()
