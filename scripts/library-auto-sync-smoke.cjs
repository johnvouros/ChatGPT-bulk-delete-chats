// All browser requests are mocked. Requires Playwright; see README.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).content_scripts[0].js;
const file = id => ({ kind: 'file', id: `lib-${id}`, file_id: `file-${id}`, name: `${id}.png` });

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    let calls = 0;
    let phase = 'initial';
    let releaseSecond;
    let stored = {};
    let account = 'account-a';
    let holdSession = false;
    let releaseSession;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<html><body><main>Mock Library</main></body></html>' });
      if (url.pathname === '/api/auth/session') {
        if (holdSession) {
          holdSession = false;
          await new Promise(resolve => { releaseSession = resolve; });
        }
        return route.fulfill({ json: { accessToken: 'token', user: { id: account } } });
      }
      if (url.pathname === '/backend-api/conversations') return route.fulfill({ json: { items: [] } });
      if (url.pathname === '/backend-api/files/library/nodes') {
        calls += 1;
        if (!url.searchParams.has('cursor')) return route.fulfill({ json: { items: [file(phase === 'failed-resync' ? 'replacement' : 'a')], cursor: 'second' } });
        if (phase === 'initial') await new Promise(resolve => { releaseSecond = resolve; });
        if (phase === 'failed-resync' || phase === 'failed-initial') return route.fulfill({ status: 500, json: {} });
        return route.fulfill({ json: { items: [file('b')], cursor: null } });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    async function install() {
      await page.evaluate(values => {
        window.testStored = values;
        window.chrome = {
          runtime: { getManifest: () => ({ version: '1.1.1' }), getURL: x => `https://chatgpt.com/${x}`, onMessage: { addListener() {} } },
          storage: { local: {
            get: async () => ({ ...values }), set: async next => Object.assign(values, next), remove: async key => { delete values[key]; }
          }, onChanged: { addListener() {} } }
        };
      }, stored);
      await page.addStyleTag({ path: path.join(root, 'styles.css') });
      for (const script of scripts) await page.addScriptTag({ path: path.join(root, script) });
    }
    const sync = () => page.locator('[data-action="library-sync"]');
    const tiles = () => page.locator('input[data-library-id]');
    const idle = () => page.waitForFunction(() => !document.querySelector('[data-action="library-sync"]').disabled);
    const focus = () => page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); });
    await page.goto('https://chatgpt.com/library');
    await install();
    await page.waitForFunction(() => document.querySelectorAll('input[data-library-id]').length === 1);
    assert.equal(await sync().isDisabled(), true, 'first-page tiles must appear before sync completes');
    assert.equal(await tiles().first().isDisabled(), true);
    assert.equal(await page.locator('[data-action="library-select-all"]').isDisabled(), true);
    await focus();
    await page.waitForFunction(() => document.querySelector('[data-role="library-progress-label"]').textContent.includes('1'));
    // Wait for the mocked second request without depending on real timing.
    for (let attempt = 0; !releaseSecond && attempt < 1000; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(typeof releaseSecond, "function", "second page must be requested");
    assert.equal(calls, 2, 'focus must not start concurrent syncs');
    releaseSecond();
    phase = 'success';
    await idle();
    assert.equal(await tiles().count(), 2);
    assert.equal(await tiles().first().isDisabled(), false);
    await page.locator('[data-action="set-mode"][data-mode="chats"]').click();
    await page.locator('[data-action="set-mode"][data-mode="library"]').click();
    stored = await page.evaluate(() => window.testStored);
    assert.equal(stored['gptbd-toolbar-mode'], 'library');
    const firstCalls = calls;
    await page.goto('https://chatgpt.com/c/mock-chat');
    await install();
    await page.waitForFunction(() => document.querySelectorAll('input[data-library-id]').length === 2);
    await idle();
    assert.equal(calls - firstCalls, 2, 'refresh must restore Library mode and auto-sync once');
    const beforeSwitch = calls;
    account = 'account-b';
    await focus();
    for (let n = 0; calls < beforeSwitch + 2 && n < 1000; n++) await new Promise(resolve => setTimeout(resolve, 5));
    await idle();
    assert.equal(calls - beforeSwitch, 2, 'new account must auto-sync');
    account = 'account-a';
    await focus();
    for (let n = 0; calls < beforeSwitch + 4 && n < 1000; n++) await new Promise(resolve => setTimeout(resolve, 5));
    await idle();
    assert.equal(calls - beforeSwitch, 4, 'returning account must auto-sync its cleared session');
    assert.equal(await tiles().count(), 2);
await tiles().first().check();
    holdSession = true;
    await page.locator('[data-action="library-delete"]').click();
    for (let n = 0; !releaseSession && n < 1000; n++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(typeof releaseSession, 'function');
    const beforePendingSync = calls;
    // Dispatch directly to exercise the handler even if the UI disables the button.
    await sync().evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(calls, beforePendingSync, 'resync must not start during delete preparation');
    releaseSession();
    await page.waitForFunction(() => document.querySelector('#gptbd-modal').dataset.visible === 'true');
    await page.locator('#gptbd-modal [data-action="modal-cancel"]').last().click();
    phase = 'failed-resync';
    await sync().click();
    await idle();
    assert.deepEqual(await tiles().evaluateAll(nodes => nodes.map(n => n.dataset.libraryId)), ['lib-a', 'lib-b'], 'failed resync must restore previous complete list');
    assert.match(await page.locator('[data-role="library-status"]').innerText(), /500|failed/i);
    await page.locator('[data-action="library-clear-cache"]').click();
    await focus();
    assert.equal(await tiles().count(), 0, 'Clear session must remain cleared');
    assert.equal(await sync().isDisabled(), false);
    phase = 'failed-initial';
    await sync().click();
    await idle();
    assert.equal(await tiles().count(), 0, 'failed initial sync must remove partial results');
    const failedCalls = calls;
    await focus();
    await page.locator('[data-action="set-mode"][data-mode="chats"]').click();
    await page.locator('[data-action="set-mode"][data-mode="library"]').click();
    assert.equal(calls, failedCalls, 'failed sync must not auto-retry in a loop');
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('gptbd-library-cache'))), false);
    assert.deepEqual(errors, []);
    console.log('Auto-sync smoke passed: progressive tiles, safe selection, single sync, mode restoration, rollback, clear-session, no retry loops, no persistent Library data.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
