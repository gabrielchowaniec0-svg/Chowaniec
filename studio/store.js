// Chowaniec Studio – on-device storage (/studio/store.js)
// ---------------------------------------------------------------------------------------------------
// Everything stays on this phone. Nothing is uploaded.
//   Metadata (projects with their scene line-up and settings, takes) → IndexedDB "chowaniec-studio".
//   Video clips → Origin Private File System (navigator.storage.getDirectory()), streamed chunk by chunk
//   with createWritable(), so a long 4K take never sits in memory. Where the browser has no writable
//   OPFS files (older Safari), chunks go into IndexedDB as Blobs instead (also on disk, also streamed).
//
// window.StudioStore = {
//   ready(): Promise, backend: 'opfs' | 'idb',
//   listProjects(), getProject(id), putProject(p), deleteProject(id),
//   listTakes(projectId), getTake(id), putTake(t), deleteTake(id),
//   createClipWriter(projectId, takeId, ext) → { write(blob), close() → Promise<size>, abort() },
//   getClip(take) → Promise<File|Blob|null>, estimate() → { usage, quota, free }, persist()
// }
(function () {
  'use strict';
  if (window.StudioStore) return;
  var DB_NAME = 'chowaniec-studio', DB_VER = 1, db = null, dbP = null;

  function openDb() {
    if (dbP) return dbP;
    dbP = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('takes')) d.createObjectStore('takes', { keyPath: 'id' }).createIndex('project', 'projectId');
        if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks', { keyPath: ['takeId', 'seq'] }).createIndex('take', 'takeId');
      };
      req.onsuccess = function () { db = req.result; resolve(db); };
      req.onerror = function () { reject(req.error); };
    });
    return dbP;
  }
  function tx(store, mode, fn) {
    return openDb().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(store, mode), out;
        var s = t.objectStore(store);
        out = fn(s);
        t.oncomplete = function () { resolve(out && 'result' in out ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }
  var get = function (store, key) { return tx(store, 'readonly', function (s) { return s.get(key); }); };
  var put = function (store, val) { return tx(store, 'readwrite', function (s) { return s.put(val); }); };
  var del = function (store, key) { return tx(store, 'readwrite', function (s) { return s.delete(key); }); };
  function byIndex(store, index, key) { return tx(store, 'readonly', function (s) { return s.index(index).getAll(key); }); }
  function delByIndex(store, index, key) {
    return tx(store, 'readwrite', function (s) {
      var r = s.index(index).openKeyCursor(IDBKeyRange.only(key));
      r.onsuccess = function () { var c = r.result; if (c) { s.delete(c.primaryKey); c.continue(); } };
    });
  }

  // ---------- OPFS ----------
  var rootP = null, backend = 'idb';
  function opfsRoot() {
    if (rootP) return rootP;
    rootP = (async function () {
      if (!navigator.storage || !navigator.storage.getDirectory) return null;
      if (!window.FileSystemFileHandle || !('createWritable' in FileSystemFileHandle.prototype)) return null;
      try {
        var r = await navigator.storage.getDirectory();
        var dir = await r.getDirectoryHandle('studio', { create: true });
        // Prove it really writes (some private modes expose the API but refuse writes).
        var probe = await dir.getFileHandle('.probe', { create: true });
        var w = await probe.createWritable(); await w.write(new Blob(['ok'])); await w.close();
        await dir.removeEntry('.probe');
        backend = 'opfs';
        return dir;
      } catch (e) { return null; }
    })();
    return rootP;
  }
  async function projectDir(projectId, create) {
    var root = await opfsRoot();
    if (!root) return null;
    try { return await root.getDirectoryHandle(projectId, { create: !!create }); } catch (e) { return null; }
  }

  function createClipWriter(projectId, takeId, ext) {
    var queue = Promise.resolve(), size = 0, seq = 0, failed = null, writable = null, mode = null, fileName = takeId + '.' + ext;
    var opened = (async function () {
      var dir = await projectDir(projectId, true);
      if (dir) {
        try {
          var fh = await dir.getFileHandle(fileName, { create: true });
          writable = await fh.createWritable();
          mode = 'opfs';
          return;
        } catch (e) { /* fall through */ }
      }
      mode = 'idb';
    })();
    function write(blob) {
      if (!blob || !blob.size) return queue;
      queue = queue.then(function () { return opened; }).then(function () {
        if (failed) return;
        var n = seq++;
        size += blob.size;
        if (mode === 'opfs') return writable.write(blob);
        return put('chunks', { takeId: takeId, seq: n, blob: blob });
      }).catch(function (e) { failed = e; });
      return queue;
    }
    function close() {
      return queue.then(function () { return opened; }).then(async function () {
        if (mode === 'opfs' && writable) await writable.close();
        if (failed) throw failed;
        return { size: size, storage: mode, file: fileName };
      });
    }
    function abort() {
      return queue.then(function () { return opened; }).then(async function () {
        try { if (writable) await writable.abort(); } catch (e) { /* ignore */ }
        await removeClip({ projectId: projectId, id: takeId, file: fileName, storage: mode });
      }).catch(function () {});
    }
    return { write: write, close: close, abort: abort, get size() { return size; } };
  }

  async function getClip(take) {
    if (!take) return null;
    if (take.storage === 'opfs') {
      var dir = await projectDir(take.projectId, false);
      if (!dir) return null;
      try { var fh = await dir.getFileHandle(take.file); return await fh.getFile(); } catch (e) { return null; }
    }
    var chunks = await byIndex('chunks', 'take', take.id);
    if (!chunks || !chunks.length) return null;
    chunks.sort(function (a, b) { return a.seq - b.seq; });
    return new Blob(chunks.map(function (c) { return c.blob; }), { type: take.mimeType || 'video/mp4' });
  }
  async function removeClip(take) {
    if (take.storage === 'opfs' || !take.storage) {
      var dir = await projectDir(take.projectId, false);
      if (dir) { try { await dir.removeEntry(take.file); } catch (e) { /* already gone */ } }
    }
    await delByIndex('chunks', 'take', take.id).catch(function () {});
  }

  var api = {
    get backend() { return backend; },
    ready: function () { return Promise.all([openDb(), opfsRoot()]); },
    listProjects: function () { return tx('projects', 'readonly', function (s) { return s.getAll(); }).then(function (a) { return (a || []).sort(function (x, y) { return (y.updated || 0) - (x.updated || 0); }); }); },
    getProject: function (id) { return get('projects', id); },
    putProject: function (p) { p.updated = Date.now(); return put('projects', p).then(function () { return p; }); },
    deleteProject: async function (id) {
      var takes = await byIndex('takes', 'project', id);
      for (var i = 0; i < takes.length; i++) { await removeClip(takes[i]); await del('takes', takes[i].id); }
      var root = await opfsRoot();
      if (root) { try { await root.removeEntry(id, { recursive: true }); } catch (e) { /* none */ } }
      await del('projects', id);
    },
    listTakes: function (projectId) { return byIndex('takes', 'project', projectId); },
    getTake: function (id) { return get('takes', id); },
    putTake: function (t) { return put('takes', t).then(function () { return t; }); },
    deleteTake: async function (id) {
      var t = await get('takes', id);
      if (!t) return;
      await removeClip(t);
      await del('takes', id);
    },
    createClipWriter: createClipWriter,
    getClip: getClip,
    estimate: async function () {
      try {
        var e = await navigator.storage.estimate();
        return { usage: e.usage || 0, quota: e.quota || 0, free: Math.max(0, (e.quota || 0) - (e.usage || 0)) };
      } catch (err) { return null; }
    },
    persist: async function () {
      try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* ignore */ }
      return false;
    },
    persisted: async function () { try { return await navigator.storage.persisted(); } catch (e) { return false; } }
  };
  window.StudioStore = api;
})();
