// A terrier's portrait, for the logo and icons the owner picked on 2026-11-22
// (dev/logo.html; PLAN's status): one terrier, posed through a DrawerFrame
// as the view hands one to the drawer, drawn by the game's own code-built
// drawer (drawers/code.ts, pose.ts) in the look it's given, its parts at a
// close-up's segments, with the game's blob shadow (shadows.ts), under a
// camera and lights of the portrait's own, rendered in tiles to a
// transparent WebGL 2 canvas and read back as premultiplied floats, which
// dev/logo/post.ts makes every size from. So a new look (Q-11) draws the
// same pictures of its own terrier. Dev only: nothing the build takes
// imports it, and three stays in src/render (D-26).
//
// No tone mapping and sRGB output, as the stage draws. A shot is drawn at
// master × ss px, in tiles of TILE px by the camera's view offset, and boxed
// down by ss: 4096 px in four tiles for a 2048 px master, 16 samples a pixel
// with the canvas's MSAA.

import {
  AmbientLight, DirectionalLight, HemisphereLight, type InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshPhongMaterial, Object3D,
  PCFShadowMap, PerspectiveCamera, PlaneGeometry, Scene, ShaderChunk, Vector3, WebGLRenderer,
} from 'three';
import { defaultParams } from '../core/sim/params';
import { type Pack, NEVER } from '../core/sim/state';
import type { AnimLayer, DrawerFrame, TerrierDrawer } from './drawer';
import { createCodeDrawer, FACE_DARK, terrierGeometries, type TerrierSegments } from './drawers/code';
import type { Look } from './look';
import { blobTexture, shadowSize, TERRIER_SHADOW_RADII } from './shadows';

const R_T = defaultParams.terrierRadius;
/** The canvas's side, and so the largest tile. */
const TILE = 2048;
/** The close-up's segments: the play distance's facets show at 1024 px. */
const CLOSE_UP: TerrierSegments = { body: [128, 96], snout: [96, 64], face: [48, 32], ear: [96, 8], leg: [24, 64, 4], tail: [24, 48, 4], bandana: [48, 192] };
/** The blob's texture's side: the game's 64 px blurs at 2048. */
const BLOB_TEXTURE = 256;
/** Its height over the floor. */
const BLOB_LIFT = 0.002;

/** A posed terrier, as a TerrierFrame takes it, at the origin heading +x; anything left out is at rest. */
export interface PortraitPose {
  /** The drawn time, in ticks. */
  readonly time: number;
  readonly layers: readonly AnimLayer[];
  readonly vx?: number;
  readonly gait?: number;
  readonly headingChange?: number;
}

/** A directional light from an azimuth about the camera's and an elevation, in degrees. */
export interface PortraitLight { readonly az: number; readonly el: number; readonly i: number; readonly colour: number }

export interface PortraitLights {
  /** It casts the shadow map, so three sorts it first, and the catchlight takes its highlight alone. */
  readonly key: PortraitLight;
  readonly fill: PortraitLight;
  readonly rim: PortraitLight;
  readonly hemi: { readonly sky: number; readonly ground: number; readonly i: number };
  readonly ambient: number;
}

/** The camera: its azimuth about the terrier and its elevation, in degrees, its distance in metres from the centre of
 *  the parts the crop holds, and its vertical field of view in degrees. */
export interface PortraitView { readonly az: number; readonly el: number; readonly dist: number; readonly fovDeg: number }

export type PortraitPart = 'body' | 'head' | 'snout' | 'jaw' | 'face' | 'ears' | 'legs' | 'tail' | 'bandana';

/** The crop: the parts it holds, projected, boxed and squared. */
export interface PortraitFrame {
  readonly parts: readonly PortraitPart[];
  /** The margin on each side, a share of the subject's larger side. */
  readonly pad: number;
  /** Grows the subject's box before it's squared, by shares of its width and height: left, right, bottom, top. */
  readonly grow?: readonly [number, number, number, number];
  /** Zooms the squared crop in by this about its top edge, so the bottom is cut. */
  readonly zoomTop?: number;
}

/** Shares of the image's side over which a layer fades out towards each edge. */
export interface Edges { readonly left?: number; readonly right?: number; readonly top?: number; readonly bottom?: number }

