# -*- coding: utf-8 -*-
"""
build-media-pages.py — 옥외광고 매체 목록 + 매체별 상세 페이지 생성.

핵심 설계
 - 카드 513개를 '정적 HTML'로 미리 깔아둔다 → 봇(네이버·AI)이 JS 없이 전부 읽는다.
 - 필터(catalog-filter.js)는 그 카드를 '보였다/숨겼다'만 한다 → 사람은 필터를 쓴다.
 - 원본은 data/media.json 하나. 지도(map.html)와 같은 원본을 본다.
   데이터가 바뀌면 scripts/build-all.py 한 번이면 지도와 동기화된다.
 - 카드 내용·색·비율은 지도 페이지(map.js / styles.css)와 맞춰 둔다.

출력: media-catalog.html + media-<slug>.html × 513
"""
import os, json, html, re
from collections import Counter

os.chdir(r"C:/goplay/k-goplay-ui")
SRC = "data/media.json"
BASE = "https://lscape82.github.io/k-goplay-ui"
LOGO = f"{BASE}/assets/images/k-goplay-logo-new.png"
PLACEHOLDER = "assets/images/placeholders/media-placeholder.svg"

CAT = {
    "large_billboard": "대형 전광판",
    "shopping_mall_did": "쇼핑몰 DID",
    "transport_hub": "도시 철도·버스·터미널",
    "bus": "버스·쉘터",
    "vehicle": "차량 래핑",
    "package": "패키지",
    "subway": "지하철",
    "other": "기타",
}
CAT_ORDER = ["large_billboard", "shopping_mall_did", "transport_hub", "bus", "vehicle", "package", "subway", "other"]

# 엘리베이터 — 매체 목록에는 상품 6개 요약만 싣고, 각 상세는 elevator-*.html 이 맡는다.
# (단지 9,470개를 카드로 깔면 이 목록의 축과 안 맞는다. 상품 단위로만 요약)
ELEV_SLUG = {"townboard": "townboard", "fmk": "focus", "gsa": "mediamid",
             "officebiz": "officebiz", "primeliving": "prime-living", "asa": "prime-office"}

# 지도가 실사진이 없을 때 쓰는 샘플(프로토타입 데이터). imageUrl이 있으면 그게 우선.
SAMPLE_PAIRS = [
    ["assets/images/map-samples/gangnam-wide.jpg", "assets/images/map-samples/gangnam-close.jpg"],
    ["assets/images/map-samples/cheonggye-wide.jpg", "assets/images/map-samples/cheonggye-close.jpg"],
    ["assets/images/map-samples/gwanghwamun-wide.jpg", "assets/images/map-samples/gwanghwamun-close.jpg"],
]


def esc(s):
    return html.escape(str(s or ""), quote=True)


def won(v):
    """common.js formatKRW 와 동일 (억원 / 만원)"""
    if not v:
        return "상담"
    v = int(v)
    if v >= 100000000:
        e = v / 100000000
        return (f"{e:.1f}".rstrip("0").rstrip(".")) + "억원"
    return f"{round(v / 10000):,}만원"


def _minprice(x):
    ps = [r.get("monthlyPriceKRW") for r in (x.get("pricing") or []) if r.get("monthlyPriceKRW")]
    return min(ps) if ps else None


def is_package(x):
    """패키지 옵션이 있는 매체 — category=package 이거나, pricing/계약조건에 '패키지'가
    판매 상품으로 명시된 것. 개별+패키지 둘 다 되는 매체가 많아 상세 내용으로 판단한다."""
    if x.get("category") == "package":
        return True
    for r in (x.get("pricing") or []):
        if "패키지" in (r.get("label") or "") + (r.get("rawText") or ""):
            return True
    return "패키지" in (x.get("contractText") or "")


def is_uni_cafe(x):
    """대학교 카페 미디어(패키지 33종) — 목록엔 대표 카드 1장만. 태그 대학교광고/카페광고
    또는 계약이 '15초 영상 100회-25만원/월(패키지)디지털+포스터' 형태."""
    tags = x.get("tags") or []
    if any("대학교광고" in t or "카페광" in t for t in tags):
        return True
    ct = x.get("contractText") or ""
    return "포스터" in ct and "패키지" in ct and "25만원" in ct


def is_smart_garo(x):
    """스마트가로 미디어(37종) — 목록엔 대표 카드 1장만."""
    return "스마트가로" in (x.get("name") or "")


def card_image(x, i):
    """실사진(imageUrl) 우선 — 주요 5개 매체는 자기 사진, 나머지는 샘플"""
    own = [u for u in (x.get("images") or []) if u]
    if own:
        return own[0]
    if x.get("imageUrl"):
        return x["imageUrl"]
    return SAMPLE_PAIRS[i % len(SAMPLE_PAIRS)][0]


def region_of(x):
    """지역 필터 값 — filters.json과 같은 기준: 서울은 '서울 OO구', 그 외는 시도명.
    (원본 areaSlug/areaName이 전부 비어 있어 주소로 보완)"""
    a = x.get("address") or ""
    m = re.search(r"(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\S*\s+(\S+[구군시])", a)
    if not m:
        return ""
    sido, gu = m.group(1), m.group(2)
    return f"서울 {gu}" if sido == "서울" else sido


def decision_line(x):
    """지도 카드와 동일 (map.js mapCardDecisionSummary) — '월 1,200만원 · 월 단위 집행'"""
    m = x.get("minPrice")
    price = f"월 {won(m)}" if m else "월 비용 상담 필요"
    term = "월 단위 집행" if x.get("shortTermAvailable") is False else "1개월 미만 협의"
    return f"{price} · {term}"


def exposure_line(x):
    """지도 카드와 동일 (map.js cardExposurePoint) — 매체별 실데이터"""
    return x.get("exposureShort") or ""


def spec_chips(x):
    """media-list.js specChips 와 동일"""
    out = []
    if x.get("widthM") and x.get("heightM"):
        out.append(f'<span class="spec-chip"><b>크기</b>{x["widthM"]}×{x["heightM"]}m</span>')
    row = (x.get("pricing") or [{}])[0]
    if row.get("dailyPlays") and row.get("durationSec"):
        out.append(f'<span class="spec-chip"><b>송출</b>일 {row["dailyPlays"]}회 · {row["durationSec"]}초</span>')
    elif row.get("dailyPlays"):
        out.append(f'<span class="spec-chip"><b>송출</b>일 {row["dailyPlays"]}회</span>')
    if x.get("shortTermAvailable"):
        out.append('<span class="spec-chip is-mint">단기 가능</span>')
    return "".join(out)


FIELDS = ["slug", "name", "category", "mediaType", "address", "sizeText", "widthM", "heightM",
          "resolutionPx", "operationHours", "exposureShort", "tags", "areaName", "areaSlug",
          "imageUrl", "images", "shortTermAvailable",
          # 상세페이지 — 사진 외 영상·위치맥락·오디언스 파생에 쓰는 필드(지도 상세와 동일 원본)
          # (매체사 company 는 비공개라 일부러 제외)
          "videoUrl", "exposureLong", "locationDescription", "locationFeature"]

_raw = json.load(open(SRC, encoding="utf-8"))
items = []
for _x in _raw:
    if not _x.get("slug") or not _x.get("name"):
        continue
    _it = {k: _x.get(k) for k in FIELDS}
    _it["minPrice"] = _minprice(_x)
    _it["pricing"] = _x.get("pricing")
    _it["contractText"] = _x.get("contractText")
    items.append(_it)

# 엘리베이터 네트워크 6개 로드(있을 때만) — 매체 목록 요약 섹션용
try:
    _elev = json.load(open("data/elevator-networks.json", encoding="utf-8"))["networks"]
    _esite = json.load(open("data/elevator-sites.json", encoding="utf-8"))
except Exception:
    _elev, _esite = [], {}

# 필터 단일 출처 — 지도(map.js)와 목록이 공유. 지역·유형·예산이 여기서 온다.
FILTERS = json.load(open("data/filters.json", encoding="utf-8"))

