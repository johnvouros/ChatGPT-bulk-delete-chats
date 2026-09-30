// Optional browser smoke test: npm install --no-save playwright && npx playwright install chromium
// Run: node scripts/library-browser-smoke.cjs
// Every request is intercepted; this never accesses a real ChatGPT account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const deletes = [];
    const externalRequests = [];
    let mode = 'success';
    let accountKey = 'account-a';
    let delayLibrary = false;
    let releaseLibrary;
    let notifyLibraryStarted;
    const libraryStarted = new Promise(resolve => { notifyLibraryStarted = resolve; });
    let files = [
      { library_file_id: 'lib-a', file_id: 'file-a', file_name: 'Report.pdf' },
      { library_file_id: 'lib-b', file_id: 'file-b', file_name: 'Budget.csv' },
      ...Array.from({ length: 54 }, (_, index) => `extra-${index}`).map(id => ({ library_file_id: `lib-${id}`, file_id: `file-${id}`, file_name: `Photo ${id}.png` }))
    ];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname !== "chatgpt.com") { externalRequests.push(url.href); return route.fulfill({ status: 403, body: "Unexpected external request" }); }
      if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<html><body><nav><a href="/c/chat-a">Example chat</a></nav><main>Mock ChatGPT</main></body></html>' });
      if (url.pathname === '/api/auth/session') return route.fulfill({ json: { accessToken: 'mock-token', user: { id: accountKey } } });
      if (url.pathname === '/backend-api/conversations') return route.fulfill({ json: { items: [] } });
      if (url.pathname === '/backend-api/files/library/nodes') {
        const nodes = accountKey === 'account-c' ? [] : [...files];
        if (delayLibrary) {
          notifyLibraryStarted();
          await new Promise(resolve => { releaseLibrary = resolve; });
          delayLibrary = false;
        }
        return route.fulfill({ json: { items: [{ kind: 'directory', id: 'mount-a', name: 'External folder' }, ...nodes.map(file => ({ kind: 'file', id: file.library_file_id, file_id: file.file_id, name: file.file_name, thumbnail_url: file.file_id === 'file-extra-1' ? 'https://untrusted.example/preview.png' : `/backend-api/estuary/content?id=${file.file_id}`, mime_type: 'image/png' }))], cursor: null } });
      }
      if (url.pathname.startsWith('/backend-api/files/library/files/') && request.method() === 'DELETE') {
        deletes.push({ url: url.href, method: request.method() });
        if (mode === 'rate-limit') return route.fulfill({ status: 429, headers: { 'retry-after': '120' }, json: {} });
        files = files.filter(file => !url.pathname.endsWith(`/${file.library_file_id}`));
        return route.fulfill({ json: { success: true } });
      }
      if (url.pathname === '/backend-api/estuary/content' && url.searchParams.get('id') === 'file-extra-0') return route.fulfill({ status: 302, headers: { location: 'https://untrusted.example/redirect.png' } });
      if (url.pathname === '/backend-api/estuary/content') return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=', 'base64') });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('https://chatgpt.com/');
    await page.evaluate(() => {
      const values = { 'gptbd-skip-delete-warning': true };
      window.testPreviewFetches = [];
      window.testCreatedBlobs = [];
      window.testRevokedBlobs = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options) => {
        if (String(url).includes('/estuary/content')) window.testPreviewFetches.push({ cache: options?.cache, credentials: options?.credentials });
        return originalFetch(url, options);
      };
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); window.testCreatedBlobs.push(url); return url; };
      URL.revokeObjectURL = url => { window.testRevokedBlobs.push(url); revoke(url); };
      localStorage.setItem('gptbd-library-cache-v1:old-account', JSON.stringify({ files: [{ id: 'private-old-file' }] }));
      window.chrome = {
        runtime: {
          getManifest: () => ({ version: '1.1.1' }), getURL: file => `https://chatgpt.com/${file}`,
          onMessage: { addListener: listener => { window.testMessageListener = listener; } }
        },
        storage: {
          local: {
            get: async () => ({ ...values }), set: async update => Object.assign(values, update),
            remove: async key => { delete values[key]; }
          },
          onChanged: { addListener: () => {} }
        }
      };
      localStorage.setItem('gptbd-conversation-cache-v1', JSON.stringify({ conversations: [{ id: 'chat-a', title: 'Example chat' }], loadedAt: 123 }));
    });
    await page.addStyleTag({ path: path.join(root, 'styles.css') });
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    for (const script of manifest.content_scripts[0].js) await page.addScriptTag({ path: path.join(root, script) });
    await page.locator('[data-action="set-mode"][data-mode="library"]').click();
    await page.waitForFunction(() => document.querySelector('[data-role="library-count"]').textContent.includes('56'));
    await page.waitForFunction(() => window.testCreatedBlobs.length > 0);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('gptbd-library-cache'))), false, 'Library metadata must never persist');
    assert.equal(await page.evaluate(() => window.testPreviewFetches.every(request => request.cache === 'no-store')), true);
    const columns = await page.locator('[data-role="library-grid"]').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(columns, 5, 'desktop grid must show five tiles per row');
    assert.equal(await page.locator('input[data-library-id]').count(), 50, 'large libraries should render a limited tile page');
    const beforeResync = await page.evaluate(() => window.testCreatedBlobs.length);
    await page.locator('[data-action="library-sync"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-action="library-sync"]').disabled);
    await page.waitForFunction(previous => window.testCreatedBlobs.length > previous, beforeResync);
    assert.equal(await page.locator('[data-role="library-grid"] img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 0)), true, 'resync must reload previews for unchanged IDs');
    await page.locator('[data-role="library-search"]').fill('Report');
    await page.locator('[data-action="library-select-all"]').click();
    await page.locator('[data-action="library-delete"]').click();
    const modal = page.locator('#gptbd-modal');
    await page.waitForFunction(() => document.querySelector('#gptbd-modal').dataset.visible === 'true');
    assert.match(await modal.innerText(), /Library|library/);
    assert.match(await modal.innerText(), /Report.pdf/);
    assert.equal(deletes.length, 0, 'deletion must wait for mandatory confirmation');
    await modal.locator('[data-role="modal-warning-check"]').check();
    await modal.locator('[data-action="modal-confirm"]').click();
    await page.waitForFunction(() => document.querySelector('[data-role="library-selection-count"]').textContent.includes('0 selected'));
    assert.equal(deletes.length, 1);
    assert.equal(deletes[0].method, 'DELETE');
    assert.equal(new URL(deletes[0].url).searchParams.get('file_id'), 'file-a');
    assert.match(await page.evaluate(() => localStorage.getItem('gptbd-conversation-cache-v1')), /chat-a/);
    await page.locator('[data-role="library-search"]').fill('');
    await page.locator('[data-action="library-select-all"]').click();
    mode = 'rate-limit';
    await page.locator('[data-action="library-delete"]').click();
    await page.waitForFunction(() => document.querySelector('#gptbd-modal').dataset.visible === 'true');
    await modal.locator('[data-role="modal-warning-check"]').check();
    await modal.locator('[data-action="modal-confirm"]').click();
    await page.waitForFunction(() => document.querySelector('[data-role="library-status"]').textContent.match(/rate|wait|limit/i));
    assert.match(await page.locator('[data-role="library-selection-count"]').innerText(), /55 selected/);
    assert.equal(await page.locator('[data-action="library-delete"]').isDisabled(), true);
    delayLibrary = true;
    accountKey = 'account-b';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('[data-role="library-count"]').textContent === '0 files');
    assert.equal(await page.locator('input[data-library-id]').count(), 0, 'account switch must hide prior account files');
    await libraryStarted;
    accountKey = 'account-c';
    releaseLibrary();
    await page.waitForFunction(() => !document.querySelector('[data-action="library-sync"]').disabled);
    assert.equal(await page.locator('input[data-library-id]').count(), 0, 'sync must discard results when account changes mid-request');
    assert.equal(await page.evaluate(() => localStorage.getItem('gptbd-library-cache-v1:account-b')), null);
    assert.equal(await page.evaluate(() => window.testCreatedBlobs.every(url => window.testRevokedBlobs.includes(url))), true, 'account switch must revoke every preview blob');
    assert.deepEqual(externalRequests, [], "preview allowlist and redirect blocking must prevent all external requests");
    assert.deepEqual(errors, []);
    console.log('Browser smoke passed: five-column grid, no-store previews, blob cleanup, session-only metadata, sync, filter, selection, mandatory confirmation, delete, chat-cache isolation, rate-limit retention, account switching, and stale sync rejection.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
