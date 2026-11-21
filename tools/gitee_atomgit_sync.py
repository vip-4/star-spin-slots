# -*- coding: utf-8 -*-
"""同步原始碼到 Gitee 與 AtomGit 的公開倉庫。

使用方式（憑證僅由環境變數傳入，切勿寫入檔案）：
  GITEE_TOKEN=<token> ATOMGIT_TOKEN=<token> python tools/gitee_atomgit_sync.py

兩個平台都使用 Gitee 風格的 v5 Contents API（表單參數 + access_token）。
"""
import base64
import os
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
EXCLUDE_DIRS = {"__pycache__", ".git"}
EXCLUDE_NAMES = {".DS_Store"}

PLATFORMS = [
    {
        "name": "Gitee",
        "api": "https://gitee.com/api/v5",
        "owner": "vip882",
        "repo": "star-spin-slots",
        "branch": "master",
        "token": os.environ.get("GITEE_TOKEN", ""),
    },
    {
        "name": "AtomGit",
        "api": "https://api.atomgit.com/api/v5",
        "owner": "zzw1208",
        "repo": "star-spin-slots",
        "branch": "main",
        "token": os.environ.get("ATOMGIT_TOKEN", ""),
    },
]


def fail(message):
    raise SystemExit("同步失敗：" + message)


def collect_files():
    result = []
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        if any(part in EXCLUDE_DIRS for part in rel.parts) or rel.name in EXCLUDE_NAMES:
            continue
        result.append((rel.as_posix(), path))
    return result


def sync_platform(config, files):
    name, api, owner, repo = config["name"], config["api"], config["owner"], config["repo"]
    branch, token = config["branch"], config["token"]
    if not token:
        print(f"略過 {name}：未提供 Token")
        return
    base = f"{api}/repos/{owner}/{repo}/contents"
    print(f"\n=== {name}: {owner}/{repo} ({branch}) ===")

    for rel, local in files:
        url = f"{base}/{rel}"
        content = base64.b64encode(local.read_bytes()).decode("ascii")
        payload = {
            "access_token": token,
            "content": content,
            "message": "Sync Star Spin static source",
            "branch": branch,
        }
        existing = requests.get(
            url, params={"access_token": token, "ref": branch}, timeout=30
        )
        existing_json = existing.json() if existing.status_code == 200 else None
        if isinstance(existing_json, dict) and existing_json.get("sha"):
            payload["sha"] = existing_json["sha"]
            response = requests.put(url, data=payload, timeout=60)
            action = "更新"
        else:
            response = requests.post(url, data=payload, timeout=60)
            action = "新增"
            if response.status_code in (400, 409) and "already" in response.text.lower():
                # 權限或索引延遲造成的競態：重新取得 sha 再試一次
                retry = requests.get(
                    url, params={"access_token": token, "ref": branch}, timeout=30
                )
                retry_json = retry.json() if retry.status_code == 200 else None
                if isinstance(retry_json, dict) and retry_json.get("sha"):
                    payload["sha"] = retry_json["sha"]
                    response = requests.put(url, data=payload, timeout=60)
                    action = "更新"
        if response.status_code not in (200, 201):
            fail(f"{name} {action} {rel} 失敗：{response.status_code} {response.text[:200]}")
        print(action, rel)

    print(f"{name} 完成，共 {len(files)} 個檔案")


def main():
    files = collect_files()
    for config in PLATFORMS:
        sync_platform(config, files)


if __name__ == "__main__":
    main()