# 상권(areas) — 유동인구·시간대 원본. media-detail.js와 같은 data/areas.json 을 areaSlug 로 매칭.
try:
    AREAS = {e["slug"]: e for e in json.load(open("data/areas.json", encoding="utf-8"))}
except Exception:
    AREAS = {}


def elev_unit_range(nid):
    v = [x["unitPrice"] for x in _esite.get(nid, []) if x.get("unitPrice") and x["unitPrice"] < 20000]
    return (min(v), max(v)) if v else None


def elev_list_cards():
    """엘리베이터를 매체 목록의 카드 2장(아파트/오피스)으로. 매체 카드와 같은 구조·필터속성.
    개별 단지는 별도 데이터(9,470건)라 여기선 대표 카드만, 상세는 elevator-<place>.html."""
    if not _elev:
        return ""
    out = ""
    for place, label, note in [
        ("apartment", "아파트 엘리베이터 광고", "주거 가구에 노출"),
        ("office", "오피스 엘리베이터 광고", "상주 직장인·방문 고객에 노출"),
    ]:
        ns = [n for n in _elev if n["type"] == place]
        cnt = sum(n["complexes"] for n in ns)
        mon = sum(n["monitors"] for n in ns)
        uw = "단지" if place == "apartment" else "빌딩"
        # 단지 단위 상품의 최저 대당 단가
        lows = [elev_unit_range(n["id"])[0] for n in ns
                if elev_unit_range(n["id"]) and n.get("saleUnit") != "package"]
        price = f"대당 월 {min(lows):,}원부터" if lows else "권역 패키지"
        brands = " ".join(n["brand"] for n in ns)
        blob = f"{label} 엘리베이터 승강기 아파트 오피스 {brands}".lower()
        img = "assets/images/elevator/elevator-apt-1.jpg" if place == "apartment" \
            else "assets/images/elevator/elevator-office-1.jpg"
        out += (
            f'<article class="card" data-cat="daily_touchpoint" data-region="전국" data-price="" data-package="1"'
            f' data-search="{esc(blob)}">'
            f'<a class="media-thumb" href="elevator-{place}.html" aria-label="{esc(label)} 상세보기">'
            f'<img class="card-image" src="{esc(img)}" alt="{esc(label)}" loading="lazy"'
            f' onerror="this.style.background=\'#eef1f6\';this.style.visibility=\'hidden\'"></a>'
            f'<div class="card-body">'
            f'<div class="ttl-row"><h3>{esc(label)}</h3></div>'
            f'<p class="mc-addr">전국 {uw} {cnt:,}곳 · 모니터 {mon:,}대</p>'
            f'<p class="mc-decision">{esc(price)} · {uw} 단위 집행</p>'
            f'<p class="mc-exposure">{esc(note)}</p>'
            f'<div class="map-card-footer"><span>상세보기</span></div>'
            f'</div></article>')
    return out


def _group_card(title, addr, decision, exposure, href, cat, img, blob):
    return (
        f'<article class="card" data-cat="{cat}" data-region="전국" data-price="" data-package="1" data-search="{esc(blob)}">'
        f'<a class="media-thumb" href="{href}" aria-label="{esc(title)} 상세보기">'
        f'<img class="card-image" src="{esc(img)}" alt="{esc(title)}" loading="lazy"'
        f' onerror="this.style.background=\'#eef1f6\';this.style.visibility=\'hidden\'"></a>'
        f'<div class="card-body"><div class="ttl-row"><h3>{esc(title)}</h3></div>'
        f'<p class="mc-addr">{esc(addr)}</p>'
        f'<p class="mc-decision">{esc(decision)}</p>'
        f'<p class="mc-exposure">{esc(exposure)}</p>'
        f'<div class="map-card-footer"><span>상세보기</span></div>'
        f'</div></article>')


def group_summary_cards(unis, sgs):
    """대학교 카페 미디어(33)·스마트가로(37)를 각각 대표 카드 1장으로. 상세는 대표 매체 페이지로 링크."""
    out = ""
    if unis:
        out += _group_card(
            "대학교 카페 미디어", f"서울 주요 대학 {len(unis)}곳 · 카페·학생회관 디지털 미디어",
            "월 25만원 · 10곳 이상 패키지 집행", "MZ 대학생 타깃에 노출",
            f'media-{esc(unis[0]["slug"])}.html', "other", card_image(unis[0], 0),
            ("대학교 카페 미디어 대학광고 캠퍼스 카페광고 mz " + " ".join(u.get("name", "") for u in unis)).lower())
    if sgs:
        out += _group_card(
            "스마트가로 미디어", f"전국 {len(sgs)}곳 · 공공 가로시설물(휴지통 상단) 디스플레이",
            "월 15만원 · 구좌 단위 집행", "보행자 밀착 노출 (940×530mm)",
            f'media-{esc(sgs[0]["slug"])}.html', "other", card_image(sgs[0], 1),
            # '사이니지'는 금지어 — 등록 키워드가 '사이니지 설치·솔루션' 수요라 의도가 정반대(봇 오인 위험)
            ("스마트가로 스마트가로광고 가로시설물 가로변광고 " + " ".join(s.get("name", "") for s in sgs)).lower())
    return out

# ───────────────────────── 아이콘 ─────────────────────────
IC_MAP = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" '
          'stroke-linejoin="round" aria-hidden="true"><path d="M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3z"/>'
          '<path d="M9 3v15M15 6v15"/></svg>')
IC_LIST = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
           'aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>')
IC_CHAT = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" '
           'stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3.4-.6L3 21l1.7-5'
           'a8.2 8.2 0 0 1-.7-3.4 8.4 8.4 0 0 1 8.4-8.4 8.4 8.4 0 0 1 8.6 7.9z"/></svg>')
IC_AREA = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" '
           'stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/>'
           '<circle cx="12" cy="10" r="2.5"/></svg>')
IC_STAR = ('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61'
           'L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>')
# 관심매체 비교 = 지도 서비스 도크와 동일한 '나란한 두 패널' 픽토그램(map-services.js ICONS.compare)
IC_COMPARE = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" '
              'stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="7" height="14" rx="1.5"/>'
              '<rect x="13.5" y="5" width="7" height="14" rx="1.5"/></svg>')

