// Bookmarks data — loaded from bookmarks-data.json
let ALL_BOOKMARKS = [];
let FOLDERS = [];
let activeFolder = "All";
let activeView = "media";
let DISPLAY_BOOKMARKS = [];

const isLowSpecDevice = () => {
  const memory = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  return memory <= 4 || cores <= 4 || window.innerWidth < 900;
};

const CONFIG = {
  MEDIA_COLS: 5,
  CARD_COLS: 4,
  CANVAS_COLS: 5,
  GAP: 18,
  easingFactor: 0.1,
  POOL_SIZE: isLowSpecDevice() ? 260 : 420,
  BUFFER: isLowSpecDevice() ? 320 : 600, // px buffer outside viewport to pre-render
  CANVAS_STEP: 700,
  CANVAS_FOCAL: 1100,
  CANVAS_NEAR: 140,
  CANVAS_FAR: isLowSpecDevice() ? 3200 : 5200,
  CANVAS_DEPTH_SPACING: 720,
  CANVAS_LAYER_ROWS: 3,
};

const state = {
  cameraOffset: { x: 0, y: 0, z: 0 },
  targetOffset: { x: 0, y: 0, z: 0 },
  isDragging: false,
  previousMousePosition: { x: 0, y: 0 },
  dragStartPosition: { x: 0, y: 0 },
  hasDragged: false,
  touchStart: null,
  lightboxOpen: false,
  lightboxItem: null,
  lightboxAnimating: false,
};

const viewport = document.getElementById("viewport");
const container = document.getElementById("container");
const grid = document.getElementById("grid");
const overlay = document.getElementById("lightbox-overlay");
const lightboxClose = document.getElementById("lightbox-close");
const lightboxTitle = document.getElementById("lightbox-title");
const lightboxLink = document.getElementById("lightbox-link");
const lightboxMeta = document.getElementById("lightbox-meta");

// --- Masonry layout data (pure data, no DOM) ---
let layoutItems = []; // flat array: { key, bookmark, x, y, w, h }
let colWidth = 0;
let totalWidth = 0;
let maxColHeight = 0;
let canvasDepthPeriod = CONFIG.CANVAS_DEPTH_SPACING;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value) => {
  const date = parseDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const escapeHtml = (value = "") =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const lineClampText = (value = "", maxLength = 180) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
};

