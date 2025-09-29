const logoInput = document.getElementById("logoFile");
const tilesInput = document.getElementById("tilesFile");
const thumbs = document.getElementById("thumbs");
const outW = document.getElementById("outW");
const outH = document.getElementById("outH");
const cols = document.getElementById("cols");
const rows = document.getElementById("rows");
const blend = document.getElementById("blend");
const blendVal = document.getElementById("blendVal");
const layout = document.getElementById("layout");
const shuffleSel = document.getElementById("shuffle");
const renderBtn = document.getElementById("renderBtn");
const dlBtn = document.getElementById("dlBtn");
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d", { willReadFrequently: true });
const pxMeta = document.getElementById("pxMeta");
const preset = document.getElementById("preset");
const dlSvgBtn = document.getElementById("dlSvgBtn");
const hoverPreview = document.getElementById("hoverPreview");
const hoverImg = document.getElementById("hoverImg");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const HAS_OFFSCREEN = typeof OffscreenCanvas !== "undefined";
const logoMode = document.getElementById("logoMode");
const logoAlpha = document.getElementById("logoAlpha");
const logoAlphaVal = document.getElementById("logoAlphaVal");
const tintColor = document.getElementById("tintColor");

logoAlpha.addEventListener("input", () => {
  logoAlphaVal.textContent = logoAlpha.value + "%";
});

let logoImg = null;
let tileImgs = [];
let logoFile = null;
let logoSVGText = null;
let parsedLogo = null; // NEW: parsed SVG details
let tileDataURLs = [];
let lastTilesOrder = [];
let lastRandomPositions = [];
let lastCRSig = null; // NEW: signature for random layout consistency
let drawnTiles = []; // array of {x, y, w, h, img}
let hoverRAF = null;

// NEW: lightweight hover mask buffers
let maskCanvas = null;
let maskCtx = null;
let imgToHref = new Map();

cv.addEventListener("mousemove", (e) => {
  if (!drawnTiles.length || hoverRAF) return;

  const clientX = e.clientX;
  const clientY = e.clientY;

  hoverRAF = requestAnimationFrame(() => {
    hoverRAF = null;

    const rect = cv.getBoundingClientRect();
    const scaleX = cv.width / rect.width;
    const scaleY = cv.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    // mask hit test only in mask mode
    const needMaskCheck = logoMode.value !== "overlay";
    if (needMaskCheck) {
      if (!maskCtx) {
        hoverPreview.style.display = "none";
        return;
      }
      const a = safeAlphaAt(maskCtx, x, y);
      if (a === 0) {
        hoverPreview.style.display = "none";
        return;
      }
    }

    const hit = findTileAt(x, y);
    if (!hit) {
      hoverPreview.style.display = "none";
      return;
    }

    // only update src if changed (prevents flicker / re-decode)
    if (hoverImg.src !== hit.img.src) hoverImg.src = hit.img.src;
    hoverPreview.style.display = "block";

    // position tooltip next frame (so it has dimensions)
    requestAnimationFrame(() => {
      const pad = 16;
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const box = hoverPreview.getBoundingClientRect();
      let left = clientX + pad;
      let top = clientY + pad;
      if (left + box.width > vpW) left = clientX - box.width - pad;
      if (top + box.height > vpH) top = clientY - box.height - pad;
      hoverPreview.style.left = left + "px";
      hoverPreview.style.top = top + "px";
    });
  });
});

function isUnsupportedRaster(type) {
  return /image\/(heic|heif)/i.test(type || "");
}

// pointer helpers
function findTileAt(px, py) {
  // scan backwards to prioritise last drawn for random layout overlaps
  for (let i = drawnTiles.length - 1; i >= 0; i--) {
    const t = drawnTiles[i];
    if (px >= t.x && px < t.x + t.w && py >= t.y && py < t.y + t.h) return t;
  }
  return null;
}

cv.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch") return;
  e.preventDefault();

  const rect = cv.getBoundingClientRect();
  const scaleX = cv.width / rect.width;
  const scaleY = cv.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;

  const needMaskCheck = logoMode.value !== "overlay";
  if (needMaskCheck) {
    if (!maskCtx) return;
    const a = safeAlphaAt(maskCtx, x, y);
    if (a === 0) return;
  }

  const hit = findTileAt(x, y);
  if (!hit) return;

  if (hoverImg.src !== hit.img.src) hoverImg.src = hit.img.src;
  hoverPreview.style.display = "block";

  lightboxImg.src = hit.img.src;
  lightbox.style.display = "flex";
});