# ───────────────────────── CSS ─────────────────────────
CSS = """
 body{margin:0;background:#fff;font-family:var(--font-sans);color:#1c1c1c}
 /* 페이지 공통 골격 — 헤더·본문·도크가 모두 이 기준선을 쓴다.
    본문 폭 = min(--shell-max, 100%-40px) 안쪽에서 좌우 --dock-gutter 만큼 들여쓴 영역. */
 :root{--shell-max:1760px;--dock-gutter:248px;--dock-top:145px;--dock-w:210px}
 /* 본문 폭 — 헤더·본문·푸터·도크가 모두 이 값을 공유해야 어긋나지 않는다 */
 :root{--shell-w:min(var(--shell-max),calc(100% - 40px))}
 /* 헤더 — 지도(.map-global-header)와 동일: 높이 54px, 14px/650, #344054, SUIT */
 .hd{position:sticky;top:0;z-index:30;border-bottom:1px solid #e9edf3;
     background:#fff;font-family:var(--font-sans)}
 /* 지도 목록 방식(데스크톱): 위(브레드크럼·제목·설명·필터)는 고정, 카드 목록만 내부 스크롤.
    화면 높이에서 헤더(--hd-h)를 뺀 만큼을 앱 영역으로 잡고 그 안에서 목록만 스크롤한다.
    → 스크롤해도 카드가 고정바 밑으로 파고들어 '중간부터' 잘려 보이는 일이 없다. */
 /* 광고 인사이트와 동일: 바깥 페이지 스크롤 + 상단 블록(제목·설명·필터)만 sticky 고정. */
 .catalog-sticky{position:sticky;top:calc(var(--hd-h,54px) - 1px);z-index:20;background:#fff;padding:12px 0 8px}
 .catalog-sticky h1{margin-top:0}
 .catalog-sticky .catalog-toolbar{position:static;top:auto;
     background:#fff!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
 body:has(#media-list) .section{padding-top:0}
 #main .container:has(> .catalog-sticky){padding-top:0}
 /* 헤더 내용(로고~회원가입)도 본문과 같은 기준선에 맞춘다 → .container와 동일한 폭 계산 */
 .hd-in{display:flex;align-items:center;gap:22px;min-height:54px;flex-wrap:wrap;box-sizing:border-box;
        width:min(var(--shell-max),calc(100% - 40px));margin:0 auto;padding-inline:var(--dock-gutter)}
 .hd-brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;flex:none}
 .hd-brand strong{font-size:18.5px;font-weight:760;letter-spacing:-0.01em;color:#0f172a}.hd-brand .brand-mark{width:30px;height:30px;background-size:auto 30px}
 .hd-nav{margin-left:auto;display:flex;align-items:center;gap:22px;flex-wrap:wrap}
 .hd-act{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
 .hd a{font-size:13px;font-weight:620;color:#344054;text-decoration:none;white-space:nowrap;
       transition:color .15s ease,transform .15s ease}
 .hd-nav a:hover,.hd-nav a:focus,.hd-act a:hover,.hd-act a:focus{color:#0b1b3f;transform:translateY(-2px)}
 .hd-nav a.on,.hd-act a.on{color:#344054;font-weight:620}
 /* 상세페이지 본문도 헤더와 같은 기준선 */
 .wrap{width:min(var(--shell-max),calc(100% - 40px));margin:0 auto;box-sizing:border-box;
       padding:22px var(--dock-gutter) 90px}
 @media(max-width:1079px){.wrap{padding-inline:0;padding-bottom:100px}}
 .bc{font:13px/1.6 var(--font-sans);color:#8a8a8a;margin:0 0 8px}
 .bc a{color:#8a8a8a;text-decoration:none}
 h1{font:850 26px/1.3 var(--font-sans);margin:6px 0 8px}
 .lead{font:16px/1.75 var(--font-sans);color:#2a2a2a;margin:0 0 18px}
 /* 목록 상단 요약 — 봇/AI가 이 페이지를 인용할 때 뽑아 쓰는 문단. 카드 영역 폭을 그대로 쓴다(한 줄) */
 .cat-lead{margin:8px 0 4px;font:15px/1.7 var(--font-sans);color:#4a5568}
 /* 긴 옵션이 드롭다운 화살표에 겹치지 않게 — 여백 확보 + 예산 필드는 폭 넉넉히 */
 .filter-grid select{padding-right:32px!important;text-overflow:ellipsis}
 .filter-grid #budgetFilter{min-width:168px}
 .filter-grid #categoryFilter,.filter-grid #areaFilter{min-width:150px}
 h2{font:760 17px/1.4 var(--font-sans);margin:26px 0 10px}
 h2 .c{color:#0b3a91}
 table.t{border-collapse:collapse;width:100%;font:14px/1.6 var(--font-sans);margin:0 0 6px}
 table.t th,table.t td{border:1px solid #e8e8e8;padding:10px 12px;text-align:left}
 table.t th{background:#f8fafc;font-weight:700;white-space:nowrap;color:#333;width:130px}
 .faq details{border-bottom:1px solid #eee;padding:12px 2px}
 .faq summary{font:700 15px/1.5 var(--font-sans);cursor:pointer}
 .faq p{margin:8px 0 0;font:14px/1.7 var(--font-sans);color:#333}
 .note{font:12px/1.6 var(--font-sans);color:#9a9a9a;margin-top:8px}
 /* ── 상단 히어로: 좌측 영상/사진 + 우측 카드형 요약 ── */
 /* 카드는 내용에 맞는 자연 높이 — 스크롤 금지, 전체가 한눈에. 폭은 제한해 세로 비율 유지.
    우측 컬럼(340px)보다 카드(300px)를 좁혀 왼쪽 정렬 → 우측 플로팅 도크와 간격 확보. */
 .dv-hero{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:22px;align-items:start;margin:6px 0 12px}
 .dv-card{max-width:300px}
 .dv-video,.dv-photo{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:16px;display:block}
 .dv-video{background:#000}
 .dv-photo{background:#eef1f6}
 .dv-empty{display:grid;place-items:center;color:#9aa0aa;font:600 14px/1 var(--font-sans);aspect-ratio:16/10}
 .dv-card{border:1px solid #e5e8ee;border-radius:16px;background:#fff;
          box-shadow:0 6px 20px rgba(15,23,42,.06);padding:18px 20px}
 .dv-card-label{font:800 11.5px/1 var(--font-sans);color:#8a93a3;letter-spacing:.02em;margin:0 0 8px}
 .dv-prices{margin:0 0 8px}
 .dv-price{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;padding:7px 0;
           border-bottom:1px solid #eef0f4}
 .dv-price:last-child{border-bottom:0}
 .dv-price span{font:600 13px/1.4 var(--font-sans);color:#475569}
 .dv-price b{font:800 14px/1.3 var(--font-sans);color:#0f172a;margin-left:auto;white-space:nowrap}
 .dv-specs{margin:2px 0 0;border-top:1px solid #f1f3f7;padding-top:6px}
 .dv-spec{display:flex;justify-content:space-between;gap:12px;padding:4px 0;
          font:12.5px/1.45 var(--font-sans)}
 .dv-spec span{color:#8a93a3;font-weight:650;flex:none}
 .dv-spec b{color:#1f2937;font-weight:650;text-align:right}
 .dv-cta{display:block;text-align:center;margin:14px 0 0;padding:12px;border-radius:11px;
         background:#0b2e6b;color:#fff;font:800 14px/1 var(--font-sans);text-decoration:none}
 .dv-cta:hover{background:#0a2657}
 .dv-card-note{margin:10px 0 0;font:11px/1.55 var(--font-sans);color:#9aa0aa}
 @media(max-width:900px){.dv-hero{grid-template-columns:1fr}}
 /* 오디언스 대시보드는 styles.css 의 .audience-* 레이아웃을 쓰고, 색만 지도 팔레트로 덮는다.
    (인라인이 styles.css 뒤라 같은/높은 특이도로 이기게 둔다) — 막대 네이비 그라데이션·트랙 #e2e8f0·성별 핑크/파랑 */
 .audience-progress-track{background:#e2e8f0}
 .audience-progress-track i{background:linear-gradient(90deg,#0b3a91,#6d95ff)}
 .audience-card-gender .audience-progress-track i{background:#e8608e}
 .audience-card-gender .audience-progress.is-accent .audience-progress-track i{background:#3b74f2}
 .audience-column i{background:linear-gradient(180deg,#6d95ff,#0b3a91)}
 .aud-note{font:14px/1.7 var(--font-sans);color:#3a4150;margin:0 0 12px}
 .aud-note b{color:#0b3a91}
 /* 출처 — 작은 '출처' 라벨에 마우스 오버(또는 포커스)하면 메모 툴팁(공공데이터 링크)이 뜬다. 전 페이지 공통 */
 .srcline{margin:8px 0 0}
 .srcpop{position:relative;display:inline-block;font:11px/1.4 var(--font-sans);color:#9aa0aa;
         cursor:help;border-bottom:1px dotted #c4c9d2}
 .srcpop-body{position:absolute;left:0;bottom:calc(100% + 8px);z-index:40;width:max-content;max-width:360px;
         padding:12px 14px;border-radius:10px;background:#f3f4f6;color:#6b7280;text-align:left;
         border:1px solid #e3e6ec;font:11.5px/1.5 var(--font-sans);box-shadow:0 6px 18px rgba(15,23,42,.12);
         opacity:0;visibility:hidden;transform:translateY(4px);
         transition:opacity .15s ease,transform .15s ease,visibility .15s ease}
 .srcpop:hover .srcpop-body,.srcpop:focus-visible .srcpop-body,.srcpop:focus-within .srcpop-body{
         opacity:1;visibility:visible;transform:translateY(0)}
 .srcpop-body b{display:block;margin-bottom:4px;color:#414855;font-weight:700}
 .srcpop-body a{display:block;margin-top:5px;color:#5b6472;text-decoration:none}
 .srcpop-body a:hover,.srcpop-body a:focus{color:#0b3a91;text-decoration:underline}
 .srcpop-body::before{content:"";position:absolute;top:100%;left:0;right:0;height:9px}
 .srcpop-body::after{content:"";position:absolute;top:100%;left:14px;
         border:6px solid transparent;border-top-color:#f3f4f6}
 /* 카드 사진 — styles.css의 '#media-list .card-image{width:205%;object-position:left top}'는
    옛 media.html 전용 규칙인데 선택자가 더 세서 사진을 205%로 확대해 왼쪽 위만 보여준다.
    같은 강도로 덮어쓰고, 지정된 틀에 여백 없이 가운데 기준으로 자동 확대(cover)한다. */
 .media-thumb{aspect-ratio:1.5/1;background:#eef1f6}
 #media-list .media-thumb{aspect-ratio:1.5/1;background:#eef1f6}
 #media-list .card-image{width:100%;max-width:100%;height:100%;aspect-ratio:1.5/1;
                         object-fit:cover;object-position:center;background:#eef1f6}
 /* 카드 어디를 눌러도 상세로 — 사진 링크의 ::after를 카드 전체로 확장.
    styles.css의 '.media-thumb{position:relative}'(3539)와 'overflow:hidden'(667)이 그대로면
    ::after가 사진 안에 갇혀 사진만 눌린다 → 둘 다 해제해야 카드 전체가 링크가 된다.
    (205% 확대를 없앤 뒤라 overflow로 잘라낼 것도 없다) */
 #media-list .card{position:relative}
 /* 필터가 숨긴 카드(hidden) — styles.css의 '#media-list .card{display:flex}'가 hidden을
    덮어써서 안 사라지던 것. hidden 속성이 이기도록 명시(catalog-filter.js가 c.hidden 사용) */
 #media-list .card[hidden]{display:none!important}
 #media-list .media-thumb{position:static;overflow:visible}
 #media-list .media-thumb::after{content:"";position:absolute;inset:0;z-index:1}
 /* 지도 카드와 동일한 '상세보기 ›' 표시 (.map-card-footer 스타일은 styles.css 공용) */
 #media-list .map-card-footer{margin-top:12px}
 /* 관심 버튼은 카드 전체 링크(::after) 위로 올려야 클릭이 먹는다 */
 #media-list .card .map-card-fav{position:relative;z-index:2}
 /* 관심매체 — 지도처럼 '매체명 옆'에 (.map-card-fav 스타일은 styles.css 공용) */
 .ttl-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start}
 .ttl-row h3{margin:0;font:700 16px/1.4 var(--font-sans);color:#111827}
 /* 카드 설명 — 지도 카드(.map-card-decision-line/.map-card-exposure-point)와 동일 */
 #media-list .mc-addr{margin:7px 0 0;font:12.5px/1.55 var(--font-sans);color:#8892a4}
 #media-list .mc-decision{margin:9px 0 0;font:720 12.5px/1.5 var(--font-sans);color:#172033}
 #media-list .mc-exposure{margin:3px 0 0;font:560 12px/1.5 var(--font-sans);color:#52647e}
 /* 우측 플로팅 메뉴판 — 지도 도크(.gps-dock/.gps-svc)와 동일한 형태.
    top은 본문 시작선(툴바 윗변)에, 좌우는 '본문 오른쪽 여백(--dock-gutter)'의 정중앙에 놓는다.
    여백 중앙 = 본문 오른쪽 끝 + 여백/2 → 거기서 도크 폭의 절반을 뺀 값이 left. */
 .viewtog{position:fixed;top:var(--dock-top);z-index:19;display:flex;flex-direction:column;gap:5px;
          width:var(--dock-w);right:auto;
          left:calc(50% + var(--shell-w)/2 - var(--dock-gutter) + (var(--dock-gutter) - var(--dock-w))/2)}
 .viewtog a{display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid #e2e7f0;border-radius:11px;
            background:#fff;text-decoration:none;font:700 13px/1.3 var(--font-sans);color:#2b3242;
            /* 흰 배경에선 그림자가 뿌연 후광이 돼 지저분 → 그림자 없이 테두리만 */
            box-shadow:none;transition:border-color .15s ease}
 .viewtog a:hover{border-color:#3b74f2}
 .viewtog a[hidden]{display:none}  /* display:flex가 hidden 속성을 덮어써서 명시 필요 */
 .viewtog .ic{width:22px;height:22px;flex:none;display:grid;place-items:center;border-radius:6px;
              background:#eaf0ff;color:#0b3a91}
 .viewtog .ic svg{width:14px;height:14px;flex:none}
 .viewtog .consult .ic,.viewtog .favlink .ic{background:#0b3a91;color:#fff}
 .viewtog .favlink svg{fill:none;stroke:currentColor}
 .viewtog b{margin-left:auto;font:800 10px/1 var(--font-sans);color:#fff;background:#0b3a91;
            border-radius:999px;padding:3px 7px}
 /* 푸터 */
 .site-foot{border-top:1px solid #e9e9ee;background:#fafafb;margin-top:56px}
 /* 푸터도 헤더·본문과 같은 기준선 */
 .foot-inner{width:min(var(--shell-max),calc(100% - 40px));margin:0 auto;box-sizing:border-box;
             padding:26px var(--dock-gutter) 34px}
 @media(max-width:1079px){.foot-inner{padding-inline:0}}
 .foot-nav{display:flex;flex-wrap:wrap;gap:10px 18px;margin-bottom:16px}
 .foot-nav a{color:#33363d;text-decoration:none;font:600 13.5px/1 var(--font-sans)}
 .foot-info{display:flex;flex-wrap:wrap;gap:6px 20px;font-style:normal;font:13px/1.7 var(--font-sans);color:#5c616b}
 .foot-info b{color:#33363d;font-weight:650;margin-right:4px}
 .foot-copy{margin:14px 0 0;font:12.5px/1.6 var(--font-sans);color:#9a9ea7}
 /* 목록은 기본 컨테이너(1280px)로는 양옆이 죽는다 → 창 폭을 넓게 쓴다 */
 #main .container{--container-max:var(--shell-max)}
 /* 헤더~제목 51px — 광고집행사례와 동일한 상단 여백(.section 기본값이 6px 모자람) */
 #main .container{padding-top:6px}
 /* 도크 자리를 오른쪽에서만 빼면 판이 왼쪽으로 쏠린다 → 좌우 같은 여백으로 가운데 정렬 */
 @media(min-width:1080px){#main .container{padding-left:var(--dock-gutter);padding-right:var(--dock-gutter)}}
 /* 4칸 고정이면 도크 여백만큼 카드가 좁아진다 → 카드 최소폭 기준 자동 배치(넓게) */
 #media-list.grid.cols-3{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
 /* 1080px 미만은 도크 자리를 뺄 여유가 없다 → 하단 가로 바로 내려 본문을 가리지 않게 */
 @media(max-width:1079px){
   .hd-in{padding-inline:0}
   .viewtog{right:10px;left:10px;top:auto;bottom:10px;width:auto;flex-direction:row;flex-wrap:wrap;justify-content:center}
   .viewtog a{flex:1 1 auto;justify-content:center;padding:9px 10px;font-size:12.5px}
   .viewtog b{margin-left:6px}
   #main .container{padding-bottom:64px}}
 @media(max-width:900px){.hd-in{gap:12px;min-height:50px}.hd-nav{gap:14px}.hd-act{gap:12px}
   .hd a{font-size:13px}}
"""

