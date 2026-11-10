"""用 Wikimedia Pageviews API 抓取各品牌、「澳門」條目在不同語言維基百科的每月瀏覽量。
各語言的條目名透過英文維基的 langlinks 自動對應。"""
import time
from datetime import date, timedelta
from urllib.parse import quote

from common import RAW, config, get_json, save_json

OUT = RAW / "wiki"
PAGEVIEWS = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
             "{lang}.wikipedia.org/all-access/user/{title}/monthly/{start}/{end}")


def langlinks(en_title):
    r = get_json("https://en.wikipedia.org/w/api.php", params={
        "action": "query", "titles": en_title, "prop": "langlinks", "lllimit": "max",
        "redirects": 1, "format": "json", "formatversion": 2,
    })
    pages = (r or {}).get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing"):
        return None
    links = {l["lang"]: l["title"] for l in pages[0].get("langlinks", [])}
    links["en"] = pages[0]["title"]
    return links


def monthly_views(lang, title, start, end):
    url = PAGEVIEWS.format(lang=lang, title=quote(title.replace(" ", "_"), safe=""),
                           start=start, end=end)
    r = get_json(url)
    time.sleep(0.2)
    if not r:
        return {}
    return {f"{i['timestamp'][:4]}-{i['timestamp'][4:6]}": i["views"] for i in r.get("items", [])}


def main():
    brands = config("brands.json")
    settings = config("settings.json")
    langs = settings["wiki_languages"]
    end = (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y%m%d")  # 上個月最後一天
    start = settings["wiki_start"]

    targets = [(b["id"], b["wiki_en"]) for b in brands] + [("_macau", "Macau")]
    titles, views = {}, {}
    for key, en_title in targets:
        links = langlinks(en_title)
        if not links:
            print(f"警告：英文維基找不到條目「{en_title}」，請修正 config/brands.json")
            continue
        titles[key] = {l: links[l] for l in langs if l in links}
        views[key] = {}
        for lang, title in titles[key].items():
            data = monthly_views(lang, title, start, end)
            if data:
                views[key][lang] = data
        print(key, "語言數：", len(views[key]))

    save_json(OUT / "titles.json", titles, pretty=True)
    save_json(OUT / "pageviews.json", views)


if __name__ == "__main__":
    main()
