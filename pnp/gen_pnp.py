# -*- coding: utf-8 -*-
"""三世纪：罗马的黄昏 —— PnP 组件 SVG 生成器（古罗马风格简单美术）
输出目录: battleline_ring/pnp/
所有组件文案与 rules.html（客户版）严格对齐。
"""
import os, math

OUT = r"C:/Users/yushan/WorkBuddy/2026-10-05-16-48-00/battleline_ring/pnp"
os.makedirs(OUT, exist_ok=True)

# ---------- 调色板 ----------
PARCH   = "#f3e9d2"   # 羊皮纸底
PARCH2  = "#e9dcb8"
GOLD    = "#c9a227"
GOLD_D  = "#9c7a1e"
INK     = "#2b2118"
INK_SOFT= "#5b4f3a"
SERIF   = "'Noto Serif CJK SC','Songti SC','SimSun','Times New Roman',serif"

# 6 中央势力（= 6 花色），与序章 4 严格对应
SUITS = [
    ("元老院", "Senatus",     "#6b4a8c", "fasces"),
    ("禁卫军", "Praetoriani", "#b23a2e", "eagle"),
    ("宫廷近臣", "Aula Regia", "#2f6f9f", "star"),
    ("财政使", "Fiscus",      "#d98324", "coin"),
    ("意大利城市", "Italia",   "#4e8a4f", "tower"),
    ("北非粮仓", "Annona",     "#d9ad2e", "wheat"),
]

# 8 玩家势力（座位 / 名 / 称号 / 旗色 / 徽记）
FACTIONS = [
    (1, "卡劳修斯",   "不列颠分离政权", "不列颠的奥古斯都 · 海盗王", "#1f6f8b", "anchor"),
    (2, "克罗库斯",   "阿勒曼尼/法兰克诸部", "神庙毁灭者",            "#8a5a2b", "axe"),
    (3, "奥勒良",     "伊利里亚/多瑙河军团", "世界光复者",            "#b5462f", "orb"),
    (4, "尼瓦",       "哥特诸部", "皇帝杀手",                        "#3a3a3a", "sword"),
    (5, "沙普尔一世", "萨珊波斯", "王中之王 · 大帝",                 "#2f5fa8", "bow"),
    (6, "芝诺比娅",   "帕米拉帝国", "东方女王",                      "#7a3b8f", "arch"),
    (7, "巴高达",     "巴高达起义", "自称皇帝（埃里安努斯与阿曼杜斯）","#4f6b3a", "fork"),
    (8, "波斯图穆斯", "高卢帝国", "高卢帝国建立者",                  "#6b6f76", "standard"),
]

# 战术牌（分类 / 标题(可多行) / 徽记 / 效果分行）
TACTICS = [
    ("士气", "领袖", ["领袖", "克劳狄乌斯·哥提库斯"], "laurel_crown",
     ["万能牌：结算时确定其", "颜色与数字（任意花色", "任意点数）。", "同战线只可有一张领袖。"]),
    ("士气", "领袖", ["领袖", "普罗布斯"], "laurel_crown",
     ["万能牌：结算时确定其", "颜色与数字（任意花色", "任意点数）。", "同战线只可有一张领袖。"]),
    ("士气", "御林铁骑", ["御林铁骑"], "horse",
     ["视为任一花色的 8；", "颜色在结算时确定。"]),
    ("士气", "戍边军团", ["戍边军团"], "shield",
     ["视为任一花色、点数", "≤3（1/2/3）的牌；", "颜色与点位结算时确定。"]),
    ("环境", "西普里安瘟疫", ["西普里安瘟疫"], "skull",
     ["置于某未夺旗幟己方一侧。", "该旗幟忽略一切牌型，", "仅比双方点数总和。"]),
    ("环境", "多瑙河春汛", ["多瑙河春汛"], "waves",
     ["置于某未夺旗幟己方一侧。", "该旗幟改为四张成阵。", "离场→容量回落 3；", "多出 1 张由牌主弃。"]),
    ("计谋", "哥特游骑", ["哥特游骑"], "arrow_compass",
     ["从本战线牌堆抽 3 张入手", "任选 2 张由「哥特骑兵」", "模型压住（暂离场）。", "被夺→拿回被压的 2 张"]),
    ("计谋", "莱茵换防", ["莱茵换防"], "arrows_swap",
     ["将你方某未夺旗幟旁的", "一张牌移到己方另一空位", "或弃掉；虚空站位不占位。", "被夺→恢复；被占则不还"]),
    ("计谋", "军团哗变", ["军团哗变"], "arrow_down",
     ["将对手某未夺旗幟旁的", "一张牌移出并弃掉；", "原位留「哗变军士」模型。", "被夺→恢复；被占则不还"]),
    ("计谋", "附庸倒戈", ["附庸倒戈"], "arrow_up",
     ["取对手某未夺旗幟旁的", "一张部队牌放到己方", "一个空位；原位留模型。", "被夺→恢复；被占则不还"]),
]

CAT_COLOR = {"士气": "#b5462f", "环境": "#4e8a4f", "计谋": "#2f6f9f"}

# ---------- SVG 基础 ----------
def svg_doc(w, h, body, vb=None):
    vb = vb or f"0 0 {w} {h}"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="{vb}" font-family="{SERIF}">\n{body}\n</svg>\n')

