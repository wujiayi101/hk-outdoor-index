# 今日戶外運動合適指數 · HK Outdoor Exercise Index

香港每日「戶外運動合適度」評分（1–10），結合 [香港天文台](https://www.hko.gov.hk) 與 [環保署](https://www.aqhi.gov.hk) 公開數據:

| 因素 | 來源 |
|---|---|
| 氣溫 / 濕度 / 紫外線 / 降雨 / 天氣警告 / 九天預報 | HKO Open Data API |
| 能見度（煙霞） | HKO 區域天氣 10 分鐘能見度 |
| 空氣質素 AQHI | EPD 環保署 |

分數由 10 分扣減:酷熱、潮濕、雷暴/暴雨、空氣污染、低能見度、強紫外線各有扣分;惡劣天氣警告（暴雨/雷暴/酷熱/台風）會直接壓低分數。

## 架構

天文台能見度 CSV 與環保署 AQHI XML **沒有 CORS**,瀏覽器無法直接抓,且 GitHub runner 未必連得到香港政府網站。因此用 **Cloudflare Pages Function**(`functions/api/today.js`)在邊緣伺服器抓取 5 個數據源、計算分數、加上 CORS 回傳 JSON,邊緣快取 20 分鐘。

→ 數據**每次瀏覽都是即時**的(已超越「每朝更新」);GitHub Actions 每朝 07:00 (HKT) 重新部署作心跳。

```
functions/api/today.js   邊緣計算分數的 API
src/                      React 前端(分數錶 + 因素卡 + 建議)
public/sample.json        本地開發 fallback(vite dev 無 Function 時用)
```

## 開發

```bash
npm install
npm run dev       # vite,UI 開發(用 public/sample.json 假資料)
npm run dev:cf    # build + wrangler pages dev,跑真 Function /api/today
npm run build
```

## 部署 (Cloudflare Pages)

push 到 `main` / 每朝排程 / 手動觸發即自動部署。Repo 需設 Secrets:`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。首次自動建立名為 `hk-outdoor-index` 的 Pages 專案。

## 免責

指數為綜合估算,僅供參考。惡劣天氣請以天文台官方警告為準。