export interface PortraitShot {
  /** An index in the look's coats, and the pack whose bandana it wears. */
  readonly coat: number;
  readonly pack: Pack;
  readonly pose: PortraitPose;
  readonly view: PortraitView;
  readonly frame: PortraitFrame;
  readonly light: PortraitLights;
  /** The game's blob shadow at this opacity, drawn as a layer of its own, faded out towards the edges, then put under
   *  the terrier, so a tight crop never cuts it with a visible edge. */
  readonly blob?: { readonly opacity: number; readonly fade: Edges };
  /** One highlight in each eye and on the nose, from the key light alone. */
  readonly catchlight?: boolean;
  /** The drawer's meshes left undrawn, by name: terrier-body, terrier-face and the like. */
  readonly hide?: readonly string[];
  /** Meshes that cast the key light's shadow but take none, so the body's leaves no notch on the legs. */
  readonly noReceive?: readonly string[];
  /** The image's side, and the samples a side of each of its pixels: drawn at master × ss px, boxed down by ss. */
  readonly master: number;
  readonly ss: number;
}

/** Projected points of the posed terrier in the crop's unit square, x right and y down, for the hand-tuned pixels and
 *  the lock-up's baseline. */
export interface PortraitFeatures {
  /** Left on screen first. */
  readonly eyes: readonly (readonly [number, number])[];
  readonly nose: readonly [number, number];
  /** The legs' lowest point, if they're drawn. */
  readonly feet: number | null;
  /** The drawn subject's box: x0, y0, x1, y1. */
  readonly box: readonly [number, number, number, number];
}

/** Premultiplied RGBA floats, row by row from the top, each 0 to 1, sRGB-encoded as the canvas holds them. */
export interface PremultipliedImage { readonly w: number; readonly h: number; readonly d: Float32Array }

export interface Portrait {
  readonly image: PremultipliedImage;
  readonly features: PortraitFeatures;
  /** How long the drawing and the read-back took. */
  readonly ms: number;
}

/** Each part group's meshes, and which of their instances: all of them for null. */
const GROUPS: Readonly<Record<PortraitPart, readonly (readonly [string, readonly number[] | null])[]>> = {
  body: [['terrier-body', [0]]],
  head: [['terrier-head', [0]]],
  snout: [['terrier-snout', [0]]],
  jaw: [['terrier-snout', [1]]],
  face: [['terrier-face', [0]]],
  ears: [['terrier-ears', [0, 1]]],
  legs: [['terrier-legs', [0, 1, 2, 3]]],
  tail: [['terrier-tail', [0]]],
  bandana: [['terrier-bandana-plain', null], ['terrier-bandana-striped', null]],
};

/** The eyes' and the nose's catchlight: the drawer's face dark as a Phong material whose specular comes from the key
 *  light alone, directional light 0, so each eye shows one highlight, not one a light. */
function catchlightMaterial(): MeshPhongMaterial {
  const m = new MeshPhongMaterial({ color: FACE_DARK, shininess: 70, specular: 0x8a8a8a });
  m.onBeforeCompile = (shader) => {
    const pars = ShaderChunk.lights_phong_pars_fragment.replace('* material.specularStrength;', '* material.specularStrength * logoSpecGate;');
    const begin = ShaderChunk.lights_fragment_begin;
    const at = begin.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
    const end = begin.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )');
    if (at < 0 || end < 0 || !pars.includes('logoSpecGate')) throw new Error("three's shader chunks changed: the catchlight's patch no longer applies");
    const dir = begin.slice(at, end).replace('RE_Direct( directLight,', 'logoSpecGate = ( UNROLLED_LOOP_INDEX == 0 ) ? 1.0 : 0.0;\n\t\tRE_Direct( directLight,');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_phong_pars_fragment>', `float logoSpecGate = 1.0;\n${pars}`)
      .replace('#include <lights_fragment_begin>', `${begin.slice(0, at)}${dir}${begin.slice(end)}\nlogoSpecGate = 1.0;`);
  };
  m.customProgramCacheKey = () => 'portrait catchlight, key only';
  return m;
}

function drawerFrame(shot: PortraitShot): DrawerFrame {
  const p = shot.pose;
  const t = p.time;
  return {
    time: t, tick: Math.floor(t), fraction: t - Math.floor(t),
    terriers: [{
      id: 'portrait', pack: shot.pack, coat: shot.coat, mine: false,
      x: 0, y: 0, z: R_T, vx: p.vx ?? 0, vy: 0, vz: 0, heading: 0, headingChange: p.headingChange ?? 0,
      layers: p.layers, gait: p.gait ?? 0,
      takeOffTick: NEVER, landingTick: NEVER, lastBallContactTick: NEVER, lastTerrierContactTick: NEVER, lastPushDir: 0, lastPushTick: NEVER,
      bark: null, celebrate: null,
    }],
  };
}

function dirOf(azDeg: number, elDeg: number): Vector3 {
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  return new Vector3(Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e));
}