const formatCount = (value = 0) => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${value}`;
};

const getTimelineEntries = (bookmark) => {
  const posted = formatDate(bookmark.postedAt);
  const saved = formatDate(bookmark.bookmarkedAt);
  const synced = formatDate(bookmark.syncedAt);

  const entries = [];
  if (posted) entries.push({ label: "Posted", value: posted });
  if (saved) entries.push({ label: "Saved", value: saved });
  else if (synced) entries.push({ label: "Synced", value: synced });
  return entries;
};

const getTimelineText = (bookmark) =>
  getTimelineEntries(bookmark)
    .map((entry) => `${entry.label} ${entry.value}`)
    .join("  •  ");

const estimateCardHeight = (bookmark, itemWidth) => {
  const hasImage = bookmark.images && bookmark.images.length > 0;
  const imageHeight = hasImage
    ? clamp(itemWidth / (bookmark.images[0].width / bookmark.images[0].height), 140, 240)
    : 0;
  const text = lineClampText(bookmark.text || "", 150);
  const charsPerLine = Math.max(24, Math.floor(itemWidth / 8.8));
  const textLines = clamp(Math.ceil(text.length / charsPerLine), 2, 5);
  const textHeight = textLines * 18;
  const timelineRows = getTimelineEntries(bookmark).length > 0 ? 1 : 0;
  const timelineHeight = timelineRows * 22;
  return imageHeight + textHeight + timelineHeight + 92;
};

const getFilteredBookmarks = () => {
  const folderFiltered =
    activeFolder === "All"
      ? ALL_BOOKMARKS
      : ALL_BOOKMARKS.filter(
          (bookmark) =>
            bookmark.folders && bookmark.folders.includes(activeFolder)
        );

  if (activeView === "media" || activeView === "canvas") {
    return folderFiltered.filter(
      (bookmark) => bookmark.images && bookmark.images.length > 0
    );
  }

  return folderFiltered;
};

const setDisplayBookmarks = () => {
  DISPLAY_BOOKMARKS = getFilteredBookmarks();
};

const getColumnsCount = () => {
  if (activeView === "media") return CONFIG.MEDIA_COLS;
  if (activeView === "canvas") return CONFIG.CANVAS_COLS;
  return CONFIG.CARD_COLS;
};

const buildCanvasLayout = () => {
  const gap = CONFIG.GAP;
  const columnsCount = CONFIG.CANVAS_COLS;
  const rowsPerLayer = CONFIG.CANVAS_LAYER_ROWS;
  const itemW = Math.max(180, Math.floor(window.innerWidth * 0.18));
  const itemH = Math.round(itemW * 0.72);
  const xSpacing = Math.max(itemW * 1.9, 360);
  const ySpacing = Math.max(itemH * 1.9, 290);
  const itemsPerLayer = columnsCount * rowsPerLayer;
  const worldWidth = xSpacing * (columnsCount + 1.5);
  const worldHeight = ySpacing * (rowsPerLayer + 1.2);
  const totalLayers = Math.max(1, Math.ceil(DISPLAY_BOOKMARKS.length / itemsPerLayer));

  layoutItems = DISPLAY_BOOKMARKS.map((bookmark, index) => {
    const layerIndex = Math.floor(index / itemsPerLayer);
    const slot = index % itemsPerLayer;
    const col = slot % columnsCount;
    const row = Math.floor(slot / columnsCount);
    const jitterX = ((index * 37) % 17 - 8) * 36;
    const jitterY = ((index * 29) % 15 - 7) * 28;
    const depthJitter = ((index * 17) % 9 - 4) * 48;
    const scaleJitter = ((index * 19) % 5 - 2) * 18;

    return {
      key: `canvas-${index}`,
      bookmark,
      x: (col - (columnsCount - 1) / 2) * xSpacing + jitterX,
      y: (row - (rowsPerLayer - 1) / 2) * ySpacing + jitterY,
      z: layerIndex * CONFIG.CANVAS_DEPTH_SPACING + depthJitter,
      w: itemW + scaleJitter,
      h: Math.round((itemH + scaleJitter * 0.72)),
    };
  });

  colWidth = worldWidth;
  totalWidth = worldWidth;
  maxColHeight = worldHeight;
  canvasDepthPeriod = totalLayers * CONFIG.CANVAS_DEPTH_SPACING;
};

const buildMasonryLayout = () => {
  if (activeView === "canvas") {
    buildCanvasLayout();
    return;
  }

  const vw = window.innerWidth;
  const gap = CONFIG.GAP;
  const columnsCount = getColumnsCount();

  colWidth = Math.floor((vw - gap) / columnsCount);
  totalWidth = colWidth * columnsCount;

  const colHeights = new Array(columnsCount).fill(0);
  const columns = Array.from({ length: columnsCount }, () => []);

  if (DISPLAY_BOOKMARKS.length === 0) {
    layoutItems = [];
    maxColHeight = window.innerHeight;
    return;
  }

  for (const bm of DISPLAY_BOOKMARKS) {
    let minCol = 0;
    for (let c = 1; c < columnsCount; c++) {
      if (colHeights[c] < colHeights[minCol]) minCol = c;
    }

    const itemW = colWidth - gap;
    let itemH = itemW;

    if (activeView === "media") {
      const img = bm.images[0];
      const aspect = img.width / img.height;
      itemH = itemW / aspect;
    } else if (activeView === "canvas") {
      const img = bm.images[0];
      const aspect = img.width / img.height;
      const baseHeight = clamp(itemW / aspect, 180, 360);
      const depthOffset = ((minCol + columns[minCol].length) % 3) * 28;
      itemH = baseHeight + depthOffset;
    } else {
      itemH = estimateCardHeight(bm, itemW);
    }

    const x = minCol * colWidth + gap / 2;
    const y = colHeights[minCol] + gap / 2;

    columns[minCol].push({ bookmark: bm, x, y, w: itemW, h: itemH });
    colHeights[minCol] += itemH + gap;
  }

  maxColHeight = Math.max(...colHeights);

  // Flatten into a single array with stable keys
  layoutItems = [];
  for (let col = 0; col < columnsCount; col++) {
    for (let row = 0; row < columns[col].length; row++) {
      const item = columns[col][row];
      layoutItems.push({
        key: `${col}-${row}`,
        ...item,
      });
    }
  }
};

// --- DOM Pool ---
const pool = []; // all pool elements
const freePool = []; // available elements
const activeMap = new Map(); // visKey → { poolEl, layoutItem, screenX, screenY }
const elToBookmark = new WeakMap(); // poolEl → bookmark (for click handler)

const createPool = () => {
  grid.innerHTML = "";
  pool.length = 0;
  freePool.length = 0;
  activeMap.clear();

  for (let i = 0; i < CONFIG.POOL_SIZE; i++) {
    const el = document.createElement("div");
    el.className = "grid-item";
    el.style.display = "none";
    el.innerHTML = `
      <div class="grid-item-media">
        <img src="" alt="" loading="lazy" decoding="async">
      </div>
      <div class="grid-item-body">
        <div class="grid-item-head">
          <div class="grid-item-author"></div>
          <a class="grid-item-handle" href="#" target="_blank" rel="noopener"></a>
        </div>
        <p class="grid-item-text"></p>
        <div class="grid-item-timeline"></div>
        <div class="grid-item-stats"></div>
      </div>
    `;
    grid.appendChild(el);
    pool.push(el);
    freePool.push(el);
  }
};

const acquireElement = () => {
  if (freePool.length === 0) return null;
  const el = freePool.pop();
  el.style.display = "";
  return el;
};

const releaseElement = (el) => {
  el.style.display = "none";
  el.style.visibility = "";
  freePool.push(el);
};

// --- Twitter image sizing ---
// Twitter serves different sizes via ?format=jpg&name=small|medium|large|orig
const twitterImageUrl = (url, size = "small") => {
  // Strip any existing params
  const base = url.split("?")[0];
  const ext = base.match(/\.(jpg|jpeg|png)$/i);
  const format = ext ? ext[1].toLowerCase() : "jpg";
  return `${base}?format=${format}&name=${size}`;
};

const renderCardContent = (el, bookmark, item) => {
  const mediaWrap = el.querySelector(".grid-item-media");
  const body = el.querySelector(".grid-item-body");
  const author = el.querySelector(".grid-item-author");
  const handle = el.querySelector(".grid-item-handle");
  const text = el.querySelector(".grid-item-text");
  const timeline = el.querySelector(".grid-item-timeline");
  const stats = el.querySelector(".grid-item-stats");
  const img = el.querySelector("img");
  const hasImage = bookmark.images && bookmark.images.length > 0;

  el.classList.toggle("grid-item-card", activeView === "card");
  el.classList.toggle("grid-item-canvas", activeView === "canvas");
  el.classList.toggle("grid-item-card-text-only", activeView === "card" && !hasImage);
  mediaWrap.style.display = hasImage ? "" : "none";
  body.style.display = activeView === "card" ? "" : "none";

  if (hasImage) {
    const imageHeight =
      activeView === "card"
        ? clamp(
            item.w / (bookmark.images[0].width / bookmark.images[0].height),
            170,
            320
          )
        : item.h;
    mediaWrap.style.height = `${imageHeight}px`;

    const src = twitterImageUrl(
      bookmark.images[0].url,
      activeView === "card" ? "large" : "medium"
    );
    if (img.src !== src) {
      img.src = src;
      img.alt = bookmark.text.substring(0, 80);
    }
  } else {
    img.removeAttribute("src");
    img.alt = "";
  }

  if (activeView === "card") {
    author.textContent = bookmark.authorName || `@${bookmark.authorHandle}`;
    handle.textContent = `@${bookmark.authorHandle}`;
    handle.href = bookmark.url;
    text.textContent = lineClampText(bookmark.text || "", hasImage ? 150 : 220);
    timeline.textContent = getTimelineText(bookmark);
    timeline.style.display = timeline.textContent ? "" : "none";
    stats.innerHTML = `
      <span>Likes ${formatCount(bookmark.likeCount)}</span>
      <span>Reposts ${formatCount(bookmark.repostCount)}</span>
      <span>Bookmarks ${formatCount(bookmark.bookmarkCount)}</span>
    `;
  }
};

const resetViewportAndRebuild = () => {
  state.cameraOffset.x = 0;
  state.cameraOffset.y = 0;
  state.cameraOffset.z = 0;
  state.targetOffset.x = 0;
  state.targetOffset.y = 0;
  state.targetOffset.z = 0;

  for (const [visKey, entry] of activeMap) {
    releaseElement(entry.poolEl);
    activeMap.delete(visKey);
  }

  buildMasonryLayout();
  renderVisibleItems();
};

// --- Virtualized Renderer ---

const renderFlatVisibleItems = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const buf = CONFIG.BUFFER;

  // The pool element the lightbox is using — don't touch it
  const lightboxEl = state.lightboxItem?.element || null;

  // Use current eased position for rendering transforms
  const camX = state.cameraOffset.x;
  const camY = state.cameraOffset.y;

  // Use the UNION of current + target area for culling,
  // so items at the scroll destination are pre-created
  const minCullX = Math.min(camX, state.targetOffset.x);
  const maxCullX = Math.max(camX, state.targetOffset.x);
  const minCullY = Math.min(camY, state.targetOffset.y);
  const maxCullY = Math.max(camY, state.targetOffset.y);

  // Compute tile range covering the full cull area + buffer
  const startTileX = Math.floor((minCullX - buf) / totalWidth);
  const endTileX = Math.floor((maxCullX + vw + buf) / totalWidth);
  const startTileY = Math.floor((minCullY - buf) / maxColHeight);
  const endTileY = Math.floor((maxCullY + vh + buf) / maxColHeight);

  const visibleThisFrame = new Set();

  for (let i = 0; i < layoutItems.length; i++) {
    const item = layoutItems[i];

    for (let ty = startTileY; ty <= endTileY; ty++) {
      for (let tx = startTileX; tx <= endTileX; tx++) {
        // World position of this item in this tile
        const worldX = item.x + tx * totalWidth;
        const worldY = item.y + ty * maxColHeight;

        // Screen position (for rendering)
        const sx = worldX - camX;
        const sy = worldY - camY;

        // Also check against target position (for pre-loading)
        const txs = worldX - state.targetOffset.x;
        const tys = worldY - state.targetOffset.y;

        // Visible if on screen at current cam OR at target cam
        const visibleAtCam =
          sx + item.w >= -buf && sx <= vw + buf &&
          sy + item.h >= -buf && sy <= vh + buf;
        const visibleAtTarget =
          txs + item.w >= -buf && txs <= vw + buf &&
          tys + item.h >= -buf && tys <= vh + buf;

        if (!visibleAtCam && !visibleAtTarget) {
          continue;
        }

        const visKey = `${item.key}_${tx}_${ty}`;
        visibleThisFrame.add(visKey);

        const existing = activeMap.get(visKey);
        if (existing) {
          // Don't reposition the element the lightbox is using (it's hidden)
          if (existing.poolEl !== lightboxEl) {
            existing.poolEl.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
          }
          existing.screenX = sx;
          existing.screenY = sy;
        } else {
          const el = acquireElement();
          if (!el) continue;

          el.style.width = `${item.w}px`;
          el.style.height = `${item.h}px`;
          el.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
          renderCardContent(el, item.bookmark, item);

          elToBookmark.set(el, item.bookmark);
          activeMap.set(visKey, {
            poolEl: el,
            layoutItem: item,
            screenX: sx,
            screenY: sy,
          });
        }
      }
    }
  }

  // Release elements that are no longer visible
  // But never release the element the lightbox is using
  for (const [visKey, entry] of activeMap) {
    if (!visibleThisFrame.has(visKey) && entry.poolEl !== lightboxEl) {
      releaseElement(entry.poolEl);
      elToBookmark.delete(entry.poolEl);
      activeMap.delete(visKey);
    }
  }
};

const renderCanvasVisibleItems = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const centerX = vw / 2;
  const centerY = vh / 2;
  const lightboxEl = state.lightboxItem?.element || null;
  const visibleThisFrame = new Set();
  const tileRange =
    canvasDepthPeriod > 0
      ? Math.max(1, Math.ceil((CONFIG.CANVAS_FAR - CONFIG.CANVAS_NEAR) / canvasDepthPeriod) + 1)
      : 1;

  for (let i = 0; i < layoutItems.length; i++) {
    const item = layoutItems[i];

    for (let tz = -tileRange; tz <= tileRange; tz++) {
      const worldZ = item.z + tz * canvasDepthPeriod;
      const relativeZ = worldZ - state.cameraOffset.z;

      if (relativeZ < CONFIG.CANVAS_NEAR || relativeZ > CONFIG.CANVAS_FAR) {
        continue;
      }

      const scale = CONFIG.CANVAS_FOCAL / relativeZ;
      const projectedW = item.w * scale;
      const projectedH = item.h * scale;
      const sx = centerX + (item.x - state.cameraOffset.x) * scale - projectedW / 2;
      const sy = centerY + (item.y - state.cameraOffset.y) * scale - projectedH / 2;

      if (
        sx + projectedW < -CONFIG.BUFFER ||
        sx > vw + CONFIG.BUFFER ||
        sy + projectedH < -CONFIG.BUFFER ||
        sy > vh + CONFIG.BUFFER
      ) {
        continue;
      }

      const visKey = `${item.key}_${tz}`;
      visibleThisFrame.add(visKey);
      const existing = activeMap.get(visKey);

      if (existing) {
        if (existing.poolEl !== lightboxEl) {
          existing.poolEl.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
          existing.poolEl.style.width = `${projectedW}px`;
          existing.poolEl.style.height = `${projectedH}px`;
          existing.poolEl.style.zIndex = `${Math.round(10000 - relativeZ)}`;
        }
        existing.screenX = sx;
        existing.screenY = sy;
      } else {
        const el = acquireElement();
        if (!el) continue;

        el.style.width = `${projectedW}px`;
        el.style.height = `${projectedH}px`;
        el.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
        el.style.zIndex = `${Math.round(10000 - relativeZ)}`;
        renderCardContent(el, item.bookmark, { ...item, h: projectedH, w: projectedW });

        elToBookmark.set(el, item.bookmark);
        activeMap.set(visKey, {
          poolEl: el,
          layoutItem: item,
          screenX: sx,
          screenY: sy,
        });
      }
    }
  }

  for (const [visKey, entry] of activeMap) {
    if (!visibleThisFrame.has(visKey) && entry.poolEl !== lightboxEl) {
      releaseElement(entry.poolEl);
      elToBookmark.delete(entry.poolEl);
      activeMap.delete(visKey);
    }
  }
};

const renderVisibleItems = () => {
  if (activeView === "canvas") {
    renderCanvasVisibleItems();
    return;
  }

  renderFlatVisibleItems();
};

// --- Lightbox ---

const DRAG_THRESHOLD = 5;

const easeInOutQuart = (t) =>
  t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

// Slight overshoot then settle — gives a soft bounce
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const animateValue = (from, to, duration, onUpdate, onDone, easing = easeInOutQuart) => {
  const start = performance.now();
  const tick = (now) => {
    const elapsed = Math.min((now - start) / duration, 1);
    const eased = easing(elapsed);
    onUpdate(from + (to - from) * eased);
    if (elapsed < 1) requestAnimationFrame(tick);
    else if (onDone) onDone();
  };
  requestAnimationFrame(tick);
};

let lightboxClone = null;

const openLightbox = (el, bookmark) => {
  if (state.lightboxOpen || state.lightboxAnimating) return;
  if (!bookmark.images || bookmark.images.length === 0) {
    window.open(bookmark.url, "_blank");
    return;
  }

  state.lightboxAnimating = true;
  state.lightboxOpen = true;
  state.lightboxItem = { element: el, bookmark };

  const rect = el.getBoundingClientRect();

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = vw * 0.7;
  const maxH = vh * 0.7;

  const aspectRatio = rect.width / rect.height;
  let targetW, targetH;
  if (maxW / maxH > aspectRatio) {
    targetH = maxH;
    targetW = targetH * aspectRatio;
  } else {
    targetW = maxW;
    targetH = targetW / aspectRatio;
  }

  const startX = rect.left;
  const startY = rect.top;
  const startW = rect.width;
  const startH = rect.height;
  // End position: centered in viewport at target size
  const endX = (vw - targetW) / 2;
  const endY = (vh - targetH) / 2;

  el.style.visibility = "hidden";

  lightboxClone = el.cloneNode(true);
  const clonedBody = lightboxClone.querySelector(".grid-item-body");
  if (clonedBody) clonedBody.remove();
  const clonedMedia = lightboxClone.querySelector(".grid-item-media");
  if (clonedMedia) clonedMedia.style.height = "100%";
  lightboxClone.classList.add("lightbox-active");
  lightboxClone.style.width = `${startW}px`;
  lightboxClone.style.height = `${startH}px`;
  lightboxClone.style.display = "";
  lightboxClone.style.visibility = "visible";
  lightboxClone.style.zIndex = "40001";
  lightboxClone.style.transform = `translate3d(${startX}px, ${startY}px, 0)`;
  // Layer high-res image on top that fades in when loaded
  if (bookmark) {
    const hiRes = new Image();
    hiRes.src = twitterImageUrl(bookmark.images[0].url, "4096x4096");
    hiRes.alt = "";
    hiRes.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:24px;opacity:0;transition:opacity 0.3s ease;";
    hiRes.onload = () => { hiRes.style.opacity = "1"; };
    lightboxClone.appendChild(hiRes);

    // For videos, add a play button that opens the tweet in a new tab
    if (bookmark.images[0].type === "video" || bookmark.images[0].type === "animated_gif") {
      const playBtn = document.createElement("button");
      playBtn.className = "lightbox-play-btn";
      playBtn.innerHTML = `<span class="play-pill"><img src="assets/play-icon.svg" class="play-pill-icon" alt=""><span>Play on Twitter</span></span>`;
      playBtn.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;z-index:2;pointer-events:auto;";
      playBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.open(bookmark.url, "_blank");
      });
      lightboxClone.appendChild(playBtn);
    }
  }
  document.body.appendChild(lightboxClone);

  overlay.classList.add("active");

  if (bookmark) {
    lightboxTitle.textContent =
      bookmark.text.length > 120
        ? bookmark.text.substring(0, 120) + "…"
        : bookmark.text;
    lightboxLink.href = bookmark.url;
    lightboxLink.textContent = `@${bookmark.authorHandle}`;
    lightboxMeta.textContent = getTimelineText(bookmark);
  }

  // Position info just below the media
  const lightboxInfo = document.getElementById("lightbox-info");
  lightboxInfo.style.top = `${endY + targetH + 16}px`;

  // Store for close animation
  state.lightboxItem._startX = startX;
  state.lightboxItem._startY = startY;
  state.lightboxItem._startW = startW;
  state.lightboxItem._startH = startH;
  state.lightboxItem._endX = endX;
  state.lightboxItem._endY = endY;
  state.lightboxItem._endW = targetW;
  state.lightboxItem._endH = targetH;

  // Scale duration with travel distance so far items don't rush
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const baseDuration = 0.45;
  const springDuration = baseDuration + Math.min(distance / 2000, 0.25);
  const springTransition = { type: "spring", duration: springDuration, bounce: 0.15 };

  Motion.animate(
    lightboxClone,
    {
      width: [`${startW}px`, `${targetW}px`],
      height: [`${startH}px`, `${targetH}px`],
      transform: [
        `translate3d(${startX}px, ${startY}px, 0)`,
        `translate3d(${endX}px, ${endY}px, 0)`,
      ],
    },
    springTransition
  ).then(() => {
    state.lightboxAnimating = false;
  });

  // Animate play pill in partway through the lightbox animation
  setTimeout(() => {
    const pill = lightboxClone?.querySelector(".play-pill");
    if (pill) pill.classList.add("visible");
  }, 200);
};

const closeLightbox = () => {
  if (!state.lightboxOpen || state.lightboxAnimating || !state.lightboxItem)
    return;

  state.lightboxAnimating = true;
  const { element: el } = state.lightboxItem;

  // Hide play pill immediately
  const pill = lightboxClone?.querySelector(".play-pill");
  if (pill) pill.classList.remove("visible");

  overlay.classList.remove("active");

  // Animate from current lightbox size back to the grid element's position
  const originalRect = el.getBoundingClientRect();
  const endX = originalRect.left;
  const endY = originalRect.top;
  const endW = originalRect.width;
  const endH = originalRect.height;

  const fromX = state.lightboxItem._endX;
  const fromY = state.lightboxItem._endY;
  const fromW = state.lightboxItem._endW;
  const fromH = state.lightboxItem._endH;

  const closeTransition = { type: "spring", duration: 0.4, bounce: 0 };

  Motion.animate(
    lightboxClone,
    {
      width: [`${fromW}px`, `${endW}px`],
      height: [`${fromH}px`, `${endH}px`],
      transform: [
        `translate3d(${fromX}px, ${fromY}px, 0)`,
        `translate3d(${endX}px, ${endY}px, 0)`,
      ],
    },
    closeTransition
  ).then(() => {
    lightboxClone.remove();
    lightboxClone = null;
    el.style.visibility = "";
    state.lightboxOpen = false;
    state.lightboxItem = null;
    state.lightboxAnimating = false;
  });
};

// --- Input Handlers ---

const onMouseDown = (e) => {
  if (state.lightboxOpen) return;
  state.isDragging = true;
  state.hasDragged = false;
  state.dragStartPosition = { x: e.clientX, y: e.clientY };
  viewport.classList.add("grabbing");
  state.previousMousePosition = { x: e.clientX, y: e.clientY };
};

const onMouseMove = (e) => {
  if (!state.isDragging) return;

  const totalDx = e.clientX - state.dragStartPosition.x;
  const totalDy = e.clientY - state.dragStartPosition.y;
  if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) > DRAG_THRESHOLD) {
    state.hasDragged = true;
  }

  const deltaX = e.clientX - state.previousMousePosition.x;
  const deltaY = e.clientY - state.previousMousePosition.y;

  state.targetOffset.x -= deltaX;
  state.targetOffset.y -= deltaY;

  state.previousMousePosition = { x: e.clientX, y: e.clientY };
};

const onMouseUp = (e) => {
  const wasDragging = state.isDragging;
  state.isDragging = false;
  viewport.classList.remove("grabbing");

  if (wasDragging && !state.hasDragged && !state.lightboxOpen) {
    const target = e.target.closest(".grid-item");
    if (target) {
      const bookmark = elToBookmark.get(target);
      if (bookmark) openLightbox(target, bookmark);
    }
  }
};

const onTouchStart = (e) => {
  if (e.touches.length === 1) {
    state.touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
};

const onTouchMove = (e) => {
  if (e.touches.length === 1 && state.touchStart) {
    e.preventDefault();
    const deltaX = e.touches[0].clientX - state.touchStart.x;
    const deltaY = e.touches[0].clientY - state.touchStart.y;

    state.targetOffset.x -= deltaX;
    state.targetOffset.y -= deltaY;

    state.touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
};

const onTouchEnd = () => {
  state.touchStart = null;
};

const onWheel = (e) => {
  e.preventDefault();
  if (state.lightboxOpen) return;
  if (activeView === "canvas") {
    state.targetOffset.z += e.deltaY * 0.9;
    return;
  }
  state.targetOffset.x += e.deltaX;
  state.targetOffset.y += e.deltaY;
};

const onWindowResize = () => {
  CONFIG.POOL_SIZE = isLowSpecDevice() ? 260 : 420;
  CONFIG.BUFFER = isLowSpecDevice() ? 320 : 600;
  CONFIG.CANVAS_STEP = Math.max(620, Math.round(window.innerHeight * 0.9));
  CONFIG.MEDIA_COLS = window.innerWidth < 720 ? 2 : window.innerWidth < 1100 ? 3 : 5;
  CONFIG.CARD_COLS = window.innerWidth < 720 ? 1 : window.innerWidth < 1200 ? 3 : 4;
  CONFIG.CANVAS_COLS = window.innerWidth < 720 ? 3 : window.innerWidth < 1200 ? 4 : 5;
  setDisplayBookmarks();
  createPool();
  resetViewportAndRebuild();
};

// --- Animation Loop ---

const animate = () => {
  requestAnimationFrame(animate);

  const dx = state.targetOffset.x - state.cameraOffset.x;
  const dy = state.targetOffset.y - state.cameraOffset.y;
  const dz = state.targetOffset.z - state.cameraOffset.z;

  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01 || Math.abs(dz) > 0.01) {
    state.cameraOffset.x += dx * CONFIG.easingFactor;
    state.cameraOffset.y += dy * CONFIG.easingFactor;
    state.cameraOffset.z += dz * CONFIG.easingFactor;
    renderVisibleItems();
  }
};

// --- Init ---

// --- Folder filter ---

let isTransitioning = false;

const applyFilter = (folder) => {
  if (isTransitioning || folder === activeFolder) return;
  isTransitioning = true;
  activeFolder = folder;
  updatePillLabel();

  // Animate out
  grid.style.transition = "opacity 0.2s ease";
  grid.style.opacity = "0";

  setTimeout(() => {
    // Swap content while invisible
    setDisplayBookmarks();
    resetViewportAndRebuild();

    // Animate in
    void grid.offsetHeight;
    grid.style.transition = "opacity 0.3s ease";
    grid.style.opacity = "1";

    setTimeout(() => {
      grid.style.transition = "";
      isTransitioning = false;
    }, 300);
  }, 250);
};

const applyView = (view) => {
  if (isTransitioning || view === activeView) return;
  isTransitioning = true;
  activeView = view;
  updateViewToggle();

  grid.style.transition = "opacity 0.2s ease";
  grid.style.opacity = "0";

  setTimeout(() => {
    setDisplayBookmarks();
    resetViewportAndRebuild();

    void grid.offsetHeight;
    grid.style.transition = "opacity 0.3s ease";
    grid.style.opacity = "1";

    setTimeout(() => {
      grid.style.transition = "";
      isTransitioning = false;
    }, 300);
  }, 220);
};

const createFolderPill = () => {
  const pill = document.createElement("div");
  pill.id = "folder-pill";
  pill.className = "folder-pill";
  pill.innerHTML = `<span id="folder-pill-label">All</span><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="3,4.5 6,7.5 9,4.5"/></svg>`;
  document.body.appendChild(pill);

  const dropdown = document.createElement("div");
  dropdown.id = "folder-dropdown";
  dropdown.className = "folder-dropdown";
  document.body.appendChild(dropdown);

  const buildDropdown = () => {
    dropdown.innerHTML = "";
    const options = ["All", ...FOLDERS.map((f) => f.name)];
    for (const name of options) {
      const item = document.createElement("button");
      item.className = "folder-dropdown-item" + (name === activeFolder ? " active" : "");
      item.textContent = name;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        applyFilter(name);
        dropdown.classList.remove("open");
      });
      dropdown.appendChild(item);
    }
  };

  pill.addEventListener("click", (e) => {
    e.stopPropagation();
    buildDropdown();
    dropdown.classList.toggle("open");
  });

  document.addEventListener("click", () => {
    dropdown.classList.remove("open");
  });
};

const updatePillLabel = () => {
  const label = document.getElementById("folder-pill-label");
  if (label) label.textContent = activeFolder;
};

const createViewToggle = () => {
  const toggle = document.createElement("div");
  toggle.id = "view-toggle";
  toggle.className = "view-toggle";
  toggle.innerHTML = `
    <button type="button" data-view="media" class="view-toggle-btn active">Media</button>
    <button type="button" data-view="card" class="view-toggle-btn">Cards</button>
    <button type="button" data-view="canvas" class="view-toggle-btn">Canvas</button>
  `;

  toggle.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    applyView(button.dataset.view);
  });

  document.body.appendChild(toggle);
};

const updateViewToggle = () => {
  document.querySelectorAll(".view-toggle-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === activeView);
  });
};

const nudgeCanvas = (direction) => {
  if (activeView !== "canvas") return;
  state.targetOffset.z += CONFIG.CANVAS_STEP * direction;
};

// --- Init ---

const init = async () => {
  try {
    const res = await fetch("./bookmarks-data.json");
    const data = await res.json();
    // Support both old format (array) and new format ({ folders, bookmarks })
    if (Array.isArray(data)) {
      ALL_BOOKMARKS = data;
      FOLDERS = [];
    } else {
      ALL_BOOKMARKS = data.bookmarks || [];
      FOLDERS = data.folders || [];
    }
    setDisplayBookmarks();
    console.log(
      `Loaded ${ALL_BOOKMARKS.length} bookmarks, ${FOLDERS.length} folders`
    );
  } catch (e) {
    console.error("Failed to load bookmarks data:", e);
    return;
  }

  CONFIG.MEDIA_COLS = window.innerWidth < 720 ? 2 : window.innerWidth < 1100 ? 3 : 5;
  CONFIG.CARD_COLS = window.innerWidth < 720 ? 1 : window.innerWidth < 1200 ? 3 : 4;
  CONFIG.CANVAS_COLS = window.innerWidth < 720 ? 3 : window.innerWidth < 1200 ? 4 : 5;
  buildMasonryLayout();
  createPool();
  renderVisibleItems();
  createFolderPill();
  createViewToggle();
  updateViewToggle();

  // Pre-warm Motion's animation engine so first lightbox open doesn't stutter
  const warmup = document.createElement("div");
  warmup.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;";
  document.body.appendChild(warmup);
  Motion.animate(warmup, { opacity: [0, 1] }, { duration: 0.01 }).then(() => warmup.remove());

  viewport.addEventListener("mousedown", onMouseDown);
  viewport.addEventListener("mousemove", onMouseMove);
  viewport.addEventListener("mouseup", onMouseUp);
  viewport.addEventListener("mouseleave", onMouseUp);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("touchstart", onTouchStart);
  viewport.addEventListener("touchmove", onTouchMove, { passive: false });
  viewport.addEventListener("touchend", onTouchEnd);
  window.addEventListener("resize", onWindowResize);

  lightboxClose.addEventListener("click", (e) => {
    e.stopPropagation();
    closeLightbox();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeLightbox();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.lightboxOpen) closeLightbox();
    if (activeView === "canvas" && !state.lightboxOpen) {
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
        nudgeCanvas(-1);
      } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
        nudgeCanvas(1);
      }
    }
  });

  animate();
};

init();
