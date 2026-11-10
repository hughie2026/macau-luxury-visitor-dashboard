"""共用工具：路徑、HTTP 請求、JSON 讀寫。"""
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

session = requests.Session()
session.headers.update({"User-Agent": USER_AGENT})


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
    with path.open("w", encoding="utf-8") as f:
        if pretty:
            json.dump(obj, f, ensure_ascii=False, indent=2, sort_keys=True)
        else:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        f.write("\n")


def get_json(url, params=None, data=None, retries=4, wait=10, timeout=60):
    """GET（或在傳入 data 時 POST）並解析 JSON。404 回傳 None，限流和 5xx 會重試。"""
    last_error = None
    for attempt in range(retries):
        try:
            if data is not None:
                r = session.post(url, data=data, timeout=timeout)
            else:
                r = session.get(url, params=params, timeout=timeout)
            if r.status_code == 404:
                return None
            if r.status_code in (429, 500, 502, 503, 504):
                raise RuntimeError(f"HTTP {r.status_code}")
            r.raise_for_status()
            if not r.text.strip():
                return {}
            return r.json()
        except (requests.RequestException, ValueError, RuntimeError) as e:
            last_error = e
            time.sleep(wait * (attempt + 1))
    raise RuntimeError(f"請求失敗：{url} → {last_error}")
