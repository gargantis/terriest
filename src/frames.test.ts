import { describe, expect, it } from 'vitest';
import { config } from './config';
import { parseFrameParams } from './frames';

// The #test=frames page's parameters, in its own fragment (M4's design, research/m4/DESIGN.md, §1.53,
// M4-Q4): seconds, quality, frameMs, capacity, repair=1 with holdAt and hold, and model=<path>, a
// same-origin relative path only, with no scheme, no // and no ..; a parameter it doesn't take, one
// given twice, or one out of its range is refused, so the page says why and contacts nothing. The page
// itself plays through e2e/frames.spec.ts and e2e/frames.run.ts.

describe("the bench's parameters (§1.53, M4-Q4)", () => {
  it('takes none but its own: a whole match at the default quality, no busy wait, capacity, repair or model', () => {
    expect(parseFrameParams('#test=frames')).toEqual({
      seconds: null, quality: config.renderQualityDefault, frameMs: 0, capacity: null, repair: false, holdAt: 15, hold: 4100, model: null,
    });
  });

  it('reads each, the forced repair with its hold, and a model by a relative path on its origin', () => {
    expect(parseFrameParams('#test=frames&seconds=5&quality=low&frameMs=67&capacity=300')).toMatchObject({
      seconds: 5, quality: 'low', frameMs: 67, capacity: 300, repair: false,
    });
    expect(parseFrameParams('test=frames&repair=1&holdAt=1&hold=2000&seconds=20')).toMatchObject({ repair: true, holdAt: 1, hold: 2000, seconds: 20 });
    expect(parseFrameParams('#test=frames&repair=1')).toMatchObject({ repair: true, holdAt: 15, hold: 4100 });
    for (const model of ['standin.glb', './standin.glb', 'dev/standin.glb', 'a_b-c/d.e.glb']) {
      expect(parseFrameParams(`#test=frames&model=${encodeURIComponent(model)}`), model).toMatchObject({ model });
    }
  });

  it('refuses a parameter it takes not, one given twice, another page, and any out of its range', () => {
    const refused = (hash: string): string => {
      const p = parseFrameParams(hash);
      if (!('error' in p)) throw new Error(`${hash} was taken: ${JSON.stringify(p)}`);
      return p.error;
    };
    expect(refused('#test=frames&players=8')).toMatch(/^players: this page takes no such parameter/);
    expect(refused('#test=frames&seconds=5&seconds=6')).toMatch(/^seconds: given more than once/);
    expect(refused('#test=net')).toMatch(/^test: this is the #test=frames page/);
    for (const [key, value] of [
      ['seconds', '0'], ['seconds', '3601'], ['seconds', '1.5'], ['seconds', '05'], ['seconds', ''], ['frameMs', '-1'], ['frameMs', '1001'],
      ['capacity', '0'], ['quality', 'medium'], ['quality', 'LOW'],
    ]) {
      expect(refused(`#test=frames&${key}=${value}`), `${key}=${value}`).toMatch(new RegExp(`^${key}: `));
    }
    expect(refused('#test=frames&repair=0')).toMatch(/^repair: 1/);
    expect(refused('#test=frames&repair=true')).toMatch(/^repair: 1/);
    expect(refused('#test=frames&holdAt=1')).toMatch(/^holdAt and hold: only with repair=1/);
    expect(refused('#test=frames&hold=100')).toMatch(/^holdAt and hold: only with repair=1/);
    expect(refused('#test=frames&repair=1&holdAt=601')).toMatch(/^holdAt: /);
    // From 1 s into play: the room makes its TICKs a little ahead of their send, and holds those sent from the start.
    expect(refused('#test=frames&repair=1&holdAt=0')).toMatch(/^holdAt: a whole number from 1 to 600/);
    expect(refused('#test=frames&repair=1&hold=0')).toMatch(/^hold: /);
  });

  it('refuses a model anywhere but a relative path on its origin: no scheme, no //, no .., nothing root-absolute', () => {
    for (const model of [
      'https://example.invalid/standin.glb', 'http:standin.glb', 'data:model/gltf-binary;base64,AAAA', 'javascript:alert(1)', 'blob:standin',
      '//example.invalid/standin.glb', '/standin.glb', '../standin.glb', 'dev/../standin.glb', 'a..b.glb', '.', './', '', 'dev//standin.glb',
      '.hidden.glb', 'dev\\standin.glb', '%2e%2e/standin.glb', 'standin.glb?x=1', 'standin.glb#x', ' standin.glb', 'a'.repeat(201),
    ]) {
      const p = parseFrameParams(`#test=frames&model=${encodeURIComponent(model)}`);
      expect('error' in p && p.error, model).toMatch(/^model: a relative path on this page's origin/);
    }
  });
});
