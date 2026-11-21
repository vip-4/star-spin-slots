# -*- coding: utf-8 -*-
"""Cloudflare Pages Direct Upload（不依賴 Wrangler / esbuild）。

使用方式（憑證僅由環境變數傳入，切勿寫入檔案）：
  CF_ACCOUNT_ID=<account> CF_API_TOKEN=<token> python tools/cloudflare_pages_deploy.py

上傳流程參考 Wrangler 原始碼：
1. 取得 upload-token（JWT）
2. POST /pages/assets/upload 上傳 base64 內容
3. POST /accounts/.../pages/projects/.../deployments 提交 manifest
"""
import base64
import json
import mimetypes
import os
from pathlib import Path

import blake3
import requests

ACCOUNT = os.environ.get("CF_ACCOUNT_ID", "")
TOKEN = os.environ.get("CF_API_TOKEN", "")
PROJECT = os.environ.get("CF_PROJECT_NAME", "star-spin-slots")
ROOT = Path(__file__).resolve().parents[1]
API = "https://api.cloudflare.com/client/v4"

# 只上線真正需要公開的檔案；工具腳本、README 與授權宣告不對外發布
WEB_FILES = [
    "index.html",
    "css/style.css",
    "js/game.js",
    "og-image.png",
    "robots.txt",
    "sitemap.xml",
    "llms.txt",
]


def fail(message):
    raise SystemExit("部署失敗：" + message)


def check_response(response, action):
    try:
        body = response.json()
    except ValueError:
        fail(f"{action} 回傳非 JSON（HTTP {response.status_code}）")
    if not body.get("success"):
        fail(f"{action}：{body.get('errors')}")
    return body.get("result")


def main():
    if not ACCOUNT or not TOKEN:
        fail("請設定 CF_ACCOUNT_ID 與 CF_API_TOKEN 環境變數")
    for name in WEB_FILES:
        if not (ROOT / name).is_file():
            fail(f"缺少檔案：{name}")

    auth = {"Authorization": f"Bearer {TOKEN}"}

    # 1) 取得上傳用 JWT
    result = check_response(
        requests.get(
            f"{API}/accounts/{ACCOUNT}/pages/projects/{PROJECT}/upload-token",
            headers=auth,
            timeout=30,
        ),
        "取得 upload-token",
    )
    jwt = result["jwt"]

    # 2) 計算雜湊並上傳檔案內容
    # Wrangler 的規則：BLAKE3(base64 內容 + 副檔名)'hex' 的前 32 碼
    payload = []
    manifest = {}
    for name in WEB_FILES:
        raw = (ROOT / name).read_bytes()
        encoded = base64.b64encode(raw).decode("ascii")
        ext = Path(name).suffix.lstrip(".")
        digest = blake3.blake3((encoded + ext).encode("utf-8")).hexdigest()[:32]
        content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        payload.append({
            "key": digest,
            "value": encoded,
            "metadata": {"contentType": content_type},
            "base64": True,
        })
        # Pages Direct Upload 的 manifest 路徑必須帶前導斜線（與 Wrangler 一致）
        manifest["/" + name] = digest

    jwt_headers = {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}
    all_hashes = [item["key"] for item in payload]
    missing = check_response(
        requests.post(
            f"{API}/pages/assets/check-missing",
            headers=jwt_headers,
            json={"hashes": all_hashes},
            timeout=30,
        ),
        "檢查缺少的資源",
    )
    to_upload = [item for item in payload if item["key"] in missing]
    if to_upload:
        uploaded = check_response(
            requests.post(
                f"{API}/pages/assets/upload",
                headers=jwt_headers,
                json=to_upload,
                timeout=60,
            ),
            "上傳靜態資源",
        )
        print("已上傳檔案數:", uploaded.get("successful_key_count"))

    # 關鍵步驟：必須 upsert-hashes，否則部署的 manifest 會找不到資源而回 404
    check_response(
        requests.post(
            f"{API}/pages/assets/upsert-hashes",
            headers=jwt_headers,
            json={"hashes": all_hashes},
            timeout=30,
        ),
        "註冊資源雜湊",
    )

    # 3) 建立部署；_headers 為 Pages 的特殊表單欄位
    import hashlib
    commit_hash = hashlib.sha256("|".join(sorted(manifest)).encode("utf-8")).hexdigest()[:40]
    form = {
        "manifest": (None, json.dumps(manifest, separators=(",", ":"))),
        "branch": (None, "main"),
        "commit_dirty": (None, "false"),
        "commit_hash": (None, commit_hash),
        "commit_message": (None, "SEO/GEO static deploy"),
        "pages_build_output_dir": (None, "."),
    }
    headers_path = ROOT / "_headers"
    if headers_path.is_file():
        form["_headers"] = ("_headers", headers_path.read_bytes(), "text/plain")

    # 必須用 files= 送出才會是 multipart/form-data；
    # 若用 data= 會變成 x-www-form-urlencoded，API 會回 8000006。
    deployment = check_response(
        requests.post(
            f"{API}/accounts/{ACCOUNT}/pages/projects/{PROJECT}/deployments",
            headers=auth,
            files=form,
            timeout=60,
        ),
        "建立部署",
    )

    print("部署已建立")
    print("deployment id:", deployment.get("id"))
    print("url:", deployment.get("url"))
    print("上傳檔案數:", len(WEB_FILES))


if __name__ == "__main__":
    main()