FAV = '\n<script src="assets/js/catalog-fav.js?v=fav-20260717a"></script>'

HEADER = """<header class="hd"><div class="hd-in">
  <a class="hd-brand" href="map.html" aria-label="광고플레이 홈"><span class="brand-mark">AD</span><strong>광고플레이</strong></a>
  <nav class="hd-nav" aria-label="주요 메뉴">
    <a href="map.html">옥외광고 지도</a>
    <a class="on" href="media-catalog.html">옥외광고 목록</a>
    <a href="cases.html">광고집행사례</a>
    <a href="insights.html">광고 인사이트</a>
  </nav>
  <div class="hd-act">
    <a href="about.html">회사소개</a>
    <a href="admin.html">관리자</a>
    <a href="login.html">로그인</a>
    <a href="join.html">회원가입</a>
  </div>
</div></header>"""

FOOTER = """
<footer class="site-foot"><div class="foot-inner">
  <nav class="foot-nav" aria-label="회사 정보 메뉴">
    <a href="index.html">홈</a><a href="about.html">회사소개</a><a href="terms.html">이용약관</a><a href="privacy.html">개인정보처리방침</a><a href="media-policy.html">매체관리규정</a>
  </nav>
  <address class="foot-info">
    <span><b>회사명</b> 광고플레이 주식회사(Adplay Co., Ltd)</span>
    <span><b>대표자</b> 임정언</span>
    <span><b>이용문의</b> 1533-1975</span>
    <span><b>팩스</b> 044-902-6029</span>
    <span><b>이메일</b> info@k-goplay.com</span>
    <span><b>주소</b> 세종특별자치시 한누리대로 350, 뱅크빌딩 6층 D45호(어진동)</span>
    <span><b>통신판매업신고</b> 제2024-세종아름-0724</span>
    <span><b>사업자등록번호</b> 148-81-03399</span>
  </address>
  <p class="foot-copy">Copyright &copy; Adplay Korea Co., Ltd. All Rights Reserved.</p>
</div></footer>"""


