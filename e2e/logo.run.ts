// Draws the logo and icons the owner picked on 2026-11-22 (PLAN's status)
// from the game's own terrier and writes their files, outside the gate, as
// a new look (Q-11) asks:
//
//   GALLIUM_DRIVER=d3d12 TERRIEST_LOGO_OUT="$(mktemp -d)" npx playwright test -c playwright.logo.config.ts
//
// dev/logo.html, built by Vite into a folder of its own and answered by
// interception at an address that never resolves, draws the picks
// (dev/logo/picks.ts); this run writes dev/logo/files.ts' files under the
// folder TERRIEST_LOGO_OUT names, at the paths the repo holds them:
// public/favicon.ico, favicon.svg, apple-touch-icon.png and og.png, the
// link-preview card, and docs/brand/logo.png, lockup-light.png and
// lockup-dark.png. Without the variable it refuses at once, and it refuses
// to write over a file in the repo, as the repo's root as the folder would,
// however the folder reaches it, by a symbolic link too, unless
// TERRIEST_LOGO_OVERWRITE=1. On C-6's GPU path while GALLIUM_DRIVER is set
// (e2e/lib/gl.ts), as the committed files were drawn: another GPU, or
// software, draws a little differently, so the run logs what drew. The page
// is watched as the gate watches one: no console error, and no request
// outside its own address. Named .run.ts, so the gate's
// playwright.config.ts, which matches *.spec.ts, never runs it.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { LOGO_FILES, logoFiles, type RgbaImage } from '../dev/logo/files';
import type { LogoRender } from '../dev/logo/main';
import { GL_PATH } from './lib/gl';
import { expect, expectEverywhere, expectWebGL2, test } from './lib/guards';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.TERRIEST_LOGO_OUT;
const OVERWRITE = process.env.TERRIEST_LOGO_OVERWRITE === '1';
/** The page's address: .invalid never resolves, so only the interception answers it. */
const ORIGIN = 'http://logo.invalid/';
const TYPES: Readonly<Record<string, string>> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/** Whether `file` is inside the folder `dir`. */
function inside(dir: string, file: string): boolean {
  const r = relative(dir, file);
  return r !== '' && !r.startsWith('..') && !isAbsolute(r);
}

/**
 * The folder's files, refused at once without the variable, or where one would write over a file in the repo. Each
 * file that exists is placed by its real path, and the repo by its own, so a folder that reaches the repo by a
 * symbolic link, as a shell's logical $PWD can, is refused as the repo's root is; a file that doesn't exist yet
 * writes over nothing.
 */
function targets(): string[] {
  if (OUT === undefined || OUT === '') {
    throw new Error("Refusing to run without TERRIEST_LOGO_OUT: set it to the folder the files go to, or to the repo's root with TERRIEST_LOGO_OVERWRITE=1 to replace the committed ones");
  }
  const files = LOGO_FILES.map((path) => resolve(OUT, path));
  const root = realpathSync(ROOT);
  const committed = files.filter((file) => existsSync(file)).map((file) => realpathSync(file)).filter((file) => inside(root, file));
  if (committed.length > 0 && !OVERWRITE) {
    throw new Error(`Refusing to write over ${committed.map((f) => relative(root, f)).join(', ')} without TERRIEST_LOGO_OVERWRITE=1`);
  }
  return files;
}

test("draws the owner's logo and icons, and the link-preview card, from the game's terrier", async ({ page, guard }) => {
  const files = targets();
  const dist = mkdtempSync(join(tmpdir(), 'terriest-logo-'));
  try {
    await build({
      configFile: false, root: ROOT, base: './', logLevel: 'warn', publicDir: false,
      build: { outDir: dist, emptyOutDir: true, target: 'es2022', minify: false, sourcemap: false, reportCompressedSize: false, rolldownOptions: { input: join(ROOT, 'dev/logo.html') } },
    });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const file = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
      if (url.origin !== new URL(ORIGIN).origin || !inside(dist, file) || !existsSync(file)) {
        await route.abort();
        return;
      }
      await route.fulfill({ status: 200, body: readFileSync(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream' });
    });
    guard.allowed = [ORIGIN];
    await expectWebGL2(page);
    await page.goto(`${ORIGIN}dev/logo.html`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'yes', { timeout: 60_000 });
    const drawn: LogoRender = await page.evaluate(() => window.logo!.render());
    console.log(`drawn in ${(drawn.totalMs / 1000).toFixed(1)} s, the shots ${drawn.shotsMs.join(', ')} ms, on ${GL_PATH}: ${JSON.stringify(drawn.gl)}`);
    const images: Record<string, RgbaImage> = {};
    for (const [name, im] of Object.entries(drawn.images)) images[name] = { w: im.w, h: im.h, rgba: Buffer.from(im.b64, 'base64') };
    // The guard's checks before any file is written, so a page that logged an error replaces nothing.
    expectEverywhere(guard);
    for (const [path, bytes] of logoFiles(images)) {
      const file = files[LOGO_FILES.indexOf(path)]!;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      console.log(`wrote ${file}, ${bytes.length} bytes`);
    }
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
