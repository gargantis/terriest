// The walls drawn as glass (C-57; the owner's decision of 2026-11-21: "Let's
// make the walls transparent like plexiglass. This way the virtual camera
// can go outside of the arena."), and the rail along their top: drawn over
// the simulation's own wall pieces (src/core/sim/pitch.ts), which stop
// terriers and the ball as before.
//
// One geometry of 28 panes, each wall piece split into panes about
// PANE_METRES long, drawn twice by one program. Each draw keeps only some
// panes, by the camera's side of each pane's wall's plane, which wallSides
// decides on the CPU once a frame and the vertex shader reads from a
// uniform by the wall each vertex carries, so the rule the tests check is
// the one drawn; a pane a draw doesn't keep collapses to a point outside
// the view and costs no pixels:
// - the inner draw: the panes the camera is inside of, the far side of the
//   arena, first of the transparent things (src/render/pitch.ts's order): a
//   light tint, a sheen where it's seen at a slant, a post at every pane
//   joint, the kick band along the foot in its half's pack colour, and the
//   band's top line;
// - the outer draw: the panes the camera is outside of, the near side seen
//   from outside, last of them, squashed to the kick band: only the band and
//   its line, so a camera outside looks at the pitch through nothing. With
//   the camera inside every wall's plane it has no pane to draw, and is
//   skipped.
// Both draws are clear near the camera and round the line to its subject
// (src/render/fade.ts's line fade), so a camera passing through a wall sees
// nothing snap on or off. They write no depth, test it, and draw both
// sides. The colours are the look's: the tint is its wall panel colour with
// some of the sky, the sheen, the posts and the line that colour with white,
// and the band and the rail each half's pack colour with white (L68).
// Metres, z up.

import { BufferAttribute, BufferGeometry, Color, DoubleSide, GLSL3, type IUniform, ShaderMaterial, Vector2, type Vector3 } from 'three';
import { type Pack, type Pitch, WALL } from '../core/sim/pitch';
import { LINE_FADE_GLSL, type LineFade } from './fade';
import type { Look } from './look';
import { along, edge1, edge2, mix, offsetOf, origin, shade, Triangles, type V, WHITE } from './shapes';

/** Each wall piece's panes, about this long. */
const PANE_METRES = 4;
/** The inner draw's tint, seen square on and at a grazing view, (1 − |cos θ|)⁴ between them. */
const ALPHA_FACE = 0.08;
const ALPHA_RIM = 0.24;
/** A post at every pane joint, this half-width each side of it, at this opacity, kept a pixel wide and faded as it
 *  gets thinner than one, so far posts never shimmer. */
const POST_HALF_METRES = 0.03;
const ALPHA_POST = 0.55;
/** The kick band along the foot, a hockey board's height for a terrier: this high, its half's pack colour with this
 *  much white, at this opacity; its top line this half-width each side, at this one. */
const KICK_BAND_METRES = 0.45;
const KICK_BAND_WHITE = 0.2;
const ALPHA_KICK_BAND = 0.55;
const LINE_HALF_METRES = 0.02;
const ALPHA_LINE = 0.8;
/** The outer draw keeps each pane up to the band's top and this much more, for its line. */
const OUTER_OVER_BAND_METRES = 0.06;
/** Nearer the camera than the first distance the glass is clear, by the second all there. */
const NEAR_FADE_METRES: readonly [number, number] = [0.5, 2.5];
/** The posts and the sheen fade in over these distances from the camera, so nothing bright sits beside it. */
const DETAIL_FADE_METRES: readonly [number, number] = [1.0, 5.0];
/** The tint: the look's wall panel colour with this much of the sky. The sheen, the posts and the band's line: that
 *  colour with this much white. */
const TINT_SKY = 0.5;
const SHEEN_WHITE = 0.6;
const POST_WHITE = 0.75;
const LINE_WHITE = 0.9;
/** The rail along the walls' top: from this far below the top to this far above it, this thick, its half's pack
 *  colour with this much white, as the padding's was, its underside shaded. */
