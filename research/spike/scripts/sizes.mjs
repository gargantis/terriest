// What each way of drawing the terriers costs to download (PLAN §12, M0's
// question), from the production build in dist/: every shipped file's raw,
// gzip (level 9) and brotli (quality 11) size, and each path's total:
// - the code-built path: index.html and the entry chunk;
// - the model path: that, plus the model drawer's chunk (GLTFLoader and
//   SkeletonUtils) and the stand-in .glb, which never ships (D-27).
// A single module can't be split between chunks, so three's core lives in
// the entry chunk with whatever either path uses of it. Two measurement
// builds, written to results/tmp/, say how much: one with three's core in a
// chunk of its own, and one with the model drawer stubbed out.
//
//   npm run build && node scripts/sizes.mjs [--json out.json]
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { makeStandin } from './make-standin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function sizes(bytes) {
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } }).length,
  };
}

const sum = (xs) => xs.reduce((a, s) => ({ raw: a.raw + s.raw, gzip: a.gzip + s.gzip, brotli: a.brotli + s.brotli }), { raw: 0, gzip: 0, brotli: 0 });

/** Every shipped file under dir, with its sizes; dotfiles (the licence JSON) are skipped. */
async function files(dir) {
  const out = {};
  for (const f of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!f.isFile() || f.name.startsWith('.')) continue;
    const abs = join(f.parentPath, f.name);
    out[abs.slice(dir.length + 1).split('\\').join('/')] = sizes(await readFile(abs));
  }
  return out;
}

/** The entry chunk named by index.html, and the chunks it imports dynamically. */
async function chunksOf(dir) {
  const html = await readFile(join(dir, 'index.html'), 'utf8');
  const entry = /<script[^>]+src="\.\/([^"]+)"/.exec(html)?.[1];
  if (!entry) throw new Error('no entry script in index.html');
  const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\.\/([^"]+)"/g)].map((m) => m[1]);
  const js = await readFile(join(dir, entry), 'utf8');
  const dynamic = [...js.matchAll(/import\(`?["'`]?\.\/([^"'`)]+\.js)/g)].map((m) => `assets/${m[1]}`);
  return { entry, preloads, dynamic };
}

/** A measurement build of this page into results/tmp/<name>, with extra config. */
async function variant(name, extra) {
  const outDir = join(root, 'results', 'tmp', `sizes-${name}`);
  await rm(outDir, { recursive: true, force: true });
  await build({
    root,
    configFile: join(root, 'vite.config.ts'),
    logLevel: 'silent',
    ...extra,
    build: { outDir, emptyOutDir: true, copyPublicDir: false, license: false, ...(extra.build ?? {}) },
  });
  return { outDir, files: await files(outDir), chunks: await chunksOf(outDir) };
}

export async function measure() {
  const dist = join(root, 'dist');
  const shipped = await files(dist);
  const { entry, preloads, dynamic } = await chunksOf(dist);
  const model = dynamic.find((f) => f.includes('model-drawer'));
  if (!model) throw new Error('no model-drawer chunk in the entry');
  const pick = (names) => names.map((n) => {
    const s = shipped[n];
    if (!s) throw new Error(`${n} is not in dist/`);
    return s;
  });
  const glb = sizes(makeStandin());
  const codePath = sum(pick(['index.html', entry, ...preloads]));
  const modelChunk = sum(pick([model]));
  const modelPath = sum([codePath, modelChunk, glb]);

  // three's core in a chunk of its own: the line §12 reports apart.
  const split = await variant('three-split', {
    build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'three-core', test: /node_modules[\\/]three[\\/]build[\\/]/ }] } } } },
  });
  const threeCore = Object.entries(split.files).find(([n]) => n.includes('three-core'));

  // The model drawer stubbed out: what the code-built path alone needs of three.
  const stub = '\0spike-no-model-drawer';
  const noModel = await variant('no-model', {
    plugins: [{
      name: 'spike-no-model-drawer',
      enforce: 'pre',
      resolveId: (source) => (source === './model-drawer' ? stub : null),
      load: (id) => (id === stub ? 'export async function loadModelDrawer() { throw new Error("no model drawer in this build"); }' : null),
    }],
  });
  const noModelEntry = noModel.files[noModel.chunks.entry];

  return {
    files: { ...shipped, 'standin.glb (served by the tests, never shipped)': glb },
    entry, preloads, modelChunk: model,
    codeBuiltPath: codePath,
    modelPath,
    modelPathAdds: sum([modelChunk, glb]),
    threeCoreChunk: threeCore ? { file: threeCore[0], ...threeCore[1] } : null,
    entryWithoutThreeCore: split.files[split.chunks.entry] ?? null,
    entryWithoutModelDrawer: noModelEntry ?? null,
    modelShareOfEntry: noModelEntry ? { raw: shipped[entry].raw - noModelEntry.raw, gzip: shipped[entry].gzip - noModelEntry.gzip, brotli: shipped[entry].brotli - noModelEntry.brotli } : null,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await measure();
  const row = (name, s) => `${name.padEnd(58)} ${String(s.raw).padStart(9)} ${String(s.gzip).padStart(9)} ${String(s.brotli).padStart(9)}`;
  console.log(row('bytes', { raw: 'raw', gzip: 'gzip -9', brotli: 'brotli 11' }));
  for (const [n, s] of Object.entries(r.files)) console.log(row(n, s));
  console.log(row('code-built path (index.html + entry chunk)', r.codeBuiltPath));
  console.log(row('model path (+ model-drawer chunk + stand-in .glb)', r.modelPath));
  console.log(row('  of which the model path adds', r.modelPathAdds));
  if (r.threeCoreChunk) console.log(row(`three core alone (${r.threeCoreChunk.file}, split build)`, r.threeCoreChunk));
  if (r.entryWithoutThreeCore) console.log(row('entry chunk without three core (split build)', r.entryWithoutThreeCore));
  if (r.entryWithoutModelDrawer) console.log(row('entry chunk with the model drawer stubbed out', r.entryWithoutModelDrawer));
  if (r.modelShareOfEntry) console.log(row("  so the entry chunk carries, for the model path only", r.modelShareOfEntry));
  const at = process.argv.indexOf('--json');
  if (at > 0 && process.argv[at + 1]) {
    const out = resolve(process.argv[at + 1]);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(r, null, 2)}\n`);
  }
}