// close lightbox on click
lightbox.addEventListener("click", () => {
  lightbox.style.display = "none";
});

function safeAlphaAt(ctx, x, y) {
  try {
    return ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3] || 0;
  } catch {
    return 255; // assume opaque so UX still works
  }
}

// ADD: strict SVG sanitiser and normaliser for decoding
function sanitiseSVG(svgText) {
  // Strip external URLs in href/xlink:href and url(...)
  svgText = svgText.replace(/xlink:href\s*=\s*"(http[^"]+)"/gi, "");
  svgText = svgText.replace(/\shref\s*=\s*"(http[^"]+)"/gi, "");
  svgText = svgText.replace(/url\((['"]?)(http[^)]+)\1\)/gi, "none");

  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;

  // Remove <script> and <foreignObject>
  doc.querySelectorAll("script, foreignObject").forEach((el) => el.remove());

  // Remove any inline event handlers: onload, onclick, etc.
  const walker = doc.createTreeWalker(svg, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    // clone attributes to avoid live list issues
    [...el.attributes].forEach((attr) => {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      // Also remove external refs that slipped through on attributes
      if (
        (attr.name === "href" || attr.name === "xlink:href") &&
        /^http/i.test(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
      // Clean style URLs: url(http...) -> none
      if (attr.name === "style") {
        el.setAttribute(
          "style",
          attr.value.replace(/url\((['"]?)(http[^)]+)\1\)/gi, "none")
        );
      }
    });
  }

  // Ensure viewBox exists and width/height are valid px numbers
  let vb = svg.getAttribute("viewBox");
  let w = svg.getAttribute("width");
  let h = svg.getAttribute("height");

  const isPercent = (v) => v && /%$/.test(v.trim());
  if (!vb) {
    const wNum = parseFloat(w);
    const hNum = parseFloat(h);
    if (wNum > 0 && hNum > 0 && !isNaN(wNum) && !isNaN(hNum)) {
      svg.setAttribute("viewBox", `0 0 ${wNum} ${hNum}`);
    } else {
      svg.setAttribute("viewBox", "0 0 1024 1024");
      w = w || "1024";
      h = h || "1024";
    }
  }
  if (!w || isPercent(w) || parseFloat(w) <= 0)
    svg.setAttribute("width", "1024");
  if (!h || isPercent(h) || parseFloat(h) <= 0)
    svg.setAttribute("height", "1024");

  return new XMLSerializer().serializeToString(svg);
}

function enableIfReady() {
  renderBtn.disabled = !(logoImg && tileImgs.length);
  if (renderBtn.disabled) {
    hoverPreview.style.display = "none";
  }
}

// CHANGED: robust SVG parsing with defs and viewBox preserved
function parseSVG(svgText) {
  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svg = doc.documentElement;
    // collect defs
    const defs = Array.from(svg.querySelectorAll("defs"))
      .map((n) => n.outerHTML)
      .join("\n");
    // collect children except defs
    const children = Array.from(svg.childNodes)
      .filter((n) => n.nodeType === 1 && n.nodeName.toLowerCase() !== "defs")
      .map((n) => n.outerHTML)
      .join("\n");
    // read intrinsic dimensions
    let vbW = null,
      vbH = null;
    const vb = svg.getAttribute("viewBox");
    if (vb) {
      const parts = vb.trim().split(/\s+/).map(Number);
      if (parts.length === 4) {
        vbW = parts[2];
        vbH = parts[3];
      }
    }
    if (!vbW || !vbH) {
      vbW = parseFloat(svg.getAttribute("width")) || 1000;
      vbH = parseFloat(svg.getAttribute("height")) || 1000;
    }
    return { inner: children, defs, vbW, vbH };
  } catch {
    return null;
  }
}

// kept for backward compatibility though no longer used for vectors
function extractSVGInner(svgText) {
  const m = svgText.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  return m ? m[1] : svgText;
}

function setSize(w, h) {
  outW.value = String(w);
  outH.value = String(h);
  syncSize();
}

dlSvgBtn.addEventListener("click", async () => {
  const W = cv.width;
  const H = cv.height;
  const C = Math.max(10, Math.min(400, parseInt(cols.value || 60, 10)));
  const R = Math.max(10, Math.min(400, parseInt(rows.value || 60, 10)));
  const layoutMode = layout.value;
  const blendPct = parseInt(blend.value || 0, 10);
  const mode = logoMode.value; // "overlay" | "mask"
  const overlayAlpha = Math.max(
    0,
    Math.min(1, parseInt(logoAlpha.value || "80", 10) / 100)
  );

  const svgString = await buildSVGString({
    W,
    H,
    C,
    R,
    layoutMode,
    blendPct,
    mode,
    overlayAlpha,
    tint: tintColor.value || "#dddddd",
  });
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const link = document.createElement("a");
  link.download = "metta-logo-mosaic.svg";
  link.href = URL.createObjectURL(blob);
  link.click();
  // CHANGED: revoke on next tick for reliability
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
});

preset.addEventListener("change", () => {
  switch (preset.value) {
    case "square4k":
      setSize(4096, 4096);
      break;
    case "a3p":
      setSize(3508, 4961);
      break;
    case "a3l":
      setSize(4961, 3508);
      break;
    default:
      break;
  }
});

logoInput.addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;

  // Guard unsupported rasters here
  if (isUnsupportedRaster(f.type)) {
    console.error(
      "Unsupported image type. Please convert HEIC HEIF to PNG or JPEG."
    );
    return;
  }

  try {
    console.debug("Logo file type:", f.type);
    logoFile = f;
    logoSVGText = null;
    parsedLogo = null;

    if (f.type === "image/svg+xml") {
      // Use sanitised SVG for both parsing and preview to avoid external refs issues
      const raw = await f.text();
      const clean = sanitiseSVG(raw);
      logoSVGText = clean;
      parsedLogo = parseSVG(clean);
    }

    logoImg = await loadImageFromFile(f); // will also sanitise SVG internally for raster decode
    enableIfReady();
    dlSvgBtn.disabled = !(logoImg && tileImgs.length);
  } catch (err) {
    console.error("Failed to load logo", err);
  }
});

tilesInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files).slice(0, 1000);
  try {
    tileImgs = await Promise.all(files.map(loadImageFromFile));
    tileDataURLs = await Promise.all(
      tileImgs.map((img) => imageToDataURL(img, "image/jpeg", 0.92))
    );
    imgToHref = new Map(tileImgs.map((img, i) => [img, tileDataURLs[i]]));
  } catch (err) {
    console.error("Failed to load one or more tiles", err);
  }
  thumbs.innerHTML = "";
  tileImgs.slice(0, 120).forEach((img) => {
    const t = document.createElement("img");
    t.src = img.src;
    thumbs.appendChild(t);
  });
  enableIfReady();
  dlSvgBtn.disabled = !(logoImg && tileImgs.length);
});

outW.addEventListener("input", syncSize);
outH.addEventListener("input", syncSize);

function syncSize() {
  const w = parseInt(outW.value || 1536, 10);
  const h = parseInt(outH.value || 1536, 10);

  cv.width = Math.max(512, Math.min(8000, w));
  cv.height = Math.max(512, Math.min(8000, h));

  if (pxMeta) {
    pxMeta.textContent = `export ${cv.width} × ${cv.height} px`;
  }
}

syncSize();

blend.addEventListener("input", () => {
  blendVal.textContent = blend.value + "%";
});

renderBtn.addEventListener("click", render);

dlBtn.addEventListener("click", () => {
  cv.toBlob((blob) => {
    if (!blob) {
      console.error(
        "Could not export image. Try a smaller size or fewer tiles."
      );
      return;
    }
    const link = document.createElement("a");
    link.download = "metta-logo-mosaic.png";
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }, "image/png");
});

function drawImageCover(dstCtx, img, dx, dy, dw, dh) {
  const ir = img.width / img.height;
  const dr = dw / dh;
  let sx, sy, sw, sh;
  if (ir > dr) {
    sh = img.height;
    sw = sh * dr;
    sx = (img.width - sw) * 0.5;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / dr;
    sx = 0;
    sy = (img.height - sh) * 0.5;
  }
  dstCtx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function loadImageFromFile(file) {
  // Special case for SVG: avoid createImageBitmap entirely
  // REPLACE the SVG branch inside loadImageFromFile with this
  if (file && file.type === "image/svg+xml") {
    let raw = await file.text();
    const clean = sanitiseSVG(raw);

    const blob = new Blob([clean], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    return await new Promise((resolve, reject) => {
      const img = new Image();
      // ensure immediate decode try
      img.decoding = "sync";
      img.onload = async () => {
        try {
          if ("decode" in img) await img.decode().catch(() => {});
        } finally {
          URL.revokeObjectURL(url);
          resolve(img);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("SVG could not be decoded after sanitising"));
      };
      img.src = url;
    });
  }

  // Raster images: try createImageBitmap first, then fall back cleanly
  if ("createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(file);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      const img = new Image();
      img.src = c.toDataURL("image/png");
      // wait for decode to be safe before returning
      if ("decode" in img) {
        try {
          await img.decode();
        } catch {}
      }
      return img;
    } catch {
      // fall through to object URL path below
    }
  }

  // Fallback path: object URL to Image, with a last-chance FileReader route
  try {
    const url = URL.createObjectURL(file);
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = async () => {
        try {
          if ("decode" in img) await img.decode().catch(() => {});
        } finally {
          URL.revokeObjectURL(url);
          resolve(img);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Raster image could not be decoded"));
      };
      img.src = url;
    });
  } catch {
    // Very rare: some environments need DataURL
    const dataURL = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    const img = new Image();
    img.src = dataURL;
    if ("decode" in img) {
      try {
        await img.decode();
      } catch {}
    }
    return img;
  }
}

// helper  draw an HTMLImageElement into a canvas to get a data URL
async function imageToDataURL(img, mime = "image/png", quality = 0.92) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const cctx = c.getContext("2d");
  cctx.drawImage(img, 0, 0);
  return c.toDataURL(mime, quality);
}

async function buildSVGString({
  W,
  H,
  C,
  R,
  layoutMode,
  blendPct,
  mode = "mask",
  overlayAlpha = 0.8,
  tint = "#dddddd",
}) {
  const tileW = Math.ceil(W / C);
  const tileH = Math.ceil(H / R);

  const orderImgs = lastTilesOrder.length ? lastTilesOrder : tileImgs.slice();

  // logo box
  const lr = logoImg.width / logoImg.height;
  const ar = W / H;
  let lw, lh, lx, ly;
  if (lr > ar) {
    lw = W;
    lh = W / lr;
    lx = 0;
    ly = (H - lh) / 2;
  } else {
    lh = H;
    lw = H * lr;
    ly = 0;
    lx = (W - lw) / 2;
  }

  // CHANGED: regenerate random positions if signature changed
  if (layoutMode !== "grid") {
    const sig = `${C}x${R}x${W}x${H}`;
    if (sig !== lastCRSig) {
      lastRandomPositions = [];
      lastCRSig = sig;
    }
  }

  // defs: clip or mask
  let defs = "";
  let mainClipRef = "";

  if (parsedLogo) {
    const { inner, defs: logoDefs, vbW, vbH } = parsedLogo;
    const sx = lw / vbW;
    const sy = lh / vbH;

    if (mode === "mask") {
      const clipId = "logoClip";
      defs += `
  ${logoDefs || ""}
  <clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">
    <g transform="translate(${lx},${ly}) scale(${sx},${sy})">
      ${inner}
    </g>
  </clipPath>`;
      mainClipRef = `clip-path="url(#${clipId})"`;
    } else {
      // overlay mode will paint vector later, but we still include defs here
      defs += `${logoDefs || ""}`;
    }
  } else if (logoSVGText) {
    // fallback simple inner extract when parse failed
    const clipId = "logoClip";
    const inner = extractSVGInner(logoSVGText);
    const sx = lw / logoImg.width;
    const sy = lh / logoImg.height;
    defs += `
  <clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">
    <g transform="translate(${lx},${ly}) scale(${sx},${sy})">
      ${inner}
    </g>
  </clipPath>`;
    mainClipRef = `clip-path="url(#${clipId})"`;
  } else {
    const maskId = "logoMask";
    const logoDataURL = await imageToDataURL(logoImg, "image/png", 0.92);
    defs += `
  <mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"  x="0" y="0" width="${W}" height="${H}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="black"/>
    <image x="${lx}" y="${ly}" width="${lw}" height="${lh}" href="${logoDataURL}" preserveAspectRatio="xMidYMid meet" />
  </mask>`;
    mainClipRef = `mask="url(#${maskId})"`;
  }

  // tiles
  let tilesMarkup = "";
  if (layoutMode === "grid") {
    let k = 0;
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < C; x++) {
        const img = orderImgs[k % orderImgs.length];
        const href = imgToHref.get(img);
        const dx = x * tileW;
        const dy = y * tileH;
        tilesMarkup += `<image x="${dx}" y="${dy}" width="${tileW}" height="${tileH}" href="${href}" preserveAspectRatio="xMidYMid slice" />\n`;
        k++;
      }
    }
  } else {
    const positions = lastRandomPositions.length
      ? lastRandomPositions
      : (lastRandomPositions = Array.from(
          { length: Math.floor(C * R * 1.1) },
          () => {
            const w = tileW * (0.75 + Math.random() * 0.9);
            return {
              x: Math.random() * (W - w),
              y: Math.random() * (H - w),
              w,
              h: w,
            };
          }
        ));

    for (let i = 0; i < positions.length; i++) {
      const img = orderImgs[i % orderImgs.length];
      const href = imgToHref.get(img);
      if (!href) continue; // guard (shouldn't happen, but safe)
      const { x, y, w, h } = positions[i];
      tilesMarkup += `<image x="${x.toFixed(2)}" y="${y.toFixed(
        2
      )}" width="${w.toFixed(2)}" height="${h.toFixed(
        2
      )}" href="${href}" preserveAspectRatio="xMidYMid slice" />\n`;
    }
  }

  const tintRect =
    blendPct > 0
      ? `<rect x="0" y="0" width="${W}" height="${H}" fill="${tint}" opacity="${(
          blendPct / 100
        ).toFixed(3)}" />`
      : "";

  const baseSvgOpen = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${defs}
  </defs>`;

  // overlay branch
  if (mode === "overlay") {
    let overlayLogo;
    if (parsedLogo) {
      const { inner, vbW, vbH } = parsedLogo;
      const sx = lw / vbW;
      const sy = lh / vbH;
      overlayLogo = `
    <g transform="translate(${lx},${ly}) scale(${sx},${sy})"
       opacity="${overlayAlpha.toFixed(3)}">
      ${inner}
    </g>`;
    } else if (logoSVGText) {
      const inner = extractSVGInner(logoSVGText);
      const sx = lw / logoImg.width;
      const sy = lh / logoImg.height;
      overlayLogo = `
    <g transform="translate(${lx},${ly}) scale(${sx},${sy})"
       opacity="${overlayAlpha.toFixed(3)}">
      ${inner}
    </g>`;
    } else {
      const data = await imageToDataURL(logoImg, "image/png", 0.92);
      overlayLogo = `
    <image x="${lx}" y="${ly}" width="${lw}" height="${lh}"
           href="${data}" opacity="${overlayAlpha.toFixed(3)}"
           preserveAspectRatio="xMidYMid meet" />`;
    }

    return `${baseSvgOpen}
  <g>
    ${tilesMarkup}
    ${tintRect}
    ${overlayLogo}
  </g>
</svg>`;
  }

  // mask or clip branch
  return `${baseSvgOpen}
  <g ${mainClipRef}>
    ${tilesMarkup}
    ${tintRect}
  </g>
</svg>`;
}

async function render() {
  if (!(logoImg && tileImgs.length)) return;

  drawnTiles = [];

  const W = cv.width;
  const H = cv.height;
  ctx.clearRect(0, 0, W, H);

  const C = Math.max(10, Math.min(400, parseInt(cols.value || 60, 10)));
  const R = Math.max(10, Math.min(400, parseInt(rows.value || 60, 10)));
  const tileW = Math.ceil(W / C);
  const tileH = Math.ceil(H / R);

  console.log(`Rendering at ${W} × ${H} px with ${C} × ${R} tiles`);
  if (tileW < 16 || tileH < 16) {
    console.warn(
      "Tiles under 16 px. Reduce columns or rows for a sharper look."
    );
  }
  const tileCount = C * R; // NEW
  if (tileCount > 120000) {
    // NEW: sanity warning
    console.warn(
      "Very high tile count. Expect slow rendering or a very large SVG."
    );
  }

  let tiles = tileImgs.slice();
  if (shuffleSel.value === "1") tiles = shuffle(tiles);

  const mosaic = HAS_OFFSCREEN
    ? new OffscreenCanvas(W, H)
    : document.createElement("canvas");
  if (!HAS_OFFSCREEN) {
    mosaic.width = W;
    mosaic.height = H;
  }
  const mctx = mosaic.getContext("2d");
  mctx.imageSmoothingEnabled = false;

  if (layout.value === "grid") {
    let k = 0;
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < C; x++) {
        const img = tiles[k % tiles.length];
        const dx = x * tileW;
        const dy = y * tileH;
        drawImageCover(mctx, img, dx, dy, tileW, tileH);
        drawnTiles.push({ x: dx, y: dy, w: tileW, h: tileH, img });
        k++;
      }
    }
  } else {
    const count = Math.floor(C * R * 1.1);
    lastRandomPositions = [];
    for (let i = 0; i < count; i++) {
      const img = tiles[i % tiles.length];
      const w = tileW * (0.75 + Math.random() * 0.9);
      const h = w;
      const x = Math.random() * (W - w);
      const y = Math.random() * (H - h);
      drawImageCover(mctx, img, x, y, w, h);
      drawnTiles.push({ x, y, w, h, img });
      lastRandomPositions.push({ x, y, w, h });
    }
  }

  const blendPct = parseInt(blend.value || 0, 10);
  if (blendPct > 0) {
    mctx.globalCompositeOperation = "multiply";
    mctx.fillStyle = tintColor.value || "#dddddd";
    mctx.globalAlpha = blendPct / 100;
    mctx.fillRect(0, 0, W, H);
    mctx.globalAlpha = 1;
    mctx.globalCompositeOperation = "source-over";
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mosaic, 0, 0);

  // Compute logo box ONCE
  const lr = logoImg.width / logoImg.height;
  const ar = W / H;
  let lw, lh, lx, ly;
  if (lr > ar) {
    lw = W;
    lh = W / lr;
    lx = 0;
    ly = (H - lh) / 2;
  } else {
    lh = H;
    lw = H * lr;
    ly = 0;
    lx = (W - lw) / 2;
  }

  // Warn if upscaling logo a lot
  const logoScale = Math.max(lw / logoImg.width, lh / logoImg.height);
  if (logoScale > 1.25) {
    console.warn(
      `Logo upscaled ${logoScale.toFixed(2)}x. Prefer a larger PNG or an SVG.`
    );
  }

  if (!maskCanvas) {
    maskCanvas = HAS_OFFSCREEN
      ? new OffscreenCanvas(cv.width, cv.height)
      : document.createElement("canvas");
  }
  // Always keep maskCanvas in lockstep with the main canvas
  maskCanvas.width = W; // <— add this even for OffscreenCanvas
  maskCanvas.height = H; // <— add this even for OffscreenCanvas

  maskCtx = maskCanvas.getContext("2d");
  maskCtx.clearRect(0, 0, W, H);

  // Overlay vs Mask
  if (logoMode.value === "overlay") {
    ctx.save();
    ctx.globalAlpha = Math.max(
      0,
      Math.min(1, parseInt(logoAlpha.value || "80", 10) / 100)
    );
    ctx.drawImage(logoImg, lx, ly, lw, lh);
    ctx.restore();
    // overlay covers visually, no need to draw into maskCtx for hover
  } else {
    const mask = HAS_OFFSCREEN
      ? new OffscreenCanvas(W, H)
      : document.createElement("canvas");
    if (!HAS_OFFSCREEN) {
      mask.width = W;
      mask.height = H;
    }
    const _maskCtx = mask.getContext("2d");
    _maskCtx.imageSmoothingEnabled = false;
    _maskCtx.clearRect(0, 0, W, H);
    _maskCtx.drawImage(logoImg, lx, ly, lw, lh);

    // destination-in to clip mosaic to logo
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    // also keep a copy for fast hover checks
    maskCtx.drawImage(logoImg, lx, ly, lw, lh);
  }

  lastTilesOrder = drawnTiles.map((t) => t.img);
  dlBtn.disabled = false;
  dlSvgBtn.disabled = false;
}

[cols, rows, blend, layout, shuffleSel, logoMode, logoAlpha, tintColor].forEach(
  (el) => {
    el.addEventListener("input", () => {
      if (!renderBtn.disabled) render();
    });
    el.addEventListener("change", () => {
      if (!renderBtn.disabled) render();
    });
  }
);
[outW, outH, preset].forEach((el) => {
  el.addEventListener("change", () => {
    if (!renderBtn.disabled) render();
  });
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") lightbox.style.display = "none";
});

blendVal.textContent = blend.value + "%";
