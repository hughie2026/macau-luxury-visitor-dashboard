"""從 Google News RSS 抓取各市場版本中「澳門 + 品牌」的新聞（免註冊、免 API key）。

- 每個市場（Google News 地區版本）× 每個品牌查詢一次，只保存標題、來源、日期和連結。
- 結果合併進 data/raw/news/gnews.json，逐日累積。
- 環境變數 NEWS_BUDGET_MIN：總時間上限（分鐘，預設 6）。時間用完或連續失敗時，保存已抓到的部分。
"""
import email.utils
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET
from datetime import date, timedelta, timezone
from urllib.parse import urlparse

import requests

from common import RAW, budget_from_env, config, load_json, log, save_json, session

RSS = "https://news.google.com/rss/search"
OUT = RAW / "news" / "gnews.json"
PAUSE = 1.5      # 兩次請求之間至少間隔的秒數
MAX_FAILS = 5    # 連續失敗幾次就停止


def fold(s):
    """小寫並去掉重音符號，Hermès → hermes。標題和品牌別名都用同一方法處理。"""
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def term(t):
    return f'"{t}"' if " " in t else t


def norm_key(title, source):
    t = " ".join(unicodedata.normalize("NFKC", title).lower().split())
    return f"{t}|{source.lower()}"


def fetch(params, deadline):
    last = None
    for attempt in range(1, 4):
        if time.monotonic() > deadline:
            raise TimeoutError("超過時間上限")
        try:
            r = session.get(RSS, params=params, timeout=(10, 30))
            if r.status_code == 200:
                root = ET.fromstring(r.content)
                if root.tag == "rss":
                    return root
                last = f"回應不是 RSS（{root.tag}）"
            else:
                last = f"HTTP {r.status_code}"
                if r.status_code not in (429, 500, 502, 503, 504):
                    break
        except requests.RequestException as e:
            last = type(e).__name__
        except ET.ParseError:
            last = "回應無法解析為 XML"
        if attempt < 3:
            time.sleep(5 * attempt)
    raise RuntimeError(last)


def parse(root):
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        src = item.find("source")
        source = (src.text or "").strip() if src is not None else ""
        src_url = src.get("url", "") if src is not None else ""
        # Google News 的標題格式是「標題 - 媒體名」
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3].strip()
        try:
            dt = email.utils.parsedate_to_datetime(item.findtext("pubDate") or "")
        except (TypeError, ValueError):
            continue
        if not title or not link or dt is None:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        domain = urlparse(src_url).netloc.lower().removeprefix("www.")
        yield {
            "title": title,
            "url": link,
            "source": source or domain,
            "domain": domain,
            "date": dt.astimezone(timezone.utc).date().isoformat(),
        }


def main():
    brands = config("brands.json")
    settings = config("settings.json")
    markets = settings["news_markets"]
    when = settings.get("news_when", "30d")
    keep_from = (date.today() - timedelta(days=settings.get("news_keep_days", 400))).isoformat()
    deadline = budget_from_env("NEWS_BUDGET_MIN", 6)

    store = {norm_key(a["title"], a["source"]): a for a in load_json(OUT, [])}
    before = len(store)
    aliases = {b["id"]: [fold(x) for x in b.get("aliases", [b["name"]])] for b in brands}
    ok = fails = 0
    last = 0.0

    def save():
        kept = [a for a in store.values() if a["date"] >= keep_from]
        kept.sort(key=lambda a: a["date"], reverse=True)
        save_json(OUT, kept[: settings.get("articles_keep", 20000)])

    try:
        for mi, m in enumerate(markets, 1):
            got = 0
            for b in brands:
                if fails >= MAX_FAILS:
                    raise RuntimeError(f"連續 {fails} 次失敗，Google News 可能暫時拒絕請求")
                wait = PAUSE - (time.monotonic() - last)
                if wait > 0:
                    time.sleep(wait)
                macau = " OR ".join(map(term, m["macau"]))
                names = " OR ".join(map(term, b.get("aliases", [b["name"]])))
                params = {"q": f"({macau}) ({names}) when:{when}",
                          "hl": m["hl"], "gl": m["gl"], "ceid": m["ceid"]}
                try:
                    root = fetch(params, deadline)
                    ok += 1
                    fails = 0
                except TimeoutError:
                    raise
                except RuntimeError as e:
                    fails += 1
                    log(f"  {m['iso3']}/{b['id']} 失敗：{e}")
                    continue
                finally:
                    last = time.monotonic()

                for it in parse(root):
                    title_f = fold(it["title"])
                    found = {bid for bid, al in aliases.items() if any(x in title_f for x in al)}
                    found.add(b["id"])
                    key = norm_key(it["title"], it["source"])
                    rec = store.get(key)
                    if rec is None:
                        rec = store[key] = {**it, "lang": m["lang"], "markets": [], "brands": []}
                    rec["markets"] = sorted(set(rec["markets"]) | {m["iso3"]})
                    rec["brands"] = sorted(set(rec["brands"]) | found)
                    got += 1
            log(f"[{mi}/{len(markets)}] {m['iso3']}（{m['hl']}）：{got} 條結果")
            save()
    except (TimeoutError, RuntimeError) as e:
        log(f"提前結束：{e}。已抓到的結果會保存。")
    finally:
        save()

    log(f"Google News：成功 {ok} 次請求，新增 {len(store) - before} 篇，累計 {len(store)} 篇")
    if ok == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
