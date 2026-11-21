# 星耀拉霸 Star Spin — 靜態 Casino H5 遊戲

一款可直接部署到任何靜態托管平台的輕量級老虎機遊戲。使用原生 JavaScript + Canvas 2D，**無框架、無建置步驟、無外部網路請求**，且全部點數皆為虛擬幣，不涉及現金交易。

> ⚠️ 本專案僅供娛樂與技術展示。虛擬幣不可充值、提領或兌換現金與任何有價物品；正式博弈營運必須把 RNG、下注與派彩結算移至伺服器端，並確認目標地區法規。

---

## 一、來源篩選結果

| 來源 | 檢查結果 | 決策 |
| --- | --- | --- |
| [GitHub topics/open-source-games](https://github.com/topics/open-source-games) | 50 個專案中沒有 casino/slots/poker/blackjack 相關項目 | 未採用 |
| [GitHub Trending](https://github.com/trending) | 今日與 JS 榜單皆無符合條件的輕量博弈 HTML5 遊戲 | 未採用 |
| [Ludum Dare 組織](https://github.com/orgs/LudumDare/repositories) | 7 個 repo 均為官網與活動工具，無可玩博弈遊戲 | 未採用 |
| [Simple Game Tutorials](https://simplegametutorials.github.io/) | 僅提供 Lua/LÖVE 與 Python/Pygame Zero 教學，無 JS/Canvas | 未採用 |
| itch.io 開源標籤 / API | 唯一符合「開源＋博弈＋HTML5」的 Mobile spin roulette 採 GPL-3.0，且需 Vite 建置 | 未採用（copyleft + 建置成本） |
| [johakr/html5-slot-machine](https://github.com/johakr/html5-slot-machine) | MIT、633 stars、原生 HTML/CSS/JS、Web Animations API、RWD | ✅ 選為設計參考 |

**選型理由**：MIT 授權限制最少、設計概念單純（三轉輪老虎機），適合重新實作為零相依、免建置的 Canvas 版本。原專案授權宣告完整收錄於 `THIRD_PARTY_LICENSES.txt`，並於頁尾標示來源。

---

## 二、專案結構

```
casino-static/
├── index.html               # 語意化首頁 + SEO/GEO meta + JSON-LD
├── css/style.css            # RWD、淺色主題、無障礙樣式
├── js/game.js               # 狀態機、RNG、Canvas 渲染、音效、粒子池
├── og-image.png             # 社群分享圖（1200×630）
├── .nojekyll                # 停用 Jekyll，保留底線開頭檔案
├── _headers                 # Cloudflare Pages 安全標頭與快取規則
├── robots.txt               # 爬蟲規則與 sitemap 位置
├── sitemap.xml              # 網站地圖
├── llms.txt                 # 生成式引擎友善摘要（GEO）
├── THIRD_PARTY_LICENSES.txt # 開源來源授權宣告
└── tools/
    ├── make_og.py           # 重新產生 og-image.png 的腳本
    ├── smoke-test.js        # 不需瀏覽器的狀態機煙測
    ├── cloudflare_pages_deploy.py  # Cloudflare Pages Direct Upload 部署腳本
    └── github_pages_deploy.py      # GitHub Pages Contents API 部署腳本
```

本機驗證指令：

```bash
node tools/smoke-test.js
```

---

## 三、SEO / GEO 實作清單

**SEO（搜尋引擎優化）**

- `<html lang="zh-Hant">`、語意化 `<header>/<nav>/<main>/<section>/<article>/<aside>/<footer>`
- 完整的 `<title>`、`description`、`keywords`、`<link rel="canonical">`
- Open Graph（`og:type/title/description/url/image/image:alt/locale`）
- Twitter Card（`summary_large_image`）
- JSON-LD 結構化資料：`WebSite`、`Organization`、`WebPage`、`GameApplication`、`FAQPage`
- `robots.txt` + `sitemap.xml`，allow 全部爬蟲
- 所有重要內容都是真實 HTML 文字，不藏在 Canvas 或圖片裡
- FAQ 區塊與 JSON-LD 內容一致，提高精選摘要與引用機會

**GEO（生成式引擎優化）**

- 首頁第一段提供 2–3 句可直接引用的定義式摘要
- `<dl>` 重點摘要表與「技術摘要」提供結構化事實
- `llms.txt` 以純文字 Markdown 列出核心事實、賠率、FAQ 與引用建議
- 標題層級單一且清楚（h1 → h2 → h3），段落短、用語一致
- 賠率、操作方式、限制條件在 JSON-LD、FAQ、llms.txt 三處保持一致

**效能與可訪問性**

- 總資源僅 1 支 CSS + 1 支 JS，無外部字型/圖片/套件請求
- Canvas 內部解析度依 `devicePixelRatio` 調整並上限 2 倍，避免過度繪製
- 粒子系統使用物件池，降低 GC 卡頓
- 數學模型：加權抽樣 30/24/18/16/12，搭配賠率 10/15/25/40/80，理論 RTP 約 92.5%（僅供展示）
- 所有控制項皆為原生 `<button>`，支援鍵盤與 `ARIA` 即時播報
- `prefers-reduced-motion` 自動縮短動畫；`touch-action: manipulation` 降低觸控延遲

---

## 四、部署方式

直接把整個目錄上傳到任意靜態托管（GitHub Pages、Cloudflare Pages、Netlify、Vercel、Nginx 靜態目錄皆可）：

```bash
# 本機預覽
python -m http.server 8080 -d casino-static
# 開啟 http://localhost:8080
```

Cloudflare Pages 直接上傳（CI 情境用環境變數，切勿把 Token 寫入檔案）：

```bash
cd casino-static
CF_ACCOUNT_ID=<你的帳號 ID> CF_PROJECT_NAME=star-spin-slots CF_API_TOKEN=<你的 API Token> \
  python tools/cloudflare_pages_deploy.py
```

此腳本不使用 Wrangler，直接呼叫 Pages REST API，並處理三個容易踩坑的細節：
BLAKE3 雜湊、`pages/assets/upsert-hashes` 註冊、manifest 路徑需帶前導斜線。
`_headers` 是 Cloudflare Pages 的安全標頭與快取設定；GitHub Pages 不會讀取它，但保留檔案不影響站台。本專案不需要 R2 或資料庫。

GitHub Pages 部署（使用 Contents API，不需本機 git 憑證）：

```bash
cd casino-static
GH_TOKEN=<你的 GitHub Token> GH_REPO=star-spin-slots \
  python tools/github_pages_deploy.py
```

目前網址已替換為 GitHub Pages 網域 `https://vip-4.github.io/star-spin-slots/`。若之後綁定自訂網域，請把以下檔案中的網址換成正式網域：

- `index.html`：`canonical`、`og:url`、`og:image`、`twitter:image`、所有 JSON-LD 的 `@id` / `url`
- `robots.txt`：Sitemap 網址
- `sitemap.xml`：`<loc>`
- `llms.txt`：頁面連結

---

## 五、正式營運注意事項

1. **RNG 與派彩 server 化**：前端只做動畫，結果由伺服器在每次旋轉開始前決定並簽章，避免竄改。
2. **斷線重連**：以 roundId 做冪等結算，重連後向伺服器補拉結果，不要信任 localStorage 餘額。
3. **iOS Safari 音訊**：AudioContext 必須在使用者手勢中建立/resume；本版本預設靜音並由按鈕解鎖。
4. **WebGL 上下文遺失**：本版本只用 Canvas 2D，無此問題；若改用 PixiJS/Phaser，需監聽 `webglcontextlost`。
5. **法規**：上線前確認目標地區對線上博弈的規範，並落實年齡限制與責任博奕警示。