function centreOf(ps: readonly Vector3[]): Vector3 {
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of ps) {
    lo.min(p);
    hi.max(p);
  }
  return lo.add(hi).multiplyScalar(0.5);
}

/** Fades the image out towards its edges, each side's ramp eased. */
function fade(a: PremultipliedImage, edges: Edges): PremultipliedImage {
  const d = new Float32Array(a.d);
  const ease = (t: number): number => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };
  for (let y = 0; y < a.h; y++) {
    const v = (y + 0.5) / a.h;
    let ky = 1;
    if (edges.top) ky *= ease(v / edges.top);
    if (edges.bottom) ky *= ease((1 - v) / edges.bottom);
    for (let x = 0; x < a.w; x++) {
      const u = (x + 0.5) / a.w;
      let k = ky;
      if (edges.left) k *= ease(u / edges.left);
      if (edges.right) k *= ease((1 - u) / edges.right);
      if (k >= 1) continue;
      const o = (y * a.w + x) * 4;
      for (let c = 0; c < 4; c++) d[o + c]! *= k;
    }
  }
  return { w: a.w, h: a.h, d };
}

/** GL's premultiplied 8-bit read-back as premultiplied floats, boxed down by `k`. */
function boxDown(bytes: Uint8Array, size: number, k: number): PremultipliedImage {
  const w = size / k;
  const d = new Float32Array(w * w * 4);
  const inv = 1 / (255 * k * k);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let v = 0; v < k; v++) {
        let i = ((y * k + v) * size + x * k) * 4;
        for (let u = 0; u < k; u++, i += 4) {
          r += bytes[i]!;
          g += bytes[i + 1]!;
          b += bytes[i + 2]!;
          a += bytes[i + 3]!;
        }
      }
      const o = (y * w + x) * 4;
      d[o] = r * inv;
      d[o + 1] = g * inv;
      d[o + 2] = b * inv;
      d[o + 3] = a * inv;
    }
  }
  return { w, h: w, d };
}

/** The crop in normalised device coordinates: its centre and half side, the camera without a view offset. */
interface Crop { readonly cx: number; readonly cy: number; readonly hs: number }

/** One shot's scene: the posed terrier, its blob, the lights and the camera. */
interface Built {
  readonly scene: Scene;
  readonly drawer: TerrierDrawer;
  readonly camera: PerspectiveCamera;
  readonly meshes: ReadonlyMap<string, InstancedMesh>;
  readonly blobs: readonly Object3D[];
  dispose(): void;
}

/** Draws portraits on a canvas of its own. */
export class Portraits {
  readonly canvas: HTMLCanvasElement;
  private readonly look: Look;
  private readonly renderer: WebGLRenderer;
  private readonly gl: WebGL2RenderingContext;

