// Types for scripts/make-standin.mjs, for the TypeScript specs that serve it.
export declare const STANDIN_PHASES: readonly string[];
export declare const STANDIN_BONES: readonly string[];
export declare function crc32(bytes: Uint8Array): number;
export declare function encodePng(w: number, h: number, rgb: Uint8Array): Buffer;
/** The stand-in's .glb bytes; `detail` scales its segment counts (1: about 2,500 triangles). */
export declare function makeStandin(options?: { detail?: number }): Buffer;
/** A .glb's JSON chunk and binary chunk. */
export declare function readGlb(bytes: Uint8Array): { json: GltfJson; bin: Buffer };
export interface GltfJson {
  asset: { version: string };
  nodes: { name?: string; mesh?: number; skin?: number; children?: number[]; translation?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
  skins: { joints: number[]; inverseBindMatrices?: number; skeleton?: number }[];
  materials: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
  textures: { source?: number; sampler?: number }[];
  images: { bufferView?: number; mimeType?: string; uri?: string }[];
  accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; target?: number }[];
  buffers: { byteLength: number; uri?: string }[];
  animations: { name?: string; channels: { sampler: number; target: { node?: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[];
}
