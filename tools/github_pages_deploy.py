# -*- coding: utf-8 -*-
"""將本目錄部署為 GitHub Pages 專案站台。

使用方式（憑證僅由環境變數傳入，切勿寫入檔案）：
  GH_TOKEN=<你的 Token> GH_REPO=star-spin-slots python tools/github_pages_deploy.py

流程：確認/建立 repo → 以 Contents API 逐檔上傳 → 啟用 Pages（branch root）。
"""
import base64
import os
import time
from pathlib import Path

import requests

API = "https://api.github.com"
OWNER = os.environ.get("GH_OWNER", "")
REPO = os.environ.get("GH_REPO", "star-spin-slots")
TOKEN = os.environ.get("GH_TOKEN", "")
ROOT = Path(__file__).resolve().parents[1]

# 不上傳到 Pages 的本機檔案
EXCLUDE_DIRS = {"__pycache__", ".git"}
EXCLUDE_NAMES = {".DS_Store"}


def session_headers():
    return {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def fail(message):
    raise SystemExit("部署失敗：" + message)


def main():
    global OWNER
    if not TOKEN:
        fail("請設定 GH_TOKEN 環境變數")

    headers = session_headers()

    # 1) 取得帳號（若未指定 owner）
    me = requests.get(f"{API}/user", headers=headers, timeout=30)
    if me.status_code != 200:
        fail(f"Token 驗證失敗：{me.status_code}")
    if not OWNER:
        OWNER = me.json()["login"]

    # 2) 確認或建立 repo
    repo_url = f"{API}/repos/{OWNER}/{REPO}"
    existing = requests.get(repo_url, headers=headers, timeout=30)
    if existing.status_code == 200:
        repo = existing.json()
        branch = repo.get("default_branch") or "main"
        print("使用現有 repo:", repo["full_name"], "分支:", branch)
    elif existing.status_code == 404:
        created = requests.post(
            f"{API}/user/repos",
            headers=headers,
            json={
                "name": REPO,
                "description": "星耀拉霸 Star Spin — 輕量靜態 HTML5 老虎機（虛擬幣）",
                "private": False,
                "has_issues": False,
                "has_wiki": False,
                "has_projects": False,
                "auto_init": False,
            },
            timeout=30,
        )
        if created.status_code not in (200, 201):
            fail(f"建立 repo 失敗：{created.status_code} {created.text[:200]}")
        repo = created.json()
        branch = repo.get("default_branch") or "main"
        print("已建立 repo:", repo["full_name"], "分支:", branch)
    else:
        fail(f"查詢 repo 失敗：{existing.status_code}")

    # 3) 逐檔上傳（Contents API 會自動建立必要的目錄）
    files = []
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        if any(part in EXCLUDE_DIRS for part in rel.parts) or rel.name in EXCLUDE_NAMES:
            continue
        files.append((rel.as_posix(), path))

    for rel, local_path in files:
        content = base64.b64encode(local_path.read_bytes()).decode("ascii")
        url = f"{repo_url}/contents/{rel}"
        payload = {
            "message": "Deploy Star Spin static site",
            "content": content,
            "branch": branch,
        }
        current = requests.get(url, headers=headers, params={"ref": branch}, timeout=30)
        if current.status_code == 200:
            payload["sha"] = current.json()["sha"]
        response = requests.put(url, headers=headers, json=payload, timeout=60)
        if response.status_code not in (200, 201):
            fail(f"上傳 {rel} 失敗：{response.status_code} {response.text[:200]}")
        print("已上傳:", rel)

    # 4) 啟用 Pages（branch root）
    pages = requests.get(f"{repo_url}/pages", headers=headers, timeout=30)
    if pages.status_code == 200:
        print("Pages 已啟用:", pages.json().get("html_url"))
    else:
        enabled = requests.post(
            f"{repo_url}/pages",
            headers=headers,
            json={"source": {"branch": branch, "path": "/"}},
            timeout=30,
        )
        if enabled.status_code not in (200, 201):
            fail(f"啟用 Pages 失敗：{enabled.status_code} {enabled.text[:300]}")
        print("Pages 已啟用:", enabled.json().get("html_url"))

    print("完成，共上傳檔案數:", len(files))
    print("站台網址: https://%s.github.io/%s/" % (OWNER, REPO))


if __name__ == "__main__":
    main()