const RAIL_DOWN_METRES = 0.1;
const RAIL_UP_METRES = 0.03;
const RAIL_THICK_METRES = 0.09;
const RAIL_WHITE = 0.15;
const RAIL_UNDER_SHADE = 0.8;

/** A pane's plane: its normal into the pitch, and its offset along it. */
export interface PanePlane {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly offset: number;
}

/** A wall piece's plane, by the simulation's name for the piece. */
export interface WallPlane extends PanePlane {
  readonly name: string;
}

/** How far a point is inside a pane's plane: the inner draw keeps a pane the camera is 0 or more inside of, the
 *  outer draw one it's outside of (wallSides). */
export function insideOf(q: PanePlane, x: number, y: number, z: number): number {
  return x * q.nx + y * q.ny + z * q.nz - q.offset;
}

/** The walls' planes, a wall piece's each, in the pieces' order: the order of the glass's wallInside uniform, by
 *  which each vertex finds its pane's wall. */
export function wallPlanes(p: Pitch): WallPlane[] {
  return p.pieces.filter((q) => q.surface === WALL).map((q) => ({ name: q.name, nx: q.nx, ny: q.ny, nz: q.nz, offset: offsetOf(q) }));
}

/** The glass's draws' choice of panes for a camera at c, into `out`, a wall's each (C-57): 1 for a wall whose plane
 *  the camera is 0 or more inside of, its panes the inner draw's, and 0 for one it's outside of, its panes the
 *  outer draw's. Decided here once a frame, for every camera, the overview's included; the vertex shader only reads
 *  it, from the wallInside uniform. */
export function wallSides(planes: readonly PanePlane[], c: Readonly<Vector3>, out: number[]): number[] {
  for (let k = 0; k < planes.length; k++) out[k] = insideOf(planes[k]!, c.x, c.y, c.z) >= 0 ? 1 : 0;
  return out;
}

/** The glass's wallInside uniform: wallSides' choice, which both draws read. */
export type WallSides = IUniform<number[]>;

/** The uniform for `planes`, every wall's panes the inner draw's until a frame decides. */
export function wallSidesUniform(planes: readonly PanePlane[]): WallSides {
  return { value: planes.map(() => 1) };
}

/** Whether the outer draw has a pane to draw, by wallSides' choice: the camera outside some wall's plane. */
export const outerDrawn = (sides: readonly number[]): boolean => sides.includes(0);

/** The glass: each wall piece as panes about PANE_METRES long, two triangles each. Every vertex carries its pane's
 *  normal, for the sheen, its wall's index in wallPlanes' order, by which the vertex shader reads the draws' choice
 *  of its pane, and its place along the pane with the pane's length, for the posts at its ends. The pitch's object
 *  stands untransformed, so a pane's plane is the world's. */
