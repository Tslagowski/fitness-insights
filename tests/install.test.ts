// @vitest-environment node
import { expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// Ticket 30: the site can be added to the iPhone home screen and opens full screen.
const pngSize = (path: string) => { const bytes = readFileSync(path); return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]; };

test('the manifest, icons, and iOS tags make the app installable without caching private data', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  expect(manifest).toMatchObject({ name: 'Fitness Insights', display: 'standalone', start_url: './', scope: './', theme_color: '#172b29' });
  for (const icon of manifest.icons) {
    const [width, height] = pngSize(`public/${icon.src}`);
    expect(`${width}x${height}`).toBe(icon.sizes);
  }
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(true);
  expect(pngSize('public/icons/apple-touch-icon.png')).toEqual([180, 180]);
  const html = readFileSync('index.html', 'utf8');
  expect(html).toContain('viewport-fit=cover');
  expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
  expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
  expect(html).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
  // No service worker: data is always fetched live from Supabase, never cached offline.
  expect(existsSync('public/sw.js') || existsSync('public/service-worker.js')).toBe(false);
  expect(readFileSync('src/main.ts', 'utf8')).not.toContain('serviceWorker');
});

test('the bottom navigation draws its icons inline with no icon font or external source', () => {
  const app = readFileSync('src/App.vue', 'utf8');
  expect(app).toContain('class="nav-icon"');
  for (const page of ['overview', 'nutrition', 'training', 'insights', 'settings']) expect(app).toMatch(new RegExp(`\\n  ${page}: 'M`));
  expect(readFileSync('index.html', 'utf8')).not.toMatch(/fonts\.googleapis|font-awesome|material-icons/i);
});