def star_path(r_out, r_in, points=5, cx=0, cy=0):
    pts = []
    for i in range(points * 2):
        r = r_out if i % 2 == 0 else r_in
        a = math.pi / 2 - i * math.pi / points
        pts.append((cx + r * math.cos(a), cy - r * math.sin(a)))
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + " Z"

def laurel_ring(r, color, leaves=16):
    s = [f'<circle cx="0" cy="0" r="{r}" fill="none" stroke="{color}" stroke-width="1.5"/>']
    for i in range(leaves):
        ang = math.radians(i * (360 / leaves))
        if 150 < (i * (360 / leaves)) % 360 < 210:  # 底部留口
            continue
        x = r * math.cos(ang); y = r * math.sin(ang)
        s.append(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="6" ry="2.6" '
                 f'fill="{color}" transform="rotate({math.degrees(ang)+90:.1f} {x:.1f} {y:.1f})"/>')
    return "".join(s)

# ---------- 徽记库 ----------
def emblem(kind, color):
    g = []
    def add(s): g.append(s)
    if kind == "eagle":
        add(f'<path d="M0,-2 C-9,-13 -23,-15 -35,-11 C-25,-9 -19,-5 -15,-1 '
            f'C-27,-3 -35,-1 -43,5 C-31,3 -21,5 -13,9 L0,19 L13,9 '
            f'C21,5 31,3 43,5 C35,-1 27,-3 15,-1 C19,-5 25,-9 35,-11 '
            f'C23,-15 9,-13 0,-2 Z" fill="{color}"/>')
        add(f'<circle cx="0" cy="-13" r="5" fill="{color}"/>')
    elif kind == "coin":
        add(f'<circle cx="0" cy="0" r="26" fill="none" stroke="{color}" stroke-width="4"/>')
        add(f'<circle cx="0" cy="0" r="17" fill="none" stroke="{color}" stroke-width="2"/>')
        add(f'<path d="M0,-13 L0,13 M-13,0 L13,0" stroke="{color}" stroke-width="3.5"/>')
    elif kind == "wheat":
        add(f'<path d="M0,26 L0,-20" stroke="{color}" stroke-width="3"/>')
        for yy in (-14, -4, 6, 16):
            add(f'<ellipse cx="-9" cy="{yy}" rx="6" ry="2.6" fill="{color}" '
                f'transform="rotate(-30 -9 {yy})"/>')
            add(f'<ellipse cx="9" cy="{yy}" rx="6" ry="2.6" fill="{color}" '
                f'transform="rotate(30 9 {yy})"/>')
    elif kind == "tower":
        add(f'<rect x="-20" y="-8" width="40" height="32" fill="none" stroke="{color}" stroke-width="4"/>')
        for bx in (-20, -4, 12):
            add(f'<rect x="{bx}" y="-20" width="12" height="12" fill="{color}"/>')
        add(f'<path d="M-8,24 L-8,4 A8,8 0 0 1 8,4 L8,24 Z" fill="none" stroke="{color}" stroke-width="3"/>')
    elif kind == "star":
        add(f'<path d="{star_path(28, 12)}" fill="{color}"/>')
    elif kind == "fasces":
        for xx in (-14, -5, 5, 14):
            add(f'<line x1="{xx}" y1="-26" x2="{xx}" y2="26" stroke="{color}" stroke-width="3"/>')
        add(f'<rect x="-20" y="-8" width="40" height="7" fill="{color}"/>')
        add(f'<rect x="-20" y="6" width="40" height="7" fill="{color}"/>')
        add(f'<path d="M18,-26 L30,-40 L34,-34 L22,-20 Z" fill="{color}"/>')
    elif kind == "laurel_crown":
        add(laurel_ring(24, color))
        add(f'<path d="{star_path(9, 4)}" fill="{color}"/>')
    elif kind == "horse":
        add(f'<path d="M-22,12 C-30,4 -26,-12 -12,-17 C-5,-20 0,-17 2,-10 '
            f'C9,-15 18,-12 19,-3 C20,6 13,15 2,14 L-4,14 L-8,24 L-15,24 L-10,14 '
            f'C-15,14 -19,14 -22,12 Z" fill="{color}"/>')
        add(f'<circle cx="-12" cy="-12" r="2.4" fill="{PARCH}"/>')
    elif kind == "shield":
        add(f'<path d="M0,-28 L24,-20 L24,6 C24,20 12,28 0,30 '
            f'C-12,28 -24,20 -24,6 L-24,-20 Z" fill="none" stroke="{color}" stroke-width="4"/>')
        add(f'<path d="{star_path(11, 5)}" fill="{color}" transform="translate(0,2)"/>')
    elif kind == "skull":
        add(f'<circle cx="0" cy="-4" r="20" fill="{color}"/>')
        add(f'<path d="M-12,14 L-12,24 L12,24 L12,14 Z" fill="{color}"/>')
        add(f'<circle cx="-8" cy="-6" r="5" fill="{PARCH}"/>')
        add(f'<circle cx="8" cy="-6" r="5" fill="{PARCH}"/>')
        add(f'<path d="M-3,8 L3,8 L0,13 Z" fill="{PARCH}"/>')
    elif kind == "waves":
        for yy in (-8, 2, 12):
            add(f'<path d="M-26,{yy} q13,-12 26,0 q13,12 26,0" fill="none" '
                f'stroke="{color}" stroke-width="4"/>')
    elif kind == "arrow_compass":
        add(f'<circle cx="0" cy="0" r="22" fill="none" stroke="{color}" stroke-width="3"/>')
        add(f'<path d="M0,18 L0,-22 M0,-22 L-7,-12 M0,-22 L7,-12" fill="none" '
            f'stroke="{color}" stroke-width="4"/>')
        add(f'<path d="{star_path(7, 3)}" fill="{color}" transform="translate(0,14)"/>')
    elif kind == "arrows_swap":
        add(f'<path d="M-22,-10 A22,22 0 0 1 22,-10" fill="none" stroke="{color}" stroke-width="4"/>')
        add(f'<path d="M22,-10 L13,-16 L13,-4 Z" fill="{color}"/>')
        add(f'<path d="M22,10 A22,22 0 0 1 -22,10" fill="none" stroke="{color}" stroke-width="4"/>')
        add(f'<path d="M-22,10 L-13,4 L-13,16 Z" fill="{color}"/>')
    elif kind == "arrow_down":
        add(f'<path d="M0,-22 L0,20 M0,20 L-9,10 M0,20 L9,10" fill="none" '
            f'stroke="{color}" stroke-width="5"/>')
    elif kind == "arrow_up":
        add(f'<path d="M0,22 L0,-20 M0,-20 L-9,-10 M0,-20 L9,-10" fill="none" '
            f'stroke="{color}" stroke-width="5"/>')
    elif kind == "anchor":
        add(f'<circle cx="0" cy="-20" r="5" fill="none" stroke="{color}" stroke-width="3"/>')
        add(f'<path d="M0,-15 L0,24" stroke="{color}" stroke-width="4"/>')
        add(f'<path d="M-16,2 A16,16 0 0 0 16,2" fill="none" stroke="{color}" stroke-width="4"/>')
        add(f'<path d="M-20,-2 L20,-2" stroke="{color}" stroke-width="4"/>')
    elif kind == "axe":
        add(f'<path d="M0,-24 L0,28" stroke="{color}" stroke-width="5"/>')
        add(f'<path d="M0,-18 C16,-22 22,-10 16,2 C10,-4 4,-8 0,-8 Z" fill="{color}"/>')
        add(f'<path d="M0,-18 C-16,-22 -22,-10 -16,2 C-10,-4 -4,-8 0,-8 Z" fill="{color}" opacity="0.55"/>')
    elif kind == "orb":
        add(f'<circle cx="0" cy="0" r="20" fill="none" stroke="{color}" stroke-width="4"/>')
        add(f'<path d="M-20,0 L20,0 M0,-20 L0,20" stroke="{color}" stroke-width="3"/>')
        add(f'<path d="M0,-28 L0,-20 M0,20 L0,28" stroke="{color}" stroke-width="4"/>')
    elif kind == "sword":
        add(f'<path d="M0,-28 L0,14" stroke="{color}" stroke-width="4"/>')
        add(f'<path d="M-12,14 L12,14 L12,20 L-12,20 Z" fill="{color}"/>')
        add(f'<path d="M0,20 L0,28" stroke="{color}" stroke-width="4"/>')
        add(f'<path d="M-6,24 L6,24" stroke="{color}" stroke-width="4"/>')
    elif kind == "bow":
        add(f'<path d="M14,-24 C-22,-10 -22,10 14,24" fill="none" stroke="{color}" stroke-width="4"/>')
        add(f'<path d="M14,-24 L14,24" stroke="{color}" stroke-width="2.5"/>')
        add(f'<path d="M-12,0 L20,0" stroke="{color}" stroke-width="3"/>')
        add(f'<path d="M14,-4 L22,0 L14,4 Z" fill="{color}"/>')
    elif kind == "arch":
        add(f'<path d="M-18,24 L-18,-4 A18,18 0 0 1 18,-4 L18,24" fill="none" '
            f'stroke="{color}" stroke-width="4"/>')
        add(f'<path d="M-22,24 L22,24" stroke="{color}" stroke-width="4"/>')
        add(f'<path d="M-22,-20 L22,-20 L22,-12 L-22,-12 Z" fill="{color}"/>')
    elif kind == "fork":
        for xx in (-9, 0, 9):
            add(f'<path d="M{xx},-26 L{xx},2" stroke="{color}" stroke-width="4"/>')
            add(f'<path d="M{xx},-26 q0,-8 {6 if xx<0 else -6 if xx>0 else 0},-2" '
                f'fill="none" stroke="{color}" stroke-width="4"/>')
        add(f'<path d="M0,2 L0,28" stroke="{color}" stroke-width="5"/>')
    elif kind == "standard":
        add(f'<path d="M-3,-28 L3,-28 L3,28 L-3,28 Z" fill="{color}"/>')
        add(f'<path d="M3,-26 L22,-20 L3,-14 Z" fill="{color}"/>')
        add(f'<circle cx="0" cy="-22" r="4" fill="{PARCH}" stroke="{color}" stroke-width="2"/>')
    else:
        add(f'<circle cx="0" cy="0" r="20" fill="{color}"/>')
    return f'<g>{"" .join(g)}</g>' if False else "".join(g)

