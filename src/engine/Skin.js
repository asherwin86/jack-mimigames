import * as THREE from 'three';

/**
 * Minecraft-style player skins for Blockcraft.
 *
 * A skin is the standard 64x64 PNG (or the old 64x32 layout) that the real
 * Minecraft launcher, minecraft.net and every skin site all use, so a file
 * saved from any of them imports here unchanged. Everything is normalised to
 * a 64x64 canvas up front; that canvas is what gets textured onto the model
 * and, as a small PNG data URL, what gets sent to other players.
 */

export const SKIN_PREFIX = 'data:image/png;base64,';
/** A 64x64 RGBA PNG is at most ~16 KB raw (~22 KB as base64) — this leaves headroom, not a loophole. */
export const MAX_SKIN_CHARS = 30000;
const MAX_FILE_BYTES = 1024 * 1024;

/** True only for a small PNG data URL — the one shape this game ever sends or
 *  accepts for a skin, checked again on every receiving end (never trusted
 *  because a client claims it). */
export function isValidSkinData(s) {
  return typeof s === 'string'
    && s.length > SKIN_PREFIX.length
    && s.length <= MAX_SKIN_CHARS
    && s.startsWith(SKIN_PREFIX)
    && /^[A-Za-z0-9+/]+={0,2}$/.test(s.slice(SKIN_PREFIX.length));
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file is not a readable image.'));
    img.src = src;
  });
}

/** Reads a user-picked file and returns a normalised 64x64 canvas, or throws
 *  an Error whose message is fit to show the player. */
export async function importSkinFile(file) {
  if (!file) throw new Error('No file chosen.');
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is too big to be a skin.');
  const url = URL.createObjectURL(file);
  try {
    return normalizeSkin(await loadImage(url));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Turns a decoded image into a 64x64 skin canvas. Accepts the modern 64x64
 *  layout and the legacy 64x32 one (mirroring the right limbs onto the left,
 *  as the game itself does); anything else isn't a Minecraft skin. */
export function normalizeSkin(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w !== 64 || (h !== 64 && h !== 32)) {
    throw new Error(`Skins are 64×64 (or 64×32) PNGs — this one is ${w}×${h}.`);
  }
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  if (h === 32) {
    // Old skins only drew the right arm/leg; the left ones are mirror images.
    flipCopy(ctx, 0, 16, 16, 48);    // leg -> left leg
    flipCopy(ctx, 40, 16, 32, 48);   // arm -> left arm
  }
  return c;
}

/** Copies a limb's 16x16 strip to another spot, mirroring every face and
 *  swapping the two sides — how a legacy skin's left limbs are derived. */
function flipCopy(ctx, sx, sy, dx, dy) {
  const F = [[4, 0, 4, 4], [8, 0, 4, 4], [0, 4, 4, 12], [4, 4, 4, 12], [8, 4, 4, 12], [12, 4, 4, 12]];   // top, bottom, right, front, left, back
  const FROM = [0, 1, 4, 3, 2, 5];   // each destination face's source face (right <-> left)
  F.forEach(([fx, fy, fw, fh], i) => {
    const [gx, gy, gw, gh] = F[FROM[i]];
    ctx.save();
    ctx.translate(dx + fx + fw, dy + fy);
    ctx.scale(-1, 1);
    ctx.drawImage(ctx.canvas, sx + gx, sy + gy, gw, gh, 0, 0, fw, fh);
    ctx.restore();
  });
}

export function skinToDataURL(canvas) {
  return canvas.toDataURL('image/png');
}

export async function skinFromDataURL(dataUrl) {
  if (!isValidSkinData(dataUrl)) throw new Error('Bad skin data.');
  return normalizeSkin(await loadImage(dataUrl));
}

/** Slim ("Alex") arms are 3px wide, which leaves the outer 2px of the arm's
 *  back-face strip empty. Classic ("Steve") skins fill it. */
export function isSlimSkin(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx.getImageData) return false;
  const px = ctx.getImageData(54, 20, 2, 12).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return false;
  return true;
}

/** A plain stand-in skin in the player's colour, for anyone who hasn't
 *  imported one — so every player is the same model, just a different shirt.
 *  Only uses fillRect so it works with any 2D context. */
export function defaultSkinCanvas(color = '#5ad1ff') {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const R = (x, y, w, h, fill) => { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); };
  const SKIN = '#c68e6a', HAIR = '#3b2a1e', PANTS = '#3b4a9c', SHOE = '#2a2a33';
  R(0, 0, 32, 16, SKIN);                                   // head strip
  R(8, 0, 8, 8, HAIR); R(0, 8, 32, 3, HAIR); R(24, 8, 8, 8, HAIR);   // hair: top, a fringe round the sides, the whole back
  R(9, 11, 2, 1, '#ffffff'); R(13, 11, 2, 1, '#ffffff');   // eyes
  R(10, 11, 1, 1, '#3d5fd6'); R(13, 11, 1, 1, '#3d5fd6');
  R(11, 14, 2, 1, '#8a5a44');                              // mouth
  R(16, 16, 24, 16, color);                                // torso strip
  for (const [x, y] of [[40, 16], [32, 48]]) {             // arms: sleeve on top, skin below
    R(x, y, 16, 16, SKIN); R(x, y, 16, 8, color);
  }
  for (const [x, y] of [[0, 16], [16, 48]]) {              // legs: trousers, shoes at the bottom
    R(x, y, 16, 16, PANTS); R(x, y + 13, 16, 3, SHOE);
  }
  return c;
}

/* ----------------------------------------------------------------- model */

const PX = 1.8 / 32;   // one skin pixel in world units — a Minecraft player is 32px (1.8 blocks) tall