export function glassGeometry(p: Pitch): BufferGeometry {
  const position: number[] = [];
  const normal: number[] = [];
  const pane: number[] = [];
  const wall: number[] = [];
  let index = 0;
  for (const q of p.pieces) {
    if (q.surface !== WALL) continue;
    const o = origin(q);
    const e1 = edge1(q);
    const e2 = edge2(q);
    const length = Math.hypot(e1[0], e1[1], e1[2]);
    const count = Math.max(1, Math.round(length / PANE_METRES));
    const wide = length / count;
    for (let i = 0; i < count; i++) {
      const a = along(o, e1, i / count);
      const b = along(o, e1, (i + 1) / count);
      const c = along(b, e2, 1);
      const d = along(a, e2, 1);
      const put = (at: V, u: number): void => {
        position.push(at[0], at[1], at[2]);
        normal.push(q.nx, q.ny, q.nz);
        pane.push(u, wide);
        wall.push(index);
      };
      put(a, 0);
      put(b, wide);
      put(c, wide);
      put(a, 0);
      put(c, wide);
      put(d, 0);
    }
    index++;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  g.setAttribute('pane', new BufferAttribute(new Float32Array(pane), 2));
  g.setAttribute('wall', new BufferAttribute(new Float32Array(wall), 1));
  return g;
}

/** The glass's vertex shader for `walls` walls. */
const glassVertex = (walls: number): string => `
in vec2 pane;
in float wall;
uniform float outer;
uniform float outerTop;
uniform float wallInside[${walls}];
out vec3 vWorld;
out vec3 vNormal;
out vec2 vPane;
void main() {
  // Whether the camera is inside this pane's wall's plane, as wallSides decided it this frame. Every vertex of a pane
  // has its wall, so all of them decide alike.
  bool inside = wallInside[int(wall)] > 0.5;
  bool kept = outer > 0.5 ? !inside : inside;
  vec3 p = position;
  if (outer > 0.5) p.z = min(p.z, outerTop);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vPane = pane;
  // A pane this draw doesn't keep collapses to a point outside the view: no pixels.
  gl_Position = kept ? projectionMatrix * viewMatrix * w : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const GLASS_FRAGMENT = `
uniform float outer;
uniform vec3 tint;
uniform vec3 sheen;
uniform vec3 postColour;
uniform vec3 lineColour;
uniform vec3 bandA;
uniform vec3 bandB;
uniform float alphaFace;
uniform float alphaRim;
uniform float alphaPost;
uniform float postHalf;
uniform float bandTop;
uniform float alphaBand;
uniform float lineHalf;
uniform float alphaLine;
uniform vec2 nearFade;
uniform vec2 detailFade;
${LINE_FADE_GLSL}
in vec3 vWorld;
in vec3 vNormal;
in vec2 vPane;
out vec4 glassColour;
// 1 within halfWidth of e = 0, anti-aliased by e's rate of change on the screen, kept at least a pixel wide, and
// fading out as it gets thinner than one.
float strip(float e, float halfWidth) {
  float px = max(fwidth(e), 1e-5);
  float hw = max(halfWidth, 0.75 * px);
  return (1.0 - smoothstep(hw - 0.5 * px, hw + 0.5 * px, abs(e))) * min(1.0, halfWidth / (0.75 * px));
}
// Colour c at opacity a laid over a layer.
vec4 over(vec4 under, vec3 c, float a) {
  float outA = a + under.a * (1.0 - a);
  return vec4((c * a + under.rgb * under.a * (1.0 - a)) / max(outA, 1e-6), outA);
}
void main() {
  vec3 toCamera = cameraPosition - vWorld;
  float dist = length(toCamera);
  float detail = smoothstep(detailFade.x, detailFade.y, dist);
  // The strips first, out of any branch, for their screen-space derivatives.
  float post = strip(min(vPane.x, vPane.y - vPane.x), postHalf);
  float line = strip(vWorld.z - bandTop, lineHalf);
  float pz = max(fwidth(vWorld.z), 1e-5);
  float band = 1.0 - smoothstep(bandTop - 0.5 * pz, bandTop + 0.5 * pz, vWorld.z);
  vec4 c = vec4(tint, 0.0);
  if (outer < 0.5) {
    float slant = clamp(1.0 - abs(dot(normalize(vNormal), toCamera / max(dist, 1e-6))), 0.0, 1.0);
    float rim = slant * slant * slant * slant * detail;
    c = vec4(mix(tint, sheen, rim), mix(alphaFace, alphaRim, rim));
  }
  c = over(c, vWorld.x < 0.0 ? bandA : bandB, alphaBand * band);
  if (outer < 0.5) c = over(c, postColour, alphaPost * detail * post);
  c = over(c, lineColour, alphaLine * line);
  float a = c.a * smoothstep(nearFade.x, nearFade.y, dist) * lineFade(vWorld);
  glassColour = linearToOutputTexel(vec4(c.rgb, a));
}
`;

/** One of the glass's two draws, the inner or the outer: the same program, its draw picked by a uniform, its panes
 *  by `sides`, wallSides' choice, which both draws share. */
export function glassMaterial(look: Look, outer: boolean, fade: LineFade, sides: WallSides): ShaderMaterial {
  const panel = look.pitch.wallPanel;
  const band = (pack: Pack): Color => new Color(mix(look.packs[pack].colour, WHITE, KICK_BAND_WHITE));
  return new ShaderMaterial({
    name: outer ? 'glass, outer' : 'glass, inner',
    glslVersion: GLSL3,
    uniforms: {
      ...fade,
      wallInside: sides,
      outer: { value: outer ? 1 : 0 },
      outerTop: { value: KICK_BAND_METRES + OUTER_OVER_BAND_METRES },
      tint: { value: new Color(mix(panel, look.pitch.sky, TINT_SKY)) },
      sheen: { value: new Color(mix(panel, WHITE, SHEEN_WHITE)) },
      postColour: { value: new Color(mix(panel, WHITE, POST_WHITE)) },
      lineColour: { value: new Color(mix(panel, WHITE, LINE_WHITE)) },
      bandA: { value: band(0) },
      bandB: { value: band(1) },
      alphaFace: { value: ALPHA_FACE },
      alphaRim: { value: ALPHA_RIM },
      alphaPost: { value: ALPHA_POST },
      postHalf: { value: POST_HALF_METRES },
      bandTop: { value: KICK_BAND_METRES },
      alphaBand: { value: ALPHA_KICK_BAND },
      lineHalf: { value: LINE_HALF_METRES },
      alphaLine: { value: ALPHA_LINE },
      nearFade: { value: new Vector2(NEAR_FADE_METRES[0], NEAR_FADE_METRES[1]) },
      detailFade: { value: new Vector2(DETAIL_FADE_METRES[0], DETAIL_FADE_METRES[1]) },
    },
    vertexShader: glassVertex(sides.value.length),
    fragmentShader: GLASS_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** The rail along every wall piece's top edge, centred on the wall's plane, RAIL_DOWN_METRES below the top to
 *  RAIL_UP_METRES above it and RAIL_THICK_METRES thick; split where it crosses the halfway line, so each half's
 *  takes its pack's colour; each a little longer than its edge, so the rails meet at the corners. */
export function railGeometry(p: Pitch, look: Look): BufferGeometry {
  const t = new Triangles();
  const h = RAIL_THICK_METRES / 2;
  for (const q of p.pieces) {
    if (q.surface !== WALL) continue;
    const o = origin(q);
    const e1 = edge1(q);
    const top = along(o, edge2(q), 1);
    const length = Math.hypot(e1[0], e1[1], e1[2]);
    const ux = e1[0] / length;
    const uy = e1[1] / length;
    const splits = [0, 1];
    const crossing = q.e1x === 0 ? -1 : -q.ox / q.e1x;
    if (crossing > 0 && crossing < 1) splits.splice(1, 0, crossing);
    const extend = h / length;
    const lo = top[2] - RAIL_DOWN_METRES;
    const hi = top[2] + RAIL_UP_METRES;
    for (let s = 0; s + 1 < splits.length; s++) {
      const a = along(top, e1, splits[s]! - (s === 0 ? extend : 0));
      const b = along(top, e1, splits[s + 1]! + (s + 2 === splits.length ? extend : 0));
      const pack: Pack = a[0] + b[0] < 0 ? 0 : 1;
      const colour = mix(look.packs[pack].colour, WHITE, RAIL_WHITE);
      const at = (pt: V, side: number, z: number): V => [pt[0] + q.nx * h * side, pt[1] + q.ny * h * side, z];
      t.quad(at(a, 1, lo), at(b, 1, lo), at(b, 1, hi), at(a, 1, hi), [q.nx, q.ny, 0], colour);
      t.quad(at(a, -1, lo), at(b, -1, lo), at(b, -1, hi), at(a, -1, hi), [-q.nx, -q.ny, 0], colour);
      t.quad(at(a, 1, hi), at(b, 1, hi), at(b, -1, hi), at(a, -1, hi), [0, 0, 1], colour);
      t.quad(at(a, 1, lo), at(b, 1, lo), at(b, -1, lo), at(a, -1, lo), [0, 0, -1], shade(colour, RAIL_UNDER_SHADE));
      t.quad(at(a, 1, lo), at(a, -1, lo), at(a, -1, hi), at(a, 1, hi), [-ux, -uy, 0], colour);
      t.quad(at(b, 1, lo), at(b, -1, lo), at(b, -1, hi), at(b, 1, hi), [ux, uy, 0], colour);
    }
  }
  return t.geometry();
}