def E(kind, color, x, y, s=1):
    return (f'<g transform="translate({x},{y}) scale({s})">{emblem(kind, color)}</g>')

# ---------- 兵牌（正面，6×10 整页） ----------
def troop_card(rank, suit, x, y):
    name, latin, color, kind = suit
    w, h = 200, 280
    b = []
    b.append(f'<g transform="translate({x},{y})">')
    b.append(f'<rect x="2" y="2" width="{w-4}" height="{h-4}" rx="12" fill="{PARCH}" stroke="{GOLD_D}" stroke-width="3"/>')
    b.append(f'<rect x="9" y="9" width="{w-18}" height="{h-18}" rx="8" fill="none" stroke="{color}" stroke-width="2"/>')
    b.append(f'<rect x="9" y="9" width="{w-18}" height="34" fill="{color}"/>')
    b.append(f'<text x="26" y="35" font-size="30" font-weight="700" fill="#fff">{rank}</text>')
    b.append(f'<text x="{w-18}" y="33" font-size="15" font-weight="700" fill="#fff" text-anchor="end">{name}</text>')
    b.append(E(kind, color, 100, 118, 1.25))
    b.append(f'<text x="100" y="212" font-size="66" font-weight="800" fill="{color}" text-anchor="middle">{rank}</text>')
    b.append(f'<rect x="9" y="{h-43}" width="{w-18}" height="34" fill="{color}"/>')
    b.append(f'<text x="100" y="{h-20}" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">点数 · {rank}</text>')
    b.append(E(kind, "#fff", 100, h-26, 0.42))
    b.append('</g>')
    return "".join(b)

