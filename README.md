# 文華花苑｜配送管理 Demo

橘色品牌的手機掃碼工具。實際相機辨識，模擬登入、查詢、已送達登記、歷史訂單與操作紀錄。**不連接 SHOPLINE、不修改真實訂單。**

## 開啟方式

[開啟線上 Demo](https://wildddlilyyy.github.io/mandarin-delivery-demo/) · [GitHub 專案](https://github.com/wildddlilyyy/mandarin-delivery-demo)

靜態檔案可直接部署 GitHub Pages，來源選 `main` 分支的根目錄。支援 repository 子目錄及 hash 路由。相機必須由 HTTPS 網頁或 localhost 開啟；不支援直接雙擊 file 網址使用。

本機預覽需 Node.js 18+，執行 `npm start`，開啟 `http://127.0.0.1:8173`。測試執行 `npm test`。沒有前端建置步驟或 npm 安裝需求，ZXing 套件已隨網站附上。

## 展示操作

1. 用 `driver01` 或 `manager01` 登入，密碼都是 `demo1234`。
2. 選「開始掃描」，允許相機並對準出貨單右上方條碼。也可手動輸入或點擊「成功範例／失敗範例」。
3. 開啟訂單清單，核對、勾選已實際送達，再確認送出。
4. 查看逐筆結果、歷史與操作紀錄；到操作紀錄頁可重設資料重新展示。

| 訂單編號 | 示範結果 |
|---|---|
| `20261012192853973` | 成功；僅採用出貨單可見編號，顧客內容皆虛構 |
| `20261013100000001` | 成功 |
| `20261013100000002` | 初始已送達，略過加入 |
| `20261013100000003` | 固定模擬更新失敗 |
| `00000000000000000` | 查無訂單 |

## 保存與限制

- 展示帳密公開，模擬登入不是安全保護。
- 狀態與紀錄保存在本機 localStorage；登入狀態使用 sessionStorage。相同瀏覽器帳號清單分離、歷史共用，不同裝置不互相同步。
- 單一分頁展示；資料可以由使用者修改／清除，不能用作真正稽核。
- 相機影格只在本機解碼，不上傳。沒有 API 金鑰或真實顧客個資。
- 手機、平板與桌機採相同中央最大 390px 內容，頂部 menu 與背景全寬。
- 相機可能受權限、裝置或光線影響，拒絕權限後可手動輸入。
- 實際 iPhone／Android 出貨單辨識仍需客戶現場驗收，不能以桌機測試替代。

## 文件與授權

[正式產品規格](SPEC.md) · [Demo 開發規格](DEMO_SPEC.md) · [驗證紀錄](TEST_REPORT.md)

條碼引擎：`@zxing/browser` 0.1.5 UMD（內含 ZXing JS），來源為官方 npm 套件的 jsDelivr 發佈；browser 的 MIT 授權見 `assets/vendor/ZXING-LICENSE.txt`，內含 library 的 Apache-2.0 授權見 `assets/vendor/ZXING-LIBRARY-LICENSE.txt`。字體使用 Google Fonts 的 Noto Sans TC，網路不可用時回退至系統繁中字體。

