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

logoAlpha.addEventListener("input", () => {
  logoAlphaVal.textContent = logoAlpha.value + "%";
});

let logoImg = null;
let tileImgs = [];
let logoFile = null;
let logoSVGText = null;
let tileDataURLs = [];
let lastTilesOrder = [];
let lastRandomPositions = [];
let drawnTiles = []; // array of {x, y, w, h, img}
let hoverRAF = null;

cv.addEventListener("mousemove", (e) => {
  if (!drawnTiles.length) return;
  if (hoverRAF) return;
  hoverRAF = requestAnimationFrame(() => {
    hoverRAF = null;
    const rect = cv.getBoundingClientRect();
    const scaleX = cv.width / rect.width;
    const scaleY = cv.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const a = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3];
    if (a === 0) {
      hoverPreview.style.display = "none";
      return;
    }

    const hit = findTileAt(x, y);
    if (!hit) {
      hoverPreview.style.display = "none";
      return;
    }

    hoverImg.src = hit.img.src;
    hoverPreview.style.display = "block";
    hoverPreview.style.left = e.clientX + 16 + "px";
    hoverPreview.style.top = e.clientY + 16 + "px";
  });
});

// pointer helpers
function findTileAt(px, py) {
  // scan backwards to prioritise last drawn for random layout overlaps
  for (let i = drawnTiles.length - 1; i >= 0; i--) {
    const t = drawnTiles[i];
    if (px >= t.x && px < t.x + t.w && py >= t.y && py < t.y + t.h) return t;
  }
  return null;
}

cv.addEventListener("mouseleave", () => {
  hoverPreview.style.display = "none";
});

cv.addEventListener("click", (e) => {
  const rect = cv.getBoundingClientRect();
  const scaleX = cv.width / rect.width;
  const scaleY = cv.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;

  const a = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3];
  if (a === 0) {
    hoverPreview.style.display = "none";
    return;
  }

  const hit = findTileAt(x, y);
  if (!hit) return;
  lightboxImg.src = hit.img.src;
  lightbox.style.display = "flex";
});

// close lightbox on click
lightbox.addEventListener("click", () => {
  lightbox.style.display = "none";
});

function enableIfReady() {
  renderBtn.disabled = !(logoImg && tileImgs.length);
  if (renderBtn.disabled) {
    hoverPreview.style.display = "none";
  }
}

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
  });
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const link = document.createElement("a");
  link.download = "metta-logo-mosaic.svg";
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
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
      // do nothing for Custom
      break;
  }
});

logoInput.addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    logoFile = f;
    logoSVGText = null;
    if (f.type === "image/svg+xml") {
      // read text content for clip path use
      logoSVGText = await f.text();
      // we still want an <img> for the canvas preview
    }
    logoImg = await loadImageFromFile(f);
    enableIfReady();
    // enable SVG download if we already have tiles too
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

  // update the live export size label every time size changes
  if (pxMeta) {
    pxMeta.textContent = `export ${cv.width} × ${cv.height} px`;
  }
}

// ensure canvas reflects initial inputs and the label shows correct size
syncSize();

blend.addEventListener("input", () => {
  blendVal.textContent = blend.value + "%";
});

renderBtn.addEventListener("click", render);
dlBtn.addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "metta-logo-mosaic.png";
  link.href = cv.toDataURL("image/png");
  link.click();
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
  // Fast path with createImageBitmap when available
  if ("createImageBitmap" in window) {
    const bmp = await createImageBitmap(file);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    const img = new Image();
    img.src = c.toDataURL("image/png");
    return img;
  }
  // Fallback for Safari and older browsers
  const url = URL.createObjectURL(file);
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
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

  // defs: clip or mask
  let defs = "";
  let mainClipRef = "";
  if (logoSVGText) {
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
  <mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" mask-type="luminance" x="0" y="0" width="${W}" height="${H}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="black"/>
    <image x="${lx}" y="${ly}" width="${lw}" height="${lh}" href="${logoDataURL}" xlink:href="${logoDataURL}" preserveAspectRatio="xMidYMid meet" />
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
        const idx = tileImgs.indexOf(img);
        const href = tileDataURLs[idx];
        const dx = x * tileW;
        const dy = y * tileH;
        tilesMarkup += `<image x="${dx}" y="${dy}" width="${tileW}" height="${tileH}" href="${href}" xlink:href="${href}" preserveAspectRatio="xMidYMid slice" />\n`;
        k++;
      }
    }
  } else {
    const positions = lastRandomPositions.length
      ? lastRandomPositions
      : Array.from({ length: Math.floor(C * R * 1.1) }, () => {
          const w = tileW * (0.75 + Math.random() * 0.9);
          return {
            x: Math.random() * (W - w),
            y: Math.random() * (H - w),
            w,
            h: w,
          };
        });
    for (let i = 0; i < positions.length; i++) {
      const img = orderImgs[i % orderImgs.length];
      const idx = tileImgs.indexOf(img);
      const href = tileDataURLs[idx];
      const { x, y, w, h } = positions[i];
      tilesMarkup += `<image x="${x.toFixed(2)}" y="${y.toFixed(
        2
      )}" width="${w.toFixed(2)}" height="${h.toFixed(
        2
      )}" href="${href}" xlink:href="${href}" preserveAspectRatio="xMidYMid slice" />\n`;
    }
  }

  const tintRect =
    blendPct > 0
      ? `<rect x="0" y="0" width="${W}" height="${H}" fill="#dddddd" opacity="${(
          blendPct / 100
        ).toFixed(3)}" />`
      : "";

  const baseSvgOpen = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${defs}
  </defs>`;

  if (mode === "overlay") {
    const logoDataURL = await imageToDataURL(logoImg, "image/png", 0.92);
    return `${baseSvgOpen}
  <g>
    ${tilesMarkup}
    ${tintRect}
    <image x="${lx}" y="${ly}" width="${lw}" height="${lh}"
           href="${logoDataURL}" xlink:href="${logoDataURL}"
           opacity="${overlayAlpha.toFixed(3)}"
           preserveAspectRatio="xMidYMid meet" />
  </g>
</svg>`;
  }

  // mask mode
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
        const dx = x * tileW,
          dy = y * tileH;
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
    mctx.fillStyle = "#dddddd";
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

  // Overlay vs Mask
  if (logoMode.value === "overlay") {
    ctx.save();
    ctx.globalAlpha = Math.max(
      0,
      Math.min(1, parseInt(logoAlpha.value || "80", 10) / 100)
    );
    ctx.drawImage(logoImg, lx, ly, lw, lh);
    ctx.restore();
  } else {
    const mask = HAS_OFFSCREEN
      ? new OffscreenCanvas(W, H)
      : document.createElement("canvas");
    if (!HAS_OFFSCREEN) {
      mask.width = W;
      mask.height = H;
    }
    const maskCtx = mask.getContext("2d");
    maskCtx.imageSmoothingEnabled = false;
    maskCtx.clearRect(0, 0, W, H);
    maskCtx.drawImage(logoImg, lx, ly, lw, lh);

    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }

  lastTilesOrder = drawnTiles.map((t) => t.img);
  dlBtn.disabled = false;
  dlSvgBtn.disabled = false;
}

blendVal.textContent = blend.value + "%";
