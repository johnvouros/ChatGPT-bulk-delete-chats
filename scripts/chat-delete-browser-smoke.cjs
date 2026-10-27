// Isolated browser smoke test for concurrent chat deletion.
// Run with:
// PLAYWRIGHT_MODULE=/path/to/playwright node scripts/chat-delete-browser-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).content_scripts[0].js;
const ids = ['a', 'b', 'c', 'd'];
const chat = id => ({ id, title: `Chat ${id}`, update_time: '2026-10-26T00:00:00.000Z' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const engine = process.env.PLAYWRIGHT_BROWSER === 'firefox' ? firefox : chromium;
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const patchStarts = [];
    let mode = 'success';
    let active = 0;
    let peakActive = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.isNavigationRequest()) {
        return route.fulfill({ contentType: 'text/html', body: `<html><body><nav>${ids.map(id => `<a href="/c/${id}">Chat ${id}</a>`).join('')}</nav><main>Mock ChatGPT</main></body></html>` });
      }
      if (url.pathname === '/api/auth/session') return route.fulfill({ json: { accessToken: 'mock-token', user: { id: 'account-a' } } });
      if (url.pathname === '/backend-api/conversations') return route.fulfill({ json: { items: ids.map(chat) } });
      if (url.pathname.startsWith('/backend-api/files/library/')) return route.fulfill({ json: { items: [], cursor: null } });
      if (request.method() === 'PATCH' && url.pathname.startsWith('/backend-api/conversation/')) {
        const id = url.pathname.split('/').pop();
        patchStarts.push({ id, at: Date.now() });
        active += 1;
        peakActive = Math.max(peakActive, active);
        // Keep requests live long enough to make overlap observable.
        await sleep(1500);
        active -= 1;
        if (mode === 'rate-limit' && id === 'a') return route.fulfill({ status: 429, headers: { 'retry-after': '60' }, json: {} });
        return route.fulfill({ status: 200, json: { success: true } });
      }
      return route.fulfill({ status: 404, body: '' });
    });

    async function install() {
      await page.evaluate(() => {
        const stored = {};
        window.chrome = {
          runtime: { getManifest: () => ({ version: '1.3.0' }), getURL: file => `https://chatgpt.com/${file}`, onMessage: { addListener() {} } },
          storage: { local: { get: async () => ({ ...stored }), set: async update => Object.assign(stored, update), remove: async key => { delete stored[key]; } }, onChanged: { addListener() {} } }
        };
      });
      await page.addStyleTag({ path: path.join(root, 'styles.css') });
      for (const script of scripts) await page.addScriptTag({ path: path.join(root, script) });
      await page.waitForSelector('[data-action="sync-all"]');
    }
    await page.goto('https://chatgpt.com/c/mock');
    await install();

    const sync = page.locator('[data-action="sync-all"]');
    const selectAll = page.locator('[data-action="select-all"]');
    const del = page.locator('[data-action="delete"]');
    const modal = page.locator('#gptbd-modal');
    const waitForIdle = () => page.waitForFunction(() => !document.querySelector('[data-action="sync-all"]').disabled);
    async function syncAndSelect() {
      await sync.click();
      await waitForIdle();
      await selectAll.click();
      await page.waitForFunction(() => document.querySelector('[data-role="count"]').textContent.includes('4 selected'));
    }
    async function confirmDelete() {
      await del.click();
      await page.waitForFunction(() => document.querySelector('#gptbd-modal').dataset.visible === 'true');
      assert.equal(patchStarts.length, 0, 'the mandatory confirmation must occur before any delete request');
      await modal.locator('[data-role="modal-warning-check"]').check();
      await modal.locator('[data-action="modal-confirm"]').click();
    }

    await syncAndSelect();
    await confirmDelete();
    await page.waitForFunction(() => document.querySelector('.gptbd-toast').textContent.includes('Deleted 4 conversations'));
    assert.equal(patchStarts.length, 4);
    assert.equal(peakActive, 2, 'successful API deletes must use at most two simultaneous requests');
    assert.ok(patchStarts[1].at - patchStarts[0].at >= 1100, 'starts must retain the global pacing interval');
    assert.match(await page.locator('[data-role="count"]').innerText(), /0 selected/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('gptbd-conversation-cache-v1')).conversations.length), 0);

    // Reload the mocked page to restore four chats, then prove a 429 stops dispatch.
    mode = 'rate-limit';
    patchStarts.length = 0;
    active = 0;
    peakActive = 0;
    await page.reload();
    await page.evaluate(() => localStorage.removeItem('gptbd-conversation-cache-v1'));
    await install();
    await syncAndSelect();
    await confirmDelete();
    await page.waitForFunction(() => /rate|wait|limit/i.test(document.querySelector('.gptbd-toast').textContent));
    assert.equal(patchStarts.length, 2, '429 must stop queued requests; only the already-in-flight companion may finish');
    assert.equal(peakActive, 2);
    assert.match(await page.locator('[data-role="count"]').innerText(), /3 selected/);
    assert.deepEqual(errors, []);
    console.log('Chat delete smoke passed: mandatory confirmation, paced concurrency of two, cache/selection cleanup, and 429 dispatch stop.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