def viewtog():
    """우측 플로팅 메뉴판 — 지도 도크와 동일한 형태"""
    return ('<div class="viewtog">'
            f'<a href="map.html"><span class="ic">{IC_MAP}</span>지도로 보기</a>'
            f'<a href="media-catalog.html"><span class="ic">{IC_LIST}</span>목록으로 보기</a>'
            f'<a href="areas.html"><span class="ic">{IC_AREA}</span>지역으로 보기</a>'
            f'<a class="consult" href="estimate.html"><span class="ic">{IC_CHAT}</span>상담신청</a>'
            f'<a class="favlink" id="favBar" href="map.html" hidden><span class="ic">{IC_COMPARE}</span>'
            f'관심매체 비교<b id="favCount">0</b></a>'
            '</div>')


def head(title, desc, canon, extra_ld=""):
    return f"""<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{canon}">
<link rel="stylesheet" href="assets/css/styles.css">
{extra_ld}
<style>{CSS}</style></head><body>
{HEADER}"""


def audience_profile(x):
    """지도 상세와 동일한 오디언스 추정(assets/js/common.js audienceProfile 1:1).
    상권 아키타입(코엑스/서울역/광화문·도심/강남 기본)으로 성별·연령 분포를 파생한다.
    → 지도가 바뀌면 common.js 값을 여기와 같이 맞춰야 동기화 유지."""
    text = " ".join(str(v) for v in [x.get("name"), x.get("areaName"), x.get("areaSlug"),
                                     x.get("address"), x.get("locationDescription")] if v)
    src = "출처: 소상공인 상권정보 · 통계청 KOSIS (2026, 상권 기준)"

    def p(arch, f, m, worker, note, age):
        return {"arch": arch, "f": f, "m": m, "worker": worker, "note": note, "src": src, "age": age}

    if re.search(r"삼성|코엑스|COEX|samseong|coex", text, re.I):
        return p("coex", 48, 52, "높음", "업무·전시 방문과 쇼핑 체류가 섞인 3040 중심",
                 [("10대", 5, 17, "학생·동반"), ("20대", 22, 73, "활동층"), ("30대", 28, 93, "구매 핵심"),
                  ("40대", 24, 80, "직장인"), ("50대", 14, 47, "가족 소비"), ("60대+", 7, 23, "생활권")])
    if re.search(r"서울역|KTX|seoul-station|transport", text, re.I):
        return p("seoul-station", 45, 55, "보통", "출장·관광·통근이 겹쳐 전 연령 고른 분포",
                 [("10대", 6, 20, "학생·동반"), ("20대", 20, 67, "활동층"), ("30대", 24, 80, "구매 핵심"),
                  ("40대", 23, 77, "직장인"), ("50대", 16, 53, "가족 소비"), ("60대+", 11, 37, "생활권")])
    if re.search(r"광화문|종로|시청|청계|gwanghwamun|jongno|jung", text, re.I):
        return p("gwanghwamun", 47, 53, "매우 높음", "도심 오피스 직장인 3040·40대 이상 비중 높음",
                 [("10대", 4, 13, "학생·동반"), ("20대", 18, 60, "활동층"), ("30대", 26, 87, "구매 핵심"),
                  ("40대", 26, 87, "직장인"), ("50대", 16, 53, "가족 소비"), ("60대+", 10, 33, "생활권")])
    return p("gangnam", 58, 42, "높음", "뷰티·패션 소비층, 2030 여성 비중 우세",
             [("10대", 6, 20, "학생·동반"), ("20대", 28, 93, "활동층"), ("30대", 30, 100, "구매 핵심"),
              ("40대", 20, 67, "직장인"), ("50대", 11, 37, "가족 소비"), ("60대+", 5, 17, "생활권")])


def hero_media(x):
    """상단 좌측 — 영상이 등록돼 있으면 영상, 없으면 대표 사진으로 대체."""
    v = x.get("videoUrl")
    if v:
        poster = f' poster="{esc(x.get("imageUrl"))}"' if x.get("imageUrl") else ""
        return (f'<video class="dv-video" controls preload="none" playsinline{poster}>'
                f'<source src="{esc(v)}" type="video/mp4"></video>')
    img = (([u for u in (x.get("images") or []) if u] or [x.get("imageUrl")]) or [None])[0]
    if img:
        return f'<img class="dv-photo" src="{esc(img)}" alt="{esc(x["name"])} 현장 사진" loading="lazy">'
    return '<div class="dv-photo dv-empty">이미지 준비 중</div>'


def pricing_card(x):
    """상단 우측 — 영상 높이에 맞춘 카드형 요약. 광고비 구간 + 매체 규격·위치 정보 + 견적 문의."""
    cat = CAT.get(x.get("category"), "매체")
    tiers = [r for r in (x.get("pricing") or []) if r.get("monthlyPriceKRW")]
    rows = ""
    for r in tiers:
        rt = (r.get("rawText") or "").strip()
        if " - " in rt:
            spec, price = rt.split(" - ", 1)
            rows += f'<div class="dv-price"><span>{esc(spec)}</span><b>{esc(price)}</b></div>'
        else:
            label = r.get("label") or rt or "광고비"
            rows += f'<div class="dv-price"><span>{esc(label)}</span><b>{won(r.get("monthlyPriceKRW"))}/월</b></div>'
    if not rows:
        rows = '<div class="dv-price"><span>광고비 상담 안내</span></div>'
    size = x.get("sizeText") or (f"{x.get('widthM')}m × {x.get('heightM')}m" if x.get("widthM") else None)
    res = x.get("resolutionPx")
    size_res = " · ".join(v for v in (size, res) if v) or None  # 규격·해상도는 한 줄로
    short = "협의 필요" if x.get("shortTermAvailable") is False else "가능 (협의)"
    specs = [("매체 유형", x.get("mediaType") or cat), ("위치", x.get("address")),
             ("규격·해상도", size_res),
             ("운영 시간", x.get("operationHours")), ("단기 집행", short)]
    spec_rows = "".join(f'<div class="dv-spec"><span>{esc(a)}</span><b>{esc(b)}</b></div>'
                        for a, b in specs if b)
    return (
        '<aside class="dv-card">'
        '<div class="dv-card-label">광고비</div>'
        f'<div class="dv-prices">{rows}</div>'
        f'<div class="dv-specs">{spec_rows}</div>'
        '<a class="dv-cta" href="estimate.html">이 매체 견적 문의</a>'
        '<p class="dv-card-note">표기된 광고비는 VAT 별도 기준의 참고가입니다. '
        '최종 비용 및 구좌 가능 여부는 상담 시점에 확인이 필요합니다.</p>'
        '</aside>')


