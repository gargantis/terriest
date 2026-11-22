// The goals giving way to the camera (C-57). With the walls glass, a
// player's camera may sit in a goal or behind it, or beside it beyond the
// goal line, and nothing of a goal moves it. So a goal's frame and netting
// fade near the camera, clear within GOAL_NEAR_FADE_METRES[0] and all there
// by [1], and round the line to its subject, as the glass does
// (src/render/fade.ts's line fade); and once the camera is beyond a goal's
// line, that goal's netting faces the camera is outside of aren't drawn:
// from behind a goal it looks through the open back, and from beside it
// through the open side. How much of each face shows is decided on the CPU
// once a frame (facesShown) and read by the netting's vertex shader from a
// uniform by the face each vertex carries, so the rule the tests check is
// the one drawn. The frames keep their own lit material, drawn among the
// transparent things after the inner glass and still writing depth, so
// what's behind a solid post stays hidden, but for a fragment its fades
// have all but cleared, which it discards, so a post faded out cuts nothing
// drawn after it; the netting is lines, transparent, writing no depth. Both
// are src/render/pitch.ts's parts, and its draw order places them. Metres,
// z up.

import { GLSL3, type IUniform, MeshLambertMaterial, ShaderMaterial, Vector2, type Vector3 } from 'three';
import { GOAL_NET, type Pitch } from '../core/sim/pitch';
import { LINE_FADE_GLSL, type LineFade } from './fade';
import { offsetOf } from './shapes';

/** A goal's frame and netting: clear nearer the camera than the first distance, all there by the second. */
const GOAL_NEAR_FADE_METRES: readonly [number, number] = [1.5, 4.5];
/** A netting face the camera is outside of goes over this much of the camera's distance outside its plane, and
 *  over the first this much past its goal's line. */
const CUT_METRES = 0.5;
/** A frame's fragment its fades leave less than this of is discarded, so it writes no depth. */
const FRAME_CLEAR_ALPHA = 0.05;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A netting face's plane: its normal into the goal, and its offset along it. */
export type Face = readonly [nx: number, ny: number, nz: number, offset: number];

/** How much of a netting face shows for a camera at (x, y, z): all of it, but for a face the camera is outside of
 *  once the camera is beyond its goal's line, at `side` (−1 or 1) of the halfway line, and none of it from CUT_METRES
 *  outside and CUT_METRES beyond. */
export function nettingShown(face: Face, side: number, goalLineX: number, x: number, y: number, z: number): number {
  const outside = face[3] - (x * face[0] + y * face[1] + z * face[2]);
  const beyond = smoothstep(goalLineX, goalLineX + CUT_METRES, x * side);
  return 1 - smoothstep(0, CUT_METRES, outside) * beyond;
}

/** A face of a goal's netting: its piece's name, its plane, and its goal's side of the halfway line, −1 or 1. */
export interface NettingFace {
  readonly name: string;
  readonly face: Face;
  readonly side: number;
}

/** The goals' netting faces, a goal net piece's each, in the pieces' order: the order of the netting's faceShown
 *  uniform, by which each vertex finds its face. */
export function nettingFaces(p: Pitch): NettingFace[] {
  return p.pieces.filter((q) => q.surface === GOAL_NET).map((q) => ({ name: q.name, face: [q.nx, q.ny, q.nz, offsetOf(q)], side: Math.sign(q.ox) }));
}

/** How much of each face shows for a camera at c, nettingShown's, into `out`, a face's each. Decided here once a
 *  frame; the netting's vertex shader only reads it, from the faceShown uniform. */
export function facesShown(faces: readonly NettingFace[], goalLineX: number, c: Readonly<Vector3>, out: number[]): number[] {
  for (let k = 0; k < faces.length; k++) out[k] = nettingShown(faces[k]!.face, faces[k]!.side, goalLineX, c.x, c.y, c.z);
  return out;
}

/** The netting's faceShown uniform: facesShown's choice. */
export type FacesShown = IUniform<number[]>;

