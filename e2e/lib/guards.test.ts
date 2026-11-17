import { describe, expect, it } from 'vitest';
import { isConsoleError, outsideRequests, type PageWatch } from './guards';

// The guard's rules (PLAN §16, Everywhere), on what the engines log and
// request. The console texts are the engines' own, logged for WebGL calls
// made to fail on the started page, except ANGLE's, whose form is its own.

describe("the e2e guard's console rule", () => {
  it('counts WebGL errors in every engine, whichever level each logs them at', () => {
    // Chromium logs them as warnings.
    expect(isConsoleError('warning', 'WebGL: INVALID_ENUM: enable: invalid capability')).toBe(true);
    expect(isConsoleError('warning', 'WebGL: INVALID_OPERATION: drawArrays: no valid shader program in use')).toBe(true);
    expect(isConsoleError('warning', '[.WebGL-0x2a6c007ec000]GL_INVALID_OPERATION: Error: 0x00000502')).toBe(true);
    // So does Firefox, wrapped.
    expect(isConsoleError('warning', '[JavaScript Warning: "WebGL warning: enable/disable: Bad `cap`: 0x1234"]')).toBe(true);
    // WebKit logs them as errors.
    expect(isConsoleError('error', 'WebGL: INVALID_VALUE: texImage2D: level < 0')).toBe(true);
  });

  it("leaves out warnings that aren't errors: notes, notices and deprecations", () => {
    const stall = '[.WebGL-0x2a6c007ec000]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels';
    expect(isConsoleError('warning', stall)).toBe(false);
    expect(isConsoleError('warning', 'THREE.WebGLRenderer: KHR_parallel_shader_compile extension not supported.')).toBe(false);
    // Firefox's, for e2e/pitch.spec.ts's renderer line.
    const deprecated = '[JavaScript Warning: "WEBGL_debug_renderer_info is deprecated in Firefox and will be removed. Please use RENDERER."]';
    expect(isConsoleError('warning', deprecated)).toBe(false);
    expect(isConsoleError('info', 'WebGL: INVALID_ENUM: enable: invalid capability')).toBe(false);
  });
});

describe("the e2e guard's request rule", () => {
  const watch = (allowed: string[], requests: string[]): PageWatch => ({ errors: [], requests, allowed, allowedErrors: [] });

  it('keeps a page served from a subpath under it (L232)', () => {
    const w = watch(['http://127.0.0.1:4339/a/b/'], ['http://127.0.0.1:4339/a/b/assets/x.js', 'http://127.0.0.1:4339/favicon.ico']);
    expect(outsideRequests(w)).toEqual(['http://127.0.0.1:4339/favicon.ico']);
  });

  it("allows a blob: URL of an allowed server's origin, though it names no path, and a data: URL", () => {
    // WebKit requests the blob a page under /a/b/ makes as this.
    const blob = 'blob:http://127.0.0.1:4339/1549e7ea-6089-404b-85fe-98533700354e';
    expect(outsideRequests(watch(['http://127.0.0.1:4339/a/b/'], [blob, 'data:,']))).toEqual([]);
  });

  it('counts a blob: URL of another origin, or of an opaque one, as outside', () => {
    const other = 'blob:http://127.0.0.1:4340/1549e7ea-6089-404b-85fe-98533700354e';
    const opaque = 'blob:null/1549e7ea-6089-404b-85fe-98533700354e';
    expect(outsideRequests(watch(['http://127.0.0.1:4339/a/b/', 'file:///dist/'], [other, opaque]))).toEqual([other, opaque]);
  });
});
