import { expect, test } from '@playwright/test';

// The toolchain's end-to-end check: the built page loads in each engine,
// with three bundled, WebGL 2 available and no errors.
test('the built page loads, with three and WebGL 2', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('./');
  await expect(page.locator('#app')).toContainText('three r187');
  await expect(page.locator('html'), 'a WebGL 2 context; Firefox needs DISPLAY or WAYLAND_DISPLAY').toHaveAttribute('data-webgl2', 'yes');
  expect(errors).toEqual([]);
});
