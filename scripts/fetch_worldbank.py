"""從 World Bank API 抓取人均 GDP、出境旅遊支出、出境人次的最新可用值（CC BY 4.0）。"""
from common import RAW, get_json, save_json

API = "https://api.worldbank.org/v2/country/all/indicator/{indicator}"
INDICATORS = {
    "gdp_pc": "NY.GDP.PCAP.CD",       # 人均 GDP（美元）
    "outbound_exp": "ST.INT.XPND.CD",  # 國際旅遊支出（美元）
    "departures": "ST.INT.DPRT",       # 出境旅遊人次
}


def main():
    out = {}
    for key, indicator in INDICATORS.items():
        r = get_json(API.format(indicator=indicator),
                     params={"format": "json", "mrnev": 1, "per_page": 500})
        rows = r[1] if isinstance(r, list) and len(r) > 1 and r[1] else []
        for row in rows:
            iso3, value = row.get("countryiso3code"), row.get("value")
            if iso3 and value is not None:
                out.setdefault(iso3, {})[key] = {"value": value, "year": row.get("date")}
        print(key, len(rows))
    save_json(RAW / "worldbank.json", out)


if __name__ == "__main__":
    main()