def location_html(x):
    rows = []
    seen = set()  # 같은 문장이 두 필드에 중복 저장된 매체가 있어 텍스트 기준으로 한 번만 노출
    # 매체사(company)는 비공개 — 지도도 노출하지 않으므로 여기서도 넣지 않는다.
    for label, key in (("입지 설명", "locationDescription"), ("노출 포인트", "exposureLong"),
                       ("입지 특성", "locationFeature")):
        v = (x.get(key) or "").strip()
        if not v or v in seen:
            continue
        seen.add(v)
        rows.append(f"<tr><th>{label}</th><td>{esc(v)}</td></tr>")
    if not rows:
        return ""
    return f'<h2>위치·입지 특성</h2><table class="t">{"".join(rows)}</table>'


# 유동인구 파생 — media-detail.js deriveAudienceInsights 와 동일한 상수·규칙
_DAY_DIST = [("월", 16), ("화", 16), ("수", 17), ("목", 17), ("금", 16), ("토", 11), ("일", 7)]
_TIME_FALLBACK = [("05~09", 14), ("09~12", 18), ("12~14", 16), ("14~18", 26), ("18~23", 22), ("23~05", 4)]
_WOBBLE = [0, 0.02, 0.04, 0.06, 0.07, 0.05, 0.03, 0.06, 0.05, 0.06, 0.03, 0.02]


def _fmt_num(v):
    try:
        return f"{int(v):,}"
    except (TypeError, ValueError):
        return "확인 필요"


def _fmt_compact(v):
    try:
        return f"{round(float(v) / 1000)}K"
    except (TypeError, ValueError):
        return "0"


def _man(v):
    """만명 단위 — 지도(단위 만명)와 통일. 소수 1자리, 불필요한 0 제거."""
    try:
        return f"{(float(v) or 0) / 10000:.1f}".rstrip("0").rstrip(".")
    except (TypeError, ValueError):
        return "0"


def _fmt_pct(v):
    n = float(v)
    return f"{int(n) if n == int(n) else round(n, 1)}%"


def _month_label(m):
    parts = str(m or "").split(".")
    return f"{int(parts[1])}월" if len(parts) > 1 else str(m or "")


def _derive_insights(x):
    """media-detail.js deriveAudienceInsights 이식 — areaSlug 로 상권을 찾아 유동인구·시간대 파생."""
    area = AREAS.get(x.get("areaSlug")) or {}
    base500 = int(area.get("dailyFootTraffic") or 0) or 76000
    base300 = round(base500 * 0.4)
    p = audience_profile(x)
    bh = [r for r in (area.get("busHourlyUsers") or []) if float(r.get("users") or 0) > 0]
    if bh:
        total = sum(float(r.get("users") or 0) for r in bh) or 1
        time_pct = [(r["label"], round(float(r.get("users") or 0) / total * 100)) for r in bh]
    else:
        time_pct = _TIME_FALLBACK
    monthly = [(f"2026.{i + 1:02d}", round(base500 * (0.95 + w))) for i, w in enumerate(_WOBBLE)]
    return {"avg500": base500, "avg300": base300, "weekday": 72, "weekend": 28,
            "gender": [("여성", p["f"]), ("남성", p["m"])],
            "age": [(lbl, pct) for lbl, pct, _b, _n in p["age"]],
            "day": _DAY_DIST, "time": time_pct, "monthly": monthly,
            "note": p["note"], "worker": p["worker"], "has_bus": bool(bh)}


def _count_rows(rows, base):
    return [(lbl, pct, round(base * pct / 100)) for lbl, pct in rows]


def _metric_card(label, scope, value):
    return (f'<div class="audience-metric"><span>{esc(label)} <b>({esc(scope)})</b></span>'
            f'<strong>{_man(value)}만명</strong></div>')


def _progress_rows(rows, gender_accent):
    mx = max([c for _l, _p, c in rows] + [1])
    out = ""
    for i, (label, pct, count) in enumerate(rows):
        w = max(3, count / mx * 100)
        acc = " is-accent" if gender_accent and i == 1 else ""
        out += (f'<div class="audience-progress{acc}"><span>{esc(label)}</span>'
                f'<div class="audience-progress-track"><i style="width:{w:.0f}%"></i></div>'
                f'<strong>{_man(count)}만명 <em>{_fmt_pct(pct)}</em></strong></div>')
    return f'<div class="audience-progress-list">{out}</div>'


def _column_chart(rows):
    mx = max([c for _l, _p, c in rows] + [1])
    out = ""
    for label, _pct, count in rows:
        h = max(8, count / mx * 100)
        out += (f'<div class="audience-column"><strong>{_man(count)}만</strong>'
                f'<i style="height:{h:.0f}%"></i><span>{esc(label)}</span></div>')
    return f'<div class="audience-columns">{out}</div>'


def _line_chart(monthly):
    pts = [(_month_label(m), v) for m, v in monthly]
    if not pts:
        return ""
    vals = [v for _l, v in pts]
    mn, mx = min(vals), max(vals)
    W, H, padX, padTop, padBot = 640, 220, 38, 34, 42
    pw, ph = W - padX * 2, H - padTop - padBot
    n = max(len(pts) - 1, 1)
    coords = []
    for i, (lbl, v) in enumerate(pts):
        xx = padX + pw * i / n
        ratio = 0.5 if mx == mn else (v - mn) / (mx - mn)
        yy = padTop + ph - ph * ratio
        coords.append((lbl, v, xx, yy))
    line = " ".join(f"{xx:.1f},{yy:.1f}" for _l, _v, xx, yy in coords)
    dots = ""
    for lbl, v, xx, yy in coords:
        dots += (f'<g><circle cx="{xx:.1f}" cy="{yy:.1f}" r="5" fill="#0b3a91"></circle>'
                 f'<text x="{xx:.1f}" y="{yy - 12:.1f}" text-anchor="middle">{_man(v)}만</text>'
                 f'<text class="axis-label" x="{xx:.1f}" y="{H - 12}" text-anchor="middle">{esc(lbl)}</text></g>')
    return (f'<div class="audience-line-wrap"><svg class="audience-line-chart" viewBox="0 0 {W} {H}" '
            f'role="img" aria-label="월별 일평균 유동인구 추이">'
            f'<defs><linearGradient id="dvLine" x1="0" y1="0" x2="1" y2="0">'
            f'<stop offset="0" stop-color="#0b3a91"></stop><stop offset="1" stop-color="#4f7df3"></stop>'
            f'</linearGradient></defs>'
            f'<polyline points="{line}" fill="none" stroke="url(#dvLine)" stroke-width="4" '
            f'stroke-linecap="round" stroke-linejoin="round"></polyline>{dots}</svg></div>')


def source_chip(traffic=False):
    """전 페이지 공통 출처 표기 — 작은 '출처' 라벨 + 호버 메모 툴팁(공공데이터 링크).
    문구·링크는 지도(common.js AdPlay.sourceChip)와 1:1로 동일하게 유지한다."""
    S = [
        ("일평균 유동인구 · 소상공인 상권정보 빅데이터 (2026)", "https://bigdata.sbiz.or.kr/"),
        ("인구·성별·연령 · 통계청 KOSIS (2025)", "https://kosis.kr/"),
        ("버스 승하차 · 서울 열린데이터광장 (2026)", "https://data.seoul.go.kr/"),
        ("지하철 승하차 · 국가철도공단 철도통계 (2025)", "https://www.kric.go.kr/"),
    ]
    if traffic:
        S.append(("도로 교통량 · 서울 TOPIS (2025)", "https://topis.seoul.go.kr/"))
    rows = "".join(f'<a href="{esc(h)}" target="_blank" rel="noopener noreferrer">{esc(l)}</a>' for l, h in S)
    return (f'<span class="srcpop" tabindex="0" role="note" aria-label="데이터 출처">출처'
            f'<span class="srcpop-body"><b>데이터 출처</b>{rows}</span></span>')


