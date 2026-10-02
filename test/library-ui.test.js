const test = require('node:test');
const assert = require('node:assert/strict');
const library = require('../library-ui.js');

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
    key: index => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; }
  };
}

const files = [
  { id: 'lib-a', title: 'Quarterly Report.pdf', libraryFileId: 'lib-a', fileId: 'file-a', fileName: 'Quarterly Report.pdf' },
  { id: 'lib-b', title: 'Budget.csv', libraryFileId: 'lib-b', fileId: 'file-b', fileName: 'Budget.csv' }
];

test('Library metadata is session-only and purges legacy Library caches without touching chats', () => {
  const local = storage();
  local.setItem('gptbd-conversation-cache-v1', 'chat cache');
  local.setItem('gptbd-library-cache-v1:account-a', JSON.stringify({ files, loadedAt: 123 }));
  const state = library.createState();
  library.loadCache(state, local, 'account-a');
  assert.deepEqual(state.files, []);
  assert.equal(local.getItem('gptbd-library-cache-v1:account-a'), null);
  state.files = files;
  state.cacheLoadedAt = 123;
  state.selectedIds.add('lib-a');
  assert.equal(library.persistCache(state, local), true);
  library.loadCache(state, local, 'account-b');
  assert.deepEqual(state.files, []);
  assert.equal(state.selectedIds.size, 0);
  library.clearCache(state, local);
  assert.equal(local.getItem('gptbd-conversation-cache-v1'), 'chat cache');
});

test('Library search is case insensitive, trims whitespace, and preserves source files', () => {
  assert.deepEqual(library.filterFiles(files, ' REPORT '), [files[0]]);
  assert.deepEqual(library.filterFiles(files, ''), files);
  assert.deepEqual(library.filterFiles(files, 'missing'), []);
  assert.equal(files.length, 2);
});

test('recognizes current and legacy Library routes only', () => {
  assert.equal(library.isLibraryPath('/space/files?tab=images'), true);
  assert.equal(library.isLibraryPath('/space/files/uploads'), true);
  assert.equal(library.isLibraryPath('/library'), true);
  assert.equal(library.isLibraryPath('/library/legacy'), true);
  assert.equal(library.isLibraryPath('/space'), false);
  assert.equal(library.isLibraryPath('/c/example'), false);
});

test('Missing identity and storage failures fail safely without persistence', () => {
  const state = library.createState();
  assert.equal(library.persistCache(state, storage()), true);
  library.loadCache(state, { getItem: () => '{' }, 'account-a');
  assert.deepEqual(state.files, []);
  assert.equal(library.persistCache(state, { setItem: () => { throw new Error('Quota exceeded'); } }), true);
  library.loadCache(state, storage(), null);
  assert.equal(state.accountKey, null);
  assert.equal(state.selectedIds.size, 0);
});
