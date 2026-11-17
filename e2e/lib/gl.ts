// The GL path the gate's engines draw on (PLAN C-6). By default the gate
// passes no GL flags, and the headless engines draw WebGL 2 in software
// here and on CI: SwiftShader in Chromium, llvmpipe in Firefox and WebKit.
// GALLIUM_DRIVER opts in to the GPU path: on WSL2, GALLIUM_DRIVER=d3d12 is
// Mesa's Direct3D 12 driver, which draws on the host's GPU. Firefox and
// WebKit draw through Mesa, so the variable alone moves them. Chromium
// draws through Mesa only with ANGLE's GL flags, the ones the M0 spike used
// on this path (research/spike/scripts/verify/drawn-gl.mjs), so every
// Chromium the gate launches takes them while the variable is set. Nothing
// in a test depends on the path.

/** The GL path, as the frame-rate report names it. */
export const GL_PATH = process.env.GALLIUM_DRIVER ? `GALLIUM_DRIVER=${process.env.GALLIUM_DRIVER}` : 'GALLIUM_DRIVER unset';

/** Chromium's launch flags: ANGLE on Mesa's GL while GALLIUM_DRIVER is set, else none. */
export const CHROMIUM_GL_ARGS: readonly string[] = process.env.GALLIUM_DRIVER
  ? ['--use-gl=angle', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist']
  : [];
