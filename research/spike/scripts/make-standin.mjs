// Generates the stand-in skinned terrier (PLAN D-27, L252) as a binary glTF:
// a few bones, one clip per animation phase named as the contract's
// AnimPhase, and one embedded PNG texture. It's written here, byte by byte,
// so no third-party licence is involved and no binary is committed; the
// tests make it when they run and serve it to the page by interception.
//
//   node scripts/make-standin.mjs [out.glb]     writes it (default results/tmp/standin.glb)
//
// The model follows the model drawer's convention: glTF's axes (+y up, +z
// forward, +x the terrier's left), metres, feet at y = 0 under the
// collider's centre, inside the 0.6 x 0.5 x 0.5 m box (D-4, L310); a
// material named `fur`, textured, takes the coat's colour, and one named
// `bandana` the pack's. Its proportions are the code-built terrier's.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STANDIN_PHASES = ['standing', 'running', 'zooming', 'airborne', 'lunging', 'tumbled', 'gettingUp', 'sitting'];
export const STANDIN_BONES = ['root', 'spine', 'head', 'legFL', 'legFR', 'legBL', 'legBR', 'tail'];
const TEXTURE_SIZE = 256;

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** An 8-bit RGB PNG of `rgb` (w * h * 3 bytes), no filtering. */
export function encodePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// The texture: an atlas of regions, light where the fur colour shows as it
// is and darker where the markings are, multiplied by the coat's colour.
const REGIONS = {
  body: [0, 0, 0.5, 0.5],
  head: [0.5, 0, 0.5, 0.5],
  dark: [0, 0.5, 0.125, 0.125],
  ears: [0.5, 0.5, 0.25, 0.25],
  legs: [0.75, 0.5, 0.25, 0.5],
};

function markingsTexture() {
  const S = TEXTURE_SIZE;
  const rgb = new Uint8Array(S * S * 3);
  const put = (x, y, v) => rgb.set([v, v, Math.max(0, v - 6)], (y * S + x) * 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const v = (y + 0.5) / S;
      const inside = ([u0, v0, w, h]) => u >= u0 && u < u0 + w && v >= v0 && v < v0 + h;
      const local = ([u0, v0, w, h]) => [(u - u0) / w, (v - v0) / h];
      let shade = 236;
      if (inside(REGIONS.body)) {
        const [, lat] = local(REGIONS.body);
        // A saddle along the back: the top of the body's latitude range.
        shade = lat < 0.3 ? 150 : 236;
      } else if (inside(REGIONS.head)) {
        const [lon, lat] = local(REGIONS.head);
        shade = lat > 0.55 && Math.abs(lon - 0.75) < 0.12 ? 205 : 240;
      } else if (inside(REGIONS.dark)) shade = 24;
      else if (inside(REGIONS.ears)) shade = 165;
      else if (inside(REGIONS.legs)) {
        const [, lat] = local(REGIONS.legs);
        shade = lat > 0.82 ? 120 : 236;
      }
      put(x, y, shade);
    }
  }
  return encodePng(S, S, rgb);
}

// ---------------------------------------------------------------- geometry

const rotX = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const rotZ = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const apply3 = (m, v) => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** A primitive under construction: rigidly skinned parts, each to one joint. */
class Builder {
  pos = [];
  nor = [];
  uv = [];
  joints = [];
  idx = [];

  /** An ellipsoid with radii r about local y, turned by m, at c, mapped into a UV region. */
  ellipsoid(c, r, joint, region, segW, segH, m = I3) {
    const base = this.pos.length / 3;
    const [u0, v0, uw, vh] = region;
    for (let iy = 0; iy <= segH; iy++) {
      const lat = (iy / segH) * Math.PI;
      for (let ix = 0; ix <= segW; ix++) {
        const lon = (ix / segW) * 2 * Math.PI;
        const unit = [-Math.cos(lon) * Math.sin(lat), Math.cos(lat), Math.sin(lon) * Math.sin(lat)];
        const p = apply3(m, [unit[0] * r[0], unit[1] * r[1], unit[2] * r[2]]);
        const n = norm(apply3(m, [unit[0] / r[0], unit[1] / r[1], unit[2] / r[2]]));
        this.pos.push(c[0] + p[0], c[1] + p[1], c[2] + p[2]);
        this.nor.push(...n);
        this.uv.push(u0 + (ix / segW) * uw, v0 + (iy / segH) * vh);
        this.joints.push(joint);
      }
    }
    const row = segW + 1;
    for (let iy = 0; iy < segH; iy++) {
      for (let ix = 0; ix < segW; ix++) {
        const a = base + iy * row + ix;
        const b = a + row;
        if (iy !== 0) this.idx.push(a, b, a + 1);
        if (iy !== segH - 1) this.idx.push(a + 1, b, b + 1);
      }
    }
  }

