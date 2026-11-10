"""下載 Natural Earth 1:50m 國界（公有領域），精簡屬性和座標後存到 site/data/countries.geojson。
檔案已存在時略過。"""
import sys

from common import SITE_DATA, get_json, save_json

URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
       "master/geojson/ne_50m_admin_0_countries.geojson")
OUT = SITE_DATA / "countries.geojson"


def round_coords(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], 2), round(c[1], 2)]
    return [round_coords(x) for x in c]


def prop(p, key):
    return p.get(key) if key in p else p.get(key.lower())


def main(force=False):
    if OUT.exists() and not force:
        print("countries.geojson 已存在，略過")
        return
    src = get_json(URL, timeout=180)
    features = []
    for f in src["features"]:
        p, g = f["properties"], f["geometry"]
        if not g:
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "iso3": prop(p, "ADM0_A3"),
                "name": prop(p, "NAME"),
                "name_zh": prop(p, "NAME_ZHT") or prop(p, "NAME_ZH") or prop(p, "NAME"),
                "lx": prop(p, "LABEL_X"),
                "ly": prop(p, "LABEL_Y"),
            },
            "geometry": {"type": g["type"], "coordinates": round_coords(g["coordinates"])},
        })
    save_json(OUT, {"type": "FeatureCollection", "features": features})
    print(f"已寫入 {len(features)} 個國家")


if __name__ == "__main__":
    main(force="--force" in sys.argv)