def gen_troop_sheet():
    cols, rows = 6, 10
    cw, ch, gap = 200, 280, 16
    m = 24
    W = m * 2 + cols * cw + (cols - 1) * gap
    H = m * 2 + rows * ch + (rows - 1) * gap
    body = [f'<rect x="0" y="0" width="{W}" height="{H}" fill="{PARCH2}"/>']
    body.append(f'<text x="{W/2}" y="26" font-size="20" font-weight="800" fill="{INK}" '
                f'text-anchor="middle">兵牌打印页（每色 1–10，共 60 张 · 八套牌共用此正面，以牌背区分）</text>')
    for r in range(rows):
        for c in range(cols):
            x = m + c * (cw + gap)
            y = m + 36 + r * (ch + gap)
            body.append(troop_card(r + 1, SUITS[c], x, y))
    return svg_doc(W, H + 30, "".join(body))

# ---------- 牌背（8 套，分色） ----------
def card_back(fac, x, y):
    seat, name, realm, title, color, kind = fac
    w, h = 200, 280
    b = []
    b.append(f'<g transform="translate({x},{y})">')
    b.append(f'<rect x="2" y="2" width="{w-4}" height="{h-4}" rx="12" fill="{PARCH}" stroke="{GOLD_D}" stroke-width="3"/>')
    b.append(f'<rect x="10" y="10" width="{w-20}" height="{h-20}" rx="8" fill="none" stroke="{color}" stroke-width="3"/>')
    b.append(f'<rect x="16" y="16" width="{w-32}" height="{h-32}" rx="5" fill="none" stroke="{GOLD}" stroke-width="1.5"/>')
    # 四角小星
    for cx, cy in [(26, 26), (w-26, 26), (26, h-26), (w-26, h-26)]:
        b.append(f'<path d="{star_path(6, 2.5, cx=cx, cy=cy)}" fill="{GOLD}"/>')
    b.append(f'<text x="{w/2}" y="52" font-size="18" font-weight="800" fill="{color}" text-anchor="middle">{name}</text>')
    b.append(f'<text x="{w/2}" y="72" font-size="11" fill="{INK_SOFT}" text-anchor="middle">{realm}</text>')
    b.append(f'<g transform="translate({w/2},{h/2+6})">{emblem(kind, color)}</g>')
    b.append(f'<g transform="translate({w/2},{h/2+6})">{laurel_ring(42, GOLD)}</g>')
    b.append(f'<text x="{w/2}" y="{h-56}" font-size="15" font-weight="700" fill="{color}" text-anchor="middle">第 {seat} 席</text>')
    b.append(f'<text x="{w/2}" y="{h-36}" font-size="10" fill="{INK_SOFT}" text-anchor="middle">SPQR · III SECOLVM</text>')
    b.append('</g>')
    return "".join(b)

def gen_card_backs():
    cols, rows = 4, 2
    cw, ch, gap = 200, 280, 24
    m = 30
    W = m * 2 + cols * cw + (cols - 1) * gap
    H = m * 2 + rows * ch + (rows - 1) * gap
    body = [f'<rect x="0" y="0" width="{W}" height="{H}" fill="{PARCH2}"/>']
    body.append(f'<text x="{W/2}" y="24" font-size="20" font-weight="800" fill="{INK}" text-anchor="middle">牌背（8 套 · 各势力不同，卡背区分牌堆）</text>')
    for i, fac in enumerate(FACTIONS):
        r, c = divmod(i, cols)
        x = m + c * (cw + gap)
        y = m + 34 + r * (ch + gap)
        body.append(card_back(fac, x, y))
    return svg_doc(W, H + 20, "".join(body))

