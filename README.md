# 三世纪 · 罗马的黄昏
### Third Century: Twilight of Rome

![Players](https://img.shields.io/badge/players-2--8%20(best%203)-informational)
![Playtime](https://img.shields.io/badge/playtime-20--30%20min-blue)
![Engine](https://img.shields.io/badge/engine-zero--dependency%20ESM-9cf)
![Tests](https://img.shields.io/badge/tests-456%2F0-brightgreen)
![License](https://img.shields.io/badge/license-CC%20BY--NC%204.0-lightgrey)

一场发生在公元三世纪罗马帝国危机（235–284 年）的环形战线博弈。皇帝频遭弑杀、边境烽火连天、经济崩溃——你要在四面楚歌中守住自己的疆界，并从中央区攫取足以定鼎的筹码。

本仓库同时提供 **可即开即玩的网页版**、**可打印的 PnP（打印即玩）素材**与**完整规则书**，全部零依赖、可离线运行。

---

## 目录

- [快速开始](#快速开始)
- [游戏简介](#游戏简介)
- [核心机制](#核心机制)
- [组件清单](#组件清单)
- [仓库结构](#仓库结构)
- [技术说明](#技术说明)
- [许可](#许可)

---

## 快速开始

### 网页版（推荐，零安装）
直接用浏览器打开 [`web/index.html`](web/index.html) 即可游玩——单文件、无依赖、可离线。
本地开发可运行 `node web/server.cjs` 后访问 `http://localhost:8080`，或修改后执行 `node web/build_standalone.mjs` 重新生成单文件。

### 实体 PnP 版
1. 打印 [`pnp/`](pnp/) 目录下的 6 张 SVG（兵牌、牌背、战术牌、中央棋盘、筹码、玩家速查卡）。
2. 需要重新生成素材时运行 `python pnp/gen_pnp.py`。
3. 折装与配件说明见 [`docs/pnp-guide.html`](docs/pnp-guide.html)。

### 规则书
- 网页版：[`docs/rules.html`](docs/rules.html)
- PDF 版：[`docs/rulebook.pdf`](docs/rulebook.pdf)

---

## 游戏简介

三世纪是罗马最危险的世纪：五十年内超过二十位皇帝死于非命，行省纷纷自立，瘟疫与通胀撕裂社会。本作不追求历史还原的沉重，而是把这段「谁都可能是下一任皇帝、谁都可能明天被刺」的混沌提炼成一套轻量、互车、零和的阵营博弈。

设计取向偏**美式（Ameritrash）**而非欧式：决策空间大、信息模糊、人人互车，中央区是全员争夺的公共资源而非可独占的私产。

---

## 核心机制

- **环形战线（规则 3.1）**：战线数 = 人数（2–8 人）。每位玩家同时镇守左右两条战线，所有战线首尾相连成闭环——没有旁观者，每一线都是双线全面战争。
- **零和旗帜**：每面旗帜归一方所有即对方失去；夺旗后**封存**（牌留原位、归属定格、至多易主一次），形成不可逆的战线走势。
- **中央区争夺**：位于环中央的公共资源，约占终局分数的 27%，是全员拉锯的焦点。
- **战术牌三态**：
  - **士气**：落入己方阵型，结算时作为定点万能牌。
  - **环境**：改变该格的比较方式（瘟疫→只比点数和；春汛→阵型扩为 4 张）。
  - **计谋**：落场持久效果——哥特游骑（侦察）、换防、哗变、倒戈；可被对手夺取并回滚，构成「绑定中央区─被夺─回滚」的循环。
- **双模式终局**：短局（12 面旗定胜负）约 20 分钟；长局（打空手牌或棋盘封满）约 30 分钟。

---

## 组件清单

| 类别 | 文件 | 说明 |
|---|---|---|
| 规则书 | `docs/rules.html` / `docs/rulebook.pdf` | 完整规则（网页 / PDF） |
| PnP 说明 | `docs/pnp-guide.html` | 组件清单与折装指引 |
| 兵牌 | `pnp/01_troop_cards.svg` | 部队卡 |
| 牌背 | `pnp/02_card_backs.svg` | 卡背 |
| 战术牌 | `pnp/03_tactics_cards.svg` | 战术卡 |
| 中央棋盘 | `pnp/04_central_board.svg` | 战线与中央区 |
| 筹码 | `pnp/05_tokens.svg` | 控制/标记筹码 |
| 玩家速查 | `pnp/06_player_reference.svg` | 回合流程速查 |
| 生成脚本 | `pnp/gen_pnp.py` | 从真源重生成 6 张 SVG |

---

## 仓库结构

```
third-century/
├── docs/                 # 规则书与 PnP 说明
│   ├── rules.html
│   ├── rulebook.pdf
│   └── pnp-guide.html
├── pnp/                  # 打印即玩素材（SVG + 生成脚本）
│   ├── 01_troop_cards.svg … 06_player_reference.svg
│   ├── gen_pnp.py
│   └── qa_tokens.png
├── web/                  # 网页版（单文件可玩 + 模块化源码）
│   ├── index.html        # 单文件可玩版（双击即玩）
│   ├── index.src.html    # 构建源
│   ├── src/              # 引擎源码（零依赖 ESM）
│   ├── build_standalone.mjs
│   ├── server.cjs
│   └── test.mjs / sim.mjs / fuzz.mjs / settle_invariant.mjs / balance_analysis.mjs
├── README.md
├── LICENSE
└── .gitignore
```

---

## 技术说明

- **引擎零依赖**：`web/src/` 为纯 ES Module，不依赖任何第三方包；`node web/test.mjs` 即可在本地跑全套回归（**456/0** 通过）。
- **单文件构建**：`web/build_standalone.mjs` 把 `index.src.html` 与 `src/*.mjs` 内联打包为 `web/index.html`，可直接 `file://` 打开。
- **平衡与正确性**：`sim.mjs`（夺冠分布）、`fuzz.mjs`（混沌）、`settle_invariant.mjs`（结算不变量）、`balance_analysis.mjs`（平衡四指标）共同保证规则一致性。规则书、网页、PnP 四层文本以 `pnp/gen_pnp.py` 为真源，改一处即可重生成。
- **最佳人数 = 3 人**：8 人仅为最大支持人数；3 人时形成无旁观者的双线闭环战争，决策密度最高。

---

## 许可

本作品以 **知识共享 署名-非商业性使用 4.0 国际（CC BY-NC 4.0）** 协议发布。
你可以自由下载、打印、游玩、在非商业范围内分享与修改本游戏及 PnP 素材，但须署名并注明出处；商业使用须经授权。详见 [`LICENSE`](LICENSE)。
