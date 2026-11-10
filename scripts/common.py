"""共用工具：路徑、HTTP 請求、JSON 讀寫、日誌。"""
import json
import os
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config"
RAW = ROOT / "data" / "raw"
MANUAL = ROOT / "data" / "manual"
SITE_DATA = ROOT / "site" / "data"

USER_AGENT = os.environ.get(
    "USER_AGENT", "macau-luxury-visitor-dashboard/0.1 (personal research project)"
)
RETRY_STATUS = {429, 500, 502, 503, 504}

session = requests.Session()
session.headers.update({"User-Agent": USER_AGENT})


class FetchError(RuntimeError):
    pass


def log(*args):
    print(*args, flush=True)


def deadline_after(minutes):
    return time.monotonic() + float(minutes) * 60


def budget_from_env(name, default_minutes):
    return deadline_after(os.environ.get(name) or default_minutes)


def config(name):
    return load_json(CONFIG / name)


def load_json(path, default=None):
    path = Path(path)
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save_json(path, obj, pretty=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        if pretty:
            json.dump(obj, f, ensure_ascii=False, indent=2, sort_keys=True)
        else:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        f.write("\n")
    tmp.replace(path)  # 先寫暫存檔再改名，中途被終止也不會留下半個檔案


def get_json(url, params=None, data=None, retries=3, timeout=(10, 45), backoff=5, deadline=None):
    """GET（或在傳入 data 時 POST）並解析 JSON。

    - 404 回傳 None，空白回應回傳 {}。
    - 429、5xx、連線錯誤、限流文字會重試；其他 4xx 和非 JSON 回應直接失敗。
    - timeout 是（連線秒數, 讀取秒數）；deadline 是 time.monotonic() 的截止時間。
    """
    last = None
    for attempt in range(1, retries + 1):
        if deadline and time.monotonic() > deadline:
            raise FetchError(f"超過時間上限（最後錯誤：{last}）")
        try:
            if data is not None:
                r = session.post(url, data=data, timeout=timeout)
            else:
                r = session.get(url, params=params, timeout=timeout)
        except requests.RequestException as e:
            last = f"{type(e).__name__}"
        else:
            if r.status_code == 404:
                return None
            if r.status_code in RETRY_STATUS:
                last = f"HTTP {r.status_code}"
            elif r.status_code >= 400:
                raise FetchError(f"HTTP {r.status_code}")
            else:
                text = r.text.strip()
                if not text:
                    return {}
                try:
                    return r.json()
                except ValueError:
                    snippet = text[:150].replace("\n", " ")
                    if "limit requests" in text.lower():
                        last = f"被限流：{snippet}"
                    else:
                        raise FetchError(f"回應不是 JSON：{snippet}")
        if attempt < retries:
            wait = backoff * attempt
            if deadline and time.monotonic() + wait > deadline:
                break
            log(f"    第 {attempt} 次失敗（{last}），{wait} 秒後重試")
            time.sleep(wait)
    raise FetchError(f"請求失敗：{last}")