/** One skin-mapped box. (u, v) is the top-left of that body part's strip in
 *  the 64x64 texture; sizes are in skin pixels; `inflate` grows it outward
 *  (used for the second "hat/jacket/sleeve" layer so it floats just outside
 *  the base). Each vertex's UV is computed from where it sits on the box, so
 *  the face orientation is explicit rather than trusting any default. */
function skinBox(w, h, d, u, v, inflate = 0) {
  const g = new THREE.BoxGeometry((w + inflate * 2) * PX, (h + inflate * 2) * PX, (d + inflate * 2) * PX);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv;
  const col = new Float32Array(pos.count * 3);
  const T = 64;
  // Region origin (in pixels) + which axes drive s/t, per face; see the layout
  // diagram in the MC skin format: top/bottom above, right/front/left/back below.
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.round(nrm.getX(i)), ny = Math.round(nrm.getY(i)), nz = Math.round(nrm.getZ(i));
    const fx = pos.getX(i) / ((w + inflate * 2) * PX);   // -0.5 .. 0.5 across the box
    const fy = pos.getY(i) / ((h + inflate * 2) * PX);
    const fz = pos.getZ(i) / ((d + inflate * 2) * PX);
    let rx, ry, rw, rh, s, t, shade;
    if (nz < 0)      { rx = u + d;         ry = v + d; rw = w; rh = h; s = 0.5 - fx; t = 0.5 - fy; shade = 0.86; }  // front (faces -Z)
    else if (nz > 0) { rx = u + 2 * d + w; ry = v + d; rw = w; rh = h; s = 0.5 + fx; t = 0.5 - fy; shade = 0.78; }  // back
    else if (nx > 0) { rx = u;             ry = v + d; rw = d; rh = h; s = 0.5 - fz; t = 0.5 - fy; shade = 0.7; }   // character's right (+X)
    else if (nx < 0) { rx = u + d + w;     ry = v + d; rw = d; rh = h; s = 0.5 + fz; t = 0.5 - fy; shade = 0.7; }   // character's left
    else if (ny > 0) { rx = u + d;         ry = v;     rw = w; rh = d; s = 0.5 - fx; t = 0.5 - fz; shade = 1; }     // top
    else             { rx = u + d + w;     ry = v;     rw = w; rh = d; s = 0.5 - fx; t = 0.5 - fz; shade = 0.55; }  // bottom
    uv.setXY(i, (rx + s * rw) / T, 1 - (ry + t * rh) / T);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Builds a full posable player from a 64x64 skin canvas. Origin is at the
 *  feet, facing -Z (matching this.pos and the camera's yaw), 1.8 tall.
 *  `parts` are pivoted at the shoulders/hips/neck so they can swing. */
export function buildSkinnedPlayer(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  const base = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: 0.1 });
  const over = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: 0.1, transparent: true });
  const slim = isSlimSkin(canvas);
  const armW = slim ? 3 : 4;

  const group = new THREE.Group();
  const geos = [];

  /** A limb/segment: base box + its overlay, hung from a pivot so rotating the
   *  pivot swings it from the joint rather than its middle. */
  const part = (w, h, d, u, v, ou, ov, pivot, hang) => {
    const p = new THREE.Group();
    p.position.set(pivot[0] * PX, pivot[1] * PX, pivot[2] * PX);
    for (const [g, m] of [[skinBox(w, h, d, u, v), base], [skinBox(w, h, d, ou, ov, 0.5), over]]) {
      geos.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.y = hang * PX;
      p.add(mesh);
    }
    group.add(p);
    return p;
  };

  // y is measured up from the feet in skin pixels: legs 0-12, torso 12-24, head 24-32.
  const legR = part(4, 12, 4, 0, 16, 0, 32, [2, 12, 0], -6);
  const legL = part(4, 12, 4, 16, 48, 0, 48, [-2, 12, 0], -6);
  part(8, 12, 4, 16, 16, 16, 32, [0, 18, 0], 0);
  const armR = part(armW, 12, 4, 40, 16, 40, 32, [4 + armW / 2, 22, 0], -4);
  const armL = part(armW, 12, 4, 32, 48, 48, 48, [-4 - armW / 2, 22, 0], -4);
  const head = part(8, 8, 8, 0, 0, 32, 0, [0, 24, 0], 4);

  return {
    group,
    parts: { head, armL, armR, legL, legR },
    slim,
    dispose() {
      geos.forEach((g) => g.dispose());
      base.dispose(); over.dispose(); texture.dispose();
    },
  };
}

/** Front-on 2D preview (head, torso, arms, legs) for the settings panel. */
export function drawSkinPreview(target, skin, scale = 3) {
  const ctx = target.getContext('2d');
  target.width = 16 * scale; target.height = 32 * scale;
  ctx.imageSmoothingEnabled = false;
  const blit = (sx, sy, sw, sh, dx, dy) => ctx.drawImage(skin, sx, sy, sw, sh, dx * scale, dy * scale, sw * scale, sh * scale);
  const slim = isSlimSkin(skin);
  const aw = slim ? 3 : 4;
  blit(4, 20, 4, 12, 4, 20);            // right leg front (viewer's left)
  blit(20, 52, 4, 12, 8, 20);           // left leg front
  blit(20, 20, 8, 12, 4, 8);            // torso front
  blit(44, 20, aw, 12, 4 - aw, 8);      // right arm front
  blit(36, 52, aw, 12, 12, 8);          // left arm front
  blit(8, 8, 8, 8, 4, 0);               // head front
  // second layers on top
  blit(4, 36, 4, 12, 4, 20); blit(4, 52, 4, 12, 8, 20);
  blit(20, 36, 8, 12, 4, 8);
  blit(44, 36, aw, 12, 4 - aw, 8); blit(52, 52, aw, 12, 12, 8);
  blit(40, 8, 8, 8, 4, 0);
}
