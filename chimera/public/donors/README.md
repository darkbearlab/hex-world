# 原主專屬圖（Alan 2026-10-10）

每位資料主人（原主）一個資料夾，資料夾名就是原主的編號（目前跟頭像同名：ember、onyx、silver、cedar、portrait-05 … portrait-16，見 company.js DONORS）。
放了哪張就換哪張，沒放的照舊用現在的圖。部署時會掃這個資料夾（asset-manifest.json），不用改程式。

| 檔名 | 用在哪裡 | 規格 |
|---|---|---|
| `portrait.png` | 名冊、小卡、選人清單等所有頭像 | 64×64 |
| `full.png` | 人員卡片、出擊編成卡片、簽收演出的立繪 | 半身或全身，透明底，貼底置中（電腦上直長、手機上當背景、上半部露出胸部以上） |
| `sprite.png` | ASH 戰場上的單位 | 64×32，透明底、彩色：左半（0,0）站著、右半（32,0）倒地（照「被從左邊打倒」的樣子畫，從右邊打倒時遊戲會左右翻）。有這張圖就不套操作員顏色 |

例：`donors/ember/full.png`、`donors/portrait-05/sprite.png`