def audience_html(x):
    """유동인구·타깃 오디언스 대시보드 — media-detail.js audienceDashboardVisual 와 동일 구조.
    styles.css 의 .audience-* 스타일을 그대로 써서 지도 상세와 같은 화면이 된다."""
    d = _derive_insights(x)
    a5 = d["avg500"]
    metrics = (_metric_card("일평균 유동인구", "300m", d["avg300"])
               + _metric_card("일평균 유동인구", "500m", a5)
               + _metric_card("주중 일평균", "500m", round(a5 * d["weekday"] / 100))
               + _metric_card("주말 일평균", "500m", round(a5 * d["weekend"] / 100)))
    dash = (
        '<div class="audience-dashboard">'
        f'<div class="audience-metrics">{metrics}</div>'
        f'<div class="audience-card audience-card-gender"><h3>성별 비율 기준 500m</h3>'
        f'{_progress_rows(_count_rows(d["gender"], a5), True)}</div>'
        f'<div class="audience-card"><h3>연령대별 분포 기준 500m</h3>'
        f'{_progress_rows(_count_rows(d["age"], a5), False)}</div>'
        f'<div class="audience-card"><h3>요일별 일평균 기준 500m</h3>'
        f'{_progress_rows(_count_rows(d["day"], a5), False)}</div>'
        f'<div class="audience-card audience-card-time"><h3>시간대별 유동인구 기준 500m</h3>'
        f'{_column_chart(_count_rows(d["time"], a5))}</div>'
        f'<div class="audience-card audience-card-trend"><h3>월별 일평균 유동인구 추이 기준 500m</h3>'
        f'{_line_chart(d["monthly"])}</div>'
        '</div>')
    return (f'<h2>유동인구·타깃 오디언스</h2>'
            f'<p class="aud-note">{esc(d["note"])} · 직장인 밀집도 <b>{esc(d["worker"])}</b></p>'
            f'{dash}'
            f'<p class="srcline">{source_chip()}</p>')


def detail(x):
    name = x["name"]; slug = x["slug"]; cat = CAT.get(x.get("category"), "매체")
    minp = x.get("minPrice")

    # 광고비 — 적힌 구간 그대로. '부터'라는 하한 표기는 쓰지 않는다(단기집행 시 더 낮아질 수 있음).
    pricing = [r for r in (x.get("pricing") or []) if r.get("monthlyPriceKRW")]
    prices = [r["monthlyPriceKRW"] for r in pricing]
    if prices:
        pmin, pmax = min(prices), max(prices)
        price_lead = f"월 {won(pmin)}" if pmin == pmax else f"월 {won(pmin)}~{won(pmax)}"
    else:
        price_lead = "월 광고비 상담"

    ap = audience_profile(x)
    spec_txt = x.get("sizeText") or (f"{x.get('widthM')}m × {x.get('heightM')}m" if x.get("widthM") else None)
    if pricing:
        tier_txt = ", ".join((r.get("rawText") or f"{r.get('label')} 월 {won(r['monthlyPriceKRW'])}").strip()
                             for r in pricing)
        price_ans = (f"{tier_txt} 기준입니다(VAT 별도). 단기 집행 시 더 낮은 금액부터 협의 가능하며, "
                     f"최종 비용·구좌 가능 여부는 상담 시 확인이 필요합니다.")
    else:
        price_ans = "광고비는 상담 시 안내드리며, 단기 집행 시 더 낮은 금액부터 협의 가능합니다(VAT 별도)."
    faqs = [(f"{name} 광고 비용은 얼마인가요?", price_ans),
            (f"{name}은 어디에 있나요?", f"{x.get('address') or '서울'}에 위치한 {cat} 매체입니다.")]
    if spec_txt or x.get("operationHours"):
        faqs.append((f"{name}의 규격과 운영시간은 어떻게 되나요?",
                     f"규격은 {spec_txt or '상담 시 안내'}이며, 운영시간은 {x.get('operationHours') or '상담 시 안내'}입니다."))
    faqs.append((f"{name}은 어떤 타깃에 적합한가요?",
                 f"{ap['note']}. 성별 비중은 여성 {ap['f']}% · 남성 {ap['m']}%, "
                 f"직장인 밀집도는 '{ap['worker']}' 수준입니다(소상공인 상권정보·통계청 KOSIS 기준)."))
    faqs.append(("단기 집행도 가능한가요?", "네, 매체에 따라 1일 단위부터 집행할 수 있습니다."))
    faq_html = "".join(f"<details{' open' if i == 0 else ''}><summary>{esc(q)}</summary><p>{esc(a)}</p></details>"
                       for i, (q, a) in enumerate(faqs))

    ld = [
        {"@context": "https://schema.org", "@type": "Product", "name": f"{name} 옥외광고", "category": "옥외광고 매체",
         "description": f"{x.get('exposureShort') or name} — {cat} 옥외광고 매체",
         **({"image": f"{BASE}/{x['imageUrl']}"} if x.get("imageUrl") else {}),
         "brand": {"@type": "Organization", "name": "광고플레이"},
         "offers": {"@type": "Offer", "priceCurrency": "KRW", "price": int(minp) if minp else 0,
                    "availability": "https://schema.org/InStock",
                    "priceSpecification": {"@type": "UnitPriceSpecification", "price": int(minp) if minp else 0,
                                           "priceCurrency": "KRW", "unitText": "월"},
                    "seller": {"@type": "Organization", "name": "광고플레이", "url": f"{BASE}/"}}},
        {"@context": "https://schema.org", "@type": "Place", "name": name,
         "address": {"@type": "PostalAddress", "streetAddress": x.get("address") or "",
                     "addressLocality": "서울", "addressCountry": "KR"}},
        {"@context": "https://schema.org", "@type": "FAQPage",
         "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
                        for q, a in faqs]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "홈", "item": f"{BASE}/"},
            {"@type": "ListItem", "position": 2, "name": "옥외광고 매체", "item": f"{BASE}/media-catalog.html"},
            {"@type": "ListItem", "position": 3, "name": name, "item": f"{BASE}/media-{slug}.html"}]},
    ]
    ld_html = "\n".join(f'<script type="application/ld+json">{json.dumps(o, ensure_ascii=False)}</script>' for o in ld)
    meta_desc = f"{name}({cat}) 옥외광고 매체 — 위치 {x.get('address') or '서울'}, {price_lead}(VAT 별도). 규격·광고비·집행 안내."

    return head(f"{name} 옥외광고 매체 – 위치·광고비 | 광고플레이", meta_desc,
                f"{BASE}/media-{slug}.html", ld_html) + f"""
<main class="wrap">
{viewtog()}
<p class="bc"><a href="index.html">홈</a> › <a href="media-catalog.html">옥외광고 매체</a> › {esc(name)}</p>
<h1>{esc(name)} 옥외광고 매체</h1>
<p class="lead">{esc(x.get('exposureShort') or name)} · <b>{esc(cat)}</b> · {esc(price_lead)}(VAT 별도)</p>
<div class="dv-hero">
  <div class="dv-media">{hero_media(x)}</div>
  {pricing_card(x)}
</div>
{location_html(x)}
{audience_html(x)}
<h2>자주 묻는 질문</h2>
<div class="faq">{faq_html}</div>
</main>""" + FOOTER + FAV + """</body></html>"""


