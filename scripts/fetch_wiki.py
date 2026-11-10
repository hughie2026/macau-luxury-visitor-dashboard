"""用 Wikimedia Pageviews API 抓取各品牌、「澳門」條目在不同語言維基百科的每月瀏覽量。
各語言的條目名透過英文維基的 langlinks 自動對應。
環境變數 WIKI_BUDGET_MIN 是總時間上限（分鐘，預設 5）。"""
import sys
import time
from datetime import date, timedelta
from urllib.parse import quote

from common import RAW, FetchError, budget_from_env, config, get_json, load_json, log, save_json

OUT = RAW / "wiki"
PAGEVIEWS = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
             "{lang}.wikipedia.org/all-access/user/{title}/monthly/{start}/{end}")


def langlinks(en_title, deadline):
    r = get_json("https://en.wikipedia.org/w/api.php", params={
        "action": "query", "titles": en_title, "prop": "langlinks", "lllimit": "max",
        "redirects": 1, "format": "json", "formatversion": 2,
    }, retries=2, timeout=(10, 30), deadline=deadline)
    pages = (r or {}).get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing"):
        return None
    links = {l["lang"]: l["title"] for l in pages[0].get("langlinks", [])}
    links["en"] = pages[0]["title"]
    return links


def monthly_views(lang, title, start, end, deadline):
    url = PAGEVIEWS.format(lang=lang, title=quote(title.replace(" ", "_"), safe=""),
                           start=start, end=end)
    r = get_json(url, retries=2, timeout=(10, 30), deadline=deadline)
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
    deadline = budget_from_env("WIKI_BUDGET_MIN", 5)

    # 從舊結果開始，抓失敗的條目保留舊數據
    titles = load_json(OUT / "titles.json", {})
    views = load_json(OUT / "pageviews.json", {})
    targets = [(b["id"], b["wiki_en"]) for b in brands] + [("_macau", "Macau")]
    ok = 0

    for i, (key, en_title) in enumerate(targets, 1):
        if time.monotonic() > deadline:
            log("維基百科：超過時間上限，保存已抓到的部分")
            break
        try:
            links = langlinks(en_title, deadline)
        except FetchError as e:
            log(f"[{i}/{len(targets)}] {key}：langlinks 失敗，{e}")
            continue
        if not links:
            log(f"警告：英文維基找不到條目「{en_title}」，請修正 config/brands.json")
            continue
        titles[key] = {l: links[l] for l in langs if l in links}
        result = views.get(key, {})
        for lang, title in titles[key].items():
            try:
                data = monthly_views(lang, title, start, end, deadline)
                ok += 1
            except FetchError as e:
                log(f"  {key}/{lang} 失敗：{e}")
                continue
            if data:
                result[lang] = data
        views[key] = result
        log(f"[{i}/{len(targets)}] {key} 語言數：{len(result)}")
        save_json(OUT / "titles.json", titles, pretty=True)
        save_json(OUT / "pageviews.json", views)

    save_json(OUT / "titles.json", titles, pretty=True)
    save_json(OUT / "pageviews.json", views)
    if ok == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
