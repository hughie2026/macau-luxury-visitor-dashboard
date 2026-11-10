"""用 Overpass API 抓取澳門的品牌門店、購物中心、酒店和娛樂場（© OpenStreetMap 貢獻者，ODbL）。"""
import re

from common import RAW, config, get_json, save_json

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def build_query(brands):
    names = [n for b in brands for n in b["osm"]]
    pattern = "|".join(re.escape(n) for n in names)
    return (
        '[out:json][timeout:90];\n'
        'area["ISO3166-1"="MO"]->.mo;\n'
        '(\n'
        f'  nwr["brand"~"{pattern}",i](area.mo);\n'
        f'  nwr["name"~"{pattern}",i]["shop"](area.mo);\n'
        '  nwr["shop"="mall"](area.mo);\n'
        '  nwr["tourism"="hotel"](area.mo);\n'
        '  nwr["amenity"="casino"](area.mo);\n'
        ');\n'
        'out center;\n'
    )


def match_brand(tags, brands):
    haystack = " | ".join(tags.get(k, "") for k in ("brand", "name", "name:en")).lower()
    for b in brands:
        if any(n.lower() in haystack for n in b["osm"]):
            return b["id"]
    return None


def main():
    brands = config("brands.json")
    query = build_query(brands)

    result, last_error = None, None
    for url in ENDPOINTS:
        try:
            result = get_json(url, data={"data": query}, timeout=120)
            break
        except RuntimeError as e:
            last_error = e
    if result is None:
        raise RuntimeError(f"所有 Overpass 端點都失敗：{last_error}")

    elements = result.get("elements", [])
    if not elements:
        raise RuntimeError("Overpass 沒有回傳資料，請檢查 area 條件")

    features = []
    for el in elements:
        tags = el.get("tags", {})
        if el["type"] == "node":
            lon, lat = el.get("lon"), el.get("lat")
        else:
            c = el.get("center", {})
            lon, lat = c.get("lon"), c.get("lat")
        if lon is None or lat is None:
            continue

        is_mall = tags.get("shop") == "mall"
        is_hotel = tags.get("tourism") == "hotel"
        is_casino = tags.get("amenity") == "casino"
        brand_id = match_brand(tags, brands)
        is_store = brand_id is not None and not (is_mall or is_hotel or is_casino)

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "osm": f"{el['type']}/{el['id']}",
                "name": tags.get("name", ""),
                "name_zh": tags.get("name:zh-Hant") or tags.get("name:zh") or "",
                "name_en": tags.get("name:en", ""),
                "brand_id": brand_id if is_store else None,
                "is_store": is_store,
                "is_mall": is_mall,
                "is_hotel": is_hotel,
                "is_casino": is_casino,
            },
        })

    save_json(RAW / "osm" / "macau.geojson", {"type": "FeatureCollection", "features": features})
    stores = sum(f["properties"]["is_store"] for f in features)
    print(f"共 {len(features)} 個地點，其中品牌門店 {stores} 間")


if __name__ == "__main__":
    main()