/** The uniform for `faces`, every face whole until a frame decides. */
export function facesShownUniform(faces: readonly NettingFace[]): FacesShown {
  return { value: faces.map(() => 1) };
}

/** Where a goal's frame fades into three's Lambert shader: each source's chunk, and what follows it. */
const FRAME_VERTEX_HOOKS: readonly (readonly [string, string])[] = [
  ['#include <common>', 'varying vec3 vFadeWorld;'],
  ['#include <project_vertex>', 'vFadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'],
];
const FRAME_FRAGMENT_HOOKS: readonly (readonly [string, string])[] = [
  ['#include <common>', `varying vec3 vFadeWorld;\nuniform vec2 goalNearFade;\n${LINE_FADE_GLSL}`],
  [
    '#include <opaque_fragment>',
    'gl_FragColor.a *= smoothstep(goalNearFade.x, goalNearFade.y, length(cameraPosition - vFadeWorld)) * lineFade(vFadeWorld);\n' +
      `if (gl_FragColor.a < ${FRAME_CLEAR_ALPHA.toFixed(2)}) discard;`,
  ],
];

/** A shader's source with each hook's lines after its chunk, which must be there. */
function hooked(source: string, hooks: readonly (readonly [string, string])[]): string {
  let out = source;
  for (const [chunk, lines] of hooks) {
    if (!out.includes(chunk)) throw new Error(`the goal frames' fade found no ${chunk} in three's shader`);
    out = out.replace(chunk, `${chunk}\n${lines}`);
  }
  return out;
}

/** The goals' frames' material: lit, their vertices' colours, faded near the camera and round the line, drawn among
 *  the transparent things and still writing depth, but for a fragment the fades leave less than FRAME_CLEAR_ALPHA
 *  of, which it discards. */
export function goalFrameMaterial(fade: LineFade): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ name: 'goal frames', vertexColors: true, transparent: true });
  const goalNearFade = { value: new Vector2(GOAL_NEAR_FADE_METRES[0], GOAL_NEAR_FADE_METRES[1]) };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fade, { goalNearFade });
    shader.vertexShader = hooked(shader.vertexShader, FRAME_VERTEX_HOOKS);
    shader.fragmentShader = hooked(shader.fragmentShader, FRAME_FRAGMENT_HOOKS);
  };
  // Its own program, apart from the plain Lambert of the floor's markings and the rail.
  m.customProgramCacheKey = () => 'goal frames, fading';
  return m;
}

/** The netting's vertex shader for `faces` faces. */
const nettingVertex = (faces: number): string => `
in vec3 color;
in float face;
uniform float faceShown[${faces}];
out vec3 vColour;
out vec3 vWorld;
out float vShown;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  // How much of this vertex's face shows, as facesShown decided it this frame: the same at every vertex of a face,
  // so the whole face goes alike.
  vShown = faceShown[int(face)];
  vColour = color;
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const NETTING_FRAGMENT = `
uniform vec2 goalNearFade;
${LINE_FADE_GLSL}
in vec3 vColour;
in vec3 vWorld;
in float vShown;
out vec4 nettingColour;
void main() {
  float a = vShown * smoothstep(goalNearFade.x, goalNearFade.y, length(cameraPosition - vWorld)) * lineFade(vWorld);
  nettingColour = linearToOutputTexel(vec4(vColour, a));
}
`;

/** The goals' netting's material: its lines' colours, faded near the camera and round the line, a face shown by
 *  `shown`, facesShown's choice. Its geometry carries each vertex's face (pitch.ts). */
export function goalNettingMaterial(fade: LineFade, shown: FacesShown): ShaderMaterial {
  return new ShaderMaterial({
    name: 'goal netting',
    glslVersion: GLSL3,
    uniforms: {
      ...fade,
      goalNearFade: { value: new Vector2(GOAL_NEAR_FADE_METRES[0], GOAL_NEAR_FADE_METRES[1]) },
      faceShown: shown,
    },
    vertexShader: nettingVertex(shown.value.length),
    fragmentShader: NETTING_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
}
