// All browser requests are mocked. Run with:
// PLAYWRIGHT_MODULE=/path/to/playwright node scripts/project-filters-browser-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).content_scripts[0].js;
const projectId = 'g-p-0123456789abcdef0123456789abcdef';
const emptyProjectId = 'g-p-11111111111111111111111111111111';
const staleProjectId = 'g-p-22222222222222222222222222222222';
const now = Date.now();
const daysAgo = days => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

(async () => {
  const engine = process.env.PLAYWRIGHT_BROWSER === 'firefox' ? firefox : chromium;
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.isNavigationRequest()) {
        return route.fulfill({ contentType: 'text/html', body: `
          <html><body>
            <nav>
              <div data-sidebar-project-container-id="chats">
                <div role="list" aria-label="Recent chats">
                  <div role="listitem"><a href="/c/personal-recent">Personal recent</a></div>
                  <div role="listitem"><a href="/c/personal-old">Personal old</a></div>
                </div>
              </div>
              <div data-sidebar-project-container-id="project:${projectId}" data-sidebar-project-kind="local">
                <div role="button" data-app-action-sidebar-project-row
                     data-app-action-sidebar-project-id="${projectId}"
                     data-app-action-sidebar-project-label="Correct Project Name">
                  <a href="/g/${projectId}/project">Correct Project Name</a>
                  <div role="list" aria-label="Chats in Correct Project Name">
                    <div role="listitem"><a href="/g/${projectId}/c/project-old">First project chat title</a><button aria-label="Actions for First project chat title">Actions</button></div>
                    <div role="listitem"><a href="/g/${projectId}/c/project-dom-only">DOM-only project chat</a><button aria-label="Actions for DOM-only project chat">Actions</button></div>
                  </div>
                </div>
              </div>
              <div data-sidebar-project-container-id="project:${emptyProjectId}" data-sidebar-project-kind="local">
                <div role="button" data-app-action-sidebar-project-row
                     data-app-action-sidebar-project-id="${emptyProjectId}"
                     data-app-action-sidebar-project-label="Empty Project"></div>
              </div>
            </nav>
            <main>
              <h1 style="display:none">A stale home heading</h1>
              <article><h1>First project chat title</h1></article>
            </main>
          </body></html>` });
      }
      if (url.pathname === '/api/auth/session') {
        return route.fulfill({ json: { accessToken: 'token', user: { id: 'account-a' } } });
      }
      if (url.pathname === '/backend-api/conversations') {
        return route.fulfill({ json: { items: [
          { id: 'project-old', title: 'Project old', update_time: daysAgo(31), project_id: projectId, project_name: 'Wrong API name' },
          { id: 'project-recent', title: 'Project recent', update_time: daysAgo(2), project_id: projectId, project_name: 'Wrong API name' },
          { id: 'personal-old', title: 'Personal old', update_time: daysAgo(30) },
          { id: 'personal-recent', title: 'Personal recent', update_time: daysAgo(1) }
        ] } });
      }
      if (url.pathname === '/backend-api/files/library/nodes') return route.fulfill({ json: { items: [], cursor: null } });
      return route.fulfill({ status: 404, body: '' });
    });

    await page.goto('https://chatgpt.com/c/home');
    await page.evaluate(({ fixedNow, projectId, staleProjectId }) => {
      Date.now = () => fixedNow;
      const stored = {};
      window.chrome = {
        runtime: { getManifest: () => ({ version: '1.3.0' }), getURL: file => `https://chatgpt.com/${file}`, onMessage: { addListener() {} } },
        storage: { local: {
          get: async () => ({ ...stored }),
          set: async update => Object.assign(stored, update),
          remove: async key => { delete stored[key]; }
        }, onChanged: { addListener() {} } }
      };
      localStorage.setItem('gptbd-project-cache-v1', JSON.stringify({
        projects: [
          { key: `api:${projectId}`, name: 'Old API label', updatedAt: 1 },
          { key: `path:${projectId}`, name: 'Old path label', updatedAt: 2 },
          { key: 'name:what should we work on?', name: 'What should we work on?', updatedAt: 3 },
          { key: 'project:chats', name: 'Chats', updatedAt: 4 },
          { key: `api:${staleProjectId}`, name: 'Stale project', updatedAt: 5 }
        ],
        memberships: {
          [`api:${projectId}`]: { name: 'Old API label', ids: ['legacy-a'], updatedAt: 1 },
          [`path:${projectId}`]: { name: 'Old path label', ids: ['legacy-b'], updatedAt: 2 },
          'name:what should we work on?': { name: 'What should we work on?', ids: ['personal-recent'], updatedAt: 3 },
          'project:chats': { name: 'Chats', ids: ['personal-old'], updatedAt: 4 },
          [`api:${staleProjectId}`]: { name: 'Stale project', ids: ['stale-chat'], updatedAt: 5 }
        }
      }));
      localStorage.setItem('gptbd-conversation-cache-v1', JSON.stringify({
        conversations: [
          { id: 'project-old', title: 'Project old', updateTime: new Date(fixedNow - 31 * 86400000).toISOString() },
          { id: 'project-recent', title: 'Project recent', updateTime: new Date(fixedNow - 2 * 86400000).toISOString() },
          { id: 'personal-old', title: 'Personal old', updateTime: new Date(fixedNow - 30 * 86400000).toISOString() },
          { id: 'personal-recent', title: 'Personal recent', updateTime: new Date(fixedNow - 86400000).toISOString() }
        ],
        loadedAt: fixedNow
      }));
    }, { fixedNow: now, projectId, staleProjectId });
    await page.addStyleTag({ path: path.join(root, 'styles.css') });
    for (const script of scripts) await page.addScriptTag({ path: path.join(root, script) });
    await page.waitForFunction(() => document.getElementById('gpt-bulk-delete-root'));
    const migratedProjectCache = await page.evaluate(() => JSON.parse(localStorage.getItem('gptbd-project-cache-v1')));
    assert.equal(Object.keys(migratedProjectCache.memberships).includes(`project:${projectId}`), true,
      'legacy API and path project keys must merge into the canonical project key');
    assert.equal(Object.keys(migratedProjectCache.memberships).some(key => /what should|chats/.test(key)), false,
      'obsolete non-project and recents memberships must be purged');
    assert.equal(Object.keys(migratedProjectCache.memberships).includes(`project:${staleProjectId}`), true,
      'valid historical project membership must remain stored until the user clears their cache');

    await page.locator('[data-action="sync-all"]').click();
    await page.waitForFunction(() => document.querySelector('[data-role="cache-count"]')?.textContent === '4 cached');
    await page.locator('[data-action="toggle-results"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-role="chats-results"] .gptbd-result').length === 5);

    const projectSelect = page.locator('[data-action="select-project-filter"]');
    const projectOptions = await projectSelect.locator('option').allTextContents();
    assert.equal(projectOptions.includes('Correct Project Name'), true,
      'the project label must come from ChatGPT’s project row, not its first chat or stale API metadata');
    assert.equal(projectOptions.includes('Empty Project'), true,
      'a valid visible project with no loaded chats must remain available as a filter');
    assert.equal(projectOptions.some(label => /what should|^chats$|stale/i.test(label)), false,
      'stale and non-project cache entries must not appear as project filters');
    const projectValue = await projectSelect.locator('option').evaluateAll(options => {
      const option = options.find(item => item.textContent === 'Correct Project Name');
      return option?.value || '';
    });
    assert.ok(projectValue, 'the correct project must have a selectable filter option');
    await projectSelect.selectOption(projectValue);
    await page.waitForFunction(() => document.querySelectorAll('[data-role="chats-results"] .gptbd-result').length === 3);
    assert.deepEqual(await page.locator('[data-role="chats-results"] .gptbd-result-title').allTextContents(), ['Project recent', 'Project old', 'DOM-only project chat']);

    await projectSelect.selectOption('all');
    const relation = page.locator('[data-action="filter-project-relation"]');
    await relation.selectOption('project');
    await page.waitForFunction(() => document.querySelectorAll('[data-role="chats-results"] .gptbd-result').length === 3);
    assert.deepEqual(await page.locator('[data-role="chats-results"] .gptbd-result-title').allTextContents(), ['Project recent', 'Project old', 'DOM-only project chat']);

    await relation.selectOption('none');
    await page.waitForFunction(() => document.querySelectorAll('[data-role="chats-results"] .gptbd-result').length === 2);
    assert.deepEqual(await page.locator('[data-role="chats-results"] .gptbd-result-title').allTextContents(), ['Personal recent', 'Personal old']);

    await relation.selectOption('all');
    const older = page.locator('[data-action="filter-age"][data-age="older"]');
    await older.fill('15');
    await older.press('Tab');
    await page.waitForFunction(() => document.querySelectorAll('[data-role="chats-results"] .gptbd-result').length === 2);
    assert.deepEqual(await page.locator('[data-role="chats-results"] .gptbd-result-title').allTextContents(), ['Personal old', 'Project old']);

    await older.fill('');
    await older.press('Tab');
    const newer = page.locator('[data-action="filter-age"][data-age="newer"]');
    await newer.fill('3');
    await newer.press('Tab');
    await page.waitForFunction(() => document.querySelectorAll('[data-role="chats-results"] .gptbd-result').length === 2);
    assert.deepEqual(await page.locator('[data-role="chats-results"] .gptbd-result-title').allTextContents(), ['Personal recent', 'Project recent']);
    await page.locator('[data-action="select-all"]').click();
    await page.waitForFunction(() => document.querySelector('[data-role="count"]')?.textContent === '2 selected');
    assert.equal(await page.locator('[data-role="chat-select-all-checkbox"]').isChecked(), true,
      'select all must apply only to the filtered chat set');
    await older.fill('15');
    await older.press('Tab');
    await page.waitForFunction(() => document.querySelectorAll('[data-role="chats-results"] .gptbd-result').length === 0);
    await page.waitForFunction(() => document.querySelector('[data-role="count"]')?.textContent === '0 selected');
    assert.equal(await page.locator('[data-action="delete"]').isDisabled(), true,
      'narrowing filters must remove selections that are no longer visible');
    await older.fill('');
    await older.press('Tab');
    await newer.fill('');
    await newer.press('Tab');
    await page.waitForFunction(() => document.querySelectorAll('[data-role="chats-results"] .gptbd-result').length === 5,
      'clearing an age filter must remove it instead of treating it as zero days');
    await page.evaluate(id => {
      history.pushState({}, '', `/g/${id}/project`);
      document.body.appendChild(document.createElement('span'));
    }, projectId);
    const scopeSelect = page.locator('[data-action="select-scope"]');
    await scopeSelect.waitFor();
    assert.equal(await scopeSelect.inputValue(), 'project', 'a project route must default to its visible project scope');
    assert.equal(await scopeSelect.locator('option').first().textContent(), 'This project: Correct Project Name',
      'project scope must use the sidebar project label, not a mounted chat heading');
    await page.waitForFunction(() => document.querySelector('[data-role="chats-results"]')?.dataset.visible === 'true');
    const activeProjectTitles = await page.locator('[data-role="chats-results"] .gptbd-result-title').allTextContents();
    assert.equal(activeProjectTitles.includes('DOM-only project chat'), true,
      'a loaded project chat must be visible on the active project route even when absent from the account API');
    await scopeSelect.selectOption('account');
    await page.waitForFunction(() => document.querySelectorAll('[data-role="chats-results"] .gptbd-result').length === 5);
    await page.waitForFunction(() => document.querySelector('[data-action="filter-age"]'));
    await page.screenshot({ path: '/tmp/issue10-filters.png' });

    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForFunction(() => document.querySelector('[data-role="year-filters"]')?.clientWidth > 0);
    const horizontalOverflow = await page.locator('[data-role="year-filters"]').evaluate(host => {
      const bounds = host.getBoundingClientRect();
      return Array.from(host.children).some(child => child.getBoundingClientRect().right > bounds.right + 1);
    });
    assert.equal(horizontalOverflow, false, 'filter controls must wrap at narrow widths without clipping');
    await page.screenshot({ path: '/tmp/issue10-filters-narrow.png' });
    assert.deepEqual(errors, []);
    console.log('Project/filter smoke passed: project DOM label and key, project/non-project, age windows, and filter-aware selection.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