# ---------- 战术牌 ----------
def tactics_card(t, x, y):
    cat, _tname, title_lines, kind, effect = t
    catcolor = CAT_COLOR[cat]
    w, h = 210, 300
    b = []
    b.append(f'<g transform="translate({x},{y})">')
    b.append(f'<rect x="2" y="2" width="{w-4}" height="{h-4}" rx="12" fill="{PARCH}" stroke="{GOLD_D}" stroke-width="3"/>')
    b.append(f'<rect x="9" y="9" width="{w-18}" height="{h-18}" rx="8" fill="none" stroke="{GOLD}" stroke-width="1.5"/>')
    b.append(f'<rect x="9" y="9" width="{w-18}" height="36" fill="{catcolor}"/>')
    b.append(f'<text x="18" y="33" font-size="13" font-weight="700" fill="#fff">战术牌</text>')
    b.append(f'<text x="{w-18}" y="33" font-size="15" font-weight="800" fill="#fff" text-anchor="end">{cat}</text>')
    # 标题
    ty = 70
    for i, line in enumerate(title_lines):
        fs = 19 if i == 0 else 13
        b.append(f'<text x="{w/2}" y="{ty}" font-size="{fs}" font-weight="800" fill="{INK}" text-anchor="middle">{line}</text>')
        ty += 24 if i == 0 else 19
    b.append(E(kind, catcolor, w/2, 150, 1.5))
    # 效果框
    bx, by, bw, bh = 16, 196, w - 32, 86
    b.append(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="6" fill="#fff8e8" stroke="{GOLD}" stroke-width="1.5"/>')
    ey = by + 22
    for line in effect:
        b.append(f'<text x="{w/2}" y="{ey}" font-size="13" fill="{INK}" text-anchor="middle">{line}</text>')
        ey += 19
    b.append('</g>')
    return "".join(b)

def gen_tactics_sheet():
    cols, rows = 2, 5
    cw, ch, gap = 210, 300, 20
    m = 30
    W = m * 2 + cols * cw + (cols - 1) * gap
    H = m * 2 + rows * ch + (rows - 1) * gap
    body = [f'<rect x="0" y="0" width="{W}" height="{H}" fill="{PARCH2}"/>']
    body.append(f'<text x="{W/2}" y="22" font-size="20" font-weight="800" fill="{INK}" text-anchor="middle">战术牌（共 10 张 · 士气4 / 环境2 / 计谋4）</text>')
    for i, t in enumerate(TACTICS):
        r, c = divmod(i, cols)
        x = m + c * (cw + gap)
        y = m + 32 + r * (ch + gap)
        body.append(tactics_card(t, x, y))
    return svg_doc(W, H + 16, "".join(body))

# ---------- 中心区域板（六区并排） ----------
def central_panel(suit, x, y, pw, ph):
    name, latin, color, kind = suit
    b = []
    b.append(f'<g transform="translate({x},{y})">')
    b.append(f'<rect x="0" y="0" width="{pw}" height="{ph}" rx="10" fill="{PARCH}" stroke="{GOLD_D}" stroke-width="2"/>')
    # 表头
    b.append(f'<rect x="0" y="0" width="{pw}" height="40" rx="10" fill="{color}"/>')
    b.append(f'<rect x="0" y="20" width="{pw}" height="20" fill="{color}"/>')
    b.append(E(kind, "#fff", 22, 20, 0.5))
    b.append(f'<text x="{pw/2}" y="26" font-size="16" font-weight="800" fill="#fff" text-anchor="middle">{name}</text>')
    # 战术牌槽
    b.append(f'<text x="6" y="58" font-size="10" fill="{INK_SOFT}">战术牌槽</text>')
    b.append(f'<rect x="6" y="62" width="{pw-12}" height="62" rx="6" fill="#fff8e8" stroke="{GOLD}" stroke-width="1.5"/>')
    b.append(f'<text x="{pw/2}" y="98" font-size="11" fill="{INK_SOFT}" text-anchor="middle">开局随机放置</text>')
    # 影响力标记格 4×3
    b.append(f'<text x="6" y="140" font-size="10" fill="{INK_SOFT}">影响力标记格（放对应势力标记）</text>')
    gx0, gy0, gs = 14, 148, 22
    for r in range(3):
        for c in range(4):
            cx = gx0 + c * gs; cy = gy0 + r * gs
            b.append(f'<circle cx="{cx}" cy="{cy}" r="8" fill="#fff8e8" stroke="{GOLD_D}" stroke-width="1.5"/>')
    # 领袖位
    b.append(f'<text x="6" y="232" font-size="10" fill="{INK_SOFT}">领袖位</text>')
    b.append(f'<circle cx="22" cy="248" r="11" fill="none" stroke="{INK}" stroke-width="2"/>')
    b.append(f'<text x="22" y="252" font-size="10" fill="{INK}" text-anchor="middle">领</text>')
    b.append(f'<text x="{pw-6}" y="244" font-size="9" fill="{INK_SOFT}" text-anchor="end">≥6 且唯一第一</text>')
    b.append(f'<text x="{pw-6}" y="256" font-size="9" fill="{INK_SOFT}" text-anchor="end">夺该区战术牌</text>')
    b.append(f'<text x="{pw/2}" y="{ph-8}" font-size="9" fill="{INK_SOFT}" text-anchor="middle">{latin}</text>')
    b.append('</g>')
    return "".join(b)

def gen_central_board():
    pw, ph = 178, 268
    gap = 10
    m = 20
    top = 70
    W = m * 2 + 6 * pw + 5 * gap
    H = top + ph + 30
    body = [f'<rect x="0" y="0" width="{W}" height="{H}" fill="{PARCH2}"/>']
    body.append(f'<text x="{W/2}" y="26" font-size="20" font-weight="800" fill="{INK}" text-anchor="middle">中心区域板 · 六势力并排</text>')
    body.append(f'<text x="{W/2}" y="46" font-size="12" fill="{INK_SOFT}" text-anchor="middle">打出某色牌 → 在该色区放 1 标记；或移动领袖。回合末总分最高色 = 主导花色。</text>')
    for i, s in enumerate(SUITS):
        x = m + i * (pw + gap)
        body.append(central_panel(s, x, top, pw, ph))
    return svg_doc(W, H, "".join(body))

# ---------- 标记 / 领袖 / 旗帜 整页 ----------
def gen_tokens_sheet():
    m = 24
    W = 1180
    H = 1570
    body = [f'<rect x="0" y="0" width="{W}" height="{H}" fill="{PARCH2}"/>']
    body.append(f'<text x="{W/2}" y="24" font-size="20" font-weight="800" fill="{INK}" text-anchor="middle">标记 · 领袖 · 旗帜 打印页（各势力徽记即其人史迹）</text>')

    # ---- 影响力标记：8 势力，每势 12 枚（共 96）----
    y0 = 52
    body.append(f'<text x="{m}" y="{y0-10}" font-size="14" font-weight="800" fill="{INK}">影响力标记（8 势力 · 无限供应，可复印；圈内为各势力历史徽记）</text>')
    rowh = 50
    for fi, fac in enumerate(FACTIONS):
        seat, name, realm, title, color, kind = fac
        ry = y0 + 22 + fi * rowh
        body.append(E(kind, color, m + 16, ry, 0.52))
        tt = title.split(" · ")[0].split("（")[0]
        body.append(f'<text x="{m+44}" y="{ry+5}" font-size="12" font-weight="700" fill="{color}">{tt}</text>')
        for c in range(12):
            cx = m + 232 + c * 74
            cy = ry
            body.append(f'<circle cx="{cx}" cy="{cy}" r="20" fill="#fff8e8" stroke="{color}" stroke-width="3"/>')
            body.append(E(kind, color, cx, cy, 0.48))
    body.append(f'<text x="{m}" y="{y0+22+8*rowh+10}" font-size="11" fill="{INK_SOFT}">每枚 = 1 点影响力；同区按势力分别计点，唯一第一且 ≥6 夺该区战术牌（并列则不夺）。打出某色牌 → 在该色区放本势力标记（颜色即你所属势力）。</text>')

    ly = y0 + 22 + 8 * rowh + 40
    # ---- 领袖模型：8 个（带历史称号）----
    body.append(f'<text x="{m}" y="{ly-8}" font-size="14" font-weight="800" fill="{INK}">领袖模型（每玩家 1 个 · 中心区移动 · 在该色区可移至任意区）</text>')
    for i, fac in enumerate(FACTIONS):
        seat, name, realm, title, color, kind = fac
        cx = m + 70 + i * 135
        cy = ly + 60
        body.append(f'<circle cx="{cx}" cy="{cy}" r="42" fill="{PARCH}" stroke="{color}" stroke-width="4"/>')
        body.append(f'<circle cx="{cx}" cy="{cy}" r="34" fill="none" stroke="{GOLD}" stroke-width="1.5"/>')
        body.append(E(kind, color, cx, cy - 6, 0.68))
        tt = title.split(" · ")[0].split("（")[0]
        body.append(f'<text x="{cx}" y="{cy+60}" font-size="11" font-weight="700" fill="{color}" text-anchor="middle">{tt}</text>')
    ly2 = ly + 176

    # ---- 摊开方向指示器（1 枚双面：顺/逆时针）----
    oy = ly2 + 20
    body.append(f'<text x="{m}" y="{oy-26}" font-size="14" font-weight="800" fill="{INK}">摊开方向指示器（全场 1 枚 · 双面：顺时针 / 逆时针）</text>')
    body.append(f'<text x="{m}" y="{oy-10}" font-size="10" fill="{INK_SOFT}">每回合统一转换：摊开顺时针用「顺」面、逆时针翻至「逆」面。8 条战线同一方向，故只需 1 枚。</text>')

    def dir_token(cx, cy, cw_, ch_, label, sub, flip=False, accent="#9c7a1e"):
        s = [f'<g transform="translate({cx},{cy})">']
        s.append(f'<rect x="0" y="0" width="{cw_}" height="{ch_}" rx="8" fill="{PARCH}" stroke="{accent}" stroke-width="3"/>')
        cyc = ch_ * 0.44
        if not flip:
            d = (f'M{cw_*0.5-46},{cyc-15} A46,15 0 0 1 {cw_*0.5+40},{cyc-15} '
                 f'M{cw_*0.5+40},{cyc-15} L{cw_*0.5+22},{cyc-27} '
                 f'M{cw_*0.5+40},{cyc-15} L{cw_*0.5+22},{cyc-3}')
        else:
            d = (f'M{cw_*0.5+46},{cyc-15} A46,15 0 0 1 {cw_*0.5-40},{cyc-15} '
                 f'M{cw_*0.5-40},{cyc-15} L{cw_*0.5-22},{cyc-27} '
                 f'M{cw_*0.5-40},{cyc-15} L{cw_*0.5-22},{cyc-3}')
        s.append(f'<path d="{d}" fill="none" stroke="{accent}" stroke-width="5"/>')
        s.append(f'<text x="{cw_*0.5}" y="{ch_*0.74}" font-size="18" font-weight="800" fill="{accent}" text-anchor="middle">{label}</text>')
        s.append(f'<text x="{cw_*0.5}" y="{ch_-8}" font-size="10" fill="{INK_SOFT}" text-anchor="middle">{sub}</text>')
        s.append('</g>')
        return "".join(s)

    tw, th, tgap = 230, 96, 16
    body.append(dir_token(m, oy + 6, tw, th, "顺时针", "摊开推进向（默认）", flip=False))
    body.append(dir_token(m + tw + tgap, oy + 6, tw, th, "逆时针", "翻面即用", flip=True))
    oy2 = oy + 6 + th + 22

    # ---- 起始战场标记 ----
    body.append(f'<text x="{m}" y="{oy2-8}" font-size="14" font-weight="800" fill="{INK}">起始战场标记（钉于战线①，每回合逆时针迁移 1 格）</text>')
    sx = m + 60
    sy = oy2 + 56
    body.append(f'<circle cx="{sx}" cy="{sy}" r="42" fill="#9c2b1e" stroke="{GOLD}" stroke-width="4"/>')
    body.append(f'<text x="{sx}" y="{sy-4}" font-size="18" font-weight="800" fill="#fff" text-anchor="middle">起始</text>')
    body.append(f'<text x="{sx}" y="{sy+20}" font-size="14" fill="#fff" text-anchor="middle">战线①</text>')
    sy2 = oy2 + 114

    # ---- 战线旗：72 面（8 线 × 9）----
    body.append(f'<text x="{m}" y="{sy2-8}" font-size="14" font-weight="800" fill="{INK}">战线旗（共 72 面 = 8 线 × 9 旗 · 胜 1 旗取 1 面置于该线对应位置）</text>')
    for line_i in range(8):
        ry = sy2 + 26 + line_i * 56
        body.append(f'<text x="{m}" y="{ry+4}" font-size="12" font-weight="700" fill="{INK_SOFT}">线{line_i+1}</text>')
        for f in range(9):
            cx = m + 60 + f * 46
            cy = ry
            body.append(f'<line x1="{cx-18}" y1="{cy-26}" x2="{cx-18}" y2="{cy+34}" stroke="{GOLD_D}" stroke-width="3.5"/>')
            body.append(f'<path d="M{cx-18},{cy-26} L{cx+22},{cy-16} L{cx-18},{cy-6} Z" fill="{GOLD_D}"/>')
            body.append(f'<text x="{cx+2}" y="{cy-9}" font-size="13" font-weight="800" fill="#fff" text-anchor="middle">{f+1}</text>')

    # ---- 历史身份速查 ----
    lg = sy2 + 26 + 8 * 56 + 26
    body.append(f'<text x="{m}" y="{lg}" font-size="14" font-weight="800" fill="{INK}">历史身份速查（标记即其人）</text>')
    for i, fac in enumerate(FACTIONS):
        seat, name, realm, title, color, kind = fac
        col = i % 2
        row = i // 2
        lx = m + col * 566
        lyy = lg + 22 + row * 22
        body.append(f'<text x="{lx}" y="{lyy}" font-size="11" fill="{INK}"><tspan fill="{color}" font-weight="700">第{seat}席 {name}</tspan> · {realm} · {title}</text>')

    return svg_doc(W, H, "".join(body))

# ---------- 玩家速查卡 ----------
def gen_reference():
    W, H = 840, 1180
    body = [f'<rect x="0" y="0" width="{W}" height="{H}" fill="{PARCH}" stroke="{GOLD_D}" stroke-width="3"/>']
    body.append(f'<rect x="14" y="14" width="{W-28}" height="{H-28}" rx="8" fill="none" stroke="{GOLD}" stroke-width="1.5"/>')
    body.append(f'<text x="{W/2}" y="50" font-size="26" font-weight="800" fill="{INK}" text-anchor="middle">玩家速查 · 三世纪：罗马的黄昏</text>')
    body.append(f'<line x1="40" y1="66" x2="{W-40}" y2="66" stroke="{GOLD}" stroke-width="1.5"/>')

    def block(title, lines, x, y, w, head):
        s = [f'<text x="{x}" y="{y}" font-size="16" font-weight="800" fill="{head}">{title}</text>']
        yy = y + 22
        for ln in lines:
            s.append(f'<text x="{x}" y="{yy}" font-size="13" fill="{INK}">{ln}</text>')
            yy += 19
        return "".join(s), yy

    # 左列
    b1, y1 = block("① 座次环（双线闭环）", [
        "1卡劳修斯 2克罗库斯 3奥勒良",
        "4尼瓦 5沙普尔 6芝诺比娅",
        "7巴高达 8波斯图穆斯（8↔1闭合）",
        "每人镇守左右 2 条战线。",
    ], 40, 90, 360, GOLD_D)
    b2, y2 = block("② 出牌流程", [
        "1. 选线：你的 2 条线各扣 1 张，选哪条由你定。",
        "2. 选格：该线一个未决出的旗幟格。",
        "3. 扣牌：从该线手牌选 1 张面朝下放入。",
        "4. 扣完→自标记起按方向指示器摊开(每回合翻面)",
        "5. 每格最多 3 张（比阵型大小）。",
        "6. 结算后从该线牌堆补 1 张。",
        "7. 战场标记每回合逆时针迁移 1 格。",
    ], 40, y1 + 14, 360, GOLD_D)
    b25, y25 = block("②b 双线手牌（关键）", [
        "每条战线各 7 张，共 14 张。",
        "两线手牌独立，绝不混用：",
        "补牌只补本线；出牌只出本线。",
        "某线手牌为 0 → 该线触发领袖放置，",
        "另一线照常暗扣。",
        "战术牌单独放，不占手牌位。",
        "★ 暗扣同时进行，对手看不到你选哪",
        "条线——「选线」就是本作的核心博弈。",
    ], 40, y2 + 14, 360, "#b5462f")
    b3, y3 = block("③ 阵型排序（高→低）", [
        "同花顺(三同花连号) > 方阵(三同点)",
        "> 同花(三同花) > 顺子(三连号)",
        "> 杂军(其余)。",
        "平手：后出牌者负（兵贵神速）。",
        "夺旗严格零和：无无人旗，夺者+1、原主必−1。",
    ], 40, y25 + 14, 360, GOLD_D)
    body.append(b1); body.append(b2); body.append(b25); body.append(b3)

    # 右列
    c1, yc1 = block("④ 中心区域（6 色 = 6 势力）", [
        "紫元老院 红禁卫军 蓝宫廷近臣",
        "橙财政使 绿意大利城市 黄北非粮仓",
        "打出某色牌 → 二选一：",
        "  A. 在该色区放 1 影响力标记",
        "  B. 移动领袖（规则见下）",
        "领袖在该色区→可移任意区；",
        "不在→移入该色区。",
        "回合末最高色=主导花色（并列则无主导花色）",
        "某区影响力≥6 且唯一第一→夺其战术牌。",
        "中央区第一 +1 分；易主 ±1，可反复易主。",
    ], 440, 90, 360, GOLD_D)
    c2, yc2 = block("⑤ 战术牌分类", [
        "士气(红)×4：作阵型一张牌参与比较",
        "  领袖×2=万能牌；御林铁骑=任花色8；",
        "  戍边军团=任花色≤3。",
        "环境(绿)×2：置于未夺旗旁改比较方式",
        "  瘟疫=只比点数和；春汛=四张阵型。",
        "计谋(蓝)×4：落场持久·可被夺取",
        "  哥特游骑/莱茵换防/军团哗变/附庸倒戈;",
        "  虚空站位不占格位；被超越→夺牌+回滚,",
        "  原格位已被占满则该牌不回归。",
        "库共 10 张，开局 6 色区各随机 1 张。",
        "战术牌单独存放，不占两线手牌位；",
        "可在任一参与战线打出（每线不超对手+1）。",
    ], 440, yc1 + 14, 360, GOLD_D)
    body.append(c1); body.append(c2)

    # 底部：胜负
    body.append(f'<line x1="40" y1="{H-120}" x2="{W-40}" y2="{H-120}" stroke="{GOLD}" stroke-width="1.5"/>')
    vb, _ = block("⑥ 终局与胜负", [
        "不设即胜。终局：① 任一玩家旗子数达 12",
        "（旗子数＝累计夺旗＋当前持有中央区）；",
        "② 牌堆耗尽并二次洗回再用尽；③ 全员同意。",
        "终局后总分最高者胜；同分比旗子数、再比中央区。",
        "总分=Σ战线(夺旗−失旗)+中央区占位分；夺旗+1/原主−1。",
        "主导花色对已分出胜负的战线不再影响。",
    ], 40, H - 104, 760, "#b5462f")
    body.append(vb)
    return svg_doc(W, H, "".join(body))

# ---------- 写出 ----------
def write(name, svg):
    p = os.path.join(OUT, name)
    with open(p, "w", encoding="utf-8") as f:
        f.write(svg)
    print("written:", p, os.path.getsize(p), "bytes")

if __name__ == "__main__":
    write("01_troop_cards.svg", gen_troop_sheet())
    write("02_card_backs.svg", gen_card_backs())
    write("03_tactics_cards.svg", gen_tactics_sheet())
    write("04_central_board.svg", gen_central_board())
    write("05_tokens.svg", gen_tokens_sheet())
    write("06_player_reference.svg", gen_reference())
    print("ALL DONE")
