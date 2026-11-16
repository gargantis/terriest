// The stand-in .glb, checked against the glTF 2.0 binary layout and the
// model drawer's convention (PLAN D-27), without a browser.
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { STANDIN_BONES, STANDIN_PHASES, crc32, makeStandin, readGlb } from './make-standin.mjs';

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function read(json, bin, index) {
  const a = json.accessors[index];
  const v = json.bufferViews[a.bufferView];
  const n = a.count * TYPE_SIZE[a.type];
  const at = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const C = { 5121: Uint8Array, 5123: Uint16Array, 5126: Float32Array }[a.componentType];
  return new C(bin.buffer.slice(bin.byteOffset + at, bin.byteOffset + at + n * COMPONENT_BYTES[a.componentType]));
}

describe('the stand-in skinned terrier (scripts/make-standin.mjs)', () => {
  const glb = makeStandin();
  const { json, bin } = readGlb(glb);

  it('is a glTF 2.0 binary whose chunks, views and accessors fit, aligned', () => {
    expect(json.asset.version).toBe('2.0');
    expect(json.buffers).toEqual([{ byteLength: bin.length }]);
    for (const v of json.bufferViews) {
      expect((v.byteOffset ?? 0) % 4).toBe(0);
      expect((v.byteOffset ?? 0) + v.byteLength).toBeLessThanOrEqual(bin.length);
    }
    for (const a of json.accessors) {
      const v = json.bufferViews[a.bufferView];
      expect(a.count * TYPE_SIZE[a.type] * COMPONENT_BYTES[a.componentType]).toBeLessThanOrEqual(v.byteLength);
    }
  });

  it('has one skinned mesh with a fur and a bandana primitive, rigidly weighted to a few bones', () => {
    expect(STANDIN_BONES.length).toBe(8);
    const [skin] = json.skins;
    expect(skin.joints.map((j) => json.nodes[j].name)).toEqual([...STANDIN_BONES]);
    expect(read(json, bin, skin.inverseBindMatrices).length).toBe(16 * STANDIN_BONES.length);
    const [mesh] = json.meshes;
    expect(mesh.primitives.map((p) => json.materials[p.material].name)).toEqual(['fur', 'bandana']);
    for (const p of mesh.primitives) {
      const pos = json.accessors[p.attributes.POSITION];
      expect(pos.min).toHaveLength(3);
      expect(pos.max).toHaveLength(3);
      expect(pos.count).toBeLessThan(65536);
      const joints = read(json, bin, p.attributes.JOINTS_0);
      const weights = read(json, bin, p.attributes.WEIGHTS_0);
      for (let i = 0; i < joints.length; i++) expect(joints[i]).toBeLessThan(STANDIN_BONES.length);
      for (let i = 0; i < weights.length; i += 4) expect(weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3]).toBe(1);
      const indices = read(json, bin, p.indices);
      expect(Math.max(...indices)).toBeLessThan(pos.count);
    }
  });

  it("fits the 0.6 x 0.5 x 0.5 m box, feet on the floor (glTF's +y up, +z forward)", () => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const p of json.meshes[0].primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (let c = 0; c < 3; c++) {
        lo[c] = Math.min(lo[c], a.min[c]);
        hi[c] = Math.max(hi[c], a.max[c]);
      }
    }
    expect(hi[0]).toBeLessThanOrEqual(0.25);
    expect(lo[0]).toBeGreaterThanOrEqual(-0.25);
    expect(lo[1]).toBeGreaterThanOrEqual(-0.003);
    expect(hi[1]).toBeLessThanOrEqual(0.5);
    expect(hi[2]).toBeLessThanOrEqual(0.305);
    expect(lo[2]).toBeGreaterThanOrEqual(-0.3);
  });

  it("stays inside §12's starting guesses for a model: 8,000 triangles, 32 bones, a 512 x 512 texture", () => {
    const triangles = json.meshes[0].primitives.reduce((n, p) => n + json.accessors[p.indices].count / 3, 0);
    expect(triangles).toBeLessThanOrEqual(8000);
    expect(json.skins[0].joints.length).toBeLessThanOrEqual(32);
  });

  it('embeds one PNG texture, used by the fur, with valid chunks', () => {
    expect(json.images).toHaveLength(1);
    const [image] = json.images;
    expect(image.mimeType).toBe('image/png');
    expect(image.uri).toBeUndefined();
    expect(json.materials.find((m) => m.name === 'fur').pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 });
    const v = json.bufferViews[image.bufferView];
    const png = bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let at = 8;
    const types = [];
    let idat = Buffer.alloc(0);
    while (at < png.length) {
      const len = png.readUInt32BE(at);
      const type = png.subarray(at + 4, at + 8).toString('latin1');
      expect(png.readUInt32BE(at + 8 + len)).toBe(crc32(png.subarray(at + 4, at + 8 + len)));
      if (type === 'IDAT') idat = Buffer.concat([idat, png.subarray(at + 8, at + 8 + len)]);
      types.push(type);
      at += 12 + len;
    }
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    expect([w, h]).toEqual([256, 256]);
    expect(inflateSync(idat).length).toBe((w * 3 + 1) * h);
  });

  it('has one clip per animation phase, each moving bones only', () => {
    expect(json.animations.map((a) => a.name)).toEqual([...STANDIN_PHASES]);
    const bones = new Set(json.skins[0].joints);
    for (const a of json.animations) {
      expect(a.channels.length).toBeGreaterThan(0);
      for (const c of a.channels) {
        expect(bones.has(c.target.node)).toBe(true);
        expect(['rotation', 'translation']).toContain(c.target.path);
        const s = a.samplers[c.sampler];
        const input = json.accessors[s.input];
        expect(input.min[0]).toBe(0);
        expect(input.max[0]).toBeGreaterThan(0);
      }
    }
  });

  it('computes CRC-32 as PNG specifies', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('is the same bytes every time', () => {
    expect(Buffer.compare(makeStandin(), glb)).toBe(0);
  });
});