  /** A torus about local y (ring radius R, tube t), turned by m, at c. */
  torus(c, R, t, joint, region, segRing, segTube, m = I3) {
    const base = this.pos.length / 3;
    const [u0, v0, uw, vh] = region;
    for (let j = 0; j <= segTube; j++) {
      const v = (j / segTube) * 2 * Math.PI;
      for (let i = 0; i <= segRing; i++) {
        const u = (i / segRing) * 2 * Math.PI;
        const centre = [R * Math.cos(u), 0, R * Math.sin(u)];
        const n0 = [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)];
        const p = apply3(m, [centre[0] + t * n0[0], centre[1] + t * n0[1], centre[2] + t * n0[2]]);
        this.pos.push(c[0] + p[0], c[1] + p[1], c[2] + p[2]);
        this.nor.push(...norm(apply3(m, n0)));
        this.uv.push(u0 + (i / segRing) * uw, v0 + (j / segTube) * vh);
        this.joints.push(joint);
      }
    }
    const row = segRing + 1;
    for (let j = 0; j < segTube; j++) {
      for (let i = 0; i < segRing; i++) {
        const a = base + j * row + i;
        const b = a + row;
        this.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
}

// The skeleton at bind, as world positions (no rotations), with parents.
const NECK = [0, 0.31, 0.1];
const BIND = {
  root: { at: [0, 0.215, -0.03], parent: null },
  spine: { at: [0, 0.24, 0.1], parent: 'root' },
  head: { at: NECK, parent: 'spine' },
  legFL: { at: [0.065, 0.18, 0.1], parent: 'spine' },
  legFR: { at: [-0.065, 0.18, 0.1], parent: 'spine' },
  legBL: { at: [0.065, 0.18, -0.13], parent: 'root' },
  legBR: { at: [-0.065, 0.18, -0.13], parent: 'root' },
  tail: { at: [0, 0.255, -0.19], parent: 'root' },
};
const J = Object.fromEntries(STANDIN_BONES.map((n, i) => [n, i]));
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function terrierGeometry(detail) {
  const k = Math.max(1, detail);
  const s = (n) => Math.max(4, Math.round(n * k));
  const fur = new Builder();
  // The body's pole is on top of its back, so the saddle is a cap there.
  fur.ellipsoid([0, 0.215, -0.03], [0.115, 0.095, 0.19], J.root, REGIONS.body, s(20), s(14));
  fur.ellipsoid(add3(NECK, [0, 0.05, 0.05]), [0.105, 0.105, 0.105], J.head, REGIONS.head, s(18), s(12));
  fur.ellipsoid(add3(NECK, [0, 0.02, 0.135]), [0.05, 0.042, 0.05], J.head, REGIONS.head, s(10), s(7));
  for (const side of [1, -1]) {
    fur.ellipsoid(add3(NECK, [side * 0.045, 0.075, 0.135]), [0.018, 0.018, 0.018], J.head, REGIONS.dark, s(8), s(5));
    // Ears: tall, pointed ellipsoids leaning outward.
    fur.ellipsoid(add3(NECK, [side * 0.072, 0.14, 0.03]), [0.03, 0.05, 0.022], J.head, REGIONS.ears, s(10), s(7), rotZ(-side * 0.35));
  }
  fur.ellipsoid(add3(NECK, [0, 0.035, 0.182]), [0.02, 0.02, 0.02], J.head, REGIONS.dark, s(8), s(5));
  for (const leg of ['legFL', 'legFR', 'legBL', 'legBR']) {
    const at = BIND[leg].at;
    fur.ellipsoid([at[0], 0.09, at[2]], [0.036, 0.092, 0.036], J[leg], REGIONS.legs, s(10), s(7));
  }
  // The tail leans back from its pivot.
  const lean = rotX(-0.6);
  fur.ellipsoid(add3(BIND.tail.at, apply3(lean, [0, 0.057, 0])), [0.022, 0.06, 0.022], J.tail, REGIONS.ears, s(8), s(6), lean);

  const bandana = new Builder();
  // Around the neck, its axis along the neck: up and forward at about 39 degrees.
  bandana.torus([0, 0.29, 0.075], 0.078, 0.024, J.spine, [0, 0.75, 0.25, 0.25], s(16), s(6), rotX(0.89));
  return { fur, bandana };
}

// ---------------------------------------------------------------- clips

const quat = (axis, angle) => {
  const [x, y, z] = norm(axis);
  const s = Math.sin(angle / 2);
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
};
const X = [1, 0, 0];
const Y = [0, 1, 0];
const Z = [0, 0, 1];

/** Samples f over [0, duration] at n + 1 times: [times, values]. */
function sample(duration, n, f) {
  const times = [];
  const values = [];
  for (let i = 0; i <= n; i++) {
    const t = (duration * i) / n;
    times.push(t);
    values.push(f(t));
  }
  return [times, values];
}

const rootAt = BIND.root.at;
const rel = (name) => {
  const b = BIND[name];
  return b.parent ? [b.at[0] - BIND[b.parent].at[0], b.at[1] - BIND[b.parent].at[1], b.at[2] - BIND[b.parent].at[2]] : b.at;
};

/** Each clip: { name, duration, tracks: [{ bone, path, n, f }] }. Leg swings are about +x: positive moves the foot back. */
function clips() {
  const TAU = 2 * Math.PI;
  const legs = (amp, d) => [
    { bone: 'legFL', path: 'rotation', n: 16, f: (t) => quat(X, -amp * Math.sin((TAU * t) / d)) },
    { bone: 'legBR', path: 'rotation', n: 16, f: (t) => quat(X, -amp * Math.sin((TAU * t) / d)) },
    { bone: 'legFR', path: 'rotation', n: 16, f: (t) => quat(X, amp * Math.sin((TAU * t) / d)) },
    { bone: 'legBL', path: 'rotation', n: 16, f: (t) => quat(X, amp * Math.sin((TAU * t) / d)) },
  ];
  const held = (bone, q) => ({ bone, path: 'rotation', n: 1, f: () => q });
  const bob = (d, amp, extra = [0, 0, 0]) => ({ bone: 'root', path: 'translation', n: 16, f: (t) => add3(add3(rootAt, extra), [0, amp * Math.abs(Math.sin((TAU * t) / d)), 0]) });
  return [
    {
      name: 'standing', duration: 2, tracks: [
        { bone: 'tail', path: 'rotation', n: 32, f: (t) => quat(Y, 0.5 * Math.sin(TAU * t * 2)) },
        { bone: 'head', path: 'rotation', n: 16, f: (t) => quat(X, 0.05 * Math.sin((TAU * t) / 2)) },
        { bone: 'root', path: 'translation', n: 16, f: (t) => add3(rootAt, [0, 0.004 * Math.sin((TAU * t) / 2), 0]) },
      ],
    },
    { name: 'running', duration: 0.4, tracks: [...legs(0.55, 0.4), bob(0.4, 0.02), { bone: 'tail', path: 'rotation', n: 16, f: (t) => quat(Y, 0.35 * Math.sin((TAU * t) / 0.4)) }] },
    { name: 'zooming', duration: 0.4, tracks: [...legs(0.85, 0.4), bob(0.4, 0.03), held('root', quat(X, 0.08)), held('tail', quat(X, -0.6))] },
    {
      name: 'airborne', duration: 0.9, tracks: [
        held('legFL', quat(X, -0.7)), held('legFR', quat(X, -0.7)), held('legBL', quat(X, 0.7)), held('legBR', quat(X, 0.7)),
        { bone: 'root', path: 'rotation', n: 8, f: (t) => quat(X, -0.35 + (0.7 * t) / 0.9) },
      ],
    },
    {
      name: 'lunging', duration: 0.3, tracks: [
        held('legFL', quat(X, -1.1)), held('legFR', quat(X, -1.1)), held('legBL', quat(X, 1.0)), held('legBR', quat(X, 1.0)),
        held('head', quat(X, 0.15)), held('root', quat(X, 0.1)),
      ],
    },
    {
      // Over and over once, then on its side (a quarter turn at a key, so slerp keeps the way round).
      name: 'tumbled', duration: 1, tracks: [
        { bone: 'root', path: 'rotation', n: 20, f: (t) => quat(Z, t < 0.6 ? (t / 0.6) * (TAU + Math.PI / 2) : Math.PI / 2) },
        { bone: 'root', path: 'translation', n: 20, f: (t) => add3(rootAt, [0, -0.085 * Math.abs(Math.sin(t < 0.6 ? (t / 0.6) * (TAU + Math.PI / 2) : Math.PI / 2)), 0]) },
      ],
    },
    {
      name: 'gettingUp', duration: 0.5, tracks: [
        {
          bone: 'root', path: 'rotation', n: 40, f: (t) => quat(Z, t < 0.25
            ? (Math.PI / 2) * (1 - t / 0.25)
            : 0.25 * (1 - (t - 0.25) / 0.25) * Math.sin(TAU * 7 * (t - 0.25))),
        },
        { bone: 'head', path: 'rotation', n: 40, f: (t) => quat(Y, t < 0.25 ? 0 : 0.5 * (1 - (t - 0.25) / 0.25) * Math.sin(TAU * 7 * (t - 0.25) + 1)) },
      ],
    },
    {
      name: 'sitting', duration: 0.5, tracks: [
        { bone: 'root', path: 'rotation', n: 10, f: (t) => quat(X, -0.55 * Math.min(1, t / 0.25)) },
        { bone: 'root', path: 'translation', n: 10, f: (t) => add3(rootAt, [0, -0.035 * Math.min(1, t / 0.25), -0.02 * Math.min(1, t / 0.25)]) },
        { bone: 'legBL', path: 'rotation', n: 10, f: (t) => quat(X, -1.3 * Math.min(1, t / 0.25)) },
        { bone: 'legBR', path: 'rotation', n: 10, f: (t) => quat(X, -1.3 * Math.min(1, t / 0.25)) },
        { bone: 'legFL', path: 'rotation', n: 10, f: (t) => quat(X, 0.55 * Math.min(1, t / 0.25)) },
        { bone: 'legFR', path: 'rotation', n: 10, f: (t) => quat(X, 0.55 * Math.min(1, t / 0.25)) },
        { bone: 'head', path: 'rotation', n: 10, f: (t) => quat(X, 0.45 * Math.min(1, t / 0.25)) },
        held('tail', quat(X, -0.9)),
      ],
    },
  ];
}

// ---------------------------------------------------------------- glTF

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_BYTE = 5121;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

/**
 * Builds the stand-in. `detail` scales the segment counts (1 is the default,
 * about 2,500 triangles); returns the .glb's bytes.
 */
export function makeStandin({ detail = 1 } = {}) {
  const json = {
    asset: { version: '2.0', generator: 'terriest M0 spike make-standin.mjs' },
    scene: 0,
    scenes: [{ name: 'stand-in', nodes: [0] }],
    nodes: [],
    meshes: [],
    skins: [],
    materials: [
      { name: 'fur', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.9 } },
      { name: 'bandana', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.8 } },
    ],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
    animations: [],
  };
  const chunks = [];
  let length = 0;
  const view = (bytes, target) => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      length += pad;
    }
    const v = { buffer: 0, byteOffset: length, byteLength: bytes.byteLength };
    if (target) v.target = target;
    json.bufferViews.push(v);
    chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    length += bytes.byteLength;
    return json.bufferViews.length - 1;
  };
  const accessor = (array, componentType, type, target, minmax = false) => {
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const a = { bufferView: view(array, target), componentType, count: array.length / size, type };
    if (minmax) {
      a.min = [];
      a.max = [];
      for (let c = 0; c < size; c++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = c; i < array.length; i += size) {
          lo = Math.min(lo, array[i]);
          hi = Math.max(hi, array[i]);
        }
        a.min.push(Math.fround(lo));
        a.max.push(Math.fround(hi));
      }
    }
    json.accessors.push(a);
    return json.accessors.length - 1;
  };

  // Nodes: 0 the terrier, 1 its skinned mesh, then the bones.
  const boneNode = (name) => 2 + J[name];
  json.nodes.push({ name: 'terrier', children: [1, boneNode('root')] });
  json.nodes.push({ name: 'terrier-mesh', mesh: 0, skin: 0 });
  for (const name of STANDIN_BONES) {
    const children = STANDIN_BONES.filter((c) => BIND[c].parent === name).map(boneNode);
    const node = { name, translation: rel(name) };
    if (children.length) node.children = children;
    json.nodes.push(node);
  }
  const ibm = new Float32Array(16 * STANDIN_BONES.length);
  STANDIN_BONES.forEach((name, i) => {
    const [x, y, z] = BIND[name].at;
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
  });
  json.skins.push({ name: 'terrier-skin', joints: STANDIN_BONES.map(boneNode), skeleton: boneNode('root'), inverseBindMatrices: accessor(ibm, FLOAT, 'MAT4') });

  const { fur, bandana } = terrierGeometry(detail);
  const primitive = (b, material) => {
    const n = b.pos.length / 3;
    if (n > 65535) throw new Error('too many vertices for 16-bit indices');
    const joints = new Uint8Array(n * 4);
    const weights = new Float32Array(n * 4);
    b.joints.forEach((j, i) => {
      joints[i * 4] = j;
      weights[i * 4] = 1;
    });
    return {
      attributes: {
        POSITION: accessor(new Float32Array(b.pos), FLOAT, 'VEC3', ARRAY_BUFFER, true),
        NORMAL: accessor(new Float32Array(b.nor), FLOAT, 'VEC3', ARRAY_BUFFER),
        TEXCOORD_0: accessor(new Float32Array(b.uv), FLOAT, 'VEC2', ARRAY_BUFFER),
        JOINTS_0: accessor(joints, UNSIGNED_BYTE, 'VEC4', ARRAY_BUFFER),
        WEIGHTS_0: accessor(weights, FLOAT, 'VEC4', ARRAY_BUFFER),
      },
      indices: accessor(new Uint16Array(b.idx), UNSIGNED_SHORT, 'SCALAR', ELEMENT_ARRAY_BUFFER),
      material,
    };
  };
  json.meshes.push({ name: 'terrier', primitives: [primitive(fur, 0), primitive(bandana, 1)] });

  json.images.push({ name: 'markings', mimeType: 'image/png', bufferView: view(markingsTexture()) });

  for (const clip of clips()) {
    const anim = { name: clip.name, channels: [], samplers: [] };
    for (const tr of clip.tracks) {
      const [times, values] = tr.n === 1 ? [[0, clip.duration], [tr.f(0), tr.f(0)]] : sample(clip.duration, tr.n, tr.f);
      const input = accessor(new Float32Array(times), FLOAT, 'SCALAR', undefined, true);
      const output = accessor(new Float32Array(values.flat()), FLOAT, tr.path === 'rotation' ? 'VEC4' : 'VEC3');
      anim.samplers.push({ input, output, interpolation: 'LINEAR' });
      anim.channels.push({ sampler: anim.samplers.length - 1, target: { node: boneNode(tr.bone), path: tr.path } });
    }
    json.animations.push(anim);
  }

  const pad = (4 - (length % 4)) % 4;
  if (pad) chunks.push(Buffer.alloc(pad));
  const bin = Buffer.concat(chunks);
  json.buffers.push({ byteLength: bin.length });

  let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const header = Buffer.alloc(12);
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunkHeader = (len, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(len, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  return Buffer.concat([header, chunkHeader(jsonBytes.length, 0x4e4f534a), jsonBytes, chunkHeader(bin.length, 0x004e4942), bin]);
}

/** Reads a .glb's JSON chunk and binary chunk back, for tests. */
export function readGlb(bytes) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(4) !== 2) throw new Error('not a glTF 2 binary');
  if (b.readUInt32LE(8) !== b.length) throw new Error('length mismatch');
  const jsonLen = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binAt = 20 + jsonLen;
  const binLen = b.readUInt32LE(binAt);
  if (b.readUInt32LE(binAt + 4) !== 0x004e4942) throw new Error('second chunk is not BIN');
  return { json, bin: b.subarray(binAt + 8, binAt + 8 + binLen) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = resolve(process.argv[2] ?? resolve(here, '../results/tmp/standin.glb'));
  const glb = makeStandin();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, glb);
  console.log(`make-standin: wrote ${out} (${glb.length} bytes)`);
}