def catalog(items):
    """기존 '매체 찾기' UI(필터 툴바 + 카드) — 카드는 정적 렌더라 봇도 513개를 읽음"""
    # 필터 옵션은 filters.json(단일 출처)에서. 지역은 실제 매체가 있는 것만 노출.
    present = {region_of(x) for x in items}
    region_opts = "".join(f'<option value="{esc(r["value"])}">{esc(r["label"])}</option>'
                          for r in FILTERS["regions"] if r["value"] in present)
    cat_opts = "".join(f'<option value="{esc(c["value"])}">{esc(c["label"])}</option>'
                       for c in FILTERS["categories"])
    # 엘리베이터는 filters.json의 daily_touchpoint(=지도와 동일 값)로 통일. 카드 data-cat도 daily_touchpoint.
    budget_opts = "".join(f'<option value="{esc(b["value"])}">{esc(b["label"])}</option>'
                          for b in FILTERS["budgets"])
    search_ph = esc(FILTERS.get("searchPlaceholder", "검색"))
    # 패키지 = 개별 매체 중 패키지 옵션 있는 것 + 엘리베이터 2종(프라임리빙 등 권역 패키지 보유)
    # 대학교 카페 미디어(33)·스마트가로(37)는 목록에서 대표 카드 1장씩으로 묶는다(개별 상세페이지는 유지).
    unis = [x for x in items if is_uni_cafe(x)]
    sgs = [x for x in items if is_smart_garo(x)]
    grouped = {id(x) for x in unis} | {id(x) for x in sgs}
    visible = [x for x in items if id(x) not in grouped]
    pkg_count = (sum(1 for x in visible if is_package(x)) + (2 if _elev else 0)
                 + (1 if unis else 0) + (1 if sgs else 0))
    total_cards = len(visible) + (2 if _elev else 0) + (1 if unis else 0) + (1 if sgs else 0)

    # 엘리베이터 2종 + 대학교·스마트가로 대표 카드부터 → 그다음 개별 매체
    cards = elev_list_cards() + group_summary_cards(unis, sgs)
    for i, x in enumerate(visible):
        slug = esc(x["slug"]); reg = region_of(x)
        img = card_image(x, i)
        blob = " ".join(str(v) for v in [x.get("name"), x.get("address"), reg, CAT.get(x.get("category"), ""),
                                         " ".join(x.get("tags") or [])] if v).lower()
        cards += (
            f'<article class="card" data-cat="{esc(x.get("category") or "")}" data-region="{esc(reg)}"'
            f' data-price="{x.get("minPrice") or ""}"{" data-package=\"1\"" if is_package(x) else ""} data-search="{esc(blob)}">'
            f'<a class="media-thumb" href="media-{slug}.html" aria-label="{esc(x["name"])} 상세보기">'
            f'<img class="card-image" src="{esc(img)}" alt="{esc(x["name"])} 현장 이미지" loading="lazy"></a>'
            f'<div class="card-body">'
            f'<div class="ttl-row"><h3>{esc(x["name"])}</h3>'
            f'<button type="button" class="map-card-fav" data-fav-toggle="{slug}" aria-pressed="false"'
            f' aria-label="{esc(x["name"])} 관심매체 담기">{IC_STAR}<span>관심</span></button></div>'
            f'<p class="mc-addr">{esc(x.get("address") or "주소 확인 필요")}</p>'
            f'<p class="mc-decision">{esc(decision_line(x))}</p>'
            f'<p class="mc-exposure">{esc(exposure_line(x))}</p>'
            # 지도 카드와 동일 — 카드 전체가 상세 링크라 여기는 시각 표시만(.map-card-footer)
            f'<div class="map-card-footer"><span>상세보기</span></div>'
            f'</div></article>'
        )

    lds = [
        {"@context": "https://schema.org", "@type": "ItemList", "name": "광고플레이 옥외광고 매체 목록",
         "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": x["name"],
                              "url": f"{BASE}/media-{x['slug']}.html"} for i, x in enumerate(items)]},
        # 화면의 '홈 › 옥외광고 매체'와 같은 내용을 봇에게도 알려준다
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "홈", "item": f"{BASE}/"},
            {"@type": "ListItem", "position": 2, "name": "옥외광고 매체", "item": f"{BASE}/media-catalog.html"}]},
    ]
    ld_html = "\n".join(f'<script type="application/ld+json">{json.dumps(o, ensure_ascii=False)}</script>' for o in lds)

    return head("전국 옥외광고 매체 목록 – 전광판·지하철·버스·쇼핑몰 | 광고플레이",
                "광고플레이가 운영하는 전국 옥외광고 매체 목록입니다. 지역·유형·예산으로 걸러 위치와 월 광고비를 비교하고 바로 견적을 문의하세요.",
                f"{BASE}/media-catalog.html", ld_html) + f"""
<main id="main">
<section class="section"><div class="container">
{viewtog()}
<div class="catalog-sticky">
<p class="bc"><a href="index.html">홈</a> › 옥외광고 매체</p>
<h1>옥외광고 매체 목록</h1>
<p class="cat-lead">광고플레이가 운영하는 <b>전국 옥외광고 매체</b>입니다.
<b>대형 전광판·지하철·버스·쇼핑몰 DID</b> 등 유형별로 지역·예산에 맞는 매체를 찾고,
위치와 월 광고비를 비교해 바로 상담할 수 있습니다.</p>
<div class="catalog-toolbar">
  <div class="catalog-tabs" role="tablist" aria-label="매체 분류">
    <button type="button" class="catalog-tab is-active" data-tab="all" role="tab" aria-selected="true">전체 <em>{total_cards}</em></button>
    <button type="button" class="catalog-tab" data-tab="package" role="tab" aria-selected="false">패키지 <em>{pkg_count}</em></button>
  </div>
  <span id="resultCount" class="result-count" aria-live="polite" hidden></span>
  <details class="filters" open>
    <summary>필터</summary>
    <div class="filter-grid">
      <div class="field"><label for="categoryFilter">매체 유형</label>
        <select id="categoryFilter"><option value="all">전체 유형</option>{cat_opts}</select></div>
      <div class="field"><label for="areaFilter">지역</label>
        <select id="areaFilter"><option value="all">전체 지역</option>{region_opts}</select></div>
      <div class="field"><label for="budgetFilter">예산 범위</label>
        <select id="budgetFilter"><option value="all">전체 예산</option>{budget_opts}<option value="unknown">상담 필요</option></select></div>
      <div class="field search-field">
        <label for="searchFilter">검색</label>
        <input id="searchFilter" type="search" placeholder="{search_ph}">
      </div>
      <div class="field"><label for="sortBy">정렬</label>
        <select id="sortBy">
          <option value="recommended">추천순</option>
          <option value="price-asc">가격 낮은 순</option>
          <option value="price-desc">가격 높은 순</option>
          <option value="area">지역권별</option>
        </select></div>
    </div>
  </details>
</div>
<div id="activeChips" class="active-chips" aria-live="polite"></div>
</div><!-- /catalog-sticky -->
<div id="media-list" class="grid cols-3">{cards}</div>
<div id="catalogEmpty" class="empty" hidden>조건에 맞는 매체가 없습니다. 필터를 조정해 주세요.</div>
<p class="note">표기 광고비는 VAT 별도 참고가이며, 최종 비용·구좌 가능 여부는 상담 시 확인이 필요합니다.</p>
</div></section>
</main>""" + FOOTER + ('\n<script src="assets/js/catalog-filter.js?v=cat-20260717a"></script>'
                      '\n<script src="assets/js/catalog-fav.js?v=fav-20260717a"></script>'
                      '\n<script>(function(){var d=document.documentElement,h=document.querySelector(".hd");if(!h)return;function s(){d.style.setProperty("--hd-h",h.offsetHeight+"px")}s();try{new ResizeObserver(s).observe(h)}catch(e){}addEventListener("resize",s);addEventListener("load",s)})();</script>') + """</body></html>"""


def sync_filter_regions():
    """filters.json 의 regions 를 media.json 실측으로 갱신(서울=구, 그외=시도, 많은 순).
    유형·예산은 손정의라 그대로 두고 지역만 데이터 파생. 지도도 이 파일을 읽으면 동기화됨."""
    cnt = Counter(r for r in (region_of(x) for x in items) if r)
    order = {r["value"]: i for i, r in enumerate(FILTERS["regions"])}  # 기존 순서 유지 힌트
    regs = sorted(cnt.items(), key=lambda kv: (0 if kv[0].startswith("서울") else 1, -kv[1]))
    FILTERS["regions"] = [{"value": r, "label": r, "count": c} for r, c in regs]
    json.dump(FILTERS, open("data/filters.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return len(regs)


def main():
    n = sync_filter_regions()
    for x in items:
        open(f"media-{x['slug']}.html", "w", encoding="utf-8").write(detail(x))
    open("media-catalog.html", "w", encoding="utf-8").write(catalog(items))
    print(f"생성: media-catalog.html + {len(items)} 개 상세 · filters.json 지역 {n}개 동기화")


if __name__ == "__main__":
    main()