  constructor(look: Look) {
    this.look = look;
    this.canvas = document.createElement('canvas');
    this.canvas.width = TILE;
    this.canvas.height = TILE;
    this.renderer = new WebGLRenderer({
      canvas: this.canvas, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(TILE, TILE, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.enabled = true;
    this.gl = this.renderer.getContext() as WebGL2RenderingContext;
  }

  /** What draws: the GL renderer and vendor as the debug extension names them, the samples and the drawing buffer. */
  info(): Record<string, unknown> {
    const gl = this.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      samples: gl.getParameter(gl.SAMPLES),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
  }

  shoot(shot: PortraitShot): Portrait {
    const t0 = performance.now();
    const b = this.build(shot);
    const crop = this.cropOf(b, shot);
    const features = this.featuresOf(b, crop, shot);
    const size = shot.master * shot.ss;
    let image: PremultipliedImage;
    if (shot.blob) {
      // The terrier alone, then the blob alone, faded, put under it.
      for (const o of b.blobs) o.visible = false;
      const dog = boxDown(this.render(b, crop, size), size, shot.ss);
      for (const o of b.blobs) o.visible = true;
      b.drawer.object.visible = false;
      const shade = fade(boxDown(this.render(b, crop, size), size, shot.ss), shot.blob.fade);
      for (let i = 0; i < dog.d.length; i += 4) {
        const k = 1 - dog.d[i + 3]!;
        for (let c = 0; c < 4; c++) dog.d[i + c] = dog.d[i + c]! + shade.d[i + c]! * k;
      }
      image = dog;
    } else {
      image = boxDown(this.render(b, crop, size), size, shot.ss);
    }
    b.dispose();
    return { image, features, ms: Math.round(performance.now() - t0) };
  }

  dispose(): void {
    this.renderer.dispose();
  }

  private build(shot: PortraitShot): Built {
    const scene = new Scene();
    const drawer = createCodeDrawer(this.look, 1);
    const meshes = new Map<string, InstancedMesh>();
    for (const c of drawer.object.children) meshes.set(c.name, c as InstancedMesh);
    const disposables: { dispose(): void }[] = [];
    const g = terrierGeometries(this.look.terrier, 'none', CLOSE_UP);
    const closeUp = {
      'terrier-body': g.body, 'terrier-head': g.head, 'terrier-snout': g.snout, 'terrier-face': g.face, 'terrier-ears': g.ear,
      'terrier-legs': g.leg, 'terrier-tail': g.tail, 'terrier-bandana-plain': g.bandanaPlain, 'terrier-bandana-striped': g.bandanaStriped,
    };
    for (const [name, geometry] of Object.entries(closeUp)) {
      const m = meshes.get(name);
      if (!m) throw new Error(`the drawer has no ${name}`);
      m.geometry = geometry;
      disposables.push(geometry);
    }
    if (shot.catchlight) {
      const material = catchlightMaterial();
      meshes.get('terrier-face')!.material = material;
      disposables.push(material);
    }
    drawer.draw(drawerFrame(shot));
    for (const name of shot.hide ?? []) {
      const m = meshes.get(name);
      if (!m) throw new Error(`the drawer has no ${name} to hide`);
      m.visible = false;
    }
    scene.add(drawer.object);

    const blobs: Object3D[] = [];
    if (shot.blob) {
      const texture = blobTexture(BLOB_TEXTURE);
      const material = new MeshBasicMaterial({ map: texture, color: 0x000000, transparent: true, depthWrite: false, opacity: shot.blob.opacity });
      const mesh = new Mesh(new PlaneGeometry(1, 1), material);
      const k = shadowSize(TERRIER_SHADOW_RADII * R_T, 0);
      mesh.scale.set(k, k, 1);
      mesh.position.set(0, 0, BLOB_LIFT);
      mesh.renderOrder = 1;
      scene.add(mesh);
      blobs.push(mesh);
      disposables.push(texture, material, mesh.geometry);
    }

    // The lights, placed about the camera's azimuth; the key casts the shadow map.
    const L = shot.light;
    const target = new Object3D();
    scene.add(target);
    const directional = (o: PortraitLight, shadow: boolean): void => {
      const l = new DirectionalLight(o.colour, o.i);
      l.position.copy(dirOf(shot.view.az + o.az, o.el).multiplyScalar(10));
      l.target = target;
      if (shadow) {
        l.castShadow = true;
        l.shadow.mapSize.set(4096, 4096);
        const c = l.shadow.camera;
        c.left = -1;
        c.right = 1;
        c.top = 1;
        c.bottom = -1;
        c.near = 1;
        c.far = 25;
        l.shadow.bias = -0.0004;
        l.shadow.normalBias = 0.004;
        l.shadow.radius = 6;
      }
      scene.add(l);
      disposables.push(l);
    };
    directional(L.key, true);
    directional(L.fill, false);
    directional(L.rim, false);
    const hemi = new HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.i);
    hemi.position.set(0, 0, 1);
    scene.add(hemi, new AmbientLight(0xffffff, L.ambient));
    for (const m of meshes.values()) {
      m.castShadow = true;
      m.receiveShadow = !(shot.noReceive ?? []).includes(m.name);
    }

    const camera = new PerspectiveCamera(shot.view.fovDeg, 1, 0.05, 60);
    camera.up.set(0, 0, 1);
    scene.updateMatrixWorld(true);
    const aim = centreOf(this.pointsOf(meshes, shot.frame.parts));
    target.position.copy(aim);
    camera.position.copy(aim).addScaledVector(dirOf(shot.view.az, shot.view.el), shot.view.dist);
    camera.lookAt(aim);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    scene.updateMatrixWorld(true);

    return {
      scene, drawer, camera, meshes, blobs,
      dispose: () => {
        drawer.dispose();
        for (const d of disposables) d.dispose();
        this.renderer.renderLists.dispose();
      },
    };
  }

  /** The groups' vertices, posed: every one of a part with up to 4,000, and evenly spaced ones of a larger part. */
  private pointsOf(meshes: ReadonlyMap<string, InstancedMesh>, parts: readonly PortraitPart[]): Vector3[] {
    const out: Vector3[] = [];
    const m = new Matrix4();
    const v = new Vector3();
    for (const part of parts) {
      for (const [name, which] of GROUPS[part]) {
        const mesh = meshes.get(name);
        if (!mesh || mesh.count === 0) continue;
        const instances = which ?? Array.from({ length: mesh.count }, (_, k) => k);
        const pos = mesh.geometry.getAttribute('position');
        const step = Math.max(1, Math.floor(pos.count / 4000));
        for (const k of instances) {
          mesh.getMatrixAt(k, m);
          for (let i = 0; i < pos.count; i += step) out.push(v.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
        }
      }
    }
    return out;
  }

  private cropOf(b: Built, shot: PortraitShot): Crop {
    b.camera.clearViewOffset();
    b.camera.updateProjectionMatrix();
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of this.pointsOf(b.meshes, shot.frame.parts)) {
      const q = p.clone().project(b.camera);
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y);
      y1 = Math.max(y1, q.y);
    }
    if (shot.frame.grow) {
      const [left, right, bottom, top] = shot.frame.grow;
      const w = x1 - x0;
      const h = y1 - y0;
      x0 -= left * w;
      x1 += right * w;
      y0 -= bottom * h;
      y1 += top * h;
    }
    const side = Math.max(x1 - x0, y1 - y0);
    let hs = (side / 2) * (1 + 2 * shot.frame.pad);
    let cy = (y0 + y1) / 2;
    if (shot.frame.zoomTop) {
      const top = cy + hs;
      hs /= shot.frame.zoomTop;
      cy = top - hs;
    }
    return { cx: (x0 + x1) / 2, cy, hs };
  }

  /** A world point in the crop's unit square: x right, y down. The camera must have no view offset. */
  private toUnit(p: Vector3, camera: PerspectiveCamera, crop: Crop): [number, number] {
    const q = p.clone().project(camera);
    return [(q.x - (crop.cx - crop.hs)) / (2 * crop.hs), (crop.cy + crop.hs - q.y) / (2 * crop.hs)];
  }

  private featuresOf(b: Built, crop: Crop, shot: PortraitShot): PortraitFeatures {
    b.camera.clearViewOffset();
    b.camera.updateProjectionMatrix();
    const s = this.look.terrier;
    const head = new Matrix4();
    b.meshes.get('terrier-face')!.getMatrixAt(0, head);
    const eyes = [1, -1].map((side) => this.toUnit(new Vector3(s.eyes.centre[0], side * s.eyes.centre[1], s.eyes.centre[2]).applyMatrix4(head), b.camera, crop));
    eyes.sort((a, c) => a[0] - c[0]);
    const nose = this.toUnit(new Vector3(s.nose.centre[0], 0, s.nose.centre[2]).applyMatrix4(head), b.camera, crop);
    const hidden = new Set(shot.hide ?? []);
    let feet: number | null = null;
    if (!hidden.has('terrier-legs')) {
      for (const p of this.pointsOf(b.meshes, ['legs'])) {
        const y = this.toUnit(p, b.camera, crop)[1];
        feet = feet === null ? y : Math.max(feet, y);
      }
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const drawn = (Object.keys(GROUPS) as PortraitPart[]).filter((part) => GROUPS[part].some(([name]) => !hidden.has(name)));
    for (const p of this.pointsOf(b.meshes, drawn)) {
      const [x, y] = this.toUnit(p, b.camera, crop);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return { eyes, nose, feet, box: [x0, y0, x1, y1] };
  }

  /** The crop at `size` px in tiles, read back: GL's premultiplied 8-bit RGBA, rows from the top. */
  private render(b: Built, crop: Crop, size: number): Uint8Array {
    const gl = this.gl;
    const tiles = Math.ceil(size / TILE);
    const T = size / tiles;
    if (!Number.isInteger(T)) throw new Error(`${size} px doesn't split into whole tiles`);
    this.renderer.setSize(T, T, false);
    const full = size / crop.hs;
    const left = ((crop.cx - crop.hs + 1) / 2) * full;
    const top = ((1 - (crop.cy + crop.hs)) / 2) * full;
    const out = new Uint8Array(size * size * 4);
    const buf = new Uint8Array(T * T * 4);
    for (let j = 0; j < tiles; j++) {
      for (let i = 0; i < tiles; i++) {
        b.camera.setViewOffset(full, full, left + i * T, top + j * T, T, T);
        b.camera.updateProjectionMatrix();
        this.renderer.render(b.scene, b.camera);
        gl.readPixels(0, 0, T, T, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        // GL's rows run bottom up.
        for (let y = 0; y < T; y++) {
          const src = (T - 1 - y) * T * 4;
          out.set(buf.subarray(src, src + T * 4), ((j * T + y) * size + i * T) * 4);
        }
      }
    }
    b.camera.clearViewOffset();
    return out;
  }
}
