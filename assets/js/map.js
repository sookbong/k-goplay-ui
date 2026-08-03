document.addEventListener("DOMContentLoaded", async () => {
  const root = document.querySelector("#media-map");
  if (!root) return;

  const [media, locations, areas, busStops, busStopPositionOverrides, elevatorData, elevatorSitesData] = await Promise.all([
    AdPlay.loadJson("data/media.json"),
    AdPlay.loadJson("data/media_locations.json"),
    AdPlay.loadJson("data/areas.json"),
    AdPlay.loadJson("data/bus_stops.json"),
    AdPlay.loadJson("data/bus_stop_position_overrides.json"),
    AdPlay.loadJson("data/elevator-networks.json").catch(() => ({ networks: [] })),
    AdPlay.loadJson("data/elevator-sites.json").catch(() => ({})),
  ]);
  const areaBySlug = new Map((areas || []).map((area) => [area.slug, area]));

  const categoryBar = document.querySelector("#mapCategoryBar");
  const stage = document.querySelector("#mapStage");
  const listView = document.querySelector("#mapListView");
  const detailRoot = document.querySelector("#mapDetailView");
  const listRoot = document.querySelector("#mapMediaList");
  const countRoot = document.querySelector("#mapResultCount");
  const summaryRoot = document.querySelector("#mapResultSummary");
  const searchForm = document.querySelector(".map-global-search");
  const searchInput = document.querySelector("#mapGlobalSearch");
  const curationToggle = document.querySelector("#mapCurationToggle");
  const curationPanel = document.querySelector("#mapCurationPanel");
  const curationClose = document.querySelector("#mapCurationClose");
  const curationList = document.querySelector("#mapCurationList");
  const curationImage = document.querySelector("#mapCurationImage");
  const curationCaption = document.querySelector("#mapCurationCaption");
  const curationMeta = document.querySelector("#mapCurationMeta");
  const curationTitle = document.querySelector("#mapCurationTitle");
  const curationDesc = document.querySelector("#mapCurationDesc");
  const curationLive = document.querySelector("#mapCurationLive");
  const curationDownload = document.querySelector("#mapCurationDownload");
  const curationMapView = document.querySelector("#mapCurationMapView");
  const busStopLegend = document.querySelector("#mapBusStopLegend");
  const zoomControls = document.querySelector(".map-zoom-controls");
  const costFilterToggle = document.querySelector("#mapCostFilterToggle");
  const costFilterPanel = document.querySelector("#mapCostFilterPanel");
  const costFilterClose = document.querySelector("#mapCostFilterClose");
  const costFilterApply = document.querySelector("#mapCostFilterApply");
  const regionToggle = document.querySelector("#mapRegionToggle");
  const regionPanel = document.querySelector("#mapRegionPanel");
  const regionClose = document.querySelector("#mapRegionClose");
  const budgetActive = document.querySelector("#mapBudgetActive");
  const periodActive = document.querySelector("#mapPeriodActive");
  const workspacePage = document.querySelector(".map-workspace-page");
  const mobileListToggle = document.querySelector("#mapMobileListToggle");
  const mobileListToggleLabel = document.querySelector("#mapMobileListToggleLabel");
  const curationMobileToggle = document.querySelector("#mapCurationMobileToggle");
  const favBar = document.querySelector("#mapFavBar");
  const favCountEl = document.querySelector("#mapFavCount");
  const favPanel = document.querySelector("#mapFavPanel");
  const favPanelCount = document.querySelector("#mapFavPanelCount");
  const favListEl = document.querySelector("#mapFavList");
  const favTotalEl = document.querySelector("#mapFavTotal");
  const favCta = document.querySelector("#mapFavCta");
  const favDownload = document.querySelector("#mapFavDownload");
  const favPdf = document.querySelector("#mapFavPdf");
  const favReco = document.querySelector("#mapFavReco");
  const favClose = document.querySelector("#mapFavClose");
  const mobileLayoutQuery = window.matchMedia("(max-width: 700px)");

  const FAVORITES_KEY = "goplay:favorites";
  let favorites = (() => {
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"); } catch (error) { return []; }
  })();

  function saveFavorites() {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); } catch (error) { /* ignore */ }
  }
  function isFavorite(slug) {
    return favorites.includes(slug);
  }
  // 비교표에서 '상담 대상' 체크를 해제한 관심매체 id 집합.
  // 비파괴적 제외 — 매체는 표에 남고(흐려짐), 월 합계·상담신청에서만 빠진다. 다시 체크하면 복귀.
  const favExcluded = new Set();
  function toggleFavorite(slug) {
    const index = favorites.indexOf(slug);
    if (index >= 0) { favorites.splice(index, 1); favExcluded.delete(slug); } // 완전 삭제 시 제외 상태도 정리
    else favorites.push(slug);
    saveFavorites();
    updateFavoritesUI();
    if (favPanel && !favPanel.hidden) renderFavPanel();
  }
  function topScoreLabel(insight) {
    const scores = (insight && insight.scores) || [];
    if (!scores.length) return "-";
    const top = scores.slice().sort((a, b) => (b.value || 0) - (a.value || 0))[0];
    return top ? `${top.label} ★${top.value}` : "-";
  }
  // 비고(지역) — 주소의 '구'를 우선, 없으면 매체명/상권으로 폴백
  function regionLabel(item) {
    const addr = item.address || (item.mapLocation && item.mapLocation.sourceAddress) || "";
    const m = addr.match(/([가-힣]{1,3})구(?![가-힣])/);
    if (m) return m[1].length >= 2 ? m[1] : m[1] + "구";
    const text = (item.name || "") + " " + addr;
    if (/서울역|KTX/i.test(text)) return "서울역";
    if (/전국|수도권|지방|생활권/i.test(text)) return "전국";
    return (item.areaName || "-").split(/[\s·/]/)[0];
  }
  // 1일 송출(초수·횟수) — media.json playSpec 우선, 없으면 유형별 기본값
  function playSpecLabel(item) {
    if (item.playSpec) return item.playSpec;
    const t = (item.category || "") + " " + (item.mediaType || "");
    if (/지하철|subway/i.test(t)) return "1일 다회 롤링";
    if (/버스|bus/i.test(t)) return "1일 다회 롤링";
    if (/엘리베이터|elevator|생활/i.test(t)) return "10초 · 상시 롤링";
    if (/DID|쇼핑|9to9/i.test(t)) return "상시 롤링";
    return "20초 · 1일 100회";
  }
  // 비용 표기 "월 1,200만원" → "1,200만원/월"
  function perMonthPrice(label) {
    return /만원$/.test(label || "") ? String(label).replace(/^월\s*/, "") + "/월" : (label || "-");
  }
  // 승하차 등 "856.1만명" → "856만명" (소수점 제거, 만명 단위 통일)
  function roundMan(label) {
    return String(label == null ? "-" : label).replace(/\.\d+(?=\s*만)/, "");
  }
  // "7.9만명"·"856.1만명"·"8.6만대" → 79000 / 8561000 / 86000 (원단위 숫자)
  // 비교표·엑셀에서 계산·편집이 가능하도록 축약 표기를 실제 수치로 되돌린다. 값이 없으면 null.
  function parseManNumber(label) {
    const s = String(label == null ? "" : label).trim();
    if (!s || s === "-") return null;
    const m = s.match(/([\d,]+(?:\.\d+)?)\s*(억|만)?/);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (!isFinite(n)) return null;
    const mult = m[2] === "억" ? 100000000 : m[2] === "만" ? 10000 : 1;
    return Math.round(n * mult);
  }
  // 숫자 → "12,000,000" (표에 그대로 노출). 없으면 "-"
  function numCell(n) {
    return n == null ? "-" : Number(n).toLocaleString("ko-KR");
  }
  // 유형 — 카테고리 제목 기반, '광고'·'대형' 등 수식 제거(전광판/지하철/버스…)
  function typeLabel(item) {
    const map = { large_billboard: "전광판", shopping_mall_did: "쇼핑몰 DID", subway: "지하철", bus: "버스", transport_hub: "철도·터미널", daily_touchpoint: "생활밀착형", package: "패키지", other: "기타" };
    if (map[item.category]) return map[item.category];
    return (AdPlay.categoryLabels[item.category] || item.mediaType || "-").replace(/\s*광고$/, "").replace(/^대형\s*/, "");
  }
  function favoriteItems() {
    return favorites.map((favId) => {
      if (typeof favId === "string" && favId.indexOf("bus:") === 0) {
        const stop = (busStops || []).find((s) => String(s.id) === favId.slice(4));
        if (!stop) return null;
        const p = stop.adProduct || {};
        return {
          favId,
          name: p.stationName || stop.name,
          image: null,
          price: p.monthlyCostLabel || formatBusWon(p.minMonthlyCost) || "비용 문의",
          priceMonthly: perMonthPrice(p.monthlyCostLabel || formatBusWon(p.minMonthlyCost) || "비용 문의"),
          monthly: Number(p.minMonthlyCost) || 0,
          size: p.outerSize || p.innerSize || "-",
          resolution: "-",
          area: [p.district, p.dong].filter(Boolean).join(" ") || "-",
          type: "버스 정류장",
          reach: p.ridershipLabel || "-",
          target: "-",
          topSpot: "-",
          region: (p.district || "").replace(/구$/, "") || "-",
          playSpec: "1일 다회 롤링",
          address: [p.district, p.dong, p.stationName].filter(Boolean).join(" ") || "-",
          audience: "-",
          operationHours: p.operationHours || "-",
          foot500: "-",
          subway: "-",
          bus: roundMan(p.ridershipLabel || "-"),
          // 비교표·엑셀용 원단위 숫자(축약 표기 파싱 전 원본 기준)
          foot500Num: null,
          subwayNum: null,
          busNum: parseManNumber(p.ridershipLabel),
          note: "-",
          isBus: true,
        };
      }
      if (/^(townboard|fmk|gsa|officebiz|primeliving|asa)-\d+$/.test(favId)) {
        return elevatorFavItem(favId);
      }
      const item = mediaWithLocations.find((m) => m.slug === favId);
      if (!item) return null;
      const insight = locationInsight(item);
      return {
        favId,
        name: item.name,
        image: cardImages(item)[0],
        price: mapCardPriceLabel(item),
        priceMonthly: perMonthPrice(mapCardPriceLabel(item)),
        monthly: AdPlay.minMonthlyPrice(item) || 0,
        size: sizeLabel(item),
        resolution: (item.mapLocation && item.mapLocation.resolution) || item.resolutionPx || "확인 필요",
        area: item.areaName || "-",
        type: typeLabel(item),
        reach: (cardReachLabel(item) || "").replace("일 유동인구 ", "") || "-",
        target: (insight.stats && insight.stats.target) || "-",
        topSpot: topScoreLabel(insight),
        region: regionLabel(item),
        playSpec: playSpecLabel(item),
        address: item.address || "",
        audience: detailAudience(item) || "-",
        operationHours: (item.mapLocation && item.mapLocation.operationHours) || item.operationHours || "-",
        foot500: (insight.stats && insight.stats.daily500) || "-",
        subway: roundMan((insight.stats && insight.stats.subway) || "-"),
        bus: roundMan((insight.stats && insight.stats.bus) || "-"),
        // 비교표·엑셀용 원단위 숫자 — roundMan 은 소수점을 버리므로 반드시 원본 stats 를 파싱한다
        foot500Num: parseManNumber(insight.stats && insight.stats.daily500),
        subwayNum: parseManNumber(insight.stats && insight.stats.subway),
        busNum: parseManNumber(insight.stats && insight.stats.bus),
        note: item.note || "-",
        isBus: false,
      };
    }).filter(Boolean);
  }
  // 관심 도크/비교 패널용 — 엘리베이터 사이트(id: townboard-0 형식)를 매체 항목 형태로 변환
  function elevatorFavItem(favId) {
    const netId = favId.replace(/-\d+$/, "");
    const arr = elevatorSites[netId];
    if (!arr) return null;
    const site = arr.find((s) => s.id === favId);
    if (!site) return null;
    const net = elevatorNetworks.find((n) => n.id === netId) || {};
    const isPackage = net.saleUnit === "package";
    const period = ELEV_PRICE_PERIOD[netId] || "월";
    const monthly = isPackage ? 0 : (site.monthlyCost || 0);
    const priceLabel = isPackage ? `${site.district ? site.district + " " : ""}패키지` : (monthly ? `${period} ${monthly.toLocaleString("ko-KR")}원` : "가격 상담");
    return {
      favId,
      name: String(site.name).replace(/_[LS]$/, ""),
      image: null,
      price: priceLabel,
      priceMonthly: monthly || null,
      monthly,
      size: site.monitorSize || "-",
      resolution: "-",
      area: [site.sido, site.district].filter(Boolean).join(" ") || "-",
      type: `${net.vendor || "매체사"} · ${net.type === "apartment" ? "아파트" : "오피스"} 엘리베이터`,
      reach: site.households ? `${site.households.toLocaleString("ko-KR")}세대` : "-",
      target: net.target || "-",
      topSpot: "-",
      region: site.sido || "-",
      playSpec: ELEV_BROADCAST[netId] || "1일 롤링",
      address: site.address || "-",
      audience: "-",
      operationHours: "-",
      foot500: "-", subway: "-", bus: "-",
      foot500Num: null, subwayNum: null, busNum: null,
      note: isPackage ? "패키지 전용" : "-",
      isBus: false,
      isElevator: true,
    };
  }
  function favStarButton(favId, name, variant) {
    const on = isFavorite(favId);
    const label = "관심";
    return `<button type="button" class="${variant}${on ? " is-active" : ""}" data-fav-toggle="${AdPlay.esc(favId)}" aria-pressed="${on}" aria-label="${AdPlay.esc(name)} 관심매체 ${on ? "제거" : "담기"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg><span>${label}</span></button>`;
  }

  function favHeartButton(item, variant) {
    return favStarButton(item.slug, item.name, variant);
  }
  function updateFavoritesUI() {
    const count = favorites.length;
    document.querySelectorAll("[data-fav-trigger]").forEach((el) => { el.hidden = count === 0; });
    document.querySelectorAll("[data-fav-count]").forEach((el) => { el.textContent = String(count); });
    document.querySelectorAll(".gps-svc .bn[data-fav-count]").forEach((el) => { el.hidden = count === 0; });
    document.querySelectorAll("[data-fav-toggle]").forEach((button) => {
      const on = isFavorite(button.dataset.favToggle);
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-pressed", String(on));
    });
  }
  function renderFavPanel() {
    const items = favoriteItems();
    if (favPanelCount) favPanelCount.textContent = String(items.length);
    if (!favListEl) return;
    if (!items.length) {
      favListEl.innerHTML = `<p class="map-fav-empty">아직 담은 관심매체가 없습니다.<br>매체·버스정류장의 "★ 관심" 버튼으로 담아 비교해 보세요.</p>`;
      if (favTotalEl) favTotalEl.textContent = "-";
      if (favCta) { favCta.setAttribute("aria-disabled", "true"); favCta.removeAttribute("href"); }
      if (favReco) favReco.hidden = true;
      return;
    }
    const compareRows = [
      { label: "유형", value: (fav) => fav.type },
      { label: "1일 보장횟수", className: "is-playspec", html: true, value: (fav) => AdPlay.esc(fav.playSpec).replace(/\s*·\s*/g, "<br>") },
      // 수치는 축약("1,200만원/월"·"7.9만명") 대신 원단위 숫자로 노출 — 엑셀로 받아 바로 계산·편집 가능.
      // 단위는 값마다 반복하지 않고 열 제목에 한 번만 표기한다.
      { label: "비용(원/월, 부가세 별도)", className: "is-price", value: (fav) => numCell(fav.monthly || null) },
      { label: "운영시간", value: (fav) => fav.operationHours },
      // 숫자 3열을 붙여 비교하기 쉽게 두고, 긴 텍스트인 '주 방문층'은 '비고' 왼쪽으로 모은다
      { label: "일평균 유동(명)", className: "is-numl", value: (fav) => numCell(fav.foot500Num) },
      { label: "지하철 승하차(월평균, 명)", className: "is-numl", value: (fav) => numCell(fav.subwayNum) },
      { label: "버스 승하차(월평균, 명)", className: "is-numl", value: (fav) => numCell(fav.busNum) },
      { label: "주 방문층", className: "is-audience", value: (fav) => fav.audience },
      { label: "비고", value: (fav) => fav.note },
    ];
    const thumb = (fav) => fav.image
      ? `<img src="${AdPlay.esc(fav.image)}" alt="" loading="lazy">`
      : `<span class="map-fav-busimg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10M4 16h16M4 16v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-2M20 16v2a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2M6 8h12M7 12h.01M17 12h.01"/></svg></span>`;
    favListEl.innerHTML = `
      <div class="map-fav-compare map-fav-compare--rows">
        <table>
          <thead>
            <tr>
              <th class="map-fav-no-h">상담</th>
              <th class="map-fav-compare-corner">매체</th>
              ${compareRows.map((row) => `<th class="${row.className || ""}">${AdPlay.esc(row.label)}</th>`).join("")}
              <th class="map-fav-remove-col" aria-label="삭제"></th>
            </tr>
          </thead>
          <tbody>
            ${items.map((fav, i) => `
              <tr class="${favExcluded.has(fav.favId) ? "is-excluded" : ""}">
                <td class="map-fav-no-cell"><input type="checkbox" class="map-fav-incl" data-fav-incl="${AdPlay.esc(fav.favId)}"${favExcluded.has(fav.favId) ? "" : " checked"} aria-label="${AdPlay.esc(fav.name)} 상담 대상 포함"></td>
                <th class="map-fav-rowhead"><span class="map-fav-media-cell">${thumb(fav)}<span class="map-fav-media-info"><b>${AdPlay.esc(fav.name)}</b><span class="map-fav-media-addr">${AdPlay.esc(fav.address)}</span><span class="map-fav-media-tags">${[fav.size, /\d\s*[x×]\s*\d/.test(fav.resolution) ? fav.resolution + "px" : fav.resolution].filter((v) => v && v !== "-" && v !== "확인 필요").map((v) => `<span>${AdPlay.esc(v)}</span>`).join("")}</span></span></span></th>
                ${compareRows.map((row) => `<td class="${row.className || ""}">${row.html ? row.value(fav) : AdPlay.esc(row.value(fav))}</td>`).join("")}
                <td class="map-fav-remove-cell"><button type="button" class="map-fav-remove" data-fav-remove="${AdPlay.esc(fav.favId)}" aria-label="${AdPlay.esc(fav.name)} 관심매체에서 제거">×</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
    recalcFavConsult();
    if (favReco) {
      const reco = favRecommendation(items);
      favReco.innerHTML = reco ? `<strong>추<br>천</strong><span class="map-fav-reco-body">${AdPlay.esc(reco)}</span>` : "";
      favReco.hidden = !reco;
    }
    fitFavTitles();
  }
  // 상담 대상(체크된 매체)만으로 월 합계·상담 링크·CTA 라벨을 갱신. 체크박스 토글 시 표 전체를 다시 그리지 않고
  // 이것만 호출해 가로 스크롤 위치를 지킨다. renderFavPanel 초기 렌더에서도 재사용.
  function recalcFavConsult() {
    const items = favoriteItems();
    const included = items.filter((fav) => !favExcluded.has(fav.favId));
    const total = included.reduce((sum, fav) => sum + (fav.monthly || 0), 0);
    // 제목 옆 숫자 = 상담 대상(체크된) 수 — CTA·합계와 같은 기준. 제외하면 함께 줄어든다.
    if (favPanelCount) favPanelCount.textContent = String(included.length);
    if (favTotalEl) favTotalEl.textContent = included.length ? (total ? `월 ${AdPlay.formatKRW(total)}~` : "상담 필요") : "-";
    if (favCta) {
      const label = favCta.querySelector("span");
      if (included.length) {
        favCta.setAttribute("href", `estimate.html?intent=bundle&media=${included.map((fav) => encodeURIComponent(fav.favId)).join(",")}`);
        favCta.removeAttribute("aria-disabled");
        if (label) label.textContent = `${included.length}개 매체로 상담신청`;
      } else {
        favCta.setAttribute("aria-disabled", "true");
        favCta.removeAttribute("href");
        if (label) label.textContent = "상담 대상을 선택하세요";
      }
    }
  }
  // 담은 매체 기준 자동 추천 요약 — 도달(일평균 유동) 최고 · 비용 효율(월 비용) 최저 매체를 짚고 묶음 제안
  function favRecommendation(items) {
    if (!items || items.length < 2) return "";
    const num = (s) => { const m = String(s == null ? "" : s).match(/[\d.]+/); return m ? parseFloat(m[0]) : NaN; };
    const reachList = items.filter((f) => !isNaN(num(f.foot500)));
    const costList = items.filter((f) => f.monthly > 0);
    const bestReach = reachList.length ? reachList.slice().sort((a, b) => num(b.foot500) - num(a.foot500))[0] : null;
    const cheapest = costList.length ? costList.slice().sort((a, b) => a.monthly - b.monthly)[0] : null;
    let lead;
    if (bestReach && cheapest && bestReach.favId === cheapest.favId) lead = `‘${bestReach.name}’가 도달·비용 모두 우세합니다.`;
    else if (bestReach && cheapest) lead = `도달은 ‘${bestReach.name}’, 비용 효율은 ‘${cheapest.name}’가 우세합니다.`;
    else if (bestReach) lead = `도달은 ‘${bestReach.name}’가 우세합니다.`;
    else if (cheapest) lead = `비용 효율은 ‘${cheapest.name}’가 우세합니다.`;
    else return "";
    return `${lead} 담은 ${items.length}종을 묶으면 도달·비용 균형과 집행 협상력을 함께 높일 수 있습니다.`;
  }
  // 매체명 한 줄 넘어가면 폰트 자동 축소(줄바꿈 방지)
  function fitFavTitles() {
    if (!favListEl) return;
    favListEl.querySelectorAll(".map-fav-media-info b").forEach((el) => {
      el.style.fontSize = "";
      let size = parseFloat(getComputedStyle(el).fontSize);
      let guard = 0;
      while (el.scrollWidth > el.clientWidth + 1 && size > 9.5 && guard < 24) {
        size -= 0.5;
        el.style.fontSize = size + "px";
        guard++;
      }
    });
  }
  // 화면 표와 같은 열 순서·단위 표기를 유지. headers 와 rows 는 짝이 맞아야 함.
  // 수치는 문자열이 아니라 '숫자'로 내보내야 엑셀에서 정렬·합계·편집이 된다(빈 값은 "-" 대신 null).
  // 주소 앞머리의 시·도를 짧은 이름으로. 엑셀에서 큰 단위(서울/부산…)로 먼저 묶어 보기 위함.
  function sidoShort(addr) {
    const first = String(addr || "").trim().split(/\s+/)[0] || "";
    const table = {
      "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천",
      "광주광역시": "광주", "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종",
      "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원",
      "충청북도": "충북", "충청남도": "충남", "전라북도": "전북", "전북특별자치도": "전북",
      "전라남도": "전남", "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주", "제주도": "제주",
    };
    if (table[first]) return table[first];
    for (const k in table) if (first.indexOf(k.slice(0, 2)) === 0) return table[k]; // 표기 변형 폴백
    return "";
  }
  // 지역 = 시/도(서울·부산·대구…)만. 구/군은 넣지 않는다(주소 칸에 이미 들어감).
  const FAV_EXPORT_HEADERS = ["지역", "매체명", "주소", "규격", "해상도(px)", "유형", "1일 보장횟수", "비용(원/월, 부가세 별도)", "운영시간", "일평균 유동(명)", "지하철 승하차(월평균, 명)", "버스 승하차(월평균, 명)", "주 방문층", "비고"];
  const favExportRow = (f) => [sidoShort(f.address), f.name, f.address, f.size, f.resolution, f.type, f.playSpec,
    f.monthly || null, f.operationHours, f.foot500Num, f.subwayNum, f.busNum, f.audience, f.note];
  const FAV_NUMERIC_COLS = [7, 9, 10, 11]; // 비용·일평균 유동·지하철·버스 (0-based)

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // xlsx 는 ZIP+XML 구조라 직접 만들면 파일이 깨지기 쉬움 → 검증된 SheetJS 를
  // '다운로드를 누른 시점'에만 지연 로드(평소 페이지 로딩에 부담 주지 않음).
  function loadXlsxLib() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("XLSX 로드 실패")));
      s.onerror = () => reject(new Error("XLSX 스크립트 요청 실패"));
      document.head.appendChild(s);
    });
  }

  function downloadFavCsvFallback(items) {
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const csv = "﻿" + [FAV_EXPORT_HEADERS].concat(items.map(favExportRow))
      .map((r) => r.map(esc).join(",")).join("\r\n");
    saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "관심매체_비교.csv");
  }

  // 한장제안서: 선택한 매체를 one-pager.html 로 넘겨 A4 가로 1장씩 렌더 → 브라우저 인쇄로 PDF 저장.
  // 버스정류장(bus:###)은 media.json 에 없어 한장제안서를 만들 수 없으므로 제외한다.
  function openFavOnePager() {
    // 상담 대상으로 체크된 매체만. (버스정류장은 media.json 에 없어 제안서 양식이 없으므로 별도 제외)
    const slugs = favorites.filter((id) => typeof id === "string" && id.indexOf("bus:") !== 0 && !favExcluded.has(id));
    if (!slugs.length) {
      window.alert("한장제안서를 만들 수 있는 매체가 없습니다.\n(상담 대상 체크 + 버스정류장 외 매체가 있어야 합니다.)");
      return;
    }
    window.open(`one-pager.html?slugs=${encodeURIComponent(slugs.join(","))}`, "_blank", "noopener");
  }

  async function downloadFavExcel() {
    // 상담 대상으로 체크된 매체만 내보낸다(제외한 매체는 제외).
    const items = favoriteItems().filter((f) => !favExcluded.has(f.favId));
    if (!items.length) { window.alert("상담 대상으로 체크된 관심매체가 없습니다."); return; }
    try {
      const XLSX = await loadXlsxLib();
      const aoa = [FAV_EXPORT_HEADERS].concat(items.map(favExportRow));
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // 열 폭 — 기본값이면 주소·주 방문층 같은 긴 값이 잘려 보임 (지역=시/도 한 칸)
      ws["!cols"] = [8, 22, 34, 14, 14, 12, 16, 20, 14, 16, 18, 17, 26, 24].map((w) => ({ wch: w }));
      // 수치 열에 천단위 표시 형식 지정 — 값 자체는 숫자라 계산·정렬이 그대로 된다
      FAV_NUMERIC_COLS.forEach((c) => {
        for (let rowIdx = 1; rowIdx < aoa.length; rowIdx++) {
          const ref = XLSX.utils.encode_cell({ r: rowIdx, c });
          const cell = ws[ref];
          if (cell && typeof cell.v === "number") cell.z = "#,##0";
        }
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "관심매체 비교");
      XLSX.writeFile(wb, "관심매체_비교.xlsx");
    } catch (error) {
      // 오프라인·CDN 차단 등으로 라이브러리를 못 받으면 최소한 CSV 로라도 받게 함
      console.warn("xlsx 생성 실패 → CSV 로 대체", error);
      downloadFavCsvFallback(items);
    }
  }
  function openFavPanel() {
    if (!favPanel) return;
    renderFavPanel();
    favPanel.hidden = false;
    requestAnimationFrame(fitFavTitles);
    if (workspacePage) workspacePage.classList.add("is-fav-open");
  }
  function closeFavPanel() {
    if (!favPanel) return;
    favPanel.hidden = true;
    if (workspacePage) workspacePage.classList.remove("is-fav-open");
  }

  // Representative centres for the regions this platform covers, so a region
  // search (e.g. 광화문) recenters the map even when no media match it.
  // Naver geocoding is address-only and misses most place/station names.
  const PLACE_CENTERS = [
    { keys: ["광화문", "gwanghwamun", "종로", "시청", "세종대로", "광화문역"], lat: 37.5725, lng: 126.9769, zoom: 15 },
    { keys: ["여의도", "yeouido", "여의도역", "국회의사당"], lat: 37.5283, lng: 126.9294, zoom: 15 },
    { keys: ["홍대", "hongdae", "홍대입구", "합정", "상수", "홍익대"], lat: 37.5571, lng: 126.9245, zoom: 15 },
    { keys: ["성수", "seongsu", "성수동", "성수역", "서울숲"], lat: 37.5446, lng: 127.0559, zoom: 15 },
    { keys: ["잠실", "jamsil", "송파", "롯데월드", "잠실역"], lat: 37.5133, lng: 127.1000, zoom: 14 },
    { keys: ["서울역", "seoul-station", "서울역광장", "남영", "회현"], lat: 37.5547, lng: 126.9707, zoom: 15 },
    { keys: ["마포", "공덕", "mapo", "아현", "공덕역", "마포역"], lat: 37.5443, lng: 126.9514, zoom: 14 },
    { keys: ["명동", "을지로", "myeongdong", "euljiro", "명동역", "을지로입구"], lat: 37.5637, lng: 126.9838, zoom: 15 },
    { keys: ["도산대로", "dosan", "압구정", "청담", "신사", "압구정로데오"], lat: 37.5232, lng: 127.0386, zoom: 14 },
    { keys: ["삼성", "코엑스", "samseong", "coex", "무역센터", "삼성역", "선릉"], lat: 37.5089, lng: 127.0631, zoom: 15 },
    { keys: ["강남", "gangnam", "강남역", "강남대로", "역삼", "교대"], lat: 37.4979, lng: 127.0276, zoom: 14 },
  ];

  function lookupPlaceCenter(rawQuery) {
    const q = (rawQuery || "").trim().toLowerCase();
    if (q.length < 2) return null;
    return PLACE_CENTERS.find((place) =>
      place.keys.some((key) => {
        const k = key.toLowerCase();
        return q.includes(k) || k.includes(q);
      })
    ) || null;
  }

  function centerOnGeocode(query) {
    if (!query || !naverMap || !(window.naver && naver.maps.Service && naver.maps.Service.geocode)) return;
    naver.maps.Service.geocode({ query }, (status, response) => {
      if (status !== naver.maps.Service.Status.OK) return;
      const address = response.v2 && response.v2.addresses && response.v2.addresses[0];
      if (!address) return;
      naverMap.setCenter(new naver.maps.LatLng(Number(address.y), Number(address.x)));
      naverMap.setZoom(15);
    });
  }

  const categoryTabs = [
    { value: "all", label: "옥외광고 전체", summaryLabel: "전체 옥외광고" },
    // 라벨에서 반복되던 접미사 "광고" 제거 — 칩 라벨은 정적 HTML에 없고 JS 가 렌더해서
    // Yeti·GPTBot·ClaudeBot 등 JS 미실행 크롤러는 본 적이 없다(SEO 손실 0).
    // "전광판 광고"·"옥외광고" 키워드는 이미 title·h1·description·og·schema 에 있고,
    // media-catalog.html 표기(대형 전광판/지하철/버스·쉘터/쇼핑몰 DID)와도 오히려 일치한다.
    { value: "large_billboard", label: "전광판·빌보드", categories: ["large_billboard", "package"] },
    // 교통·이동 묶음(지하철·공항·버스·차량) — 인접 배치로 스캔·키워드 군집
    { value: "subway", label: "지하철", categories: ["subway"] },
    { value: "transport_hub", label: "공항·터미널·기차", categories: ["transport_hub"] },
    { value: "bus", label: "버스 정류장", categories: ["bus"] },
    // 차량 래핑(버스 래핑·택시 등) — 매체는 추후 등록. 지금은 0건이라 alwaysShow 로 버튼만 유지.
    { value: "vehicle", label: "차량 래핑", categories: ["vehicle"], alwaysShow: true },
    { value: "shopping_mall_did", label: "쇼핑·문화시설", categories: ["shopping_mall_did"] },
    // 엘리베이터 = 회사 최대 자산(1만+ 지점). 기타 바로 왼쪽에 배치.
    { value: "daily_touchpoint", label: "엘리베이터", categories: ["daily_touchpoint"], alwaysShow: true },
    // 기타 — 리조트·카페·학교·마트 등 애매한 매체용. 매체는 추후 등록, 지금은 버튼만.
    { value: "other", label: "기타", categories: ["other"], alwaysShow: true },
    // (아래) 예전에 제거한 탭 2개 — 실측으로 다른 탭과 완전히 중복이었다(어떤 매체도 접근 불가가 되지 않음):
    //  · "이동매체 광고"(transport_hub+bus) = 공항·터미널·기차(27) + 버스(18) 를 그대로 합친 것.
    //    게다가 버스 정류장 탭은 실제 정류장 데이터로 2,176개를 보여주는데 여기 버스는 18개뿐이라 숫자도 어긋났다.
    //  · "기타 옥외 광고"(daily_touchpoint+shopping_mall_did) = daily_touchpoint 가 0건이라
    //    쇼핑·문화시설(65)과 결과가 100% 동일했다("기타"를 눌러도 쇼핑·문화시설이 그대로 나옴).
  ];

  const curationItems = [
    {
      id: "landmark",
      mediaSlug: "sinsa-h-station",
      title: "브랜드 랜드마크 전광판",
      label: "랜드마크 전광판",
      meta: "도시의 시선이 머무는 곳",
      desc: "강남·도심 핵심 상권에서 브랜드 런칭과 대형 캠페인을 빠르게 각인시키는 대표 매체 조합입니다.",
      image: "assets/images/map-samples/gangnam-wide.jpg",
      tag: "매체 종류",
    },
    {
      id: "genz",
      mediaSlug: "samseong-kpop-square-package",
      title: "2030 집중 캠퍼스 미디어",
      label: "MZ 타깃 집행 사례",
      meta: "콘텐츠 반응과 방문 동선 중심",
      desc: "쇼핑, 공연, 팝업, K-콘텐츠 동선이 겹치는 지역을 묶어 젊은 방문객에게 반복 노출합니다.",
      image: "assets/images/map-samples/cheonggye-close.jpg",
      tag: "집행 사례",
    },
    {
      id: "daily",
      mediaSlug: "daily-apartment-elevator-tv",
      title: "생활밀착 미디어 보드",
      label: "생활권 반복 노출",
      meta: "아파트·오피스·편의점 접점",
      desc: "짧은 접촉을 자주 만드는 생활권 매체로 프로모션, 지역 타깃, 앱 설치 캠페인에 적합합니다.",
      image: "assets/images/map-samples/gwanghwamun-wide.jpg",
      tag: "매체 종류",
    },
    {
      id: "mobility",
      mediaSlug: "transport-seoul-station-ktx-panorama",
      title: "일상 동선 커버 교통매체",
      label: "이동형·교통 매체",
      meta: "출퇴근과 이동 동선 커버",
      desc: "역사, 터미널, 정류장 등 이동 전후 접점에서 반복적으로 메시지를 노출합니다.",
      image: "assets/images/map-samples/gwanghwamun-close.jpg",
      tag: "매체 종류",
    },
    {
      id: "indoor",
      mediaSlug: "samseong-kpop-square-package",
      title: "체험 자극 쇼핑·문화시설 미디어",
      label: "체류형 실내 매체",
      meta: "구매 고려가 일어나는 공간",
      desc: "쇼핑몰, 영화관, 광장처럼 체류 시간이 긴 공간에서 브랜드 선호와 구매 전환을 보조합니다.",
      image: "assets/images/map-samples/cheonggye-wide.jpg",
      tag: "매체 종류",
    },
    {
      id: "hot",
      mediaSlug: "sinsa-syh-tower",
      title: "초대형·타임싱크 패키지",
      label: "시즌 집중 패키지",
      meta: "이벤트 일정에 맞춘 단기 집행",
      desc: "1개월 미만 집행이 가능한 매체를 중심으로 행사 기간에 맞춰 빠르게 노출합니다.",
      image: "assets/images/map-samples/gangnam-close.jpg",
      tag: "집행 사례",
    },
    {
      id: "wide-coverage",
      mediaSlug: "gangnam-wide-coverage-package",
      title: "비용효율 와이드커버리지",
      label: "다지역 가로형 패키지",
      meta: "10곳·20곳 단위의 넓은 커버",
      desc: "구형 가로형 매체를 여러 거점에 묶어 예산 부담은 낮추고 반복 노출 범위는 넓히는 패키지입니다.",
      image: "assets/images/map-samples/gangnam-wide.jpg",
      tag: "집행 사례",
    },
    {
      id: "truck",
      mediaSlug: "mobile-truck-national-package",
      title: "전국 이동 트럭래핑",
      isNew: true,
      label: "전국 이동형 광고",
      meta: "지역과 시간대에 맞춘 이동 노출",
      desc: "행사장, 상권, 출퇴근 동선 등 원하는 지역과 시간대에 맞춰 전국 단위로 움직이며 노출하는 이동형 광고입니다.",
      image: "assets/images/map-samples/gwanghwamun-close.jpg",
      tag: "매체 종류",
    },
    {
      id: "medical",
      mediaSlug: "medical-clinic-board-package",
      title: "병의원 메디컬 보드",
      isNew: true,
      label: "의료 업종 특화 보드",
      meta: "병의원·약국 생활권 접점",
      desc: "병의원, 약국, 건강관리 동선에 가까운 생활권 접점에서 의료·헬스케어 메시지를 반복 노출하는 보드형 매체입니다.",
      image: "assets/images/map-samples/cheonggye-wide.jpg",
      tag: "매체 종류",
    },
  ];

  const regionTargets = {
    nationwide: { latitude: 36.45, longitude: 127.9, zoom: 7 },
    capital: { latitude: 37.55, longitude: 126.98, zoom: 10 },
    seoul: { latitude: 37.5665, longitude: 126.978, zoom: 11 },
    gangbuk: { latitude: 37.6396, longitude: 127.0257, zoom: 12 },
    gangnam: { latitude: 37.4979, longitude: 127.0276, zoom: 12 },
    gangdong: { latitude: 37.5301, longitude: 127.1238, zoom: 12 },
    gangseo: { latitude: 37.5509, longitude: 126.8495, zoom: 12 },
    sejong: { latitude: 36.4801, longitude: 127.289, zoom: 12 },
    daejeon: { latitude: 36.3504, longitude: 127.3845, zoom: 12 },
    gwangju: { latitude: 35.1595, longitude: 126.8526, zoom: 12 },
    daegu: { latitude: 35.8714, longitude: 128.6014, zoom: 12 },
    busan: { latitude: 35.1796, longitude: 129.0756, zoom: 12 },
    ulsan: { latitude: 35.5384, longitude: 129.3114, zoom: 12 },
    changwon: { latitude: 35.2279, longitude: 128.6811, zoom: 12 },
    jeju: { latitude: 33.4996, longitude: 126.5312, zoom: 11 },
  };

  // ?only=<category> — 광고주 시연용 '단일 카테고리' 모드: 해당 카테고리만 표시하고 카테고리 탭을 숨긴다.
  const onlyCategory = new URLSearchParams(window.location.search).get("only") || "";
  if (onlyCategory) document.documentElement.classList.add("map-only-mode");
  let activeCategory = onlyCategory || new URLSearchParams(window.location.search).get("category") || "all";
  let selectedMediaSlug = new URLSearchParams(window.location.search).get("media") || "";
  let detailOpen = Boolean(selectedMediaSlug);
  // 상세를 열면 기본은 '상세만' 표시(목록 숨김) — 지도 보이는 영역을 최대로.
  // 목록 맥락이 필요하면 상세 헤더의 ☰ 버튼으로 목록을 함께 펼친다(선택은 유지됨).
  let panelsExpanded = false;
  let activeBudget = "all";
  let pendingBudget = "all";
  let activePeriod = "all";
  let pendingPeriod = "all";
  let naverMap = null;
  let naverMarkers = [];
  let mediaCluster = null; // 매체 마커 클러스터링 인스턴스
  let naverBusMarkers = [];
  let busStopIdleListener = null;
  let currentItems = [];
  let selectedBusStopId = "";
  // 엘리베이터 광고 — 상품(네트워크) 단위 리스트 카드 + 실제 지오코딩 핀
  const elevatorNetworks = (elevatorData && elevatorData.networks) || [];
  const elevatorSites = elevatorSitesData || {};
  let elevatorType = "apartment"; // apartment | office (좌측 리스트 세그먼트)
  let selectedNetworkId = "";
  let selectedComplexId = ""; // 단지별 카드/핀 선택(포커스)
  let townboardTier = "all"; // 타운보드 3차 토글: all | tv(25인치) | board(50·55인치)
  let elevatorMarkers = [];
  // 관심매체는 전 매체 공통 저장소(goplay:favorites)로 통합 — favStarButton(site.id, ...) 사용
  // 상품별 대표 샘플 사진(첨부 사진으로 교체 예정). 없으면 onerror로 대체 이미지.
  const ELEV_IMAGES = {
    townboard: ["assets/images/elevator/elevator-apt-1.jpg", "assets/images/elevator/elevator-apt-2.jpg"],
    fmk: ["assets/images/elevator/elevator-apt-2.jpg", "assets/images/elevator/elevator-apt-1.jpg"],
    gsa: ["assets/images/elevator/elevator-apt-1.jpg", "assets/images/elevator/elevator-apt-2.jpg"],
    officebiz: ["assets/images/elevator/elevator-office-1.jpg", "assets/images/elevator/elevator-office-2.jpg"],
    asa: ["assets/images/elevator/elevator-office-2.jpg", "assets/images/elevator/elevator-office-1.jpg"],
  };
  const ELEV_IMAGE_FALLBACK = "assets/images/map-samples/gangnam-wide.jpg";
  // 상품별 송출 보장(제품 고정값)
  const ELEV_BROADCAST = { townboard: "15초 · 1일 100회" };
  // 가격 기간 단위 — 원본 열이 다름(월 환산 금지). FMK는 '4주 금액'이 실제 청구 단위.
  const ELEV_PRICE_PERIOD = { townboard: "월", fmk: "4주", gsa: "월", officebiz: "월" };
  // 상품 상세페이지 — 요약 줄에서 실제 <a>로 연결(내부링크 = SEO 크롤 경로)
  const ELEV_DETAIL_PAGE = {
    townboard: "elevator-townboard.html",
    fmk: "elevator-focus.html",
    gsa: "elevator-mediamid.html",
    officebiz: "elevator-officebiz.html",
    primeliving: "elevator-prime-living.html",
    asa: "elevator-prime-office.html",
  };
  // 첫/기본 화면: 서울 전역 1000m 스케일(줌13). 중심은 용산구청.
  const DEFAULT_VIEW = { latitude: 37.5324, longitude: 126.9908, zoom: 13 };
  // 기본/리셋 뷰 적용 — 용산구청을 중심에 두되, 좌측 목록(430px)이 지도 왼쪽을 '오버레이'로 가리므로
  // 데스크톱에선 목록폭 절반만큼 서쪽으로 밀어 용산구청이 '보이는 영역(목록 오른쪽)'의 중앙에 오게 한다.
  function applyDefaultView() {
    if (!naverMap || !window.naver || !naver.maps) return;
    naverMap.setCenter(new naver.maps.LatLng(DEFAULT_VIEW.latitude, DEFAULT_VIEW.longitude));
    naverMap.setZoom(DEFAULT_VIEW.zoom);
    if (!mobileLayoutQuery.matches && typeof naverMap.panBy === "function") {
      const rail = document.querySelector(".map-sidebar");
      const w = rail ? rail.getBoundingClientRect().width : 0;
      if (w > 4) naverMap.panBy(new naver.maps.Point(-Math.round(w / 2), 0)); // 서쪽으로 밀어 용산구청을 우측 가시영역 중앙에
    }
  }
  const BUS_STOP_CLUSTER_MAX_ZOOM = 13;
  // 목록/마커에서 매체를 선택했을 때 지도를 이 줌까지 확대해 해당 매체 위치를 보여줌
  // (18 = 축척 약 20m — 건물 단위로 매체 위치가 또렷하게 보이는 수준)
  const DETAIL_FOCUS_ZOOM = 18;

  function setCurationPanel(isOpen) {
    if (!curationPanel) return;
    curationPanel.hidden = !isOpen;
    if (workspacePage) workspacePage.classList.toggle("is-curation-open", isOpen);
    if (!curationToggle) return;
    curationToggle.setAttribute("aria-expanded", String(isOpen));
    curationToggle.classList.toggle("is-active", isOpen);
  }

  const mediaWithLocations = media.map((item) => ({
    ...item,
    mapLocation: locations[item.slug] || null,
  })).filter(hasLatLng);

  renderCategoryTabs();
  renderCuration();
  render();

  if (searchForm) {
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      selectedMediaSlug = "";
      detailOpen = false;
      render();
      const q = (searchInput && searchInput.value ? searchInput.value : "").trim();
      if (q && currentItems.length === 0 && !lookupPlaceCenter(q)) {
        centerOnGeocode(q);
      }
    });
  }
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      selectedMediaSlug = "";
      detailOpen = false;
      render();
    });
  }
  if (curationClose && curationPanel) {
    curationClose.addEventListener("click", () => {
      setCurationPanel(false);
    });
  }
  if (curationToggle && curationPanel) {
    curationToggle.addEventListener("click", () => {
      const willOpen = curationPanel.hidden;
      setCurationPanel(willOpen);
      if (willOpen) {
        closeRegionPanel();
        closeCostPanel();
      }
    });
  }

  function setMobileListOpen(open) {
    if (!workspacePage) return;
    workspacePage.classList.toggle("is-list-open", open);
    if (mobileListToggle) mobileListToggle.setAttribute("aria-expanded", String(open));
    if (mobileListToggleLabel) mobileListToggleLabel.textContent = open ? "지도 보기" : "목록 보기";
  }

  if (mobileListToggle) {
    mobileListToggle.addEventListener("click", () => {
      setMobileListOpen(!workspacePage.classList.contains("is-list-open"));
    });
  }

  if (curationMobileToggle) {
    curationMobileToggle.addEventListener("click", () => {
      setMobileListOpen(false);
      setCurationPanel(true);
    });
  }

  // On mobile the curation panel is opt-in via the floating trigger,
  // so it should not cover the map on load.
  if (mobileLayoutQuery.matches) {
    setCurationPanel(false);
  }

  document.querySelectorAll("[data-fav-trigger]").forEach((el) => el.addEventListener("click", openFavPanel));
  document.addEventListener("gps:open-favorites", openFavPanel); // 서비스 도크 "관심매체 비교" → 실제 통합 패널 열기
  // 패널 가장자리 화살표(map-rail-toggle.js)가 상세 열린 상태에서 누르면 → 목록 함께 펼치기/접기
  document.addEventListener("gp:toggle-list-panel", () => {
    panelsExpanded = !panelsExpanded;
    syncPanelMode();
  });
  if (favClose) favClose.addEventListener("click", closeFavPanel);
  if (favDownload) favDownload.addEventListener("click", downloadFavExcel);
  if (favPdf) favPdf.addEventListener("click", openFavOnePager);
  if (favPanel) favPanel.addEventListener("click", (event) => {
    if (event.target === favPanel) closeFavPanel();
  });
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-fav-toggle]");
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(toggle.dataset.favToggle);
      return;
    }
    const remove = event.target.closest("[data-fav-remove]");
    if (remove) {
      event.preventDefault();
      toggleFavorite(remove.dataset.favRemove);
    }
  });
  // 상담 대상 체크박스 — 해제 시 그 행을 흐리게(is-excluded) + 합계·상담에서 제외. 다시 체크하면 복귀.
  document.addEventListener("change", (event) => {
    const incl = event.target.closest("[data-fav-incl]");
    if (!incl) return;
    const id = incl.dataset.favIncl;
    if (incl.checked) favExcluded.delete(id); else favExcluded.add(id);
    const row = incl.closest("tr");
    if (row) row.classList.toggle("is-excluded", !incl.checked);
    recalcFavConsult();
  });
  updateFavoritesUI();
  if (costFilterToggle && costFilterPanel) {
    costFilterToggle.addEventListener("click", () => {
      const willOpen = costFilterPanel.hidden;
      costFilterPanel.hidden = !willOpen;
      costFilterToggle.setAttribute("aria-expanded", String(willOpen));
      if (willOpen) closeRegionPanel();
      syncCostFilterButtons();
    });
  }
  if (costFilterClose && costFilterPanel) {
    costFilterClose.addEventListener("click", () => {
      costFilterPanel.hidden = true;
      if (costFilterToggle) costFilterToggle.setAttribute("aria-expanded", "false");
    });
  }
  if (costFilterPanel) {
    costFilterPanel.querySelectorAll("[data-budget-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        pendingBudget = button.dataset.budgetFilter || "all";
        syncCostFilterButtons();
      });
    });
    costFilterPanel.querySelectorAll("[data-period-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        pendingPeriod = button.dataset.periodFilter || "all";
        syncCostFilterButtons();
      });
    });
  }
  if (costFilterApply) {
    costFilterApply.addEventListener("click", () => {
      activeBudget = pendingBudget;
      activePeriod = pendingPeriod;
      selectedMediaSlug = "";
      detailOpen = false;
      if (costFilterPanel) costFilterPanel.hidden = true;
      if (costFilterToggle) costFilterToggle.setAttribute("aria-expanded", "false");
      render();
    });
  }
  if (regionToggle && regionPanel) {
    regionToggle.addEventListener("click", () => {
      const willOpen = regionPanel.hidden;
      regionPanel.hidden = !willOpen;
      regionToggle.setAttribute("aria-expanded", String(willOpen));
      if (willOpen) closeCostPanel();
    });
  }
  if (regionClose) {
    regionClose.addEventListener("click", closeRegionPanel);
  }
  if (regionPanel) {
    regionPanel.querySelectorAll("[data-region-target]").forEach((button) => {
      button.addEventListener("click", () => {
        moveToRegion(button.dataset.regionTarget);
        closeRegionPanel();
      });
    });
  }
  if (curationMapView) {
    curationMapView.addEventListener("click", () => {
      const slug = curationMapView.dataset.mediaSlug;
      if (slug) {
        setCurationPanel(false);
        openDetail(slug, true, true);
      }
    });
  }
  if (zoomControls) {
    const [zoomIn, zoomOut] = zoomControls.querySelectorAll("button");
    if (zoomIn) zoomIn.addEventListener("click", () => naverMap && naverMap.setZoom(naverMap.getZoom() + 1));
    if (zoomOut) zoomOut.addEventListener("click", () => naverMap && naverMap.setZoom(naverMap.getZoom() - 1));
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !detailOpen) return;
    detailOpen = false;
    syncPanelMode();
    focusSelectedCard();
  });
  function renderCategoryTabs() {
    const available = new Set(mediaWithLocations.map((item) => item.category));
    categoryBar.innerHTML = categoryTabs
      .filter((tab) => tab.value === "all" || tab.alwaysShow || (tab.categories || [tab.value]).some((category) => available.has(category)))
      .map(({ value, label }) => `
        <button type="button" class="map-category-pill${activeCategory === value ? " is-active" : ""}" data-map-category="${AdPlay.esc(value)}" aria-pressed="${activeCategory === value ? "true" : "false"}">
          ${AdPlay.esc(label)}
        </button>
      `).join("");

    categoryBar.querySelectorAll("[data-map-category]").forEach((button) => {
      button.addEventListener("click", () => {
        activeCategory = button.dataset.mapCategory;
        selectedMediaSlug = "";
        selectedNetworkId = "";
        selectedComplexId = "";
        detailOpen = false;
        render();
      });
    });
  }

  function renderCuration(activeId = "landmark") {
    if (!curationList) return;
    curationList.innerHTML = curationItems.map((item) => `
      <button type="button" class="${item.id === activeId ? "is-active" : ""}" data-curation-id="${AdPlay.esc(item.id)}">
        <strong><span>${AdPlay.esc(item.title)}</span>${item.isNew ? `<sup class="map-curation-new">NEW!</sup>` : ""}</strong>
      </button>
    `).join("");

    curationList.querySelectorAll("[data-curation-id]").forEach((button) => {
      button.addEventListener("click", () => updateCuration(button.dataset.curationId || "landmark"));
    });
    updateCuration(activeId, false);
  }

  function updateCuration(id, updateActive = true) {
    const item = curationItems.find((entry) => entry.id === id) || curationItems[0];
    if (!item) return;
    if (updateActive && curationList) {
      curationList.querySelectorAll("[data-curation-id]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.curationId === item.id);
      });
    }
    if (curationImage && curationImage.tagName === "IMG") curationImage.src = item.image;
    if (curationCaption) curationCaption.textContent = item.title;
    if (curationMeta) curationMeta.textContent = item.meta;
    if (curationTitle) curationTitle.textContent = item.label;
    if (curationDesc) curationDesc.textContent = item.desc;
    if (curationLive) curationLive.href = `estimate.html?intent=live-talk&media=${encodeURIComponent(item.mediaSlug)}`;
    if (curationDownload) curationDownload.href = "assets/downloads/goplay-media-introduction.html";
    if (curationMapView) curationMapView.dataset.mediaSlug = item.mediaSlug;
  }

  function render(options = {}) {
    if (activeCategory === "daily_touchpoint" && elevatorNetworks.length) {
      renderElevator(options);
      return;
    }
    const query = (searchInput && searchInput.value ? searchInput.value : "").trim().toLowerCase();
    const activeTab = categoryTabs.find((tab) => tab.value === activeCategory) || categoryTabs[0];
    const activeCategories = activeTab.categories || [activeTab.value];
    const filtered = mediaWithLocations
      .filter((item) => activeCategory === "all" || activeCategories.includes(item.category))
      .filter(matchesCostPeriod);
    const searched = filtered.filter((item) => {
      if (!query) return true;
      const location = item.mapLocation || {};
      const haystack = [
        item.name,
        item.areaName,
        item.mediaType,
        item.address,
        location.sourceName,
        location.sourceAddress,
        ...(item.tags || []),
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
    const busListStops = activeCategory === "bus" ? filteredBusAdStops(query) : [];
    currentItems = searched;

    if (selectedMediaSlug && !searched.some((item) => item.slug === selectedMediaSlug)) {
      selectedMediaSlug = "";
      detailOpen = false;
    }
    if (!selectedMediaSlug && searched.length) selectedMediaSlug = searched[0].slug;

    const resultCount = activeCategory === "bus" ? busListStops.length : searched.length;
    const countText = `${resultCount.toLocaleString("ko-KR")}개`;
    countRoot.textContent = countText;
    if (summaryRoot) {
      const category = categoryTabs.find((tab) => tab.value === activeCategory) || categoryTabs[0];
      const categoryLabel = category.summaryLabel || category.label;
      const queryText = query ? `, "${query}" 검색 결과` : "";
      const filterText = costPeriodSummary();
      summaryRoot.innerHTML = `<span class="sr-only">지도 표시 지역에 <strong id="mapResultCount">${countText}</strong>의 ${AdPlay.esc(categoryLabel)} 매체가 있습니다${AdPlay.esc(queryText)}.${filterText ? ` ${AdPlay.esc(filterText)}.` : ""}</span>`;
    }
    updateCostFilterLabels();
    if (busStopLegend) {
      const showBusLegend = activeCategory === "bus";
      busStopLegend.hidden = !showBusLegend;
      busStopLegend.classList.toggle("is-visible", showBusLegend);
    }
    renderCategoryTabs();
    renderStage(searched, options.preserveView);
    if (!options.preserveView && query && resultCount === 0) {
      const place = lookupPlaceCenter(query);
      if (place && naverMap) {
        naverMap.setCenter(new naver.maps.LatLng(place.lat, place.lng));
        naverMap.setZoom(place.zoom || 14);
      }
    }
    renderList(searched, busListStops);
    renderDetail(selectedItem(searched));
    syncPanelMode();
  }

  function renderStage(items, preserveView = false) {
    if (!window.naver || !window.naver.maps) {
      stage.innerHTML = `
        <div class="map-load-error">
          <strong>네이버 지도를 불러오지 못했습니다.</strong>
          <span>네이버 클라우드 앱의 Web 서비스 URL에 현재 도메인이 등록되어 있는지 확인해 주세요.</span>
        </div>
      `;
      return;
    }

    try {
      stage.classList.add("has-naver-map");
      if (!naverMap) {
        stage.innerHTML = "";
        naverMap = new naver.maps.Map(stage, {
          center: new naver.maps.LatLng(DEFAULT_VIEW.latitude, DEFAULT_VIEW.longitude),
          zoom: DEFAULT_VIEW.zoom,
          minZoom: 8,
          mapTypeControl: false,
          zoomControl: false,
        });
        busStopIdleListener = naver.maps.Event.addListener(naverMap, "idle", () => {
          if (activeCategory === "bus") syncBusStopLayer();
          else if (activeCategory === "daily_touchpoint") syncElevatorLayer();
        });
      }

      if (mediaCluster) { mediaCluster.setMap(null); mediaCluster = null; }
      naverMarkers.forEach((marker) => marker.setMap(null));
      naverMarkers = [];
      if (typeof clearElevatorLayer === "function") clearElevatorLayer();
      if (!items.length) {
        clearBusStopLayer();
        return;
      }

      const bounds = new naver.maps.LatLngBounds();
      items.forEach((item) => {
        const latlng = new naver.maps.LatLng(item.mapLocation.latitude, item.mapLocation.longitude);
        bounds.extend(latlng);
        const marker = new naver.maps.Marker({
          position: latlng,
          title: item.name,
          icon: {
            content: markerContent(item),
            size: new naver.maps.Size(42, 48),
            anchor: new naver.maps.Point(21, 42),
          },
        });
        naver.maps.Event.addListener(marker, "click", () => openDetail(item.slug, true, true));
        naverMarkers.push(marker);
      });

      if (!preserveView) {
        const query = (searchInput && searchInput.value ? searchInput.value : "").trim();
        if (!query) {
          // 옥외광고 전체 및 모든 카테고리 탭: 첫 화면 스케일 동일(용산구청 중심·서울 1000m)
          applyDefaultView();
        } else if (items.length === 1) {
          const item = items[0];
          naverMap.setCenter(new naver.maps.LatLng(item.mapLocation.latitude, item.mapLocation.longitude));
          naverMap.setZoom(15);
        } else {
          naverMap.fitBounds(bounds, { top: 76, right: 76, bottom: 76, left: 76 });
        }
      }

      // 매체 마커 클러스터링 — 가까운 매체를 +N으로 묶고 확대 시 개별 핀으로 분리
      if (typeof MarkerClustering === "function") {
        // 묶음 아이콘: 사진핀과 동일한 크기(단일), 강조 블루
        // 묶음 아이콘: 채운 원 + 숫자. 개수가 많을수록 '크고 진하게'(연보라→네이비) 5단계.
        // 크기·색이 밀집도를, 숫자가 정확한 개수를 보조로 말한다. 앵커는 원 중심(반지름).
        const clusterIcons = [
          { content: `<div class="map-cluster map-cluster--s"></div>`,   size: new naver.maps.Size(30, 30), anchor: new naver.maps.Point(15, 15) },
          { content: `<div class="map-cluster map-cluster--m"></div>`,   size: new naver.maps.Size(38, 38), anchor: new naver.maps.Point(19, 19) },
          { content: `<div class="map-cluster map-cluster--l"></div>`,   size: new naver.maps.Size(46, 46), anchor: new naver.maps.Point(23, 23) },
          { content: `<div class="map-cluster map-cluster--xl"></div>`,  size: new naver.maps.Size(54, 54), anchor: new naver.maps.Point(27, 27) },
          { content: `<div class="map-cluster map-cluster--xxl"></div>`, size: new naver.maps.Size(62, 62), anchor: new naver.maps.Point(31, 31) },
        ];
        mediaCluster = new MarkerClustering({
          map: naverMap,
          markers: naverMarkers,
          minClusterSize: 5, // 5개 미만 무리는 묶지 않고 개별 사진핀으로 표시(작은 +2·+3 클러스터 제거)
          maxZoom: 16, // 줌16(100m)에서만 묶음 완전 해제. 300m·500m·1000m는 묶음 유지
          gridSize: 90, // 묶는 반경(px)
          disableClickZoom: false,
          icons: clusterIcons,
          indexGenerator: [10, 30, 100, 500], // <10=s · 10~29=m · 30~99=l · 100~499=xl · 500+=xxl (icons 5단계와 대응)
          stylingFunction: (clusterMarker, count) => {
            const el = clusterMarker.getElement();
            const target = el.querySelector("div:first-child") || el;
            target.textContent = count;
            el.setAttribute("aria-label", count + "개 매체 묶음");
          },
        });
      } else {
        // 라이브러리 미로드 시: 개별 마커라도 표시(폴백)
        naverMarkers.forEach((marker) => marker.setMap(naverMap));
      }

      if (activeCategory === "bus") {
        syncBusStopLayer();
      } else {
        clearBusStopLayer();
      }
    } catch (error) {
      console.error("Naver map failed to initialize.", error);
    }
  }

  function clearBusStopLayer() {
    naverBusMarkers.forEach((marker) => marker.setMap(null));
    naverBusMarkers = [];
  }

  // ── 엘리베이터 광고 — 상품 카드 리스트 + 실제 지오코딩 핀 ───────────────
  function elevatorFmt(n) {
    if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "")}만`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}천`;
    return String(n);
  }

  function elevatorReachLabel(net) {
    if (net.households) return `세대 ${elevatorFmt(net.households)} 도달`;
    if (net.population) return net.type === "office" ? `입주 ${elevatorFmt(net.population)}명 규모` : `인구 ${elevatorFmt(net.population)} 도달`;
    return net.topRegion ? `${net.topRegion} ${net.topRegionShare}% 집중` : "";
  }

  function elevatorPriceLabel(net) {
    if (!net.prices || !net.prices.length) return "단가 상담";
    const lo = Math.min(...net.prices).toLocaleString("ko-KR");
    const hi = Math.max(...net.prices).toLocaleString("ko-KR");
    return lo === hi ? `대당 월 ${lo}원` : `대당 월 ${lo}~${hi}원`;
  }

  function elevatorImages(net) {
    return ELEV_IMAGES[net.id] || [ELEV_IMAGE_FALLBACK, ELEV_IMAGE_FALLBACK];
  }


  function elevatorNetworksByType() {
    return elevatorNetworks.filter((net) => net.type === elevatorType);
  }

  function renderElevator(options = {}) {
    renderCategoryTabs();
    if (busStopLegend) { busStopLegend.hidden = true; busStopLegend.classList.remove("is-visible"); }
    detailOpen = false;
    if (summaryRoot) {
      const sites = elevatorSitesForType();
      summaryRoot.innerHTML = `<span class="sr-only">${elevatorType === "apartment" ? "아파트" : "오피스"} 엘리베이터 광고, 지오코딩된 단지 ${sites.length.toLocaleString("ko-KR")}곳</span>`;
    }
    updateCostFilterLabels();
    renderElevatorList(elevatorComplexesForView()); // 리스트는 지도와 독립적으로 항상 렌더
    try { renderElevatorStage(options.preserveView); } catch (error) { console.warn("elevator map skipped", error); }
    syncPanelMode();
  }

  // 시도 접두어를 떼어 구·동 위주로 간결 표기
  function elevatorComplexAddr(site) {
    const stripped = String(site.address || "").replace(/^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)\s*/, "").trim();
    return stripped || site.address || "주소 확인 필요";
  }

  function elevWon(value) {
    if (!value) return "";
    if (value >= 10000) {
      const man = value / 10000;
      return `${Number.isInteger(man) ? man : man.toFixed(1)}만원`;
    }
    return `${value.toLocaleString("ko-KR")}원`;
  }

  function isTownboardTv(site) { return /^25/.test(site.monitorSize || ""); }

  function elevatorSitesForType() {
    const out = [];
    elevatorNetworksByType()
      .filter((net) => !selectedNetworkId || net.id === selectedNetworkId)
      .forEach((net) => {
        (elevatorSites[net.id] || []).forEach((site) => {
          if (Number.isFinite(site.lat) && Number.isFinite(site.lng)) {
            out.push({ ...site, networkId: net.id, brand: net.brand, vendor: net.vendor, placement: net.placement, type: net.type, saleUnit: net.saleUnit || "site" });
          }
        });
      });
    // 타운보드 3차 토글(TV 25인치 / 게시판 50·55인치)
    if (selectedNetworkId === "townboard" && townboardTier !== "all") {
      return out.filter((site) => (townboardTier === "tv" ? isTownboardTv(site) : !isTownboardTv(site)));
    }
    return out;
  }

  // 상품 단가 범위 — 원본 unitPrice에서 실측(네트워크 prices가 비어있는 상품이 있어서)
  function elevatorUnitRange(netId) {
    const prices = (elevatorSites[netId] || []).map((s) => s.unitPrice).filter((v) => v > 0);
    if (!prices.length) return null;
    return { lo: Math.min(...prices), hi: Math.max(...prices) };
  }

  function elevatorTierCounts() {
    const sites = elevatorSites.townboard || [];
    return {
      tv: sites.filter(isTownboardTv).length,
      board: sites.filter((s) => s.monitorSize && !isTownboardTv(s)).length,
    };
  }

  function elevatorComplexesForView() {
    const sites = elevatorSitesForType();
    let list = sites;
    if (naverMap && window.naver && window.naver.maps && activeCategory === "daily_touchpoint") {
      const bounds = naverMap.getBounds();
      if (bounds) {
        const sw = bounds.getSW();
        const ne = bounds.getNE();
        const inView = sites.filter((s) => s.lat >= sw.lat() && s.lat <= ne.lat() && s.lng >= sw.lng() && s.lng <= ne.lng());
        list = inView.length ? inView : sites;
      }
    }
    list = list.slice().sort((a, b) => (b.monitors || 0) - (a.monitors || 0));
    if (selectedComplexId) {
      const sel = list.find((s) => s.id === selectedComplexId);
      if (sel) list = [sel, ...list.filter((s) => s.id !== selectedComplexId)];
    }
    return list.slice(0, 120);
  }

  function elevatorComplexCard(site) {
    const isSel = selectedComplexId === site.id;
    const gubun = site.gubun || (site.type === "office" ? "오피스" : "아파트");
    const isPackage = site.saleUnit === "package";
    const monthly = site.monthlyCost || site.price || 0;
    const period = ELEV_PRICE_PERIOD[site.networkId] || "월";
    const vendorCode = site.vendor || site.brand;
    // 세대·입주년도·평형 한 줄(칩 대신). 평형 다종은 "평형 N종".
    const pyeongVals = String(site.pyeong || "").split(",").map((v) => v.trim()).filter(Boolean);
    const meta = [];
    if (site.households) meta.push(`${site.households.toLocaleString("ko-KR")}세대`);
    else if (site.tenants) meta.push(`입주사 ${site.tenants.toLocaleString("ko-KR")}`);
    if (site.year) meta.push(`${site.year}년`);
    if (pyeongVals.length) meta.push(pyeongVals.length > 1 ? `평형 ${pyeongVals.length}종` : `평형 ${pyeongVals[0]}`);
    if (site.floors) meta.push(site.floors);
    const metaLine = meta.join(" · ");
    // 설치 위치: 타운보드는 모니터크기 판별, 그 외는 networks.placement
    const install = site.networkId === "townboard"
      ? (/^25/.test(site.monitorSize || "") ? "엘리베이터 내부 TV" : "대기공간 게시판")
      : (site.placement || "");
    // 계산식 + 비용을 한 줄로: "50″ 257대 × 10,000원 = 월 2,570,000원 (VAT 별도)"
    const sizeShort = (String(site.monitorSize || "").match(/(\d+(?:\.\d+)?)/) || [])[1];
    let calc;
    if (isPackage) {
      calc = `${(site.monitors || 0).toLocaleString("ko-KR")}대 · ${site.district ? AdPlay.esc(site.district) + " " : ""}패키지 <small>개별 판매 없음</small>`;
    } else if (site.unitPrice && site.monitors) {
      calc = `${sizeShort ? `${sizeShort}″ ` : ""}${site.monitors.toLocaleString("ko-KR")}대 × ${site.unitPrice.toLocaleString("ko-KR")}원 = <b>${period} ${monthly.toLocaleString("ko-KR")}원</b> <small>VAT 별도</small>`;
    } else {
      calc = monthly ? `<b>${period} ${monthly.toLocaleString("ko-KR")}원</b> <small>VAT 별도</small>` : "가격 상담";
    }
    const detailPage = ELEV_DETAIL_PAGE[site.networkId] || "elevator.html";
    const detailLabel = isPackage ? "패키지 보기" : "상세보기";
    return `
      <article class="map-elev-complex${isSel ? " is-active" : ""}">
        <button type="button" data-elev-complex="${AdPlay.esc(site.id)}" aria-label="${AdPlay.esc(site.name)} 지도에서 보기" aria-current="${isSel ? "true" : "false"}"></button>
        <div class="map-elev-complex-head">
          <h3><span class="map-elev-gubun">${AdPlay.esc(gubun)}</span>${AdPlay.esc(String(site.name).replace(/_[LS]$/, ""))}</h3>
          <div class="map-elev-head-right">
            <span class="map-elev-vendor">${AdPlay.esc(vendorCode)}</span>
            ${favStarButton(site.id, site.name, "map-card-fav")}
          </div>
        </div>
        <p class="map-elev-complex-addr">${AdPlay.esc(site.address || "주소 확인 필요")}</p>
        ${(metaLine || install) ? `<div class="map-elev-complex-meta">
          <span>${AdPlay.esc(metaLine)}</span>
          ${install ? `<span class="map-elev-install">${AdPlay.esc(install)}</span>` : ""}
        </div>` : ""}
        <p class="map-elev-calc${isPackage ? " is-package" : ""}">${calc}</p>
        <div class="map-elev-complex-foot">
          <a class="map-elev-detail-link" href="${AdPlay.esc(detailPage)}">${detailLabel} ›</a>
        </div>
      </article>`;
  }

  function renderElevatorList(complexes) {
    const total = elevatorSitesForType().length;
    const isApt = elevatorType === "apartment";
    const pkgPage = isApt ? "elevator-apartment.html" : "elevator-office.html";
    const pkgLabel = isApt ? "아파트 패키지 상품 보기" : "오피스 패키지 상품 보기";
    listRoot.innerHTML = `
      <div class="map-elev-seg" role="tablist" aria-label="엘리베이터 광고 장소">
        <button type="button" role="tab" data-elev-type="apartment" aria-selected="${isApt}" class="${isApt ? "is-active" : ""}">아파트</button>
        <button type="button" role="tab" data-elev-type="office" aria-selected="${!isApt}" class="${!isApt ? "is-active" : ""}">오피스</button>
      </div>
      <a class="map-elev-pkg-link" href="${AdPlay.esc(pkgPage)}">${AdPlay.esc(pkgLabel)} <span aria-hidden="true">→</span></a>
      <p class="map-elev-cards-cap">이 화면 <b>${complexes.length.toLocaleString("ko-KR")}</b>곳 <span>· 지도 이동 시 갱신</span></p>
      <div class="map-elev-complex-list">${
        complexes.length
          ? complexes.map(elevatorComplexCard).join("")
          : `<div class="empty">이 지역에 표시할 매체가 없습니다. 지도를 이동하거나 축소해 보세요.</div>`
      }</div>`;

    listRoot.querySelectorAll("[data-elev-type]").forEach((button) => {
      button.addEventListener("click", () => {
        if (elevatorType === button.dataset.elevType) return;
        elevatorType = button.dataset.elevType;
        selectedNetworkId = "";
        townboardTier = "all";
        selectedComplexId = "";
        render({ preserveView: true });
      });
    });
    listRoot.querySelectorAll("[data-elev-complex]").forEach((button) => {
      button.addEventListener("click", () => focusComplex(button.dataset.elevComplex));
    });
  }

  function focusComplex(id) {
    const site = elevatorSitesForType().find((s) => s.id === id);
    if (!site) return;
    selectedComplexId = id;
    if (naverMap && window.naver && window.naver.maps) {
      naverMap.setCenter(new naver.maps.LatLng(site.lat, site.lng));
      if (naverMap.getZoom() <= BUS_STOP_CLUSTER_MAX_ZOOM) naverMap.setZoom(BUS_STOP_CLUSTER_MAX_ZOOM + 2);
      syncElevatorLayer();
    } else {
      renderElevatorList(elevatorComplexesForView());
    }
    if (mobileLayoutQuery.matches) setMobileListOpen(true);
  }

  function clearElevatorLayer() {
    elevatorMarkers.forEach((marker) => marker.setMap(null));
    elevatorMarkers = [];
  }

  function ensureNaverMap() {
    if (naverMap || !window.naver || !window.naver.maps) return;
    stage.classList.add("has-naver-map");
    stage.innerHTML = "";
    naverMap = new naver.maps.Map(stage, {
      center: new naver.maps.LatLng(DEFAULT_VIEW.latitude, DEFAULT_VIEW.longitude),
      zoom: DEFAULT_VIEW.zoom,
      minZoom: 8,
      mapTypeControl: false,
      zoomControl: false,
    });
    busStopIdleListener = naver.maps.Event.addListener(naverMap, "idle", () => {
      if (activeCategory === "bus") syncBusStopLayer();
      else if (activeCategory === "daily_touchpoint") syncElevatorLayer();
    });
  }

  function elevatorClusterGroups(sites) {
    const grouped = new Map();
    sites.forEach((site) => {
      const key = String(site.district || site.sido || "기타"); // 구/군/시 단위 클러스터(버스와 동일)
      const group = grouped.get(key) || { name: key, count: 0, lat: 0, lng: 0 };
      group.count += 1;
      group.lat += site.lat;
      group.lng += site.lng;
      grouped.set(key, group);
    });
    return [...grouped.values()]
      .map((group) => {
        const size = Math.max(34, Math.min(72, 28 + Math.sqrt(group.count) * 4.8));
        return { ...group, lat: group.lat / group.count, lng: group.lng / group.count, size };
      })
      .sort((a, b) => b.count - a.count);
  }

  function elevatorClusterContent(group) {
    return `
      <button type="button" class="bus-stop-cluster" style="--cluster-size: ${group.size}px" aria-label="${AdPlay.esc(group.name)} 엘리베이터 광고 ${group.count.toLocaleString("ko-KR")}개 보기">
        <span>${AdPlay.esc(group.name)}</span>
        <strong>${group.count.toLocaleString("ko-KR")}</strong>
      </button>`;
  }

  function elevatorPinContent(site) {
    const office = site.type === "office";
    const active = selectedComplexId === site.id ? " is-active" : "";
    return `
      <span class="bus-stop-pin ${office ? "is-elev-office" : "is-elev-apt"}${active}" role="img" aria-label="${AdPlay.esc(site.vendor || "")} · ${AdPlay.esc(site.name)}">
        <span class="bus-stop-pin-core"></span>
      </span>`;
  }

  // 버스 정류장 광고와 동일 노출: 낮은 줌=구역 클러스터, 높은 줌=개별 핀, 지도 이동마다 재동기화 + 리스트 갱신
  function syncElevatorLayer() {
    if (!naverMap || !window.naver || !window.naver.maps || activeCategory !== "daily_touchpoint") {
      clearElevatorLayer();
      return;
    }
    try {
    clearElevatorLayer();
    const sites = elevatorSitesForType();
    const zoom = typeof naverMap.getZoom === "function" ? naverMap.getZoom() : 12;

    if (zoom <= BUS_STOP_CLUSTER_MAX_ZOOM) {
      elevatorClusterGroups(sites).forEach((group) => {
        const marker = new naver.maps.Marker({
          map: naverMap,
          position: new naver.maps.LatLng(group.lat, group.lng),
          title: `${group.name} 엘리베이터 광고 ${group.count.toLocaleString("ko-KR")}개`,
          icon: {
            content: elevatorClusterContent(group),
            size: new naver.maps.Size(group.size, group.size),
            anchor: new naver.maps.Point(group.size / 2, group.size / 2),
          },
        });
        naver.maps.Event.addListener(marker, "click", () => {
          naverMap.setCenter(new naver.maps.LatLng(group.lat, group.lng));
          naverMap.setZoom(Math.max(naverMap.getZoom() + 2, BUS_STOP_CLUSTER_MAX_ZOOM + 1));
        });
        elevatorMarkers.push(marker);
      });
    } else {
      const bounds = naverMap.getBounds();
      const sw = bounds ? bounds.getSW() : null;
      const ne = bounds ? bounds.getNE() : null;
      sites
        .filter((site) => !sw || (site.lat >= sw.lat() && site.lat <= ne.lat() && site.lng >= sw.lng() && site.lng <= ne.lng()))
        .slice(0, 650)
        .forEach((site) => {
          const marker = new naver.maps.Marker({
            map: naverMap,
            position: new naver.maps.LatLng(site.lat, site.lng),
            title: `${site.vendor || ""} · ${site.name}`,
            icon: {
              content: elevatorPinContent(site),
              size: new naver.maps.Size(26, 26),
              anchor: new naver.maps.Point(13, 15),
            },
          });
          naver.maps.Event.addListener(marker, "click", () => focusComplex(site.id));
          elevatorMarkers.push(marker);
        });
    }
    } catch (error) { console.warn("elevator markers skipped", error); }
    renderElevatorList(elevatorComplexesForView());
  }

  function renderElevatorStage(preserveView) {
    if (window.naver && window.naver.maps) {
      ensureNaverMap();
      if (naverMap) {
        if (mediaCluster) { mediaCluster.setMap(null); mediaCluster = null; }
        naverMarkers.forEach((marker) => marker.setMap(null));
        naverMarkers = [];
        clearBusStopLayer();
        // 첫 진입 화면은 '옥외광고 전체'와 동일하게 용산구청 중심 기본 뷰로 고정
        if (!preserveView) {
          applyDefaultView();
        }
        syncElevatorLayer();
        return;
      }
    }
    // 네이버 지도 미로드: 리스트만 렌더
    renderElevatorList(elevatorComplexesForView());
  }

  function syncBusStopLayer() {
    if (!naverMap || !window.naver || !window.naver.maps || activeCategory !== "bus") {
      clearBusStopLayer();
      return;
    }
    const bounds = naverMap.getBounds();
    if (!bounds) return;
    clearBusStopLayer();

    const query = busStopSearchQuery();
    const allStops = filteredBusAdStops(query);
    const zoom = typeof naverMap.getZoom === "function" ? naverMap.getZoom() : 12;
    if (zoom <= BUS_STOP_CLUSTER_MAX_ZOOM) {
      renderBusStopClusters(allStops);
      renderBusStopList(busStopsForCurrentMapView(query));
      return;
    }

    const stopIdSet = new Set(allStops.map((entry) => String(entry.id)));
    const visibleStops = visibleBusStops(bounds)
      .filter((stop) => stop.adProduct)
      .filter(matchesBusStopCostPeriod)
      .filter((stop) => stopIdSet.has(String(stop.id)))
      .slice(0, 650);
    visibleStops.forEach((stop) => {
      const position = busStopPosition(stop);
      const latlng = new naver.maps.LatLng(position.latitude, position.longitude);
      const marker = new naver.maps.Marker({
        map: naverMap,
        position: latlng,
        title: busStopTitle(stop),
        icon: {
          content: busStopMarkerContent(stop),
          size: new naver.maps.Size(26, 26),
          anchor: new naver.maps.Point(13, 15),
        },
      });
      naver.maps.Event.addListener(marker, "click", () => focusBusStop(stop.id));
      naverBusMarkers.push(marker);
    });
    renderBusStopList(busStopsForCurrentMapView(query));
  }

  function renderBusStopClusters(stops) {
    const groups = busStopClusterGroups(stops);
    groups.forEach((group) => {
      const marker = new naver.maps.Marker({
        map: naverMap,
        position: new naver.maps.LatLng(group.latitude, group.longitude),
        title: `${group.district} 버스 정류장 광고 ${group.count.toLocaleString("ko-KR")}개`,
        icon: {
          content: busStopClusterContent(group),
          size: new naver.maps.Size(group.size, group.size),
          anchor: new naver.maps.Point(group.size / 2, group.size / 2),
        },
      });
      naver.maps.Event.addListener(marker, "click", () => {
        naverMap.setCenter(new naver.maps.LatLng(group.latitude, group.longitude));
        naverMap.setZoom(Math.max(naverMap.getZoom() + 2, BUS_STOP_CLUSTER_MAX_ZOOM + 1));
      });
      naverBusMarkers.push(marker);
    });
  }

  function busStopClusterGroups(stops) {
    const grouped = new Map();
    stops.forEach((stop) => {
      const position = busStopPosition(stop);
      if (!Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) return;
      const product = stop.adProduct || {};
      const district = product.district || stop.district || "기타";
      const key = String(district);
      const group = grouped.get(key) || { district: key, count: 0, latitude: 0, longitude: 0 };
      group.count += 1;
      group.latitude += position.latitude;
      group.longitude += position.longitude;
      grouped.set(key, group);
    });
    return [...grouped.values()]
      .map((group) => {
        const size = Math.max(34, Math.min(72, 28 + Math.sqrt(group.count) * 4.8));
        return {
          ...group,
          latitude: group.latitude / group.count,
          longitude: group.longitude / group.count,
          size,
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  function busStopClusterContent(group) {
    return `
      <button type="button" class="bus-stop-cluster" style="--cluster-size: ${group.size}px" aria-label="${AdPlay.esc(group.district)} 버스 정류장 ${group.count.toLocaleString("ko-KR")}개 보기">
        <span>${AdPlay.esc(group.district)}</span>
        <strong>${group.count.toLocaleString("ko-KR")}</strong>
      </button>`;
  }

  function visibleBusStops(bounds) {
    const sw = bounds.getSW();
    const ne = bounds.getNE();
    const south = sw.lat();
    const north = ne.lat();
    const west = sw.lng();
    const east = ne.lng();
    return (busStops || []).filter((stop) => (
      busStopPosition(stop).latitude >= south
      && busStopPosition(stop).latitude <= north
      && busStopPosition(stop).longitude >= west
      && busStopPosition(stop).longitude <= east
    ));
  }

  function busStopSearchQuery() {
    return (searchInput && searchInput.value ? searchInput.value : "").trim().toLowerCase();
  }

  function busStopsForCurrentMapView(query = busStopSearchQuery()) {
    const allStops = filteredBusAdStops(query);
    if (!naverMap || !window.naver || !window.naver.maps || activeCategory !== "bus") {
      return busStopListWithSelectedFirst(allStops);
    }
    const bounds = naverMap.getBounds();
    if (!bounds) return busStopListWithSelectedFirst(allStops);
    const allowed = new Set(allStops.map((stop) => String(stop.id)));
    const visible = visibleBusStops(bounds)
      .filter((stop) => stop.adProduct)
      .filter((stop) => allowed.has(String(stop.id)));
    return busStopListWithSelectedFirst(visible.length ? visible : allStops);
  }

  function busStopListWithSelectedFirst(stops) {
    const selected = selectedBusStopId
      ? (busStops || []).find((stop) => String(stop.id) === String(selectedBusStopId))
      : null;
    const deduped = [];
    const seen = new Set();
    if (selected) {
      deduped.push(selected);
      seen.add(String(selected.id));
    }
    stops.forEach((stop) => {
      const id = String(stop.id);
      if (seen.has(id)) return;
      deduped.push(stop);
      seen.add(id);
    });
    return deduped;
  }

  function busStopPosition(stop) {
    const override = busStopPositionOverrides?.[String(stop.ars || "")] || busStopPositionOverrides?.[String(stop.id || "")];
    const latitude = Number(override?.latitude ?? stop.latitude);
    const longitude = Number(override?.longitude ?? stop.longitude);
    return { latitude, longitude };
  }

  function busStopMarkerContent(stop) {
    const product = stop.adProduct || {};
    const kind = product.displayKind || "static";
    const grade = product.grade || "";
    const label = busStopTitle(stop);
    return `
      <span class="bus-stop-pin is-${AdPlay.esc(kind)}${selectedBusStopId === String(stop.id) ? " is-active" : ""}${grade ? ` is-grade-${AdPlay.esc(String(grade).toLowerCase().replace(/[^a-z0-9]+/g, "-"))}` : ""}" role="img" aria-label="${AdPlay.esc(label)}">
        <span class="bus-stop-pin-core"></span>
      </span>`;
  }

  function busStopTitle(stop) {
    const product = stop.adProduct || {};
    const price = product.minMonthlyCost
      ? ` · 월 ${Math.round(product.minMonthlyCost / 10000).toLocaleString("ko-KR")}만원`
      : "";
    const grade = product.grade ? ` · ${product.grade}` : "";
    const kind = product.displayLabel ? ` · ${product.displayLabel}` : "";
    return `${stop.name}${stop.ars ? ` (${stop.ars})` : ""}${kind}${grade}${price}`;
  }

  function filteredBusAdStops(query = "") {
    return (busStops || [])
      .filter((stop) => stop.adProduct)
      .filter((stop) => matchesBusStopCostPeriod(stop))
      .filter((stop) => {
        if (!query) return true;
        const product = stop.adProduct || {};
        const haystack = [
          stop.name,
          stop.ars,
          stop.type,
          product.district,
          product.dong,
          product.productType,
          product.grade,
          product.stationName,
          product.faceLabel,
          product.address,
          product.light,
          product.displayLabel,
          product.innerSize,
          product.outerSize,
        ].join(" ").toLowerCase();
        return haystack.includes(query);
      });
  }

  function matchesBusStopCostPeriod(stop) {
    const product = stop.adProduct || {};
    const monthly = Number(product.minMonthlyCost);
    if (activeBudget !== "all") {
      if (!Number.isFinite(monthly)) return false;
      const manwon = monthly / 10000;
      if (activeBudget === "under100") return manwon < 100;
      if (activeBudget === "100-300") return manwon >= 100 && manwon < 300;
      if (activeBudget === "300-500") return manwon >= 300 && manwon < 500;
      if (activeBudget === "500-1000") return manwon >= 500 && manwon < 1000;
      if (activeBudget === "1000-1500") return manwon >= 1000 && manwon < 1500;
      if (activeBudget === "1500plus") return manwon >= 1500;
    }
    return true;
  }

  function focusBusStop(stopId) {
    const stop = (busStops || []).find((item) => String(item.id) === String(stopId));
    if (!stop) return;
    selectedBusStopId = String(stop.id);
    if (naverMap && window.naver && window.naver.maps) {
      const position = busStopPosition(stop);
      naverMap.setCenter(new naver.maps.LatLng(position.latitude, position.longitude));
      if (naverMap.getZoom() < 16) naverMap.setZoom(16);
      syncBusStopLayer();
    }
    renderBusStopList(busStopListWithSelectedFirst(busStopsForCurrentMapView()));
    if (listView && typeof listView.scrollTo === "function") {
      listView.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function formatBusWon(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return `${number.toLocaleString("ko-KR")}원`;
  }

  function markerContent(item) {
    const isActive = selectedMediaSlug === item.slug;
    const image = cardImages(item)[0];
    return `
      <button type="button" class="media-map-pin${isActive ? " is-active" : ""}" aria-label="${AdPlay.esc(item.name)}">
        <span class="media-map-pin-image"><img src="${AdPlay.esc(image)}" alt="" onerror="this.src='${AdPlay.esc(AdPlay.pageImage(item))}'"></span>
      </button>`;
  }

  function renderList(items, busListStops = []) {
    if (activeCategory === "bus") {
      renderBusStopList(busStopsForCurrentMapView());
      return;
    }
    listRoot.innerHTML = items.length
      ? items.map(listCard).join("")
      : `<div class="empty">조건에 맞는 매체가 없습니다.</div>`;

    listRoot.querySelectorAll("[data-map-media]").forEach((button) => {
      button.addEventListener("click", () => openDetail(button.dataset.mapMedia, true, true));
    });
  }

  function listCard(item, index) {
    const location = item.mapLocation;
    const images = cardImages(item, index);
    const isActive = selectedMediaSlug === item.slug;
    return `
      <article class="map-list-card${isActive ? " is-active" : ""}" data-gallery="${AdPlay.esc(detailGalleryImages(item).join(","))}">
        <button type="button" data-map-media="${AdPlay.esc(item.slug)}" aria-label="${AdPlay.esc(item.name)} 상세 보기" aria-current="${isActive ? "true" : "false"}"></button>
        <div class="map-card-photo-pair">
          <figure>
            <img src="${AdPlay.esc(images[0])}" alt="${AdPlay.esc(item.name)} 현장 이미지 1" loading="lazy" onerror="this.src='${AdPlay.esc(AdPlay.pageImage(item))}'">
          </figure>
          <figure>
            <img src="${AdPlay.esc(images[1])}" alt="${AdPlay.esc(item.name)} 현장 이미지 2" loading="lazy" onerror="this.src='${AdPlay.esc(images[0])}'">
          </figure>
        </div>
        <div class="map-list-card-body">
          <div class="map-list-title-row">
            <h2>${AdPlay.esc(item.name)}</h2>
            ${favHeartButton(item, "map-card-fav")}
          </div>
          <p class="map-card-decision-line">${AdPlay.esc(mapCardDecisionSummary(item))}</p>
          <p class="map-card-exposure-point">${AdPlay.esc(cardExposurePoint(item))}</p>
          <div class="map-list-tags">
            ${[item.areaName, AdPlay.categoryLabels[item.category] || item.mediaType].filter(Boolean).slice(0, 3).map((tag) => `<span>${AdPlay.esc(tag)}</span>`).join("")}
          </div>
          <div class="map-card-footer">
            <span>상세보기</span>
          </div>
        </div>
      </article>`;
  }

  function renderDetail(item) {
    if (!item) {
      detailRoot.innerHTML = "";
      return;
    }
    const location = item.mapLocation;
    const image = cardImages(item)[0];
    const galleryImages = detailGalleryImages(item);
    const insight = locationInsight(item);
    const nearby = nearbyDistrict(item);
    const profile = audienceProfile(item);
    const sv = item.streetView || (location && location.streetView) || null;
    const roadviewUrl = `https://map.naver.com/v5/search/${encodeURIComponent(location.sourceAddress || item.address)}`;
    detailRoot.innerHTML = `
      <button type="button" class="map-detail-close" id="mapDetailClose" aria-label="목록으로 돌아가기">×</button>
      <section class="map-detail-media-hero" aria-label="현장 사진과 영상">
        <figure class="map-detail-video-preview${item.videoUrl ? " has-video" : ""}">
          ${item.videoUrl
            ? `<video src="${AdPlay.esc(item.videoUrl)}" poster="${AdPlay.esc(galleryImages[1] || image)}" autoplay muted loop playsinline preload="metadata" controls aria-label="${AdPlay.esc(item.name)} 광고 현장 영상"><img src="${AdPlay.esc(galleryImages[1] || image)}" alt="${AdPlay.esc(item.name)} 광고 현장"></video>`
            : `<img src="${AdPlay.esc(galleryImages[1] || image)}" alt="${AdPlay.esc(item.name)} 광고 현장 영상 미리보기">`}
        </figure>
        <div class="map-detail-media-grid">
          ${galleryImages.slice(0, 4).map((src, index) => `
            <figure>
              <img src="${AdPlay.esc(src)}" alt="${AdPlay.esc(item.name)} 현장 사진 ${index + 1}" loading="${index === 0 ? "eager" : "lazy"}">
              ${index === 3 ? `<button type="button" class="map-detail-gallery-jump">사진 더보기(${Math.max(galleryImages.length, 4)})</button>` : ""}
            </figure>
          `).join("")}
        </div>
      </section>
      <div class="map-detail-body">
        <div class="map-detail-title-row">
          <h2>${AdPlay.esc(item.name)}</h2>
          ${favHeartButton(item, "map-detail-fav")}
        </div>
        <p class="map-detail-address">${AdPlay.esc(compactAddress(item))}</p>
        <div class="map-list-tags">
          ${[item.mediaType, item.areaName, location.isComposite ? "복합 매체" : "", item.category === "package" ? "패키지" : ""].filter(Boolean).map((tag) => `<span>${AdPlay.esc(tag)}</span>`).join("")}
        </div>
        <div class="map-detail-actions">
          <a href="one-pager.html?slug=${encodeURIComponent(item.slug)}" target="_blank" rel="noopener"><strong>매체 소개서</strong><span>Brochure</span></a>
          <a href="#detailTraffic"><strong>데이터 리포트</strong><span>Data Report</span></a>
          ${sv
            ? `<a href="#detailRoadview"><strong>거리뷰 보기</strong><span>Street View</span></a>`
            : `<a href="${roadviewUrl}" target="_blank" rel="noopener"><strong>거리뷰 보기</strong><span>Street View</span></a>`}
        </div>
        <a class="map-detail-fullpage" href="media-${AdPlay.esc(item.slug)}.html">${AdPlay.esc(item.name)} 상세 페이지 전체보기<span aria-hidden="true">→</span></a>
        <section class="map-detail-section map-detail-section-top" id="detailSpecs">
          <dl class="map-detail-specs">
            ${detailFact("규격", location.size || sizeLabel(item))}
            ${detailFact("해상도", (function (r) { return (/px\s*$/i.test(r) || !/\d\s*[x×]\s*\d/.test(r)) ? r : r + "px"; })(location.resolution || item.resolutionPx || "확인 필요"))}
            ${detailFact("유형", AdPlay.categoryLabels[item.category] || item.mediaType)}
            ${detailFact("운영시간", location.operationHours || item.operationHours)}
            <dt>계약정보<br><span class="map-detail-fact-sub">비용(VAT별도)</span></dt><dd class="map-detail-contract">${contractDetailHtml(item)}</dd>
          </dl>
        </section>
        <section class="map-detail-section map-detail-selling">
          <h3>매체 노출 포인트</h3>
          <p class="map-detail-copy">${AdPlay.esc(mediaSellingPoint(item))}</p>
          ${detailAudience(item) ? `<div class="map-detail-audience-box">
            <p class="map-audience-cap">이 앞을 지나는 주 방문층</p>
            <p class="map-detail-audience-line">${AdPlay.esc(detailAudience(item))}</p>
          </div>` : ""}
          ${nearby.brands && nearby.brands.length ? `<p class="map-nearby-label map-nearby-label--brands">상권 대표 브랜드</p>
          <div class="map-nearby-brands">${nearby.brands.map((brand) => `<span>${AdPlay.esc(brand)}</span>`).join("")}</div>` : ""}
        </section>
        <a class="map-detail-live-card" href="estimate.html?intent=live-talk&media=${encodeURIComponent(item.slug)}">
          <strong>실시간 라이브 상담</strong>
          <span>할인, 패키지, 예산 맞춤 집행은 1533-1975 또는 라이브 상담 신청</span>
        </a>
        <section class="map-detail-section" id="detailGallery">
          <h3>갤러리</h3>
          <div class="map-detail-gallery">
            ${galleryImages.map((src, index) => `<img src="${AdPlay.esc(src)}" alt="${AdPlay.esc(item.name)} 현장사진 ${index + 1}" loading="lazy">`).join("")}
          </div>
          <button type="button" class="map-detail-more">사진 더보기</button>
        </section>
        <section class="map-detail-section" id="detailRoadview">
          <h3>거리뷰</h3>
          <a class="map-detail-roadview" href="${roadviewUrl}" target="_blank" rel="noopener">
            <img src="${AdPlay.esc(galleryImages[0] || image)}" alt="${AdPlay.esc(item.name)} 거리뷰 미리보기">
            <span>거리뷰 보기</span>
          </a>
        </section>
        <section class="map-detail-section" id="detailTraffic">
          <h3>유동인구와 타깃</h3>
          <p class="map-detail-copy">${AdPlay.esc(insight.traffic)}</p>
          ${trafficVisualization(insight, profile)}
        </section>
        <section class="map-detail-section" id="detailLocation">
          <h3>입지 특성</h3>
          ${item.locationFeature ? `<p class="map-detail-copy map-detail-location-feature">${AdPlay.esc(item.locationFeature)}</p>` : ""}
          <div class="map-insight-score">
            ${insight.scores.map((score) => `<div><span>${AdPlay.esc(score.label)}</span><i style="--score:${score.value}"></i><strong>${score.value}</strong></div>`).join("")}
          </div>
          <p class="map-nearby-label">주요 시설·행사</p>
          <dl class="map-detail-table">
            ${insight.facilities.map((row) => `<dt>${AdPlay.esc(row.label)}</dt><dd>${AdPlay.esc(row.value)}</dd>`).join("")}
          </dl>
        </section>
        <section class="map-detail-section" id="detailConsult">
          <details class="map-consult-accordion">
            <summary>온라인 상담</summary>
          <form class="map-consult-form" action="estimate.html" method="get">
            <input type="hidden" name="media" value="${AdPlay.esc(item.slug)}">
            <p class="map-consult-required">* 필수 정보를 입력해 주세요</p>
            <label>
              <span>이름*</span>
              <input name="name" type="text" placeholder="이름을 입력해 주세요" required>
            </label>
            <label>
              <span>대표전화*</span>
              <input name="phone" type="tel" placeholder="연락처를 입력해 주세요" required>
            </label>
            <label>
              <span>소속(기업명)</span>
              <input name="company" type="text" placeholder="개인/기업명을 입력해 주세요">
            </label>
            <label>
              <span>이메일</span>
              <input name="email" type="email" placeholder="이메일 형식으로 입력해 주세요">
            </label>
            <label>
              <span>제목</span>
              <input name="subject" type="text" value="${AdPlay.esc(item.name)} - 상담 문의 드립니다">
            </label>
            <label>
              <span>상세내용</span>
              <textarea name="message" rows="7" placeholder="광고 목적, 타깃, 선호 지역, 매체수량 및 예산을 입력해 주세요"></textarea>
            </label>
            <div class="map-consult-grid">
              <label>
                <span>기간선택</span>
                <select name="period">
                  <option value="">기간선택</option>
                  <option>1일</option>
                  <option>3일</option>
                  <option>7일</option>
                  <option>15일</option>
                  <option>1개월 이상</option>
                </select>
              </label>
              <label>
                <span>시작일</span>
                <input name="startDate" type="date">
              </label>
            </div>
            <label>
              <span>광고비용</span>
              <textarea name="budget" rows="3" placeholder="계획하신 예산을 입력해 주세요"></textarea>
            </label>
            <label>
              <span>기타 문의</span>
              <textarea name="extra" rows="3" placeholder="영상 제작, 광고기간, 구좌수 조정 등 기타 문의 사항을 입력해 주세요"></textarea>
            </label>
            <label class="map-consult-agree">
              <input name="privacy" type="checkbox" required>
              <span>개인정보 수집 및 이용에 동의합니다.</span>
            </label>
            <button type="submit">작성완료</button>
          </form>
          </details>
        </section>
      </div>`;

    document.querySelector("#mapDetailClose").addEventListener("click", () => {
      detailOpen = false;
      syncPanelMode();
      focusSelectedCard();
    });
    const galleryJump = detailRoot.querySelector(".map-detail-gallery-jump");
    if (galleryJump) galleryJump.addEventListener("click", () => {
      const gallerySection = detailRoot.querySelector("#detailGallery");
      if (gallerySection) gallerySection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    const onlineConsult = detailRoot.querySelector('.map-detail-consult[href="#detailConsult"]');
    if (onlineConsult) onlineConsult.addEventListener("click", (event) => {
      event.preventDefault();
      const formSection = detailRoot.querySelector("#detailConsult");
      if (!formSection) return;
      const details = formSection.querySelector("details");
      if (details) details.open = true;
      formSection.scrollIntoView({ behavior: "smooth", block: "start" });
      const firstInput = formSection.querySelector("input[name='name']");
      if (firstInput) firstInput.focus({ preventScroll: true });
    });
    // 거리뷰: 거리뷰좌표(pan/tilt/fov)로 네이버 파노라마 인라인 표시
    if (sv) {
      const panoEl = detailRoot.querySelector("#detailRoadviewPano");
      const panoFallback = () => {
        if (panoEl) panoEl.outerHTML = `<a class="map-detail-roadview-link" href="${roadviewUrl}" target="_blank" rel="noopener">네이버 지도에서 거리뷰 보기</a>`;
      };
      if (panoEl && window.naver && naver.maps && naver.maps.Panorama) {
        try {
          new naver.maps.Panorama(panoEl, {
            position: new naver.maps.LatLng(sv.lat, sv.lng),
            pov: { pan: sv.pan, tilt: sv.tilt, fov: sv.fov },
            flightSpot: true,
            aroundControl: true,
          });
        } catch (error) {
          console.warn("거리뷰 파노라마 초기화 실패", error);
          panoFallback();
        }
      } else {
        panoFallback();
      }
    }
  }

  function mediaSellingPoint(item) {
    if (item.exposureLong) return item.exposureLong; // 매체별 실데이터 우선(있으면), 없으면 아래 상권 키워드 폴백
    const text = [item.name, item.areaName, item.areaSlug, item.address].filter(Boolean).join(" ");
    if (/광화문|종로|시청|청계|gwanghwamun|jongno|jung/i.test(text)) {
      return "광장과 횡단보도 대기 동선에서 정면 시야가 형성되고, 주변 공공기관·언론사·문화시설 방문객에게 반복 노출되는 도심 랜드마크형 매체입니다.";
    }
    if (/삼성|코엑스|COEX|samseong|coex/i.test(text)) {
      return "코엑스·무역센터·백화점 방문 동선과 차량 흐름을 동시에 커버해 전시, 팝업, 프리미엄 브랜드 캠페인의 인지 확산에 유리합니다.";
    }
    if (/서울역|KTX|seoul-station|transport/i.test(text)) {
      return "철도·지하철·버스 환승객이 매체 전면을 지나며 확인하는 교통 허브형 매체로, 단기 고빈도 고지와 광역 캠페인에 적합합니다.";
    }
    return "횡단보도 대기 지점과 차량 정체 구간에서 시야가 오래 머무는 대형 전광판으로, 도산대로·강남 상권의 뷰티·패션·F&B 브랜드 노출에 강점이 있습니다.";
  }

  function openDetail(slug, panToMarker, moveFocus = false) {
    const item = currentItems.find((entry) => entry.slug === slug);
    if (!item) return;
    selectedMediaSlug = slug;
    detailOpen = true;
    // 매체를 고른 시점에 큐레이션(탐색 도구)의 역할은 끝난다. 열어두면 상세 위를 덮어
    // 매번 사용자가 직접 닫아야 하므로 자동으로 닫는다.
    setCurationPanel(false);
    render({ preserveView: true });
    if (mobileLayoutQuery.matches) {
      setMobileListOpen(true);
    }
    if (moveFocus) {
      detailRoot.focus({ preventScroll: true });
    }
    // 목록에서 매체를 고르면 지도도 해당 매체 위치로 이동. 도시 전체 뷰(줌 13)에서 panTo만 하면
    // "그 매체로 갔다"는 느낌이 없어, 멀리 있을 때는 확대까지 함께(morph). 이미 가까우면 확대는 유지.
    if (panToMarker && naverMap && item.mapLocation && window.naver && window.naver.maps) {
      const target = new naver.maps.LatLng(item.mapLocation.latitude, item.mapLocation.longitude);
      if (naverMap.getZoom() < DETAIL_FOCUS_ZOOM && typeof naverMap.morph === "function") {
        naverMap.morph(target, DETAIL_FOCUS_ZOOM);
      } else {
        naverMap.panTo(target);
      }
    }
  }

  function syncPanelMode() {
    // 기본은 '상세만' 표시 — 목록까지 항상 펼치면 패널이 860px을 덮어 보이는 지도가 거의 남지 않는다.
    // 목록을 함께 보고 싶을 때만 ☰(펼치기)로 연다. 모바일은 폭이 좁아 항상 전환.
    const expanded = panelsExpanded && !mobileLayoutQuery.matches;
    listView.hidden = detailOpen && !expanded;
    detailRoot.hidden = !detailOpen;
    if (workspacePage) {
      workspacePage.classList.toggle("is-detail-open", detailOpen);
      workspacePage.classList.toggle("is-panels-expanded", detailOpen && expanded);
    }
  }

  function focusSelectedCard() {
    const button = listRoot.querySelector(`[data-map-media="${CSS.escape(selectedMediaSlug)}"]`);
    if (button) button.focus({ preventScroll: true });
  }

  function selectedItem(items) {
    return items.find((item) => item.slug === selectedMediaSlug) || items[0] || null;
  }

  function hasLatLng(item) {
    return item.mapLocation && Number.isFinite(Number(item.mapLocation.latitude)) && Number.isFinite(Number(item.mapLocation.longitude));
  }

  function cardDescription(item) {
    const description = item.mapLocation && item.mapLocation.description;
    if (description && description.replace(/[.\s]/g, "").length > 0) {
      return description.length > 84 ? `${description.slice(0, 84)}...` : description;
    }
    return item.locationDescription || item.address || "현장 설명 확인 필요";
  }

  function compactAddress(item) {
    const location = item.mapLocation || {};
    const candidates = [item.address, location.sourceAddress].filter(Boolean);
    const roadAddress = (candidates.find((address) => /[가-힣0-9](대로|로|길)(\s|[0-9])/u.test(address)) || candidates[0] || "").replace(/\s{2,}/g, " ").trim();
    const dongMatch = candidates.join(" ").match(/([가-힣0-9]+동)/);
    const dong = dongMatch && dongMatch[1] ? dongMatch[1] : "";
    if (!roadAddress) return location.sourceAddress || "주소 확인 필요";
    if (!dong || roadAddress.includes(`(${dong})`)) return roadAddress;
    return `${roadAddress} (${dong})`;
  }

  function sizeLabel(item) {
    if (item.widthM && item.heightM) return `${item.widthM}m x ${item.heightM}m`;
    return item.resolutionPx || "";
  }

  function shortName(name) {
    return String(name || "").replace(/전광판|패키지|상세/g, "").trim().slice(0, 16);
  }

  function detailFact(label, value) {
    return `<dt>${AdPlay.esc(label)}</dt><dd>${AdPlay.esc(value || "확인 필요")}</dd>`;
  }

  function mapCardPriceLabel(item) {
    const min = AdPlay.minMonthlyPrice(item);
    return min ? `월 ${AdPlay.formatKRW(min)}` : "월 비용 상담 필요";
  }

  function mapCardDecisionSummary(item) {
    const terms = [mapCardPriceLabel(item)];
    terms.push(item.shortTermAvailable === false ? "월 단위 집행" : "1개월 미만 협의");
    return terms.filter(Boolean).join(" · ");
  }

  function cardReachLabel(item) {
    const area = areaBySlug.get(item.areaSlug);
    const ft = area && Number(area.dailyFootTraffic);
    if (!ft) return "";
    const man = Math.round((ft / 10000) * 10) / 10;
    return `일 유동인구 ${man}만명`;
  }

  function detailAudience(item) {
    const area = areaBySlug.get(item.areaSlug);
    const list = (area && area.primaryTargets) || [];
    return list.join(" · ");
  }

  function cardExposurePoint(item) {
    if (item.exposureShort) return item.exposureShort; // 매체별 실데이터 우선(있으면), 없으면 아래 상권 키워드 폴백
    const text = [item.name, item.areaName, item.areaSlug, item.address, item.mapLocation && item.mapLocation.sourceAddress]
      .filter(Boolean)
      .join(" ");
    if (/광화문|종로|시청|청계|gwanghwamun|jongno/i.test(text)) return "광장·보행 동선에서 반복 노출";
    if (/서울역|KTX|seoul-station|transport/i.test(text)) return "철도·지하철 환승 동선 집중 노출";
    if (/삼성|코엑스|COEX|samseong|coex/i.test(text)) return "업무·전시 방문객과 차량 동시 노출";
    if (/신사|강남|도산|가로수|sinsa|gangnam/i.test(text)) return "횡단보도·차량정체 구간 정면 노출";
    return "주요 보행·차량 동선에서 반복 노출";
  }

  function contractSummary(item) {
    const min = AdPlay.minMonthlyPrice(item);
    const monthly = min ? `월 ${AdPlay.formatKRW(min)}` : "월 비용 상담 필요";
    return `${monthly} · 1개월 미만 집행 협의 가능`;
  }
  // 계약정보 원문(줄단위) 표시 — 실데이터 우선, 없으면 요약 폴백
  function contractDetailHtml(item) {
    const location = item.mapLocation || {};
    let lines = Array.isArray(item.contractLines) ? item.contractLines.slice() : [];
    if (!lines.length && location.contract) {
      lines = String(location.contract).split(/\n+/).map((line) => line.trim()).filter(Boolean);
    }
    if (!lines.length && item.contractText) {
      lines = [String(item.contractText).trim()];
    }
    if (!lines.length) return AdPlay.esc(contractSummary(item) || "확인 필요");
    return lines
      .map((line) => `<span class="map-contract-line${/^\*/.test(line) ? " is-note" : ""}">${AdPlay.esc(line)}</span>`)
      .join("");
  }

  function matchesCostPeriod(item) {
    const days = activePeriod === "all" ? 30 : Number(activePeriod);
    if (Number.isFinite(days) && days < 30 && !item.shortTermAvailable) return false;
    const estimated = estimatedCampaignCost(item, days);
    if (activeBudget === "all") return true;
    if (!Number.isFinite(estimated)) return false;
    const manwon = estimated / 10000;
    if (activeBudget === "under100") return manwon < 100;
    if (activeBudget === "100-300") return manwon >= 100 && manwon < 300;
    if (activeBudget === "300-500") return manwon >= 300 && manwon < 500;
    if (activeBudget === "500-1000") return manwon >= 500 && manwon < 1000;
    if (activeBudget === "1000-1500") return manwon >= 1000 && manwon < 1500;
    if (activeBudget === "1500plus") return manwon >= 1500;
    return true;
  }

  function estimatedCampaignCost(item, days) {
    const monthly = AdPlay.minMonthlyPrice(item);
    if (!Number.isFinite(Number(monthly))) return null;
    if (!Number.isFinite(days) || days >= 30) return Number(monthly);
    return Math.ceil((Number(monthly) / 30) * days);
  }

  function syncCostFilterButtons() {
    if (!costFilterPanel) return;
    costFilterPanel.querySelectorAll("[data-budget-filter]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.budgetFilter === pendingBudget);
    });
    costFilterPanel.querySelectorAll("[data-period-filter]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.periodFilter === pendingPeriod);
    });
    if (budgetActive) budgetActive.textContent = filterLabel("budget", pendingBudget);
    if (periodActive) periodActive.textContent = filterLabel("period", pendingPeriod);
  }

  function updateCostFilterLabels() {
    if (budgetActive) budgetActive.textContent = filterLabel("budget", activeBudget);
    if (periodActive) periodActive.textContent = filterLabel("period", activePeriod);
    if (costFilterToggle) {
      const hasFilter = activeBudget !== "all" || activePeriod !== "all";
      costFilterToggle.classList.toggle("has-filter", hasFilter);
    }
  }

  function closeCostPanel() {
    if (costFilterPanel) costFilterPanel.hidden = true;
    if (costFilterToggle) costFilterToggle.setAttribute("aria-expanded", "false");
  }

  function closeRegionPanel() {
    if (regionPanel) regionPanel.hidden = true;
    if (regionToggle) regionToggle.setAttribute("aria-expanded", "false");
  }

  function moveToRegion(targetKey) {
    const target = regionTargets[targetKey];
    if (!target || !naverMap || !window.naver || !window.naver.maps) return;
    naverMap.setCenter(new naver.maps.LatLng(target.latitude, target.longitude));
    naverMap.setZoom(target.zoom);
  }

  function costPeriodSummary() {
    const parts = [];
    if (activeBudget !== "all") parts.push(filterLabel("budget", activeBudget));
    if (activePeriod !== "all") parts.push(filterLabel("period", activePeriod));
    return parts.length ? `적용 조건: ${parts.join(" · ")}` : "";
  }

  function filterLabel(type, value) {
    const budget = {
      all: "예산 전체",
      under100: "100만원 미만",
      "100-300": "100 - 300만원 미만",
      "300-500": "300 - 500만원 미만",
      "500-1000": "500 - 1,000만원 미만",
      "1000-1500": "1,000 - 1,500만원 미만",
      "1500plus": "1,500만원 이상",
    };
    const period = {
      all: "기간 전체",
      1: "1일",
      3: "3일",
      7: "7일",
      15: "15일",
      30: "1개월 이상",
    };
    return (type === "budget" ? budget : period)[value] || "전체";
  }

  function detailGalleryImages(item) {
    // 실사진이 있는 매체는 자기 사진만 노출(샘플 섞이지 않게)
    const own = ownImages(item);
    if (own.length) return [...new Set(own)].slice(0, 6);
    const images = cardImages(item);
    const all = [
      ...images,
      "assets/images/map-samples/gangnam-wide.jpg",
      "assets/images/map-samples/gangnam-close.jpg",
      "assets/images/map-samples/cheonggye-wide.jpg",
      "assets/images/map-samples/cheonggye-close.jpg",
      "assets/images/map-samples/gwanghwamun-wide.jpg",
      "assets/images/map-samples/gwanghwamun-close.jpg",
    ];
    return [...new Set(all)].slice(0, 6);
  }

  function trafficVisualization(insight, profile) {
    const stats = insight.stats || {
      daily500: "7.6만명",
      daily300: "3.1만명",
      subway: "12.4만명",
      bus: "3.8만명",
      traffic: "8.6만대",
      target: "2030·직장인",
    };
    const isReal = insight.isReal || { subway: false, bus: false };
    const monthly = [7.1, 7.3, 7.5, 7.9, 8.3, 7.8, 7.4, 7.9, 7.7, 7.9, 7.5, 7.6];
    const monthLabels = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
    const minMonth = Math.min(...monthly);
    const maxMonth = Math.max(...monthly);
    const peakIndex = monthly.indexOf(maxMonth);
    const monthX = (index) => 26 + index * 28.6;
    const monthY = (value) => 118 - ((value - minMonth) / (maxMonth - minMonth || 1)) * 54;
    const points = monthly.map((value, index) => `${monthX(index)},${monthY(value)}`).join(" ");
    const dayBars = [
      ["월", 7.4, 82, "강"],
      ["화", 7.6, 84, "강"],
      ["수", 7.8, 86, "강"],
      ["목", 8.0, 88, "최대"],
      ["금", 7.9, 87, "강"],
      ["토", 6.5, 72, "주말"],
      ["일", 5.7, 62, "완만"],
    ];
    const timeBars = [
      ["05~09", 4.2, 54, "출근"],
      ["09~12", 5.4, 70, "오전"],
      ["12~14", 4.8, 62, "점심"],
      ["14~18", 7.8, 100, "피크"],
      ["18~23", 6.7, 86, "저녁"],
      ["23~05", 2.6, 34, "심야"],
    ];
    const topDay = dayBars.reduce((top, row) => row[1] > top[1] ? row : top, dayBars[0]);
    const topTime = timeBars.reduce((top, row) => row[1] > top[1] ? row : top, timeBars[0]);
    const ageRows = (profile && profile.age) || [
      ["10대", 8, 27, "학생·동반"],
      ["20대", 24, 78, "활동층"],
      ["30대", 27, 88, "구매 핵심"],
      ["40대", 22, 72, "직장인"],
      ["50대", 13, 43, "가족 소비"],
      ["60대+", 6, 22, "생활권"],
    ];
    const gender = (profile && profile.gender) || { female: 52, male: 48 };
    const ageTopIndex = ageRows.reduce((top, row, index) => row[1] > ageRows[top][1] ? index : top, 0);
    const audienceRows = insight.audience || [];
    return `
      <div class="map-traffic-kpis">
        <article class="is-primary"><span>일평균 유동 500m</span><strong>${AdPlay.esc(stats.daily500)}</strong><em>상권 반경 추정</em></article>
        <article><span>일평균 유동 300m</span><strong>${AdPlay.esc(stats.daily300)}</strong><em>매체 근접권</em></article>
        <article class="is-text-kpi"><span>핵심 타깃</span><strong>${AdPlay.esc(stats.target)}</strong><em>구매·방문 가능층</em></article>
        <article><span>지하철 승하차</span><strong>${AdPlay.esc(stats.subway)}</strong><em>주변역 월평균${isReal.subway ? "" : " · 추정"}</em></article>
        <article><span>버스 승하차</span><strong>${AdPlay.esc(stats.bus)}</strong><em>주변 정류장 월평균${isReal.bus ? "" : " · 추정"}</em></article>
        <article><span>도로 교통량</span><strong>${AdPlay.esc(stats.traffic)}</strong><em>주요 간선도로 · 추정</em></article>
      </div>
      <div class="map-traffic-chart">
        <div class="map-traffic-chart-head">
          <div>
            <h4>월별 일평균 유동 추이</h4>
            <p>반경 500m 기준 · 단위 만명</p>
          </div>
          <strong>${peakIndex + 1}월 피크 ${maxMonth.toFixed(1)}만명</strong>
        </div>
        <svg viewBox="0 0 366 164" role="img" aria-label="월별 유동인구 추이 그래프">
          <defs>
            <linearGradient id="trafficLine" x1="0" x2="1">
              <stop offset="0%" stop-color="#0b3a91"></stop>
              <stop offset="100%" stop-color="#4f7df3"></stop>
            </linearGradient>
            <linearGradient id="trafficArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="#4f7df3" stop-opacity="0.22"></stop>
              <stop offset="100%" stop-color="#4f7df3" stop-opacity="0"></stop>
            </linearGradient>
          </defs>
          <path d="M26 124H341" class="axis"></path>
          <polygon points="26,124 ${points} 341,124" class="area"></polygon>
          <polyline points="${points}" class="line"></polyline>
          ${monthly.map((value, index) => `<circle class="${index === peakIndex ? "is-peak" : ""}" cx="${monthX(index)}" cy="${monthY(value)}" r="${index === peakIndex ? 5 : 3.5}"></circle>`).join("")}
          <text class="map-traffic-peak" x="${monthX(peakIndex)}" y="${monthY(maxMonth) - 12}">${maxMonth.toFixed(1)}만</text>
          ${monthLabels.map((label, index) => `<text x="${monthX(index)}" y="150">${AdPlay.esc(label)}월</text>`).join("")}
        </svg>
      </div>
      <div class="map-traffic-grid">
        <div class="map-traffic-panel">
          <div class="map-traffic-panel-head">
            <h4>요일별 일평균</h4>
            <b>${topDay[0]}요일 강세</b>
          </div>
          ${dayBars.map(([label, people, value, note]) => `<div><span>${label}</span><i style="--bar:${value}"></i><em>${people.toFixed(1)}만</em><strong>${note}</strong></div>`).join("")}
        </div>
        <div class="map-traffic-panel">
          <div class="map-traffic-panel-head">
            <h4>시간대별 유동</h4>
            <b>${topTime[0]} 집중</b>
          </div>
          ${timeBars.map(([label, people, value, note]) => `<div><span>${label}</span><i style="--bar:${value}"></i><em>${people.toFixed(1)}만</em><strong>${note}</strong></div>`).join("")}
        </div>
      </div>
      <div class="map-traffic-segments" aria-label="타깃 및 방문 동기">
        <div class="map-traffic-segments-head">
          <h4>타깃·방문 동기</h4>
        </div>
        <div class="map-gender-split">
          <div class="map-gender-split-head">
            <h5>성별 비중</h5>
            <b>여성 ${gender.female}% · 남성 ${gender.male}%</b>
          </div>
          <div class="map-gender-bar">
            <span class="f" style="width:${gender.female}%">여성 ${gender.female}%</span>
            <span class="m" style="width:${gender.male}%">남성 ${gender.male}%</span>
          </div>
        </div>
        <div class="map-age-distribution">
          <div class="map-age-distribution-head">
            <h5>연령대 분포</h5>
            <b>${AdPlay.esc(ageRows[ageTopIndex][0])} 최다</b>
          </div>
          ${ageRows.map(([label, percent, value, note], index) => `<div class="map-age-row ${index === ageTopIndex ? "is-peak" : ""}">
            <span>${label}</span>
            <i style="--bar:${value}"></i>
            <em>${percent}%</em>
            <strong>${note}</strong>
          </div>`).join("")}
        </div>
        <div class="map-traffic-segment-list">
          ${audienceRows.map((row) => `<div class="map-traffic-segment"><span>${AdPlay.esc(row.label)}</span><i style="--bar:${row.value}"></i><strong>${AdPlay.esc(row.note)}</strong></div>`).join("")}
        </div>
        ${profile ? `<p class="map-audience-src">${AdPlay.sourceChip({ traffic: true })}</p>` : ""}
      </div>`;
  }

  // 성별·연령 프로필의 단일 소스는 common.js(AdPlay.audienceProfile). 지도·목록 페이지가 공유해 자동 동기화됩니다.
  function audienceProfile(item) {
    return AdPlay.audienceProfile(item);
  }

  function nearbyDistrict(item) {
    // 실데이터 우선: 배치로 수집한 item.nearbyBrands가 있으면 사용, 없으면 아래 키워드 폴백
    if (Array.isArray(item.nearbyBrands) && item.nearbyBrands.length) {
      return { summary: item.nearbySummary || "", brands: item.nearbyBrands.slice(0, 8) };
    }
    const text = [item.name, item.areaName, item.areaSlug, item.address, item.mapLocation && item.mapLocation.sourceAddress].filter(Boolean).join(" ");
    if (/삼성|코엑스|COEX|samseong|coex/i.test(text)) {
      return {
        summary: "전시·쇼핑·업무가 겹치는 복합 상권으로, 백화점·몰 방문객과 B2B 유동이 함께 발생합니다.",
        brands: ["현대백화점", "스타필드 코엑스", "메가박스", "스타벅스", "올리브영", "무신사 스탠다드", "자라", "별마당도서관"],
      };
    }
    if (/서울역|KTX|seoul-station|transport/i.test(text)) {
      return {
        summary: "철도·지하철·버스 환승 허브로, 출퇴근·출장·관광 유동이 반복 교차하는 교통 중심 상권입니다.",
        brands: ["롯데마트", "롯데아울렛 서울역", "스타벅스", "파리바게뜨", "버거킹", "던킨", "CU", "서울로7017"],
      };
    }
    if (/광화문|종로|시청|청계|gwanghwamun|jongno|jung/i.test(text)) {
      return {
        summary: "도심 랜드마크 입지로, 직장인 출퇴근·점심 유동과 관광·문화행사 동선이 함께 형성됩니다.",
        brands: ["교보문고", "광화문 D타워", "세종문화회관", "스타벅스", "올리브영", "파리바게뜨", "GS25", "덕수궁"],
      };
    }
    return {
      summary: "강남·도산·신사를 잇는 프리미엄 소비 동선으로, 2030·구매력 직장인이 밀집하고 뷰티·패션·F&B가 강세입니다.",
      brands: ["올리브영", "무신사", "애플 가로수길", "스타벅스", "다이소", "투썸플레이스", "자라", "CU"],
    };
  }

  function locationInsight(item) {
    const text = [item.name, item.areaName, item.areaSlug, item.address, item.mapLocation && item.mapLocation.sourceAddress].filter(Boolean).join(" ");
    const area = areaBySlug.get(item.areaSlug);
    const withAreaTransit = (insight) => {
      const subway = areaSubwayTotal(area);
      const bus = areaBusTotal(area);
      return {
        ...insight,
        // 권역이 붙은 매체만 areas.json 실측치를 쓴다. 나머지는 아래 stats 의 하드코딩 추정값이
        // 그대로 남으므로, 출처(철도통계 등)를 붙이면 안 된다 — isReal 로 구분해 표기를 가른다.
        isReal: { subway: Boolean(subway), bus: Boolean(bus) },
        stats: {
          ...(insight.stats || {}),
          ...(subway ? { subway: compactPeople(subway) } : {}),
          ...(bus ? { bus: compactPeople(bus) } : {}),
        },
      };
    };
    if (/삼성|코엑스|COEX|samseong|coex/i.test(text)) {
      return withAreaTransit({
        location: "코엑스, 무역센터, 백화점, 호텔, 전시·컨벤션 동선이 겹치는 복합 상권입니다. B2B 방문객과 쇼핑·관광 체류 인구가 함께 발생해 브랜드 인지도와 행사 연계 캠페인에 적합합니다.",
        traffic: "평일에는 업무·전시 방문 수요가 안정적으로 유입되고, 주말에는 쇼핑몰·영화관·행사 방문객 중심으로 체류 시간이 길어지는 특성이 있습니다.",
        stats: { daily500: "8.4만명", daily300: "3.4만명", subway: "13.8만명", bus: "4.1만명", traffic: "9.2만대", target: "2030·B2B 방문객" },
        scores: scoreSet([["기업·오피스", 5], ["대형몰·상업시설", 5], ["지역명소", 4], ["교통접점", 4], ["행사연계", 5]]),
        facilities: facilitySet([["주요 교통", "삼성역, 봉은사역, 테헤란로"], ["지역 명소", "코엑스, 무역센터, 별마당길, K-POP 광장"], ["상업 시설", "백화점, 쇼핑몰, 영화관, 호텔"], ["기업·오피스", "무역센터, 테헤란로 업무시설, 컨벤션 방문 기업"], ["행사", "전시회, 컨퍼런스, 브랜드 팝업, K-콘텐츠 행사"]]),
        audience: audienceSet([["평일 업무·전시", 88, "오피스·컨벤션"], ["주말 쇼핑·관광", 78, "체류형 방문"], ["2030 활동층", 82, "문화·쇼핑"], ["프리미엄 소비층", 74, "백화점·호텔"]]),
      });
    }
    if (/서울역|KTX|seoul-station|transport/i.test(text)) {
      return withAreaTransit({
        location: "철도, 지하철, 버스, 택시 동선이 집중되는 광역 교통 허브입니다. 출퇴근·출장·관광객이 반복적으로 교차해 단기간 고빈도 노출과 전국 단위 도달 메시지에 유리합니다.",
        traffic: "평일 출퇴근 피크와 주말 여행 수요가 모두 발생합니다. 이동 목적이 뚜렷한 이용자가 많아 금융, 통신, 여행, 공공 캠페인 고지에 적합합니다.",
        stats: { daily500: "9.1만명", daily300: "3.7만명", subway: "18.6만명", bus: "5.4만명", traffic: "8.8만대", target: "출퇴근·출장객" },
        scores: scoreSet([["교통접점", 5], ["광역도달", 5], ["기업·오피스", 4], ["관광동선", 4], ["상업시설", 3]]),
        facilities: facilitySet([["주요 교통", "서울역, KTX, 공항철도, 지하철 1·4호선"], ["지역 명소", "서울로, 남대문, 도심 관광 동선"], ["상업 시설", "역사 상업시설, 호텔, F&B"], ["기업·오피스", "서울역 인근 업무지구, 도심 기관"], ["행사", "여행 성수기, 공공 캠페인, 광역 프로모션"]]),
        audience: audienceSet([["출퇴근 피크", 86, "반복 노출"], ["출장·관광객", 90, "광역 이동"], ["주말 여행", 76, "목적형 방문"], ["고지 수용도", 80, "이동 전 대기"]]),
      });
    }
    if (/광화문|종로|시청|청계|gwanghwamun|jongno|jung/i.test(text)) {
      return withAreaTransit({
        location: "광화문, 청계광장, 시청, 종로 업무지구를 연결하는 서울 도심 랜드마크 입지입니다. 관광·문화·공공행사 동선과 오피스 유동이 함께 발생해 신뢰도 높은 브랜드 노출에 적합합니다.",
        traffic: "평일에는 직장인 출퇴근·점심 유동이 강하고, 주말에는 관광객과 행사 방문객 비중이 커집니다. 축제·문화행사 시 체류 시간이 길어져 반복 노출이 가능합니다.",
        stats: { daily500: "7.9만명", daily300: "3.2만명", subway: "11.7만명", bus: "4.6만명", traffic: "7.4만대", target: "직장인·관광객" },
        scores: scoreSet([["지역명소", 5], ["기업·오피스", 5], ["교통접점", 4], ["관광·행사", 5], ["상업시설", 4]]),
        facilities: facilitySet([["주요 교통", "광화문역, 시청역, 종각역, 세종대로"], ["지역 명소", "청계광장, 광화문광장, 세종문화회관, 덕수궁"], ["상업 시설", "무교동·종로 상권, F&B, 관광특구"], ["기업·오피스", "서울시청, 금융기관, 언론사, 대기업 오피스"], ["행사", "서울페스티벌, 빛초롱축제, 도심 문화행사"]]),
        audience: audienceSet([["평일 직장인", 86, "출퇴근·점심"], ["주말 관광객", 78, "도심 명소"], ["행사 체류", 84, "반복 노출"], ["40대 이상", 72, "구매력 높은 층"]]),
      });
    }
    return withAreaTransit({
      location: "강남대로, 도산대로, 신사·청담 상권을 잇는 프리미엄 소비 동선입니다. 업무, 뷰티, 패션, F&B, 야간 활동 수요가 겹쳐 브랜드 런칭과 고관여 소비재 캠페인에 적합합니다.",
      traffic: "평일에는 출퇴근·점심 직장인 유동이 안정적이고, 저녁과 주말에는 쇼핑·약속·외식 목적 방문객이 증가합니다. 2030 활동층과 구매력 높은 직장인층을 함께 공략할 수 있습니다.",
      stats: { daily500: "7.6만명", daily300: "3.1만명", subway: "12.4만명", bus: "3.8만명", traffic: "8.6만대", target: "2030·직장인" },
      scores: scoreSet([["기업·오피스", 5], ["상업시설", 5], ["지역명소", 4], ["교통접점", 4], ["야간활동", 4]]),
      facilities: facilitySet([["주요 교통", "신사역, 강남대로, 도산대로, 주요 버스 동선"], ["지역 명소", "가로수길, 압구정·청담 상권, 프리미엄 뷰티·패션 거리"], ["상업 시설", "병원, 뷰티, F&B, 쇼룸, 브랜드 플래그십"], ["기업·오피스", "강남 업무시설, 스타트업, 전문직 종사자"], ["행사", "브랜드 팝업, 패션·뷰티 런칭, 시즌 프로모션"]]),
      audience: audienceSet([["평일 직장인", 84, "출퇴근·점심"], ["2030 활동층", 88, "쇼핑·약속"], ["프리미엄 소비", 82, "뷰티·패션"], ["야간 유동", 76, "외식·모임"]]),
    });
  }

  function renderBusStopList(stops) {
    let visibleStops = stops.slice(0, 120);
    if (!selectedBusStopId && stops.length) selectedBusStopId = String(stops[0].id);
    const selectedStop = selectedBusStopId
      ? stops.find((stop) => String(stop.id) === selectedBusStopId)
      : null;
    if (selectedStop && !visibleStops.some((stop) => String(stop.id) === selectedBusStopId)) {
      visibleStops = [selectedStop, ...visibleStops].slice(0, 120);
    }
    if (selectedBusStopId && !stops.some((stop) => String(stop.id) === selectedBusStopId)) {
      selectedBusStopId = stops.length ? String(stops[0].id) : "";
      visibleStops = stops.slice(0, 120);
    }
    listRoot.innerHTML = visibleStops.length
      ? visibleStops.map(busStopCard).join("")
      : `<div class="empty">조건에 맞는 버스 정류장 광고가 없습니다.</div>`;

    listRoot.querySelectorAll("[data-map-bus-stop]").forEach((button) => {
      button.addEventListener("click", () => focusBusStop(button.dataset.mapBusStop));
    });
  }

  function busStopSummaryRow(label, items) {
    const values = items.filter(([, value]) => value);
    if (!values.length) return "";
    return `
      <div class="map-bus-stop-summary-row">
        <dt>${AdPlay.esc(label)}</dt>
        <dd>${values.map(([itemLabel, value]) => `
          <span><b>${AdPlay.esc(itemLabel)}</b>${AdPlay.esc(value)}</span>
        `).join("")}</dd>
      </div>`;
  }

  function busStopRawFaceCode(value) {
    return /\d{2}-\d{3}_\d+_\d+/.test(String(value || ""));
  }

  function busStopFaceNumbers(product) {
    const sourceFaces = Array.isArray(product.faces) && product.faces.length
      ? product.faces
      : String(product.faceLabel || "").split(",");
    const numbers = sourceFaces
      .map((face) => String(face || "").trim())
      .map((face) => {
        const rawMatch = face.match(/\d{2}-\d{3}_\d+_(\d+)$/);
        if (rawMatch) return rawMatch[1];
        const labelMatch = face.match(/(\d+)\s*면/);
        if (labelMatch) return labelMatch[1];
        return "";
      })
      .filter(Boolean);
    const uniqueNumbers = [...new Set(numbers
      .map(Number)
      .filter(Boolean)
      .map((number) => ((number - 1) % 4) + 1))]
      .sort((a, b) => a - b);
    return uniqueNumbers.length ? uniqueNumbers : ["1", "2"];
  }

  function compactBusStopFaceLabel(numbers) {
    const numeric = [...new Set(numbers.map(Number).filter(Boolean))].sort((a, b) => a - b);
    if (!numeric.length) return "";
    const groups = [];
    let index = 0;
    while (index < numeric.length) {
      const first = numeric[index];
      const second = numeric[index + 1];
      if (second === first + 1) {
        groups.push(`${first}, ${second}면`);
        index += 2;
      } else {
        groups.push(`${first}면`);
        index += 1;
      }
    }
    return groups.join(", ");
  }

  function busStopFaceLabel(product) {
    const rawLabel = String(product.faceLabel || "").trim();
    if (rawLabel && !busStopRawFaceCode(rawLabel)) return rawLabel;
    const normalized = compactBusStopFaceLabel(busStopFaceNumbers(product));
    return normalized || rawLabel || "확인 필요";
  }

  function busStopTypeImage(product) {
    const type = String(product.productType || "").toUpperCase().replace(/\s+/g, "");
    const match = type.match(/\b(A-1|A-2|A|B-1|B-2|B-3|B)\b/);
    const imageKey = match ? match[1] : "A";
    return `assets/images/bus-stops/${imageKey}.png?v=bus-photo-original-20260621`;
  }

  function busStopFaceImage(product) {
    const type = String(product.productType || "").toUpperCase();
    const compactType = type.replace(/\s+/g, "");
    const faceLabel = busStopFaceLabel(product);
    const compactFace = faceLabel.replace(/\s+/g, "");
    const hasSingleFace = /(^|,)1면($|,)|(^|,)2면($|,)|1,2면/.test(compactFace)
      && !/(3,4면|3,5면|5,6면|총8면)/.test(compactFace);
    const hasAType = /(^|\/)A(-\d)?($|\/)/.test(compactType);
    const hasSideFace = hasAType || /1,3면|2,4면|광역형\(A\)|광역형\(B\)/.test(`${compactFace}${type}`);
    if (/B-3/.test(type) || hasSingleFace) {
      return "assets/images/bus-stops/ad-face-single-horizontal.png";
    }
    if (hasSideFace) {
      return "assets/images/bus-stops/ad-face-side-horizontal.png";
    }
    return "assets/images/bus-stops/ad-face-double-horizontal.png";
  }

  function busStopVisual(product) {
    const kindLabel = product.displayLabel || "고정형";
    const typeLabel = product.productType || "버스 쉘터";
    const faceLabel = busStopFaceLabel(product);
    return `
      <div class="map-bus-stop-visual" aria-label="버스 정류장 광고 타입 및 광고면 위치">
        <figure class="map-bus-stop-type-preview">
          <img src="${AdPlay.esc(busStopTypeImage(product))}" alt="${AdPlay.esc(typeLabel)} 타입 예시">
          <figcaption>
            <strong>${AdPlay.esc(kindLabel)}</strong>
            <span>${AdPlay.esc(typeLabel)}</span>
          </figcaption>
        </figure>
        <figure class="map-bus-stop-face-preview">
          <img src="${AdPlay.esc(busStopFaceImage(product))}" alt="버스 쉘터 광고면 위치 안내">
          <figcaption>광고면 ${AdPlay.esc(faceLabel)}</figcaption>
        </figure>
      </div>`;
  }

  function busStopCard(stop) {
    const product = stop.adProduct || {};
    const isActive = selectedBusStopId === String(stop.id);
    const title = product.stationName || stop.name;
    const arsLabel = stop.ars ? `ID ${stop.ars}` : "";
    const monthly = product.monthlyCostLabel || formatBusWon(product.minMonthlyCost) || "비용 문의";
    const vatNote = monthly === "비용 문의" ? "" : "* 부가세 별도";
    const summaryRows = [
      busStopSummaryRow("위치", [["자치구", product.district], ["동명", product.dong], ["정류소명", title], ["주소", product.address]]),
      busStopSummaryRow("상품", [["타입", product.productType], ["등급", product.grade], ["광고면", busStopFaceLabel(product)], ["조명", product.light || product.displayLabel]]),
      busStopSummaryRow("비용·유동", [["월광고비", monthly], ["출력/부착비", product.installationCostLabel || "80,000원"], ["월 승하차객수", product.ridershipLabel || "확인 필요"]]),
      busStopSummaryRow("규격", [["외경", product.outerSize], ["내경", product.innerSize]]),
    ].join("");
    return `
      <article class="map-list-card map-bus-stop-card${isActive ? " is-active" : ""}">
        <button type="button" data-map-bus-stop="${AdPlay.esc(String(stop.id))}" aria-label="${AdPlay.esc(title)} 위치 보기" aria-current="${isActive ? "true" : "false"}"></button>
        <div class="map-list-card-body">
          <div class="map-list-title-row map-bus-title-row">
            <h2>${AdPlay.esc(title)}${arsLabel ? `<span class="map-bus-stop-ars">${AdPlay.esc(arsLabel)}</span>` : ""}</h2>
            ${favStarButton("bus:" + stop.id, title, "map-card-fav")}
            <strong class="map-bus-stop-price">${AdPlay.esc(monthly)}${vatNote ? `<small>${AdPlay.esc(vatNote)}</small>` : ""}</strong>
          </div>
          ${isActive ? `<span class="map-bus-stop-selected-label">지도에서 선택한 정류장</span>` : ""}
          <dl class="map-bus-stop-summary">${summaryRows}</dl>
          ${busStopVisual(product)}
        </div>
      </article>`;
  }

  function areaBusTotal(area) {
    return (area?.busMonthlyUsers || []).reduce((sum, stop) => sum + Number(stop.users || 0), 0) || null;
  }

  function areaSubwayTotal(area) {
    return (area?.subwayMonthlyUsers || []).reduce((sum, station) => sum + Number(station.users || 0), 0) || null;
  }

  function compactPeople(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return number >= 10000 ? `${(number / 10000).toFixed(1)}만명` : `${AdPlay.formatNumber(number)}명`;
  }

  function scoreSet(scores) {
    return scores.map(([label, value]) => ({ label, value }));
  }

  function facilitySet(rows) {
    return rows.map(([label, value]) => ({ label, value }));
  }

  function audienceSet(rows) {
    return rows.map(([label, value, note]) => ({ label, value, note }));
  }

  // 매체 자체 사진(images)이 있으면 그것만 사용. 없는 매체는 기존처럼 샘플 사진으로 대체.
  function ownImages(item) {
    return Array.isArray(item && item.images) ? item.images.filter(Boolean) : [];
  }

  function cardImages(item) {
    const own = ownImages(item);
    if (own.length) return own.length >= 2 ? own.slice(0, 2) : [own[0], own[0]];
    const samples = {
      gangnam: ["assets/images/map-samples/gangnam-wide.jpg", "assets/images/map-samples/gangnam-close.jpg"],
      cheonggye: ["assets/images/map-samples/cheonggye-wide.jpg", "assets/images/map-samples/cheonggye-close.jpg"],
      gyeongbokgung: ["assets/images/map-samples/gwanghwamun-wide.jpg", "assets/images/map-samples/gwanghwamun-close.jpg"],
    };
    const order = [samples.gangnam, samples.cheonggye, samples.gyeongbokgung];
    const index = Math.max(0, currentItems.findIndex((entry) => entry.slug === item.slug));
    return order[index % order.length];
  }
});
