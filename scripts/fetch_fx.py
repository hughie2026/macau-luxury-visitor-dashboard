"""用 Frankfurter API（歐洲央行匯率）計算各貨幣兌港幣的匯率和一年變化。
澳門元與港幣掛鉤，所以用港幣代替。正的變化表示該貨幣對港幣升值，來澳門購物變得更便宜。"""
from datetime import date, timedelta

from common import RAW, config, get_json, save_json

API = "https://api.frankfurter.dev/v1/{start}..{end}"


def main():
    settings = config("settings.json")
    currencies = sorted(settings["currencies"])
    today = date.today()
    start = today - timedelta(days=400)

    r = get_json(API.format(start=start.isoformat(), end=today.isoformat()),
                 params={"base": "HKD", "symbols": ",".join(currencies)})
    rates = r["rates"]
    dates = sorted(rates)
    latest = dates[-1]
    target = (date.fromisoformat(latest) - timedelta(days=365)).isoformat()
    year_ago = max((d for d in dates if d <= target), default=dates[0])

    out = {}
    for cur in currencies:
        now, then = rates[latest].get(cur), rates[year_ago].get(cur)
        if not now or not then:
            continue
        hkd_now, hkd_then = 1 / now, 1 / then  # 1 單位該貨幣 = 多少港幣
        out[cur] = {
            "hkd_per_unit": round(hkd_now, 6),
            "change_1y_pct": round((hkd_now / hkd_then - 1) * 100, 2),
            "date": latest,
            "compare_date": year_ago,
        }

    save_json(RAW / "fx.json", {"base": "HKD", "currencies": out}, pretty=True)
    print(f"匯率：{len(out)} 種貨幣，最新日期 {latest}")


if __name__ == "__main__":
    main()
