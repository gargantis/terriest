import { MeshLambertMaterial, ShaderLib, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { pitch } from '../core/sim/pitch';
import { lineFadeUniforms } from './fade';
import { facesShown, facesShownUniform, goalFrameMaterial, goalNettingMaterial, nettingFaces, nettingShown } from './goal-fade';

// The goals giving way to the camera (C-57), without a GPU: the frames'
// fade hooks into three's own Lambert shader at chunks that must be there,
// with a program of its own, and discards a fragment its fades have all but
// cleared; the netting's faces, and how much of each shows, decided on the
// CPU and read by its shader, which drops a face the camera is outside of
// from beyond its goal's line (src/render/pitch.test.ts checks it on the
// netting's own lines).

describe("the goal frames' fade", () => {
  it("hooks the near fade and the line fade into three's Lambert shader, after the chunks it names, with a program of its own", () => {
    const fade = lineFadeUniforms();
    const m = goalFrameMaterial(fade);
    const shader = { uniforms: { ...ShaderLib.lambert.uniforms }, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader };
    m.onBeforeCompile(shader as never, null as never);
    const after = (source: string, chunk: string, line: string): void => {
      const at = source.indexOf(chunk);
      expect(at, chunk).toBeGreaterThanOrEqual(0);
      expect(source.indexOf(line, at), `${line} after ${chunk}`).toBeGreaterThan(at);
    };
    after(shader.vertexShader, '#include <common>', 'varying vec3 vFadeWorld;');
    after(shader.vertexShader, '#include <project_vertex>', 'vFadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    after(shader.fragmentShader, '#include <common>', 'float lineFade(vec3 p)');
    after(shader.fragmentShader, '#include <opaque_fragment>', 'gl_FragColor.a *=');
    // A fragment the fades leave less than 5% of writes no depth, so a post faded out cuts nothing drawn after it.
    after(shader.fragmentShader, 'gl_FragColor.a *=', 'if (gl_FragColor.a < 0.05) discard;');
    expect(shader.uniforms).toMatchObject({ ...fade });
    expect((shader.uniforms as Record<string, { value: { x: number; y: number } }>)['goalNearFade']!.value).toMatchObject({ x: 1.5, y: 4.5 });
    // Lit and coloured as the frames were, see-through for the fade, and still writing depth.
    expect([m.vertexColors, m.transparent, m.depthWrite]).toEqual([true, true, true]);
    expect(m.customProgramCacheKey()).not.toBe(new MeshLambertMaterial({ vertexColors: true }).customProgramCacheKey());
    // A shader without a chunk it names is an error, not a silent unfaded frame.
    expect(() => m.onBeforeCompile({ uniforms: {}, vertexShader: 'void main() {}', fragmentShader: '' } as never, null as never)).toThrow(/found no #include <common>/);
  });
});

describe("the goals' netting", () => {
  it("draws its lines see-through, writing no depth, each face as much as the CPU's choice shows, the shader deciding nothing itself", () => {
    const faces = nettingFaces(pitch);
    const shown = facesShownUniform(faces);
    const m = goalNettingMaterial(lineFadeUniforms(), shown);
    expect([m.transparent, m.depthWrite, m.uniforms['faceShown']]).toEqual([true, false, shown]);
    expect(m.uniforms['faceShown']).toBe(shown);
    expect(shown.value).toEqual(Array(8).fill(1));
    expect(m.vertexShader).toContain('uniform float faceShown[8];');
    expect(m.vertexShader).toContain('vShown = faceShown[int(face)];');
    expect(m.vertexShader).not.toContain('cameraPosition');
    m.dispose();
  });

  it("has each goal's back, two sides and top as faces, by the simulation's names, their normals into the goal", () => {
    const faces = nettingFaces(pitch);
    expect(faces.map((f) => f.name).sort()).toEqual(
      ['goal −x back', 'goal −x side −y', 'goal −x side +y', 'goal −x top', 'goal +x back', 'goal +x side −y', 'goal +x side +y', 'goal +x top'].sort(),
    );
    const back = faces.find((f) => f.name === 'goal −x back')!;
    expect([...back.face, back.side]).toEqual([1, 0, 0, -pitch.goalLineX - pitch.shape.goalDepthMetres, -1]);
    const top = faces.find((f) => f.name === 'goal +x top')!;
    expect([top.face[2], top.side]).toEqual([-1, 1]);
  });

  it("goes over half a metre outside a face and half a metre past the line, and only from beyond it", () => {
    // The −x goal's back, its plane at x = −22, its normal into the goal.
    const back = [1, 0, 0, -pitch.goalLineX - pitch.shape.goalDepthMetres] as const;
    const shown = (x: number): number => nettingShown(back, -1, pitch.goalLineX, x, 0, 2);
    // In front of the line, and in the goal: all of it. Behind the back, beyond the line: going, then gone.
    expect([shown(-19), shown(-21.9), shown(-22), shown(-22.25), shown(-22.5), shown(-30)]).toEqual([1, 1, 1, 0.5, 0, 0]);
    // The other goal's camera never drops it.
    expect(nettingShown(back, -1, pitch.goalLineX, 30, 0, 2)).toBe(1);
    // Every face's at once, as a frame decides them: behind the −x goal's back, its back alone gone.
    const faces = nettingFaces(pitch);
    const all = facesShown(faces, pitch.goalLineX, new Vector3(-24, 0, 2.1), []);
    expect(faces.filter((_, k) => all[k] !== 1).map((f) => [f.name, all[faces.indexOf(f)]])).toEqual([['goal −x back', 0]]);
  });
});
