window.__ModuleLoader__.load({
  id: '@xiaonerner0821/dsh-multi-session',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore, useCallback, memo, Fragment } = React;

    const NS = 'multiSession';
    // Persistence is split so several browser tabs never overwrite each other's tab bar:
    //  - this browser tab's own tabs live in sessionStorage (survives reload, private to the tab);
    //  - shared preferences (position, heights) live in localStorage and sync live across tabs;
    //  - a snapshot of the last-changed tab set seeds the very first tab after a browser restart.
    const PREFS_KEY = 'dsh-multi-session.prefs.v3';
    const TABS_KEY = 'dsh-multi-session.tabs.v3';
    const SNAPSHOT_KEY = 'dsh-multi-session.snapshot.v3';
    const ALIVE_KEY = 'dsh-multi-session.alive.v3';
    const LEGACY_KEYS = ['dsh-multi-session.v2', 'dsh-multi-session.v1'];
    // cross-page status facts: when a session was last looked at, and which sessions wait for an answer
    const READ_KEY = 'dsh-multi-session.read.v1';
    const PENDING_KEY = 'dsh-multi-session.pending.v1';
    const READ_SKEW_MS = 2000;   // pages see the same run end a few ms apart
    const READ_TTL_MS = 7 * 24 * 3600 * 1000;
    const MAX_READ = 200;
    const ALIVE_BEAT_MS = 10000;
    const ALIVE_TTL_MS = 90000;  // hidden tabs may be throttled to one timer per minute
    // A page removes its heartbeat when it closes. One whose heartbeat merely went quiet was most likely frozen or
    // discarded by the browser (background tabs, memory saver) and is still open, so it keeps counting as open for
    // this long. Desktop (Electron) never freezes its window: a quiet heartbeat there means the app was killed.
    const NEVER_FROZEN = typeof navigator !== 'undefined' && /\bElectron\//.test(String(navigator.userAgent || ''));
    const OPEN_KEEP_MS = NEVER_FROZEN ? ALIVE_TTL_MS : 3 * 24 * 3600 * 1000;
    // one id per document: a live plugin reload in the same page keeps it, so its sessionStorage stays its own
    const PAGE_ID = (() => {
      const fresh = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      try { return window.__dshMultiSessionPageId || (window.__dshMultiSessionPageId = fresh); } catch (_) { return fresh; }
    })();
    const RETAIN_SOURCE = 'multiSessionTabs';
    const MAX_WARM = 8;          // warm non-pinned, non-running tabs kept besides the current one
    const MAX_TABS = 60;         // hard cap on remembered tabs (hidden ones included)
    const MAX_CLOSED = 20;
    const RETRY_FAILED_MS = 30000;
    const TB_MIN = 30;
    const TB_MAX = 48;
    const TB_DEFAULT = 36;       // a touch slimmer than the shipped 40px caption
    const TB_PRESETS = [32, 36, 40, 44];
    // tab bar below the conversation header (browser / Web profile)
    const BAR_MIN = 28;
    const BAR_MAX = 52;
    const BAR_DEFAULT = 38;
    const BAR_PRESETS = [32, 38, 44, 50];
    const EMPTY_MAP = new Map();

    // ------------------------------------------------------------------ copy
    const EN = {
      tablist: 'Open sessions', newSession: 'New session', untitled: 'Untitled session', newTab: 'New session tab',
      close: 'Close tab', closeOthers: 'Close other tabs', closeRight: 'Close tabs to the right',
      rename: 'Rename', renameFailed: 'Rename failed', open: 'Switch to this tab',
      pin: 'Pin tab', unpin: 'Unpin tab', pinned: 'Pinned',
      moveLeft: 'Move left', moveRight: 'Move right',
      reopen: 'Reopen closed tab', recent: 'Recently closed', recentEmpty: 'Nothing closed yet', clearRecent: 'Clear history',
      overflowHead: 'When there are too many tabs', overflowScroll: 'Scroll horizontally', overflowShrink: 'Shrink tabs to fit',
      placement: 'Tab bar position', placeTitlebar: 'Title bar', placeBelow: 'Below conversation header', titlebarOnly: 'Windows Desktop only',
      swapPlacement: 'Swap tab bar position',
      tbHeight: 'Title bar height', tbCompact: 'Compact', tbDefault: 'Default', tbStandard: 'Original', tbRoomy: 'Roomy',
      tbDragHint: 'Drag to resize the title bar, double-click to reset',
      barHeight: 'Tab bar height', barDragHint: 'Drag to resize the tab bar, double-click to reset', tbXL: 'Extra roomy',
      rightbar: 'Toggle right sidebar', rightbarNone: 'Open a session to use the right sidebar',
      bottom: 'Toggle bottom panel', bottomNone: 'No bottom panel is installed',
      stRunning: 'Running', stAwaiting: 'Waiting for your approval or answer', stUnread: 'Finished — not read yet',
      stConnecting: 'Connecting', stIdle: 'Idle', stCold: 'Idle (not kept in memory)',
      noTabs: 'No session tabs',
    };
    const ZH = {
      tablist: '已打开的会话', newSession: '新会话', untitled: '未命名会话', newTab: '新建会话标签',
      close: '关闭标签', closeOthers: '关闭其他标签', closeRight: '关闭右侧标签',
      rename: '重命名', renameFailed: '重命名失败', open: '切换到此标签',
      pin: '固定标签', unpin: '取消固定', pinned: '已固定',
      moveLeft: '向左移动', moveRight: '向右移动',
      reopen: '恢复最近关闭的标签', recent: '最近关闭', recentEmpty: '还没有关闭过标签', clearRecent: '清空记录',
      overflowHead: '标签太多时', overflowScroll: '横向滚动', overflowShrink: '缩小宽度，全部显示',
      placement: '标签栏位置', placeTitlebar: '标题栏', placeBelow: '会话头部下方', titlebarOnly: '仅 Windows 桌面端',
      swapPlacement: '切换标签栏位置',
      tbHeight: '标题栏高度', tbCompact: '紧凑', tbDefault: '默认', tbStandard: '原始', tbRoomy: '宽松',
      tbDragHint: '拖动调整标题栏高度，双击恢复默认',
      barHeight: '标签栏高度', barDragHint: '拖动调整标签栏高度，双击恢复默认', tbXL: '特大',
      rightbar: '切换右侧边栏', rightbarNone: '打开会话后才能使用右侧边栏',
      bottom: '切换底部面板', bottomNone: '当前没有安装底部面板',
      stRunning: '运行中', stAwaiting: '等待你审批或回答', stUnread: '已完成，尚未查看',
      stConnecting: '连接中', stIdle: '空闲', stCold: '空闲（未常驻内存）',
      noTabs: '没有会话标签',
    };

    // ------------------------------------------------------------------ helpers
    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const clampTb = (n) => Math.max(TB_MIN, Math.min(TB_MAX, Math.round(n)));
    const clampBar = (n) => Math.max(BAR_MIN, Math.min(BAR_MAX, Math.round(n)));
    function readJson(storage, key) {
      try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
    }
    function writeJson(storage, key, value) {
      try { storage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
    }
    const local = (() => { try { return window.localStorage; } catch (_) { return null; } })();
    const session = (() => { try { return window.sessionStorage; } catch (_) { return null; } })();
    const strArr = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);

    // what belongs to this browser tab only
    function sanitizePage(v) {
      const tabs = [...new Set(strArr(v && v.tabs))].slice(-MAX_TABS);
      const pinnedSet = new Set(strArr(v && v.pinned).filter((id) => tabs.includes(id)));
      // invariant: pinned tabs form the leading group, in tab order
      const ordered = [...tabs.filter((id) => pinnedSet.has(id)), ...tabs.filter((id) => !pinnedSet.has(id))];
      const seen = {};
      if (v && isObj(v.seen)) for (const k of ordered) if (typeof v.seen[k] === 'number') seen[k] = v.seen[k];
      const current = v && typeof v.current === 'string' ? v.current : null;
      return { tabs: ordered, pinned: ordered.filter((id) => pinnedSet.has(id)), seen, current };
    }
    const sanitizeClosed = (a) => (Array.isArray(a)
      ? a.filter((c) => c && typeof c.id === 'string')
        .map((c) => ({ id: c.id, title: String(c.title || ''), index: Number(c.index) || 0, at: Number(c.at) || 0, pinned: !!c.pinned }))
        .slice(0, MAX_CLOSED)
      : []);
    // what every browser tab shares (preferences + the recently-closed history)
    function sanitizePrefs(v) {
      const placement = { desktop: null, web: null };
      if (v && isObj(v.placement)) for (const r of ['desktop', 'web']) if (v.placement[r] === 'titlebar' || v.placement[r] === 'below') placement[r] = v.placement[r];
      const titlebarHeight = v && typeof v.titlebarHeight === 'number' && Number.isFinite(v.titlebarHeight) ? clampTb(v.titlebarHeight) : null;
      const barHeight = v && typeof v.barHeight === 'number' && Number.isFinite(v.barHeight) ? clampBar(v.barHeight) : null;
      const overflow = v && v.overflow === 'shrink' ? 'shrink' : 'scroll';
      return { placement, titlebarHeight, barHeight, overflow, bottomHidden: !!(v && v.bottomHidden), closed: sanitizeClosed(v && v.closed) };
    }
    const pageOf = (s) => ({ tabs: s.tabs, pinned: s.pinned, seen: s.seen, current: s.current });
    const prefsOf = (s) => ({ placement: s.placement, titlebarHeight: s.titlebarHeight, barHeight: s.barHeight, overflow: s.overflow, bottomHidden: s.bottomHidden, closed: s.closed });

    // other pages that have not said goodbye: live ones plus frozen / discarded ones (see OPEN_KEEP_MS)
    function otherOpenPages() {
      const map = local ? readJson(local, ALIVE_KEY) : null;
      const out = new Set();
      if (!isObj(map)) return out;
      const now = Date.now();
      for (const id of Object.keys(map)) if (id !== PAGE_ID && typeof map[id] === 'number' && now - map[id] < OPEN_KEEP_MS) out.add(id);
      return out;
    }
    // this document is the same browser tab coming back (F5, crash reload, a discarded tab re-activated),
    // not a new tab that was handed a copy of another tab's sessionStorage (opened from a link, duplicated)
    function reloadedInPlace() {
      try { if (document.wasDiscarded) return true; } catch (_) { /* not supported */ }
      try {
        const nav = performance.getEntriesByType('navigation')[0];
        return !!nav && nav.type === 'reload';
      } catch (_) { return false; }
    }
    function alivePages() {
      const map = local ? readJson(local, ALIVE_KEY) : null;
      const out = new Set([PAGE_ID]);
      if (!isObj(map)) return out;
      const now = Date.now();
      for (const id of Object.keys(map)) if (typeof map[id] === 'number' && now - map[id] < ALIVE_TTL_MS) out.add(id);
      return out;
    }

    // { [sessionId]: time some page last showed it in a visible main view }
    function readReadMap() {
      const map = local ? readJson(local, READ_KEY) : null;
      const out = {};
      if (!isObj(map)) return out;
      const now = Date.now();
      for (const id of Object.keys(map)) if (typeof map[id] === 'number' && now - map[id] < READ_TTL_MS) out[id] = map[id];
      return out;
    }
    function markRead(id, at) {
      if (!local || !id) return;
      const map = readReadMap();
      if ((map[id] || 0) >= at) return;
      map[id] = at;
      const ids = Object.keys(map);
      if (ids.length > MAX_READ) ids.sort((a, b) => map[a] - map[b]).slice(0, ids.length - MAX_READ).forEach((k) => delete map[k]);
      writeJson(local, READ_KEY, map);
    }
    // { [sessionId]: { page, at } }: a page that can see a pending interaction for that session
    function readPendingMap() {
      const map = local ? readJson(local, PENDING_KEY) : null;
      return isObj(map) ? map : {};
    }
    function writePendingFacts(ids) {
      if (!local) return;
      const alive = alivePages();
      const prev = readPendingMap();
      const next = {};
      for (const id of Object.keys(prev)) {
        const e = prev[id];
        if (!isObj(e) || typeof e.page !== 'string' || e.page === PAGE_ID || !alive.has(e.page)) continue;
        next[id] = e;
      }
      const now = Date.now();
      for (const id of ids) {
        const own = isObj(prev[id]) && prev[id].page === PAGE_ID ? prev[id] : null;
        next[id] = own || { page: PAGE_ID, at: now };
      }
      const a = JSON.stringify(prev); const b = JSON.stringify(next);
      if (a !== b) writeJson(local, PENDING_KEY, next);
    }

    function loadInitial() {
      // shared preferences: v3, else migrate from the old single-key layouts
      let prefsRaw = local ? readJson(local, PREFS_KEY) : null;
      let legacy = null;
      if (local) for (const k of LEGACY_KEYS) { legacy = readJson(local, k); if (legacy) { legacy.__v1 = k.endsWith('.v1'); break; } }
      if (!prefsRaw && legacy) {
        // v1 stored one placement for web and desktop; drop it so Desktop defaults to the title bar
        prefsRaw = legacy.__v1 ? { bottomHidden: legacy.bottomHidden, closed: legacy.closed } : legacy;
      }
      if (prefsRaw && !Array.isArray(prefsRaw.closed)) {
        // 0.3.0 kept the history per browser tab; fold the newest copy back into the shared list
        const old = (session && readJson(session, TABS_KEY)) || (local && readJson(local, SNAPSHOT_KEY));
        if (old && Array.isArray(old.closed)) prefsRaw = { ...prefsRaw, closed: old.closed };
      }
      const prefs = sanitizePrefs(prefsRaw);

      // this browser tab's own tab bar:
      //  1) sessionStorage written by this same browser tab (reload, crash reload, discarded tab) — keep it;
      //     a copy the browser handed to a new tab (opened from a link, duplicated) while its owner is still
      //     open does not count: that new tab starts clean;
      //  2) no other open page at all (every page closed properly) — first page after a browser/app restart
      //     picks up the last snapshot;
      //  3) another page is open, even if the browser froze it — start clean so the two never mirror each other.
      const open = otherOpenPages();
      const own = session ? readJson(session, TABS_KEY) : null;
      const owner = own && typeof own.owner === 'string' ? own.owner : null;
      let page = null;
      let source;
      let inherited = null;
      if (own && (!owner || !open.has(owner) || reloadedInPlace())) { page = own; source = 'session'; inherited = owner; }
      else if (own || open.size) source = 'fresh';
      else { page = (local && readJson(local, SNAPSHOT_KEY)) || legacy; source = 'snapshot'; }
      return { state: { ...sanitizePage(page), ...prefs }, source, inherited };
    }

    function createStore() {
      const initial = loadInitial();
      let state = initial.state;
      const subs = new Set();
      let timer = null;
      let lastPrefs = JSON.stringify(prefsOf(state));
      const flush = () => {
        timer = null;
        const page = pageOf(state);
        // owner: lets a copy of this sessionStorage in another browser tab tell that it is not its own
        if (session) writeJson(session, TABS_KEY, { ...page, owner: PAGE_ID });
        // newest tab set wins the snapshot used after a restart; it never feeds a page that is already open
        if (local) writeJson(local, SNAPSHOT_KEY, page);
        const prefs = JSON.stringify(prefsOf(state));
        if (local && prefs !== lastPrefs) {
          lastPrefs = prefs;
          try { local.setItem(PREFS_KEY, prefs); } catch (_) { /* memory only */ }
        }
      };
      const emit = () => { for (const f of [...subs]) f(); };
      // claim this browser tab's sessionStorage right away, so a reload before the first change reads it as its own
      if (session) writeJson(session, TABS_KEY, { ...pageOf(state), owner: PAGE_ID });
      return {
        source: initial.source,
        inherited: initial.inherited,
        get: () => state,
        set(fn, opts) {
          const next = fn(state);
          if (!next || next === state) return;
          state = next;
          if (!(opts && opts.persist === false)) {
            // coalesce bursts (drag, rapid switching) into one write
            if (timer === null) timer = setTimeout(flush, 120);
          }
          emit();
        },
        // preferences changed in another browser tab: adopt them without echoing back
        adoptPrefs(raw) {
          const prefs = sanitizePrefs(raw);
          const json = JSON.stringify(prefs);
          if (json === JSON.stringify(prefsOf(state))) return;
          lastPrefs = json;
          state = { ...state, ...prefs };
          emit();
        },
        flush() { if (timer !== null) { clearTimeout(timer); flush(); } },
        subscribe(f) { subs.add(f); return () => subs.delete(f); },
      };
    }

    function createCell(initial) {
      let value = initial;
      const subs = new Set();
      return {
        get: () => value,
        set(v) { if (Object.is(v, value)) return; value = v; for (const f of [...subs]) f(); },
        subscribe(f) { subs.add(f); return () => subs.delete(f); },
      };
    }

    function currentOf(list) {
      if (!list || !list.byId) return undefined;
      const ids = list.ids || Object.keys(list.byId);
      for (const id of ids) {
        const s = list.byId[id];
        if (s && s.retainedBy && (s.retainedBy.mainView || 0) > 0) return id;
      }
      return undefined;
    }
    function titleOf(summary, t) {
      if (!summary) return t('untitled');
      const raw = (summary.title && String(summary.title).trim()) || (summary.displayTitle && String(summary.displayTitle).trim());
      if (raw) return raw;
      return summary.blank ? t('newSession') : t('untitled');
    }
    function move(arr, from, to) {
      const next = arr.slice();
      const [x] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(next.length, to)), 0, x);
      return next;
    }
    const titlebarAvailable = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-windows-titlebar');
    const cssEscape = (v) => ((window.CSS && window.CSS.escape) ? window.CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'));
    function isTypingTarget(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.closest('.xterm')) return true;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return !!el.closest('[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]');
    }
    const modalOpen = () => !!document.querySelector('[role=dialog][aria-modal=true],[role=alertdialog]');

    // ------------------------------------------------------------------ icons
    const svg = (children, size) => h('svg', { width: size || 14, height: size || 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' }, children);
    const Icon = {
      plus: () => svg([h('path', { key: 1, d: 'M8 3.25v9.5M3.25 8h9.5' })]),
      close: () => svg([h('path', { key: 1, d: 'M4.5 4.5l7 7M11.5 4.5l-7 7' })], 12),
      pin: () => svg([h('path', { key: 1, d: 'M6 2.75h4M6.75 2.75v3.6L4.75 9h6.5l-2-2.65v-3.6M8 9v4.25' })], 12),
      history: () => svg([h('path', { key: 1, d: 'M2.75 8a5.25 5.25 0 1 0 1.6-3.78' }), h('path', { key: 2, d: 'M2.6 2.75v2.6h2.6' }), h('path', { key: 3, d: 'M8 5.25V8l1.9 1.3' })]),
      swap: () => svg([h('path', { key: 1, d: 'M5 2.75v10.5M2.75 5 5 2.75 7.25 5' }), h('path', { key: 2, d: 'M11 13.25V2.75M13.25 11 11 13.25 8.75 11' })]),
      rightbar: () => svg([h('rect', { key: 1, x: 2.25, y: 2.75, width: 11.5, height: 10.5, rx: 2 }), h('path', { key: 2, d: 'M10 2.75v10.5' })]),
      bottom: () => svg([h('rect', { key: 1, x: 2.25, y: 2.75, width: 11.5, height: 10.5, rx: 2 }), h('path', { key: 2, d: 'M2.25 9.75h11.5' })]),
      check: () => svg([h('path', { key: 1, d: 'M3.5 8.25 6.5 11l6-6.25' })], 12),
    };

    // ------------------------------------------------------------------ styles
    const CSS = `
.dms-strip,.dms-menu{--dms-accent:var(--dsw-alias-brand-primary,#3a6df0);--dms-warn:var(--dsw-alias-state-warn-primary,#e5a00d);--dms-idle:var(--dsw-alias-label-caption,#8a8f99);--dms-mono:ui-monospace,"Cascadia Mono","JetBrains Mono",SFMono-Regular,Consolas,monospace;--dms-r:5px}
.dms-strip{--dms-h:28px;display:flex;align-items:center;gap:2px;min-width:0;box-sizing:border-box;font-size:12.5px;line-height:1;color:var(--dsw-alias-label-secondary);-webkit-app-region:no-drag;user-select:none}
.dms-strip *{box-sizing:border-box}
.dms-strip[data-host=overlay]{--dms-h:clamp(20px,calc(var(--dsh-windows-titlebar-height,40px) - 10px),28px);position:fixed;top:0;height:var(--dsh-windows-titlebar-height,40px);
  left:max(var(--dms-menu-end,180px),calc(var(--dsh-windows-sidebar-width,0px) + 12px));
  right:calc(100vw - env(titlebar-area-x,0px) - env(titlebar-area-width,calc(100vw - 144px)) + 10px);
  pointer-events:none;-webkit-app-region:drag;z-index:5}
.dms-strip[data-host=overlay] > *{pointer-events:auto;-webkit-app-region:no-drag}
.dms-strip[data-host=leading]{--dms-h:clamp(22px,calc(var(--dms-bar,38px) - 10px),34px);width:auto;margin:8px -28px 0 -20px;padding:0 20px 0 14px;height:var(--dms-bar,38px);border-top:.5px solid var(--dsw-alias-border-l3,transparent);position:relative}
.dms-scroll{position:relative;flex:0 1 auto;min-width:0;height:100%;display:flex;align-items:center;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;overscroll-behavior-x:contain}
.dms-scroll::-webkit-scrollbar{display:none}
.dms-scroll[data-fade~=l]{-webkit-mask-image:linear-gradient(90deg,transparent,#000 22px);mask-image:linear-gradient(90deg,transparent,#000 22px)}
.dms-scroll[data-fade~=r]{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 22px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 22px),transparent)}
.dms-scroll[data-fade~=l][data-fade~=r]{-webkit-mask-image:linear-gradient(90deg,transparent,#000 22px,#000 calc(100% - 22px),transparent);mask-image:linear-gradient(90deg,transparent,#000 22px,#000 calc(100% - 22px),transparent)}
.dms-tabs{position:relative;display:flex;align-items:center;gap:2px;height:100%;padding:0 2px}
.dms-tab{position:relative;flex:0 0 auto;display:flex;align-items:center;gap:7px;height:var(--dms-h);min-width:92px;max-width:208px;padding:0 6px 0 9px;border-radius:var(--dms-r);cursor:default;color:var(--dsw-alias-label-tertiary);outline:none;
  transition:background-color .14s ease,color .14s ease,box-shadow .14s ease,opacity .14s ease}
/* shrink mode: every tab starts from the same width and gives up space equally; scrolling is only a last resort */
.dms-strip[data-overflow=shrink] .dms-tabs{min-width:0;flex:1 1 auto}
.dms-strip[data-overflow=shrink] .dms-tab{flex:0 1 208px;min-width:34px;container:dms-tab/inline-size}
@container dms-tab (max-width:96px){.dms-key{display:none}}
@container dms-tab (max-width:64px){.dms-label{display:none}.dms-unpin{display:none}.dms-sig{margin-left:auto}.dms-x{margin-right:auto}}
@container dms-tab (max-width:48px){.dms-x{display:none}}
.dms-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dms-tab[aria-selected=true]{background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);box-shadow:0 0 0 .5px var(--dsw-alias-border-l2,rgba(127,127,127,.28)),0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.dms-tab:focus-visible{box-shadow:0 0 0 1.5px var(--dms-accent)}
.dms-tab[data-cold=true] .dms-label{opacity:.72}
.dms-tab[data-state=awaiting]:not([aria-selected=true]) .dms-label{color:var(--dsw-alias-state-warn-label,var(--dms-warn))}
.dms-tab[data-dragging=true]{opacity:.38}
.dms-tab[data-drop=before]::before,.dms-tab[data-drop=after]::after{content:"";position:absolute;top:4px;bottom:4px;width:2px;border-radius:1px;background:var(--dms-accent)}
.dms-tab[data-drop=before]::before{left:-2px}.dms-tab[data-drop=after]::after{right:-2px}
.dms-divider{flex:none;width:1px;height:calc(var(--dms-h) - 12px);margin:0 4px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.3))}
.dms-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.005em}
.dms-label > span{display:inline}
.dms-tab[data-marquee] .dms-label{text-overflow:clip;-webkit-mask-image:linear-gradient(90deg,transparent,#000 6px,#000 calc(100% - 8px),transparent);mask-image:linear-gradient(90deg,transparent,#000 6px,#000 calc(100% - 8px),transparent)}
.dms-tab[data-marquee] .dms-label > span{display:inline-block;padding:0 6px 0 2px;margin-left:-2px;animation:dms-marquee var(--dms-dur,4s) linear 0s infinite alternate;will-change:transform}
@keyframes dms-marquee{0%{transform:translateX(0)}88%,100%{transform:translateX(var(--dms-shift,0px))}}
.dms-x{flex:none;display:grid;place-items:center;width:18px;height:18px;margin-right:-1px;border:0;border-radius:4px;background:transparent;color:inherit;opacity:0;cursor:pointer;padding:0;transition:opacity .12s ease,background-color .12s ease}
.dms-tab:hover .dms-x,.dms-tab[aria-selected=true] .dms-x,.dms-tab:focus-within .dms-x{opacity:.62}
.dms-tab[data-pinned=true] .dms-unpin{opacity:.5;margin-right:-4px}
.dms-x:hover{opacity:1 !important;background:var(--dsw-alias-interactive-bg-hover)}
.dms-input{flex:1 1 auto;min-width:0;height:20px;margin:0 -3px;padding:0 3px;border:0;border-radius:3px;outline:1.5px solid var(--dms-accent);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;user-select:text}
.dms-key{flex:0 0 auto;order:0;position:relative;z-index:1;min-width:13px;height:14px;padding:0 3px;display:grid;place-items:center;border-radius:3px;font:600 9.5px/1 var(--dms-mono);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);box-shadow:inset 0 0 0 .5px color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);opacity:0;transition:opacity .14s ease}
.dms-strip:hover .dms-key,.dms-strip:has(.dms-tab:focus-visible) .dms-key{opacity:.7}
.dms-strip:hover .dms-tab:hover .dms-key,.dms-strip:hover .dms-tab[aria-selected=true] .dms-key,.dms-tab:focus-visible .dms-key{opacity:1}
.dms-line{position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:2px 2px 0 0;background:var(--dms-accent);pointer-events:none;transform-origin:center;animation:dms-line-in .22s cubic-bezier(.3,.7,.2,1)}
.dms-strip[data-host=leading] .dms-line{bottom:calc((var(--dms-h) - var(--dms-bar,38px)) / 2)}
@keyframes dms-line-in{from{transform:scaleX(.3);opacity:0}}
/* status signal: three slots that each state arranges differently, so the shape alone tells the state */
.dms-sig{position:relative;flex:none;width:12px;height:12px;display:flex;align-items:center;justify-content:center;gap:1.5px}
.dms-sig > i{display:block;flex:none;font-style:normal}
.dms-sig > i + i{display:none}
/* idle: a quiet ring */
.dms-sig > i:first-child{width:6px;height:6px;border-radius:50%;box-shadow:inset 0 0 0 1.25px var(--dms-idle);opacity:.7}
.dms-tab[aria-selected=true] .dms-sig[data-state=idle] > i{box-shadow:inset 0 0 0 1.25px var(--dsw-alias-label-secondary);opacity:1}
/* not kept warm: a small faint seed */
.dms-sig[data-state=cold] > i:first-child{width:4px;height:4px;box-shadow:none;background:var(--dms-idle);opacity:.38}
/* running: a three-bar level meter */
.dms-sig[data-state=running] > i{display:block;width:2px;height:9px;border-radius:1px;box-shadow:none;background:var(--dms-accent);opacity:1;transform-origin:50% 50%;animation:dms-eq .95s ease-in-out infinite}
.dms-sig[data-state=running] > i:nth-child(1){animation-delay:-.62s}
.dms-sig[data-state=running] > i:nth-child(2){animation-delay:-.31s}
/* connecting: three dots passing a wave */
.dms-sig[data-state=connecting] > i{display:block;width:2.5px;height:2.5px;border-radius:50%;box-shadow:none;background:var(--dsw-alias-label-secondary);opacity:.3;animation:dms-wave 1.1s ease-in-out infinite}
.dms-sig[data-state=connecting] > i:nth-child(2){animation-delay:.15s}
.dms-sig[data-state=connecting] > i:nth-child(3){animation-delay:.3s}
/* finished, unread: a solid accent dot with a soft halo, popping in once */
.dms-sig[data-state=unread] > i:first-child{width:7px;height:7px;box-shadow:0 0 0 2px color-mix(in srgb,var(--dms-accent) 22%,transparent);background:var(--dms-accent);opacity:1;animation:dms-land .4s cubic-bezier(.3,1.6,.5,1) both}
/* waiting for you: an amber dot that breathes a halo */
.dms-sig[data-state=awaiting] > i:first-child{position:relative;z-index:1;width:7px;height:7px;box-shadow:none;background:var(--dms-warn);opacity:1}
.dms-sig[data-state=awaiting]::after{content:"";position:absolute;left:50%;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:color-mix(in srgb,var(--dms-warn) 45%,transparent);animation:dms-breathe 1.6s ease-in-out infinite}
@keyframes dms-eq{0%,100%{transform:scaleY(.34)}50%{transform:scaleY(1)}}
@keyframes dms-wave{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-1.5px)}}
@keyframes dms-breathe{0%,100%{transform:scale(.55);opacity:.9}50%{transform:scale(1);opacity:.15}}
@keyframes dms-land{0%{transform:scale(0)}100%{transform:scale(1)}}
.dms-tools{flex:none;display:flex;align-items:center;gap:1px;height:100%}
.dms-tools[data-end]{margin-left:auto;padding-left:8px}
.dms-btn{display:grid;place-items:center;width:26px;height:min(26px,var(--dms-h));padding:0;border:0;border-radius:var(--dms-r);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:background-color .12s,color .12s}
.dms-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dms-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.dms-btn:focus-visible{outline:1.5px solid var(--dms-accent);outline-offset:-1px}
.dms-btn:disabled{opacity:.35;cursor:default}
.dms-btn[aria-pressed=true]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}
.dms-sep{width:1px;height:14px;margin:0 5px;background:var(--dsw-alias-border-l3,rgba(127,127,127,.25))}
.dms-empty{padding:0 8px;color:var(--dsw-alias-label-caption);font-size:12px}
.dms-grip{position:absolute !important;left:0;right:0;bottom:-2px;height:5px;cursor:ns-resize;touch-action:none;z-index:1}
.dms-grip::after{content:"";position:absolute;left:50%;bottom:2px;width:36px;height:2px;margin-left:-18px;border-radius:1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.5));opacity:0;transition:opacity .15s}
.dms-grip:hover::after,.dms-grip[data-active]::after{opacity:1}
.dms-menu{position:fixed;z-index:2147483000;min-width:216px;max-width:320px;max-height:min(70vh,480px);overflow:auto;padding:4px;border-radius:8px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);box-sizing:border-box;
  box-shadow:0 0 0 .5px var(--dsw-alias-border-l2,rgba(127,127,127,.3)),0 12px 32px -8px color-mix(in srgb,#000 32%,transparent);font-size:12.5px;line-height:1;-webkit-app-region:no-drag;pointer-events:auto;animation:dms-pop .12s ease-out;transform-origin:var(--dms-origin,top left);user-select:none}
.dms-menu *{box-sizing:border-box}
@keyframes dms-pop{from{opacity:0;transform:scale(.97)}}
.dms-mi{display:flex;align-items:center;gap:9px;width:100%;min-height:28px;padding:0 9px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;outline:none}
.dms-mi:hover:not(:disabled),.dms-mi:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dms-mi:disabled{color:var(--dsw-alias-label-caption);cursor:default}
.dms-mi-l{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dms-mi-k{flex:none;font:500 10.5px/1 var(--dms-mono);color:var(--dsw-alias-label-caption)}
.dms-mi-c{flex:none;width:12px;display:grid;place-items:center;color:var(--dms-accent)}
.dms-mh{padding:7px 9px 4px;font-size:11px;color:var(--dsw-alias-label-caption);letter-spacing:.02em}
.dms-ms{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l3,rgba(127,127,127,.2))}
@media (prefers-reduced-motion:reduce){.dms-strip *,.dms-strip *::before,.dms-strip *::after,.dms-menu{animation:none !important;transition:none !important}}
[data-conversation-header-leading]:has(.dms-strip[data-host=leading]){grid-area:30/1/31/-1 !important;display:block !important;min-width:0}
header:has(> [data-conversation-header-leading] .dms-strip[data-host=leading]){padding-bottom:0 !important}
`;

    // ------------------------------------------------------------------ plugin
    return {
      inject: ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout'],
      apply(ctx) {
        ctx.effect(() => {
          const offs = [];
          for (const [tag, dict] of [['en', EN], ['zh', ZH], ['zh-CN', ZH]]) {
            try { const off = ctx.locale.register(NS, tag, dict); if (typeof off === 'function') offs.push(off); } catch (_) { /* tag not supported */ }
          }
          return () => { for (const off of offs) off(); };
        }, 'multi-session: locale');
        const tRaw = ctx.locale.bind(NS);
        const t = (key) => {
          const s = tRaw(key);
          return (typeof s !== 'string' || s === key || s === `${NS}.${key}`) ? (EN[key] || key) : s;
        };
        const optional = (name) => { try { return ctx.get(name); } catch (_) { return undefined; } };

        const store = createStore();
        const warm = createCell(new Map()); // id -> 'pending' | 'ready'
        const sessions = ctx.sessions;
        const listSnap = () => { try { return sessions.list.getSnapshot(); } catch (_) { return null; } };
        const runtimeOf = () => {
          const sc = optional('shortcuts');
          if (sc && (sc.runtime === 'desktop' || sc.runtime === 'web')) return sc.runtime;
          return titlebarAvailable() ? 'desktop' : 'web';
        };

        // ---------------- browser tab icon: badge the page's own favicon with the current session's status
        // Static on purpose: browsers do not animate favicons reliably, and timers in background tabs are throttled.
        const tabSignal = createCell(null); // { state, accent, warn }: the most urgent status across this page's tab bar
        // The host never marks the session in the main view as "finished, unread" (you are looking at it).
        // But while this browser tab is in the background you are not, so remember runs that end unseen here
        // and show them as unread until the page is visible again.
        const unseenDone = createCell(new Set());
        ctx.effect(() => {
          if (typeof document.addEventListener !== 'function') return undefined;
          const onVis = () => { if (!document.hidden && unseenDone.get().size) unseenDone.set(new Set()); };
          document.addEventListener('visibilitychange', onVis);
          return () => document.removeEventListener('visibilitychange', onVis);
        }, 'multi-session: unseen completions');
        // Last status per tab, kept outside the tab bar so moving it (title bar <-> header) keeps run transitions.
        const lastStates = { map: new Map() };
        // Cross-page facts shared through localStorage: "unread" and "awaiting" are tracked per page by the host,
        // so a session read in one page, or waiting for an answer in another, would otherwise disagree here.
        const readShared = createCell(readReadMap());
        const pendingShared = createCell(readPendingMap());
        const unreadSince = new Map(); // id -> when this page first showed it as unread
        ctx.effect(() => {
          if (!local) return undefined;
          const onStorage = (e) => {
            if (e.storageArea !== local) return;
            if (e.key === READ_KEY) readShared.set(readReadMap());
            else if (e.key === PENDING_KEY) pendingShared.set(readPendingMap());
          };
          window.addEventListener('storage', onStorage);
          // the owner of a pending entry may have closed without cleaning up; drop it once its heartbeat expires
          const timer = setInterval(() => {
            const next = readPendingMap();
            if (JSON.stringify(next) !== JSON.stringify(pendingShared.get())) pendingShared.set(next);
          }, ALIVE_BEAT_MS * 3);
          return () => {
            window.removeEventListener('storage', onStorage);
            clearInterval(timer);
            writePendingFacts([]);
          };
        }, 'multi-session: cross-page status');
        const noteRead = (id) => {
          if (!id) return;
          const now = Date.now();
          markRead(id, now);
          const cur = readShared.get();
          if ((cur[id] || 0) < now) readShared.set({ ...cur, [id]: now });
        };
        ctx.effect(() => {
          const head = document.head;
          if (!head || typeof head.querySelectorAll !== 'function' || typeof document.createElement !== 'function' || typeof MutationObserver !== 'function') return undefined;
          const MARK = 'data-dms-favicon';
          const BADGED = { running: 1, awaiting: 1, unread: 1, connecting: 1 };
          // The host ships one icon per colour scheme (light: dark whale, dark: light whale), each a <link media=…>.
          // Every link is badged from its own original image, so the browser keeps picking the right variant.
          const originals = new Map(); // host <link> -> its own href attribute
          const images = new Map(); // absolute src -> { img, ready }
          const badgedCache = new Map(); // `${sigKey}|${src}|${ready}` -> data URL
          let ownLink = null;
          let mo = null;
          const hostLinks = () => [...head.querySelectorAll('link[rel~="icon"]')].filter((l) => !l.hasAttribute(MARK));
          const absolute = (href) => { try { return new URL(href || '/favicon.ico', document.baseURI).href; } catch (_) { return href || ''; } };
          const settle = () => { if (mo) mo.takeRecords(); }; // drop the mutations we caused ourselves
          const restore = () => {
            for (const [l, href] of originals) { if (l.isConnected) { if (href == null) l.removeAttribute('href'); else l.setAttribute('href', href); } }
            originals.clear();
            if (ownLink) { ownLink.remove(); ownLink = null; }
            settle();
          };
          let render = () => {};
          const imageFor = (src) => {
            let e = images.get(src);
            if (e) return e;
            const im = new Image();
            e = { img: im, ready: false };
            images.set(src, e);
            im.onload = () => { e.ready = true; render(); };
            im.onerror = () => { e.ready = false; };
            im.src = src;
            return e;
          };
          const draw = (sig, base) => {
            const S = 64;
            const c = document.createElement('canvas'); c.width = S; c.height = S;
            const g = c.getContext && c.getContext('2d');
            if (!g) return null;
            let cx = 32; let cy = 32; let r = 26; // no usable app icon: the signal alone, full size
            const img = base && base.ready ? base.img : null;
            if (img) {
              try {
                g.drawImage(img, 0, 0, S, S);
                cx = 45; cy = 45; r = 18;
                // knock a clean gap into the app icon so the badge reads at 16px
                g.globalCompositeOperation = 'destination-out';
                g.beginPath(); g.arc(cx, cy, r + 4, 0, Math.PI * 2); g.fill();
                g.globalCompositeOperation = 'source-over';
              } catch (_) { g.clearRect(0, 0, S, S); cx = 32; cy = 32; r = 26; }
            }
            const fill = (color, fallback) => { g.fillStyle = fallback; if (color) g.fillStyle = color; }; // invalid colors are ignored
            const dot = (x, y, rad) => { g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); };
            const bar = (x, y, w, hgt) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, hgt, w / 2); else g.rect(x, y, w, hgt); g.fill(); };
            if (sig.state === 'awaiting') {
              fill(sig.warn, '#e5a00d'); dot(cx, cy, r);
              g.fillStyle = '#fff';
              bar(cx - r * 0.14, cy - r * 0.6, r * 0.28, r * 0.72);
              dot(cx, cy + r * 0.45, r * 0.15);
            } else if (sig.state === 'unread') {
              fill(sig.accent, '#3a6df0'); dot(cx, cy, r);
            } else if (sig.state === 'running') {
              fill(sig.accent, '#3a6df0');
              const w = r * 0.42; const gap = r * 0.2; const base = cy + r * 0.85;
              [0.95, 1.7, 1.25].forEach((k, i) => bar(cx - w * 1.5 - gap + i * (w + gap), base - r * k, w, r * k));
            } else {
              g.fillStyle = '#8a8f99';
              for (const k of [-0.62, 0, 0.62]) dot(cx + r * k, cy, r * 0.24);
            }
            try { return c.toDataURL('image/png'); } catch (_) { return null; }
          };
          render = () => {
            const sig = tabSignal.get();
            if (!sig || !BADGED[sig.state] || runtimeOf() !== 'web') {
              if (originals.size || ownLink) restore();
              return;
            }
            const sigKey = `${sig.state}|${sig.accent}|${sig.warn}`;
            const badged = (src) => {
              const base = imageFor(src);
              const key = `${sigKey}|${src}|${base.ready}`;
              let url = badgedCache.get(key);
              if (url === undefined) {
                url = draw(sig, base);
                if (badgedCache.size > 48) badgedCache.clear();
                badgedCache.set(key, url);
              }
              return url;
            };
            const links = hostLinks();
            if (links.length) {
              if (ownLink) { ownLink.remove(); ownLink = null; }
              for (const l of links) { if (!originals.has(l)) originals.set(l, l.getAttribute('href')); }
              // Pick the variant for the current colour scheme ourselves and give every link that one result,
              // so it is right whether or not the browser honours media on icon links.
              const matches = (l) => { const m = l.getAttribute('media'); if (!m) return true; try { return window.matchMedia(m).matches; } catch (_) { return false; } };
              const chosen = links.find((l) => l.getAttribute('media') && matches(l)) || links.find(matches) || links[0];
              const url = badged(absolute(originals.get(chosen)));
              if (url) for (const l of links) { if (l.getAttribute('href') !== url) l.setAttribute('href', url); }
            } else {
              const url = badged(absolute('/favicon.ico'));
              if (url) {
                if (!ownLink) { ownLink = document.createElement('link'); ownLink.rel = 'icon'; ownLink.setAttribute(MARK, ''); head.appendChild(ownLink); }
                if (ownLink.getAttribute('href') !== url) ownLink.setAttribute('href', url);
              }
            }
            settle();
          };
          // the host may swap its own icon (theme, route); adopt it as the new base and badge it again
          mo = new MutationObserver((records) => {
            let touched = false;
            for (const rec of records) {
              const el = rec.target;
              if (rec.type === 'attributes' && originals.has(el)) { originals.set(el, el.getAttribute('href')); touched = true; }
              else if (rec.type === 'childList') touched = true;
            }
            if (touched) render();
          });
          mo.observe(head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'rel'] });
          const un = tabSignal.subscribe(render);
          const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
          const onScheme = () => render();
          if (mq && mq.addEventListener) mq.addEventListener('change', onScheme);
          render();
          return () => { un(); if (mq && mq.removeEventListener) mq.removeEventListener('change', onScheme); mo.disconnect(); mo = null; restore(); };
        }, 'multi-session: browser tab icon');

        // ---------------- global stylesheet (once, removed on dispose)
        ctx.effect(() => {
          const el = document.createElement('style');
          el.setAttribute('data-dsh-multi-session', '');
          el.textContent = CSS;
          document.head.appendChild(el);
          return () => el.remove();
        }, 'multi-session: styles');

        // ---------------- title bar presence
        const titlebarCell = createCell(titlebarAvailable());
        ctx.effect(() => {
          const obs = new MutationObserver(() => titlebarCell.set(titlebarAvailable()));
          obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-windows-titlebar'] });
          titlebarCell.set(titlebarAvailable());
          return () => obs.disconnect();
        }, 'multi-session: title bar detection');

        const effectivePlacement = (st, hasTitlebar) => {
          if (!hasTitlebar) return 'below';
          return st.placement[runtimeOf()] || 'titlebar';
        };

        // ---------------- title bar height
        // The Desktop preload writes this variable as an inline style on <html> (and rewrites it
        // whenever it re-marks the document), so a stylesheet rule is not a reliable override.
        // Write our own inline value with !important priority and re-assert it when the
        // preload touches the style attribute again; restore the original value on dispose.
        const TB_VAR = '--dsh-windows-titlebar-height';
        const liveHeight = createCell(null); // transient value while dragging the grip
        const liveBar = createCell(null);    // same, for the bar below the conversation header
        const isFullscreen = () => {
          const v = document.documentElement.getAttribute('data-fullscreen');
          return v !== null && v !== 'false';
        };
        ctx.effect(() => {
          const root = document.documentElement;
          let applied = null;
          let writing = false;
          const wanted = () => {
            const st = store.get();
            if (!titlebarCell.get() || isFullscreen() || effectivePlacement(st, true) !== 'titlebar') return null;
            const hgt = liveHeight.get() != null ? liveHeight.get() : (st.titlebarHeight != null ? st.titlebarHeight : TB_DEFAULT);
            return `${clampTb(hgt)}px`;
          };
          const render = () => {
            const want = wanted();
            const cur = root.style.getPropertyValue(TB_VAR).trim();
            const prio = root.style.getPropertyPriority(TB_VAR);
            if (want === null) {
              if (applied !== null) {
                writing = true;
                root.style.setProperty(TB_VAR, '40px'); // the preload's own value
                writing = false;
                applied = null;
              }
              return;
            }
            if (cur === want && prio === 'important') { applied = want; return; }
            writing = true;
            root.style.setProperty(TB_VAR, want, 'important');
            writing = false;
            applied = want;
          };
          const mo = new MutationObserver(() => { if (!writing) render(); });
          mo.observe(root, { attributes: true, attributeFilter: ['style', 'data-fullscreen', 'data-windows-titlebar'] });
          render();
          const u1 = store.subscribe(render);
          const u2 = liveHeight.subscribe(render);
          const u3 = titlebarCell.subscribe(render);
          return () => {
            u1(); u2(); u3(); mo.disconnect();
            if (applied !== null && titlebarAvailable()) root.style.setProperty(TB_VAR, '40px');
          };
        }, 'multi-session: title bar height');

        // ---------------- bottom panel visibility
        ctx.effect(() => {
          const el = document.createElement('style');
          el.setAttribute('data-dsh-multi-session-dynamic', '');
          document.head.appendChild(el);
          let last = '';
          const render = () => {
            const css = store.get().bottomHidden ? '[data-shell-bottom]{display:none !important}' : '';
            if (css !== last) { last = css; el.textContent = css; }
          };
          render();
          const u = store.subscribe(render);
          return () => { u(); el.remove(); };
        }, 'multi-session: bottom panel');

        // ---------------- shared, cheap environment probes (one timer for the whole plugin)
        const rightbarCell = createCell(false);
        const bottomCell = createCell(false);
        const probe = () => {
          const rs = optional('sidebarRight');
          try { rightbarCell.set(!!(rs && rs.isExpanded())); } catch (_) { rightbarCell.set(false); }
          const row = document.querySelector('[data-shell-bottom]');
          bottomCell.set(!!(row && row.childElementCount > 0));
        };
        ctx.effect(() => {
          let timer = null;
          const start = () => { if (timer === null && document.visibilityState === 'visible') timer = setInterval(probe, 1000); };
          const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
          const onVis = () => { if (document.visibilityState === 'visible') { probe(); start(); } else stop(); };
          document.addEventListener('visibilitychange', onVis);
          const rs = optional('sidebarRight');
          let un = () => {};
          try { if (rs && rs.mounted && rs.mounted.subscribe) un = rs.mounted.subscribe(probe); } catch (_) { /* ignore */ }
          probe(); start();
          return () => { stop(); un(); document.removeEventListener('visibilitychange', onVis); };
        }, 'multi-session: environment probe');

        // ---------------- tab helpers
        const visibleTabs = (list, st) => {
          const s = st || store.get();
          return list && list.byId ? s.tabs.filter((id) => list.byId[id]) : [];
        };
        const pinnedCount = (st) => st.pinned.length;
        const normalizeOrder = (s) => {
          const pinned = new Set(s.pinned);
          const tabs = [...s.tabs.filter((id) => pinned.has(id)), ...s.tabs.filter((id) => !pinned.has(id))];
          return { ...s, tabs, pinned: tabs.filter((id) => pinned.has(id)) };
        };

        const workspaceOf = (sessionId) => {
          const ws = optional('workspaces');
          try {
            const items = ws && ws.list && ws.list.getSnapshot().items;
            const hit = items && items.find((w) => w.sessionIds && w.sessionIds.includes(sessionId));
            if (hit) return hit.workspaceId;
          } catch (_) { /* fall through */ }
          return undefined;
        };

        // ---------------- actions
        const actions = {
          current: () => currentOf(listSnap()),
          activate(id) {
            try {
              const panel = ctx.layout.panelInfo && ctx.layout.panelInfo.getSnapshot();
              if (panel && panel.activePanelId !== null) ctx.layout.selectPanel(null);
            } catch (_) { /* layout optional */ }
            if (actions.current() === id) return;
            ctx.uiWorkspace.openSession(id);
          },
          newSession(fromId) {
            const base = fromId || actions.current();
            const ws = base ? workspaceOf(base) : undefined;
            try { ctx.layout.selectPanel(null); } catch (_) { /* ignore */ }
            ctx.uiWorkspace.startSession(ws);
          },
          close(ids) {
            const list = listSnap();
            const cur = currentOf(list);
            const s0 = store.get();
            const closing = new Set(ids.filter((id) => s0.tabs.includes(id)));
            if (!closing.size) return;
            let fallback;
            if (cur && closing.has(cur)) {
              // go back to the most recently activated tab that survives
              const pool = visibleTabs(list, s0).filter((id) => !closing.has(id));
              let best = -1;
              for (const id of pool) {
                const at = s0.seen[id] || 0;
                if (at > best) { best = at; fallback = id; }
              }
            }
            const now = Date.now();
            const records = [...closing].map((id) => ({ id, title: titleOf(list && list.byId && list.byId[id], t), index: s0.tabs.indexOf(id), at: now, pinned: s0.pinned.includes(id) }));
            store.set((s) => {
              const seen = { ...s.seen };
              for (const id of closing) delete seen[id];
              const closed = [...records.reverse(), ...s.closed.filter((c) => !closing.has(c.id))].slice(0, MAX_CLOSED);
              return { ...s, tabs: s.tabs.filter((id) => !closing.has(id)), pinned: s.pinned.filter((id) => !closing.has(id)), seen, closed };
            });
            if (cur && closing.has(cur)) {
              if (fallback) actions.activate(fallback);
              else actions.newSession(cur);
            }
          },
          closeOthers(id) { const s = store.get(); actions.close(s.tabs.filter((x) => x !== id && !s.pinned.includes(x))); },
          closeRight(id) { const s = store.get(); actions.close(s.tabs.slice(s.tabs.indexOf(id) + 1).filter((x) => !s.pinned.includes(x))); },
          reopen(targetId) {
            const list = listSnap();
            const s0 = store.get();
            const pool = targetId ? s0.closed.filter((c) => c.id === targetId) : s0.closed;
            const rec = pool.find((c) => list && list.byId && list.byId[c.id]);
            if (!rec) {
              if (pool.length) store.set((s) => ({ ...s, closed: s.closed.filter((c) => !pool.includes(c)) }));
              return false;
            }
            const skipped = new Set();
            for (const c of pool) { if (c === rec) break; skipped.add(c); }
            store.set((s) => {
              const tabs = s.tabs.filter((x) => x !== rec.id);
              tabs.splice(Math.min(rec.index, tabs.length), 0, rec.id);
              const pinned = rec.pinned ? [...s.pinned, rec.id] : s.pinned;
              return normalizeOrder({ ...s, tabs, pinned, seen: { ...s.seen, [rec.id]: Date.now() }, closed: s.closed.filter((c) => c.id !== rec.id && !skipped.has(c)) });
            });
            actions.activate(rec.id);
            return true;
          },
          clearClosed() { store.set((s) => ({ ...s, closed: [] })); },
          reorder(id, toIndex) {
            store.set((s) => {
              const from = s.tabs.indexOf(id);
              if (from < 0) return s;
              const pc = pinnedCount(s);
              const isPinned = s.pinned.includes(id);
              // tabs stay inside their own group
              const lo = isPinned ? 0 : pc;
              const hi = isPinned ? pc - 1 : s.tabs.length - 1;
              const to = Math.max(lo, Math.min(hi, toIndex));
              if (to === from) return s;
              const tabs = move(s.tabs, from, to);
              return { ...s, tabs, pinned: tabs.filter((x) => s.pinned.includes(x)) };
            });
          },
          // move by one visible neighbour (hidden tabs of offline workspaces are skipped)
          shiftTab(id, delta) {
            const list = listSnap();
            const s = store.get();
            const vis = visibleTabs(list, s);
            const i = vis.indexOf(id);
            const neighbour = vis[i + delta];
            if (i < 0 || !neighbour) return;
            if (s.pinned.includes(id) !== s.pinned.includes(neighbour)) return;
            actions.reorder(id, s.tabs.indexOf(neighbour));
          },
          togglePin(id) {
            store.set((s) => {
              if (!s.tabs.includes(id)) return s;
              const isPinned = s.pinned.includes(id);
              const rest = s.tabs.filter((x) => x !== id);
              const pinned = isPinned ? s.pinned.filter((x) => x !== id) : [...s.pinned, id];
              const pc = pinned.length;
              // pinning appends to the pinned group; unpinning puts the tab right after it
              rest.splice(isPinned ? pc : pc - 1, 0, id);
              return normalizeOrder({ ...s, tabs: rest, pinned });
            });
          },
          step(delta) {
            const vis = visibleTabs(listSnap());
            if (!vis.length) return;
            const i = vis.indexOf(actions.current());
            actions.activate(vis[((i < 0 ? 0 : i + delta) % vis.length + vis.length) % vis.length]);
          },
          jump(n) {
            const vis = visibleTabs(listSnap());
            const id = n >= 9 ? vis[vis.length - 1] : vis[n - 1];
            if (id) actions.activate(id);
          },
          async rename(id, title) {
            const value = title.trim();
            if (!value) return { ok: true };
            const result = await sessions.using(id, { source: 'workspaceOperation' }, (reference) => reference.binding.session.rename(value));
            if (result && result.ok === false) return { ok: false, error: result.error };
            return { ok: true };
          },
          setPlacement(p) { const r = runtimeOf(); store.set((s) => ({ ...s, placement: { ...s.placement, [r]: p } })); },
          setTitlebarHeight(v) { store.set((s) => ({ ...s, titlebarHeight: v == null ? null : clampTb(v) })); },
          setBarHeight(v) { store.set((s) => ({ ...s, barHeight: v == null ? null : clampBar(v) })); },
          setOverflow(v) { store.set((s) => ({ ...s, overflow: v === 'shrink' ? 'shrink' : 'scroll' })); },
          toggleBottom() { store.set((s) => ({ ...s, bottomHidden: !s.bottomHidden })); },
          toggleRightbar() {
            const rs = optional('sidebarRight');
            if (!rs) return;
            try { rs.toggleExpanded(); } catch (_) { /* ignore */ }
            probe();
          },
        };

        // ---------------- sync: follow the main view and keep tabs warm
        let lastCurrent;
        let lastActiveTab;
        const refs = new Map();
        const failed = new Map(); // id -> time of failure
        let scheduled = false;
        let disposed = false;

        const followMainView = () => {
          const list = listSnap();
          if (!list) return;
          const cur = currentOf(list);
          if (cur === lastCurrent) return;
          const prev = lastActiveTab;
          lastCurrent = cur;
          if (!cur) return;
          lastActiveTab = cur;
          store.set((s) => {
            const seen = { ...s.seen, [cur]: Date.now() };
            if (s.tabs.includes(cur)) return { ...s, seen, current: cur };
            const tabs = s.tabs.slice();
            const at = prev ? tabs.indexOf(prev) : -1;
            const minIndex = pinnedCount(s); // new tabs never land inside the pinned group
            tabs.splice(Math.max(minIndex, at + 1), 0, cur);
            // cap remembered tabs: drop the stalest non-pinned, non-current ones
            while (tabs.length > MAX_TABS) {
              let victim; let oldest = Infinity;
              for (const id of tabs) {
                if (id === cur || s.pinned.includes(id)) continue;
                const v = seen[id] || 0;
                if (v < oldest) { oldest = v; victim = id; }
              }
              if (!victim) break;
              tabs.splice(tabs.indexOf(victim), 1);
              delete seen[victim];
            }
            return { ...s, tabs, seen, current: cur, closed: s.closed.filter((c) => c.id !== cur) };
          });
        };

        const reconcile = () => {
          scheduled = false;
          if (disposed) return;
          const list = listSnap();
          if (!list || !list.byId) return;
          const s = store.get();
          const cur = currentOf(list);
          const now = Date.now();
          for (const [id, at] of [...failed]) if (now - at > RETRY_FAILED_MS || !s.tabs.includes(id)) failed.delete(id);
          const busy = (id) => (list.byId[id] && list.byId[id].running ? 1 : 0);
          const want = new Set();
          if (cur && list.byId[cur]) want.add(cur); // bridges the hand-off when switching away
          const cands = [];
          for (const id of s.tabs) {
            if (id === cur || !list.byId[id] || failed.has(id)) continue;
            if (busy(id) || s.pinned.includes(id)) want.add(id); // running work and pinned tabs are always warm
            else cands.push(id);
          }
          cands.sort((a, b) => (s.seen[b] || 0) - (s.seen[a] || 0));
          for (const id of cands.slice(0, MAX_WARM)) want.add(id);
          let changed = false;
          const nextWarm = new Map(warm.get());
          for (const [id, ref] of [...refs]) {
            if (want.has(id)) continue;
            refs.delete(id);
            nextWarm.delete(id);
            changed = true;
            try { ref.release(); } catch (_) { /* already released */ }
          }
          for (const id of want) {
            if (refs.has(id)) continue;
            let ref;
            try { ref = sessions.retain(id, { source: RETAIN_SOURCE }); } catch (_) { failed.set(id, now); continue; }
            refs.set(id, ref);
            nextWarm.set(id, 'pending');
            changed = true;
            Promise.resolve(ref.ready).then(() => {
              if (disposed || refs.get(id) !== ref) return;
              const m = new Map(warm.get()); m.set(id, 'ready'); warm.set(m);
            }, () => {
              if (disposed || refs.get(id) !== ref) return;
              failed.set(id, Date.now());
              refs.delete(id);
              try { ref.release(); } catch (_) { /* ignore */ }
              const m = new Map(warm.get()); m.delete(id); warm.set(m);
            });
          }
          if (changed) warm.set(nextWarm);
        };
        const schedule = () => { if (!scheduled && !disposed) { scheduled = true; queueMicrotask(reconcile); } };

        ctx.effect(() => {
          // Only membership/running/current matter for warmth; skip reconcile for unrelated churn (e.g. updatedAt ticks).
          let lastSig = '';
          const signature = () => {
            const list = listSnap();
            if (!list || !list.byId) return '';
            const s = store.get();
            let sig = `${currentOf(list) || ''}|`;
            for (const id of s.tabs) { const x = list.byId[id]; sig += x ? (x.running ? 'r' : 'i') : '-'; }
            return sig;
          };
          // After a reload the host may reopen whichever session was opened last in *any* browser
          // tab; put this tab back on the session it was showing. One attempt, early in the run only.
          let restoreId = store.source === 'session' ? store.get().current : null;
          const restoreDeadline = Date.now() + 8000;
          const tryRestore = () => {
            if (!restoreId) return false;
            if (Date.now() > restoreDeadline) { restoreId = null; return false; }
            const list = listSnap();
            if (!list || !list.byId) return true; // still loading: hold followMainView
            if (!list.byId[restoreId]) {
              // catalog not loaded yet, or the session is gone
              if (list.phase === 'ready' || (list.ids && list.ids.length)) restoreId = null;
              return !!restoreId;
            }
            const cur = currentOf(list);
            if (cur === restoreId) { restoreId = null; return false; }
            if (!cur) return true; // wait for the host to settle its own choice first
            const id = restoreId;
            restoreId = null;
            actions.activate(id);
            return true;
          };
          const onList = () => {
            if (tryRestore()) return;
            followMainView();
            const sig = signature();
            if (sig !== lastSig) { lastSig = sig; schedule(); }
          };
          let un1 = () => {};
          try { un1 = sessions.list.subscribe(onList); } catch (_) { /* no list */ }
          const un2 = store.subscribe(() => { lastSig = ''; onList(); });
          const retry = setInterval(() => { if (failed.size) schedule(); }, RETRY_FAILED_MS);
          const restoreTimeout = restoreId ? setTimeout(onList, 8100) : null;
          onList();
          return () => {
            disposed = true;
            un1(); un2(); clearInterval(retry); if (restoreTimeout) clearTimeout(restoreTimeout);
            store.flush();
            for (const ref of refs.values()) { try { ref.release(); } catch (_) { /* ignore */ } }
            refs.clear();
          };
        }, 'multi-session: follow main view and keep tabs warm');

        // ---------------- several browser tabs: presence heartbeat + live preference sync
        ctx.effect(() => {
          if (!local) return undefined;
          let predecessor = store.inherited; // this same browser tab's previous document, if it never said goodbye
          const beat = (remove) => {
            const map = readJson(local, ALIVE_KEY);
            const next = {};
            const now = Date.now();
            if (isObj(map)) for (const id of Object.keys(map)) if (typeof map[id] === 'number' && now - map[id] < OPEN_KEEP_MS) next[id] = map[id];
            if (predecessor) { delete next[predecessor]; predecessor = null; }
            if (remove) delete next[PAGE_ID]; else next[PAGE_ID] = now;
            writeJson(local, ALIVE_KEY, next);
          };
          const onStorage = (e) => {
            if (e.storageArea !== local || e.key !== PREFS_KEY || !e.newValue) return;
            try { store.adoptPrefs(JSON.parse(e.newValue)); } catch (_) { /* ignore malformed */ }
          };
          const onHide = () => { store.flush(); beat(true); };
          const onShow = () => beat(false);
          beat(false);
          const timer = setInterval(() => beat(false), ALIVE_BEAT_MS);
          window.addEventListener('storage', onStorage);
          window.addEventListener('pagehide', onHide);
          window.addEventListener('pageshow', onShow);
          return () => {
            clearInterval(timer);
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('pagehide', onHide);
            window.removeEventListener('pageshow', onShow);
            beat(true);
          };
        }, 'multi-session: browser tab presence');

        // ---------------- keyboard
        // Fixed keys handled locally: the shortcut registry rejects Alt+Shift defaults on Web and
        // drops every default of a command when any profile is rejected, so these never fired.
        ctx.effect(() => {
          const onKey = (e) => {
            if (e.defaultPrevented || e.isComposing || e.repeat && !/^Arrow/.test(e.code)) return;
            if (e.ctrlKey || e.metaKey) return;
            const target = e.target;
            const inStrip = target && target.closest && target.closest('.dms-strip,.dms-menu');
            if (inStrip) return; // the strip handles its own keys
            if (modalOpen()) return;
            const code = e.code;
            if (e.altKey && e.shiftKey) {
              let run = null;
              if (code === 'ArrowRight') run = () => actions.step(1);
              else if (code === 'ArrowLeft') run = () => actions.step(-1);
              else if (/^Digit[1-9]$/.test(code)) { const n = Number(code.slice(5)); run = () => actions.jump(n); }
              else if (code === 'KeyW') run = () => { const c = actions.current(); if (c) actions.close([c]); };
              else if (code === 'KeyT') run = () => actions.reopen();
              else if (code === 'KeyN') run = () => actions.newSession();
              if (!run) return;
              e.preventDefault();
              e.stopPropagation();
              run();
              return;
            }
            if (e.shiftKey && !e.altKey && (code === 'ArrowRight' || code === 'ArrowLeft')) {
              if (isTypingTarget(target) || isTypingTarget(document.activeElement)) return;
              const sel = window.getSelection && window.getSelection();
              if (sel && sel.type === 'Range') return; // let Shift+Arrow extend a text selection
              if (target && target.closest && target.closest('[role=listbox],[role=menu],[role=tree],[role=grid],[role=slider],[role=tablist],[role=radiogroup]')) return;
              const c = actions.current();
              if (!c || !store.get().tabs.includes(c)) return;
              e.preventDefault();
              e.stopPropagation();
              actions.shiftTab(c, code === 'ArrowRight' ? 1 : -1);
            }
          };
          window.addEventListener('keydown', onKey, true);
          return () => window.removeEventListener('keydown', onKey, true);
        }, 'multi-session: keyboard');

        // ---------------- React glue
        const useCell = (cell) => useSyncExternalStore(cell.subscribe, cell.get, cell.get);
        const useStoreState = () => useSyncExternalStore(store.subscribe, store.get, store.get);
        const localeSub = typeof ctx.locale.subscribe === 'function' ? (f) => ctx.locale.subscribe(f) : () => () => {};
        const localeGet = typeof ctx.locale.getSnapshot === 'function' ? () => ctx.locale.getSnapshot() : () => 0;
        const useLocaleTick = () => useSyncExternalStore(localeSub, localeGet, localeGet);

        function Menu({ x, y, onClose, children, label }) {
          const ref = useRef(null);
          const [pos, setPos] = useState({ left: x, top: y, visibility: 'hidden' });
          useLayoutEffect(() => {
            const el = ref.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            // A transformed/contained ancestor becomes the containing block of a fixed element and
            // shifts it away from the pointer; measure that offset and compensate for it.
            const dx = r.left - x;
            const dy = r.top - y;
            const flipX = x + r.width > window.innerWidth - 6;
            const flipY = y + r.height > window.innerHeight - 6;
            const vx = flipX ? Math.max(6, window.innerWidth - r.width - 6) : x;
            const vy = flipY ? Math.max(6, y - r.height) : y;
            setPos({ left: vx - dx, top: vy - dy, '--dms-origin': `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}` });
            const first = el.querySelector('.dms-mi:not(:disabled)');
            if (first) first.focus({ preventScroll: true });
          }, [x, y]);
          useEffect(() => {
            const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
            const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
            const blur = () => onClose();
            window.addEventListener('pointerdown', down, true);
            window.addEventListener('keydown', key, true);
            window.addEventListener('blur', blur);
            window.addEventListener('resize', blur);
            return () => {
              window.removeEventListener('pointerdown', down, true);
              window.removeEventListener('keydown', key, true);
              window.removeEventListener('blur', blur);
              window.removeEventListener('resize', blur);
            };
          }, [onClose]);
          const onKeyDown = (e) => {
            const items = [...ref.current.querySelectorAll('.dms-mi:not(:disabled)')];
            const i = items.indexOf(document.activeElement);
            if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
            else if (e.key === 'Home') { e.preventDefault(); if (items[0]) items[0].focus(); }
            else if (e.key === 'End') { e.preventDefault(); if (items.length) items[items.length - 1].focus(); }
            else if (e.key === 'Tab') { e.preventDefault(); onClose(); }
          };
          // Rendered in place (not portalled) so theme tokens scoped to the app container still apply.
          return h('div', { ref, className: 'dms-menu', role: 'menu', 'aria-label': label, style: pos, onKeyDown, onContextMenu: (e) => e.preventDefault() }, children);
        }
        const MenuItem = ({ label, hint, onSelect, disabled, checked, close, role }) => h('button', {
          type: 'button', className: 'dms-mi', role: role || 'menuitem', disabled: !!disabled,
          'aria-checked': role === 'menuitemradio' ? !!checked : undefined,
          onClick: () => { close(); if (!disabled) onSelect(); },
        }, role === 'menuitemradio' ? h('span', { className: 'dms-mi-c' }, checked ? h(Icon.check) : null) : null,
        h('span', { className: 'dms-mi-l' }, label), hint ? h('span', { className: 'dms-mi-k' }, hint) : null);
        const Sep = () => h('div', { className: 'dms-ms', role: 'separator' });
        const Head = ({ children }) => h('div', { className: 'dms-mh', role: 'presentation' }, children);

        function statusOf(id, summary, st, warmMap, isCurrent, ignoreUnread) {
          if (st && st.pendingInteraction) return 'awaiting';
          const running = st && st.running !== undefined ? st.running : (summary && summary.running);
          if (running) return 'running';
          if (st && st.completionUnread && !ignoreUnread) return 'unread';
          const w = warmMap.get(id);
          if ((isCurrent || w === 'pending') && st && st.running === undefined && w !== 'ready') return 'connecting';
          if (!isCurrent && !w) return 'cold';
          return 'idle';
        }
        const statusLabel = { awaiting: 'stAwaiting', running: 'stRunning', unread: 'stUnread', connecting: 'stConnecting', idle: 'stIdle', cold: 'stCold' };

        // marquee: reveal the full title on hover by scrolling the text, only when it overflows
        const startMarquee = (tabEl) => {
          const label = tabEl.querySelector('.dms-label');
          const inner = label && label.firstElementChild;
          if (!inner) return;
          if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
          // The inner span is inline, whose scrollWidth is always 0; measure the clipping box instead.
          const overflow = label.scrollWidth - label.clientWidth;
          if (overflow <= 2) return;
          const shift = overflow + 10;
          tabEl.style.setProperty('--dms-shift', `${-shift}px`);
          tabEl.style.setProperty('--dms-dur', `${Math.max(1.6, shift / 38).toFixed(2)}s`);
          tabEl.setAttribute('data-marquee', '');
        };
        const stopMarquee = (tabEl) => { tabEl.removeAttribute('data-marquee'); };

        const Tab = memo(function Tab(p) {
          const { id, index, title, state, selected, focusable, pinned, renaming, draft, dropSide, dragging, renameError, cwd, api } = p;
          const tip = [title, p.pinnedLabel, p.stateLabel, cwd].filter(Boolean).join('\n');
          return h('div', {
            'data-id': id,
            className: 'dms-tab',
            role: 'tab',
            'aria-selected': selected,
            'aria-label': `${title}, ${p.stateLabel}`,
            tabIndex: focusable ? 0 : -1,
            title: renameError ? `${p.renameFailedLabel}\n${tip}` : tip,
            'data-state': state,
            'data-cold': state === 'cold',
            'data-pinned': pinned || undefined,
            'data-dragging': dragging || undefined,
            'data-drop': dropSide,
            onClick: () => { if (!renaming) api.current.activate(id); },
            onDoubleClick: (e) => { e.preventDefault(); api.current.startRename(id); },
            onAuxClick: (e) => { if (e.button === 1) { e.preventDefault(); if (!pinned) api.current.close(id); } },
            onMouseDown: (e) => { if (e.button === 1) e.preventDefault(); },
            onMouseEnter: (e) => { if (!renaming) startMarquee(e.currentTarget); },
            onMouseLeave: (e) => stopMarquee(e.currentTarget),
            onContextMenu: (e) => api.current.openMenuAt('tab', id, e.currentTarget, e),
            onKeyDown: (e) => api.current.onTabKeyDown(e, id),
            draggable: !renaming,
            onDragStart: (e) => api.current.dragStart(e, id),
            onDragOver: (e) => api.current.dragOver(e, id),
            onDrop: (e) => api.current.drop(e, id),
            onDragEnd: () => api.current.dragEnd(),
          },
          h('span', { className: 'dms-sig', 'data-state': state, 'aria-hidden': true }, h('i'), h('i'), h('i')),
          renaming
            ? h('input', {
              className: 'dms-input', value: draft, autoFocus: true, 'aria-label': p.renameLabel, spellCheck: false,
              onChange: (e) => api.current.setDraft(e.target.value),
              onFocus: (e) => e.target.select(),
              onBlur: () => api.current.commitRename(),
              onClick: (e) => e.stopPropagation(),
              onDoubleClick: (e) => e.stopPropagation(),
              onKeyDown: (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                else if (e.key === 'Escape') { e.preventDefault(); api.current.cancelRename(id); }
              },
            })
            : h('span', { className: 'dms-label' }, h('span', null, title)),
          index < 9 && !renaming ? h('span', { className: 'dms-key', 'aria-hidden': true }, String(index + 1)) : null,
          pinned
            ? h('button', {
              type: 'button', className: 'dms-x dms-unpin', tabIndex: -1, 'aria-label': p.unpinLabel, title: p.unpinLabel, draggable: false,
              onClick: (e) => { e.stopPropagation(); api.current.togglePin(id); },
              onDoubleClick: (e) => e.stopPropagation(),
            }, h(Icon.pin))
            : null,
          h('button', {
            type: 'button', className: 'dms-x', tabIndex: -1, 'aria-label': p.closeLabel, title: p.closeLabel, draggable: false,
            onClick: (e) => { e.stopPropagation(); api.current.close(id); },
            onDoubleClick: (e) => e.stopPropagation(),
          }, h(Icon.close)),
          // active underline lives inside the selected tab, so it can never drift away from it
          selected ? h('span', { className: 'dms-line', 'aria-hidden': true }) : null);
        });

        // left edge in the title bar: after the Desktop-owned menu, measured by hit-testing the caption row
        // The Desktop preload mounts its menubar as a shadow host `[data-windows-menu]` (应用 / 编辑 / 查看 / 窗口).
        const desktopMenu = () => document.querySelector('[data-windows-menu]');
        function measureMenuEnd(stripEl) {
          const menuHost = desktopMenu();
          if (menuHost) {
            const r = menuHost.getBoundingClientRect();
            if (r.width > 0 && r.right > 0) return Math.round(r.right) + 12;
          }
          const rootStyle = getComputedStyle(document.documentElement);
          const tbH = parseFloat(rootStyle.getPropertyValue('--dsh-windows-titlebar-height')) || 40;
          const start = parseFloat(rootStyle.getPropertyValue('--dsh-windows-menu-start')) || 48;
          const y = Math.round(tbH / 2);
          let end = start;
          const limit = Math.min(window.innerWidth / 2, start + 520);
          for (let x = start; x < limit; x += 10) {
            for (const el of document.elementsFromPoint(x, y)) {
              if (el === document.documentElement || el === document.body) continue;
              if (stripEl && stripEl.contains(el)) continue;
              const r = el.getBoundingClientRect();
              if (r.height > tbH + 1 || r.top < -1 || r.width > 320) continue; // columns, frame, large layers
              if (r.right > end) end = r.right;
              break;
            }
          }
          return Math.round(end) + 12;
        }

        // bottom-edge resize handle; drives the title bar in the caption row, the bar itself below the header
        function HeightGrip({ host }) {
          const [active, setActive] = useState(false);
          const startRef = useRef(null);
          const titlebar = host === 'overlay';
          const onPointerDown = (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const st = store.get();
            const cur = titlebar
              ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-windows-titlebar-height')) || TB_DEFAULT)
              : (st.barHeight != null ? st.barHeight : BAR_DEFAULT);
            startRef.current = { y: e.clientY, h: cur };
            e.currentTarget.setPointerCapture(e.pointerId);
            setActive(true);
          };
          const onPointerMove = (e) => {
            if (!startRef.current) return;
            const v = startRef.current.h + (e.clientY - startRef.current.y);
            if (titlebar) liveHeight.set(clampTb(v)); else liveBar.set(clampBar(v));
          };
          const end = () => {
            if (!startRef.current) return;
            startRef.current = null;
            setActive(false);
            const cell = titlebar ? liveHeight : liveBar;
            const v = cell.get();
            if (v != null) { if (titlebar) actions.setTitlebarHeight(v); else actions.setBarHeight(v); }
            cell.set(null);
          };
          return h('div', {
            className: 'dms-grip', 'data-active': active ? '' : undefined, title: t(titlebar ? 'tbDragHint' : 'barDragHint'), 'aria-hidden': true,
            onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end,
            onDoubleClick: () => (titlebar ? actions.setTitlebarHeight(null) : actions.setBarHeight(null)),
          });
        }

        function TabBar({ host, list, statusMap, panelNull, placement, hasTitlebar }) {
          const st = useStoreState();
          const warmMap = useCell(warm);
          const liveBarH = useCell(liveBar);
          const barH = liveBarH != null ? liveBarH : (st.barHeight != null ? st.barHeight : BAR_DEFAULT);
          const rightbarExpanded = useCell(rightbarCell);
          const bottomPresent = useCell(bottomCell);
          const rs = optional('sidebarRight');
          const rsSub = useCallback((f) => (rs && rs.mounted && rs.mounted.subscribe ? rs.mounted.subscribe(f) : () => {}), [rs]);
          const rsGet = useCallback(() => (rs && rs.mounted && rs.mounted.getSnapshot ? rs.mounted.getSnapshot() : undefined), [rs]);
          const rightbarMounted = useSyncExternalStore(rsSub, rsGet, rsGet);
          const [menu, setMenu] = useState(null);
          const [renaming, setRenaming] = useState(null);
          const [draft, setDraft] = useState('');
          const [overrides, setOverrides] = useState({});
          const [renameError, setRenameError] = useState(null);
          const [drag, setDrag] = useState(null); // { id, over, side }
          const stripRef = useRef(null);
          const scrollRef = useRef(null);
          const tabsRef = useRef(null);
          const closeMenu = useCallback(() => setMenu(null), []);

          const cur = currentOf(list);
          const tabs = visibleTabs(list, st);
          const pinnedSet = new Set(st.pinned);
          const activeId = panelNull ? cur : undefined;
          // publish the most urgent status across the whole tab bar for the browser tab icon
          const unseen = useCell(unseenDone);
          const readMap = useCell(readShared);
          const pendingMap = useCell(pendingShared);
          const RANK = { awaiting: 4, running: 3, unread: 2, connecting: 1 };
          const states = new Map();
          const unreadCandidates = new Set(); // shown as unread before cross-page read facts are applied
          const readElsewhere = new Set();    // unread here, but some page has shown it since the run ended
          let curState = null;
          if (list.byId) {
            const nowMs = Date.now();
            // pending interactions published by other live pages (this page's own come from the host directly)
            let remotePending = null;
            const pendingIds = Object.keys(pendingMap);
            if (pendingIds.length) {
              const alive = alivePages();
              remotePending = new Set(pendingIds.filter((pid) => {
                const e = pendingMap[pid];
                return isObj(e) && e.page !== PAGE_ID && alive.has(e.page);
              }));
            }
            for (const id of tabs) {
              const summary = list.byId[id];
              const status = statusMap.get(id);
              let s = statusOf(id, summary, status, warmMap, id === cur);
              const running = status && status.running !== undefined ? status.running : (summary && summary.running);
              // a tab this page has not loaded yet cannot see its pending interaction; another page may
              if (s !== 'awaiting' && running && remotePending && remotePending.has(id)) s = 'awaiting';
              if (unseen.has(id) && s !== 'awaiting' && s !== 'running') s = 'unread';
              if (s === 'unread') {
                unreadCandidates.add(id);
                const since = unreadSince.has(id) ? unreadSince.get(id) : nowMs;
                if ((readMap[id] || 0) >= since - READ_SKEW_MS) {
                  readElsewhere.add(id);
                  s = statusOf(id, summary, status, warmMap, id === cur, true);
                }
              }
              states.set(id, s);
              if ((RANK[s] || 0) > (RANK[curState] || 0)) curState = s;
            }
          }
          const readShowKey = useRef(null);
          useEffect(() => {
            const prev = lastStates.map;
            lastStates.map = new Map([...prev, ...states]);
            for (const id of [...lastStates.map.keys()]) if (!list.byId || !list.byId[id]) lastStates.map.delete(id);
            const hidden = typeof document !== 'undefined' && document.hidden;
            let next = null;
            for (const [id, s] of states) {
              const was = prev.get(id);
              const busy = s === 'running' || s === 'awaiting';
              if ((busy || readElsewhere.has(id)) && unseen.has(id)) { next = next || new Set(unseen); next.delete(id); }
              else if (hidden && !busy && (was === 'running' || was === 'awaiting') && !unseen.has(id)) { next = next || new Set(unseen); next.add(id); }
            }
            if (next) unseenDone.set(next);
            const now = Date.now();
            for (const id of unreadCandidates) if (!unreadSince.has(id)) unreadSince.set(id, now);
            for (const id of [...unreadSince.keys()]) if (!unreadCandidates.has(id)) unreadSince.delete(id);
            // looking at the current session in a visible page counts as reading it, for every page
            const curWas = cur ? prev.get(cur) : undefined;
            const curNow = cur ? states.get(cur) : undefined;
            const curEnded = (curWas === 'running' || curWas === 'awaiting') && curNow !== 'running' && curNow !== 'awaiting';
            if (cur && !hidden && panelNull && (curEnded || readShowKey.current !== cur)) { readShowKey.current = cur; noteRead(cur); }
            if (hidden) readShowKey.current = null;
          });
          useEffect(() => {
            if (typeof document.addEventListener !== 'function') return undefined;
            const onVis = () => {
              if (document.hidden) return;
              const c = currentOf(listSnap());
              if (c) { readShowKey.current = c; noteRead(c); }
            };
            document.addEventListener('visibilitychange', onVis);
            return () => document.removeEventListener('visibilitychange', onVis);
          }, []);
          // publish the sessions this page knows are waiting for an answer
          const pendingKey = [...statusMap].filter(([, v]) => v && v.pendingInteraction).map(([k]) => k).sort().join('|');
          useEffect(() => { writePendingFacts(pendingKey ? pendingKey.split('|') : []); }, [pendingKey]);
          useEffect(() => {
            const cs = stripRef.current ? getComputedStyle(stripRef.current) : null;
            const accent = cs ? cs.getPropertyValue('--dms-accent').trim() : '';
            const warn = cs ? cs.getPropertyValue('--dms-warn').trim() : '';
            const prev = tabSignal.get();
            if (!curState) { if (prev) tabSignal.set(null); return; }
            if (!prev || prev.state !== curState || prev.accent !== accent || prev.warn !== warn) tabSignal.set({ state: curState, accent, warn });
          });
          useEffect(() => () => tabSignal.set(null), []);

          // title-bar placement: start after the native menu
          useLayoutEffect(() => {
            if (host !== 'overlay') return undefined;
            let raf = 0;
            const measure = () => {
              cancelAnimationFrame(raf);
              raf = requestAnimationFrame(() => {
                const el = stripRef.current;
                if (el) el.style.setProperty('--dms-menu-end', `${measureMenuEnd(el)}px`);
              });
            };
            // the menu mounts after us, and its width changes with the language and once the font loads
            let ro = null; let watched = null;
            const watchMenu = () => {
              const m = desktopMenu();
              if (m === watched) return;
              if (ro) ro.disconnect();
              watched = m;
              if (m && typeof ResizeObserver === 'function') { ro = new ResizeObserver(measure); ro.observe(m); }
              measure();
            };
            measure();
            watchMenu();
            const late = setTimeout(watchMenu, 600);
            const mo = new MutationObserver(measure);
            mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-fullscreen', 'lang'] });
            const mount = new MutationObserver(watchMenu);
            if (document.body) mount.observe(document.body, { childList: true });
            mount.observe(document.documentElement, { childList: true });
            // collapsing the sidebar moves the menu right (--dsh-windows-menu-start via :has), without a size change
            const side = new MutationObserver(measure);
            if (document.body) side.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-sidebar-collapsed'] });
            window.addEventListener('resize', measure);
            let fontsOff = () => {};
            try { const f = document.fonts; if (f && f.addEventListener) { f.addEventListener('loadingdone', measure); fontsOff = () => f.removeEventListener('loadingdone', measure); } } catch (_) { /* no font events */ }
            return () => { cancelAnimationFrame(raf); clearTimeout(late); mo.disconnect(); mount.disconnect(); side.disconnect(); if (ro) ro.disconnect(); fontsOff(); window.removeEventListener('resize', measure); };
          }, [host]);

          // overflow fades; written straight to the DOM to avoid re-rendering on scroll
          const syncGeometry = useCallback(() => {
            const sc = scrollRef.current;
            if (sc) {
              const f = [];
              if (sc.scrollLeft > 2) f.push('l');
              if (sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 2) f.push('r');
              const v = f.join(' ');
              if ((sc.getAttribute('data-fade') || '') !== v) { if (v) sc.setAttribute('data-fade', v); else sc.removeAttribute('data-fade'); }
            }
          }, []);
          const layoutKey = `${tabs.join('|')}#${st.pinned.join('|')}#${renaming || ''}#${Object.keys(overrides).length}`;
          useLayoutEffect(() => { syncGeometry(); }, [syncGeometry, layoutKey]);
          useEffect(() => {
            const el = activeId && tabsRef.current ? tabsRef.current.querySelector(`[data-id="${cssEscape(activeId)}"]`) : null;
            if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }, [activeId]);
          useEffect(() => {
            if (typeof ResizeObserver !== 'function') return undefined;
            let raf = 0;
            const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(syncGeometry); });
            if (scrollRef.current) ro.observe(scrollRef.current);
            if (tabsRef.current) ro.observe(tabsRef.current);
            return () => { cancelAnimationFrame(raf); ro.disconnect(); };
          }, [syncGeometry]);
          // drop optimistic titles once the catalog catches up
          useEffect(() => {
            const keys = Object.keys(overrides);
            if (!keys.length) return;
            const stale = keys.filter((id) => { const s = list.byId[id]; return !s || (s.title && s.title.trim() === overrides[id]); });
            if (stale.length) setOverrides((o) => { const n = { ...o }; for (const id of stale) delete n[id]; return n; });
          }, [list, overrides]);
          useEffect(() => {
            if (!renameError) return undefined;
            const tm = setTimeout(() => setRenameError(null), 2400);
            return () => clearTimeout(tm);
          }, [renameError]);

          const focusTab = (id) => {
            const el = tabsRef.current && tabsRef.current.querySelector(`[data-id="${cssEscape(id)}"]`);
            if (el) el.focus();
          };
          const openMenuAt = (kind, id, el, ev) => {
            let x; let y;
            if (ev) {
              ev.preventDefault(); ev.stopPropagation();
            }
            const r = el.getBoundingClientRect();
            // trust pointer coordinates only when they land on the anchor; otherwise anchor below it
            const inside = ev && ev.type === 'contextmenu' && ev.clientX >= r.left - 1 && ev.clientX <= r.right + 1 && ev.clientY >= r.top - 1 && ev.clientY <= r.bottom + 1;
            if (inside) { x = ev.clientX + 2; y = Math.max(ev.clientY + 2, r.bottom + 2); }
            else { x = r.left; y = r.bottom + 4; }
            setMenu({ kind, id, x, y });
          };
          const startRename = (id) => {
            setMenu(null);
            setRenameError(null);
            setRenaming(id);
            setDraft(overrides[id] || titleOf(list.byId[id], t));
          };

          // stable callback bag for memoised tabs
          const api = useRef(null);
          api.current = {
            activate: actions.activate,
            close: (id) => actions.close([id]),
            togglePin: actions.togglePin,
            startRename,
            setDraft,
            openMenuAt,
            cancelRename: (id) => { setRenaming(null); requestAnimationFrame(() => focusTab(id)); },
            commitRename: async () => {
              const id = renaming;
              const value = draft.trim();
              setRenaming(null);
              if (!id || !value || value === titleOf(list.byId[id], t)) return;
              setOverrides((o) => ({ ...o, [id]: value }));
              try {
                const r = await actions.rename(id, value);
                if (!r.ok) throw new Error('rename');
              } catch (_) {
                setOverrides((o) => { const n = { ...o }; delete n[id]; return n; });
                setRenameError(id);
              }
            },
            onTabKeyDown: (e, id) => {
              if (renaming) return;
              const k = e.key;
              const index = tabs.indexOf(id);
              if ((k === 'ArrowRight' || k === 'ArrowLeft') && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                actions.shiftTab(id, k === 'ArrowRight' ? 1 : -1);
                requestAnimationFrame(() => focusTab(id));
                return;
              }
              if ((k === 'ArrowRight' || k === 'ArrowLeft') && e.altKey && e.shiftKey) {
                e.preventDefault();
                actions.step(k === 'ArrowRight' ? 1 : -1);
                return;
              }
              if ((k === 'ArrowRight' || k === 'ArrowLeft') && !e.altKey && !e.shiftKey) {
                e.preventDefault();
                const n = tabs[(index + (k === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
                if (n) focusTab(n);
                return;
              }
              if (k === 'Home' || k === 'End') { e.preventDefault(); focusTab(k === 'Home' ? tabs[0] : tabs[tabs.length - 1]); return; }
              if (k === 'Enter' || k === ' ') { e.preventDefault(); actions.activate(id); return; }
              if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (!pinnedSet.has(id)) actions.close([id]); return; }
              if (k === 'F2') { e.preventDefault(); startRename(id); return; }
              if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) { e.preventDefault(); openMenuAt('tab', id, e.currentTarget, null); }
            },
            dragStart: (e, id) => {
              e.dataTransfer.effectAllowed = 'move';
              try { e.dataTransfer.setData('application/x-dsh-session-tab', id); e.dataTransfer.setData('text/plain', titleOf(list.byId[id], t)); } catch (_) { /* ignore */ }
              stopMarquee(e.currentTarget);
              setDrag({ id, over: null, side: null });
            },
            dragOver: (e, id) => {
              if (!drag) return;
              if (pinnedSet.has(drag.id) !== pinnedSet.has(id)) return; // no dropping across the pinned boundary
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const r = e.currentTarget.getBoundingClientRect();
              const side = e.clientX < r.left + r.width / 2 ? 'before' : 'after';
              if (drag.over !== id || drag.side !== side) setDrag({ ...drag, over: id, side });
            },
            drop: (e, id) => {
              if (!drag) return;
              e.preventDefault();
              const all = st.tabs;
              const from = all.indexOf(drag.id);
              let to = all.indexOf(id) + (drag.side === 'after' ? 1 : 0);
              if (from < to) to -= 1;
              actions.reorder(drag.id, to);
              setDrag(null);
            },
            dragEnd: () => setDrag(null),
          };

          const labels = {
            closeLabel: t('close'), unpinLabel: t('unpin'), renameLabel: t('rename'), renameFailedLabel: t('renameFailed'), pinnedLabel: t('pinned'),
          };
          const firstFocusable = activeId && tabs.includes(activeId) ? activeId : tabs[0];
          const pc = tabs.filter((id) => pinnedSet.has(id)).length;
          const tabNodes = [];
          tabs.forEach((id, i) => {
            if (i === pc && pc > 0) tabNodes.push(h('span', { key: '__div', className: 'dms-divider', 'aria-hidden': true }));
            const summary = list.byId[id];
            const isPinned = pinnedSet.has(id);
            const state = states.get(id) || statusOf(id, summary, statusMap.get(id), warmMap, id === cur);
            tabNodes.push(h(Tab, {
              key: id, id, api,
              index: i,
              title: overrides[id] || titleOf(summary, t),
              state, stateLabel: t(statusLabel[state]),
              selected: id === activeId,
              focusable: id === firstFocusable,
              pinned: isPinned,
              renaming: renaming === id,
              draft: renaming === id ? draft : '',
              dropSide: drag && drag.over === id && drag.id !== id ? drag.side : undefined,
              dragging: !!(drag && drag.id === id),
              renameError: renameError === id,
              cwd: summary && summary.cwd,
              closeLabel: labels.closeLabel, unpinLabel: labels.unpinLabel, renameLabel: labels.renameLabel,
              renameFailedLabel: labels.renameFailedLabel, pinnedLabel: isPinned ? labels.pinnedLabel : '',
            }));
          });

          const placementItems = (close) => {
            const items = [
              h(Head, { key: 'ph' }, t('placement')),
              h(MenuItem, { key: 'pt', role: 'menuitemradio', checked: placement === 'titlebar', disabled: !hasTitlebar, label: t('placeTitlebar'), hint: hasTitlebar ? null : t('titlebarOnly'), onSelect: () => actions.setPlacement('titlebar'), close }),
              h(MenuItem, { key: 'pb', role: 'menuitemradio', checked: placement === 'below', label: t('placeBelow'), onSelect: () => actions.setPlacement('below'), close }),
            ];
            if (placement === 'titlebar' && hasTitlebar) {
              const curH = st.titlebarHeight != null ? st.titlebarHeight : TB_DEFAULT;
              const names = { 32: 'tbCompact', 36: 'tbDefault', 40: 'tbStandard', 44: 'tbRoomy' };
              items.push(h(Sep, { key: 'hs' }), h(Head, { key: 'hh' }, `${t('tbHeight')} · ${curH}px`));
              for (const v of TB_PRESETS) {
                items.push(h(MenuItem, { key: `h${v}`, role: 'menuitemradio', checked: curH === v, label: t(names[v]), hint: `${v}px`, onSelect: () => actions.setTitlebarHeight(v === TB_DEFAULT ? null : v), close }));
              }
            } else {
              const curH = st.barHeight != null ? st.barHeight : BAR_DEFAULT;
              const names = { 32: 'tbCompact', 38: 'tbDefault', 44: 'tbRoomy', 50: 'tbXL' };
              items.push(h(Sep, { key: 'hs' }), h(Head, { key: 'hh' }, `${t('barHeight')} · ${curH}px`));
              for (const v of BAR_PRESETS) {
                items.push(h(MenuItem, { key: `h${v}`, role: 'menuitemradio', checked: curH === v, label: t(names[v]), hint: `${v}px`, onSelect: () => actions.setBarHeight(v === BAR_DEFAULT ? null : v), close }));
              }
            }
            items.push(
              h(Sep, { key: 'os' }), h(Head, { key: 'oh' }, t('overflowHead')),
              h(MenuItem, { key: 'o-scroll', role: 'menuitemradio', checked: st.overflow !== 'shrink', label: t('overflowScroll'), onSelect: () => actions.setOverflow('scroll'), close }),
              h(MenuItem, { key: 'o-shrink', role: 'menuitemradio', checked: st.overflow === 'shrink', label: t('overflowShrink'), onSelect: () => actions.setOverflow('shrink'), close }),
            );
            return items;
          };

          let menuEl = null;
          if (menu) {
            const close = closeMenu;
            let items;
            if (menu.kind === 'tab') {
              const id = menu.id;
              const i = tabs.indexOf(id);
              const isPinned = pinnedSet.has(id);
              const groupStart = isPinned ? 0 : pc;
              const groupEnd = isPinned ? pc - 1 : tabs.length - 1;
              const othersClosable = tabs.some((x) => x !== id && !pinnedSet.has(x));
              const rightClosable = tabs.slice(i + 1).some((x) => !pinnedSet.has(x));
              items = [
                h(MenuItem, { key: 'o', label: t('open'), disabled: id === activeId, onSelect: () => actions.activate(id), close }),
                h(MenuItem, { key: 'p', label: isPinned ? t('unpin') : t('pin'), onSelect: () => actions.togglePin(id), close }),
                h(MenuItem, { key: 'r', label: t('rename'), hint: 'F2', onSelect: () => startRename(id), close }),
                h(MenuItem, { key: 'n', label: t('newTab'), hint: 'Alt+Shift+N', onSelect: () => actions.newSession(id), close }),
                h(Sep, { key: 's1' }),
                h(MenuItem, { key: 'ml', label: t('moveLeft'), hint: 'Shift+←', disabled: i <= groupStart, onSelect: () => actions.shiftTab(id, -1), close }),
                h(MenuItem, { key: 'mr', label: t('moveRight'), hint: 'Shift+→', disabled: i < 0 || i >= groupEnd, onSelect: () => actions.shiftTab(id, 1), close }),
                h(Sep, { key: 's2' }),
                h(MenuItem, { key: 'c', label: t('close'), hint: 'Alt+Shift+W', onSelect: () => actions.close([id]), close }),
                h(MenuItem, { key: 'co', label: t('closeOthers'), disabled: !othersClosable, onSelect: () => actions.closeOthers(id), close }),
                h(MenuItem, { key: 'cr', label: t('closeRight'), disabled: !rightClosable, onSelect: () => actions.closeRight(id), close }),
                h(MenuItem, { key: 'ro', label: t('reopen'), hint: 'Alt+Shift+T', disabled: !st.closed.length, onSelect: () => actions.reopen(), close }),
                h(Sep, { key: 's3' }),
                ...placementItems(close),
              ];
            } else if (menu.kind === 'history') {
              items = [h(Head, { key: 'h' }, t('recent'))];
              if (!st.closed.length) items.push(h(MenuItem, { key: 'e', label: t('recentEmpty'), disabled: true, onSelect: () => {}, close }));
              st.closed.slice(0, 12).forEach((c, k) => {
                const live = list.byId[c.id];
                items.push(h(MenuItem, { key: c.id, label: live ? titleOf(live, t) : (c.title || t('untitled')), hint: k === 0 ? 'Alt+Shift+T' : null, disabled: !live, onSelect: () => actions.reopen(c.id), close }));
              });
              if (st.closed.length) items.push(h(Sep, { key: 's' }), h(MenuItem, { key: 'clr', label: t('clearRecent'), onSelect: actions.clearClosed, close }));
            } else {
              items = [
                h(MenuItem, { key: 'n', label: t('newTab'), hint: 'Alt+Shift+N', onSelect: () => actions.newSession(), close }),
                h(MenuItem, { key: 'ro', label: t('reopen'), hint: 'Alt+Shift+T', disabled: !st.closed.length, onSelect: () => actions.reopen(), close }),
                h(Sep, { key: 's' }),
                ...placementItems(close),
              ];
            }
            menuEl = h(Menu, { x: menu.x, y: menu.y, onClose: closeMenu, label: t('tablist') }, items);
          }

          const otherPlacement = placement === 'titlebar' ? 'below' : 'titlebar';
          const rightbarDisabled = !rs || !rightbarMounted;
          const isBackground = (target) => target === stripRef.current || (target.classList && (target.classList.contains('dms-tabs') || target.classList.contains('dms-scroll') || target.classList.contains('dms-tools')));

          return h('div', {
            ref: stripRef, className: 'dms-strip', 'data-host': host, 'data-placement': placement, 'data-overflow': st.overflow === 'shrink' ? 'shrink' : 'scroll',
            style: host === 'leading' ? { '--dms-bar': `${barH}px` } : undefined,
            onContextMenu: (e) => { if (isBackground(e.target)) openMenuAt('strip', null, e.currentTarget, e); },
            onDoubleClick: (e) => { if (e.target.classList && (e.target.classList.contains('dms-tabs') || e.target.classList.contains('dms-scroll'))) actions.newSession(); },
          },
          h('div', {
            ref: scrollRef, className: 'dms-scroll',
            onScroll: syncGeometry,
            onWheel: (e) => { const sc = scrollRef.current; if (sc && Math.abs(e.deltaY) > Math.abs(e.deltaX) && sc.scrollWidth > sc.clientWidth) sc.scrollLeft += e.deltaY; },
          },
          h('div', { ref: tabsRef, className: 'dms-tabs', role: 'tablist', 'aria-label': t('tablist'), 'aria-orientation': 'horizontal' },
            tabs.length ? tabNodes : h('span', { className: 'dms-empty' }, t('noTabs')))),
          h('div', { className: 'dms-tools' },
            h('button', { type: 'button', className: 'dms-btn', 'aria-label': t('newTab'), title: `${t('newTab')}  Alt+Shift+N`, onClick: () => actions.newSession(), onContextMenu: (e) => openMenuAt('strip', null, e.currentTarget, e) }, h(Icon.plus)),
            h('button', { type: 'button', className: 'dms-btn', 'aria-label': t('recent'), 'aria-haspopup': 'menu', 'aria-expanded': !!(menu && menu.kind === 'history'), title: `${t('recent')}  Alt+Shift+T`, onClick: (e) => (menu && menu.kind === 'history' ? closeMenu() : openMenuAt('history', null, e.currentTarget, null)) }, h(Icon.history))),
          h('div', { className: 'dms-tools', 'data-end': '' },
            h('button', {
              type: 'button', className: 'dms-btn', disabled: !hasTitlebar, 'aria-label': t('swapPlacement'),
              title: hasTitlebar ? `${t('swapPlacement')} → ${t(otherPlacement === 'titlebar' ? 'placeTitlebar' : 'placeBelow')}` : `${t('swapPlacement')}（${t('titlebarOnly')}）`,
              onClick: () => actions.setPlacement(otherPlacement),
            }, h(Icon.swap)),
            h('span', { className: 'dms-sep', 'aria-hidden': true }),
            h('button', {
              type: 'button', className: 'dms-btn', disabled: rightbarDisabled, 'aria-pressed': !rightbarDisabled && rightbarExpanded,
              'aria-label': t('rightbar'), title: rightbarDisabled ? t('rightbarNone') : t('rightbar'), onClick: actions.toggleRightbar,
            }, h(Icon.rightbar)),
            h('button', {
              type: 'button', className: 'dms-btn', disabled: !bottomPresent && !st.bottomHidden, 'aria-pressed': bottomPresent && !st.bottomHidden,
              'aria-label': t('bottom'), title: bottomPresent || st.bottomHidden ? t('bottom') : t('bottomNone'), onClick: actions.toggleBottom,
            }, h(Icon.bottom))),
          host === 'overlay' || host === 'leading' ? h(HeightGrip, { host }) : null,
          menuEl);
        }

        const makeSeat = (host) => function MultiSessionSeat(props) {
          useLocaleTick();
          const hasTitlebar = useCell(titlebarCell);
          const st = useStoreState();
          const list = props.useSessions ? props.useSessions((s) => s) : listSnap();
          const statusMap = props.useSessionStatus ? props.useSessionStatus((s) => s) : EMPTY_MAP;
          const panelNull = props.usePanelInfo ? props.usePanelInfo((i) => i.activePanelId === null) : true;
          const placement = effectivePlacement(st, hasTitlebar);
          const wanted = placement === 'titlebar' ? 'overlay' : 'leading';
          if (host !== wanted || !list) return null;
          return h(TabBar, { host, list, statusMap: statusMap || EMPTY_MAP, panelNull, placement, hasTitlebar });
        };

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'multi-session-tabs', order: 10, label: () => t('tablist') }, makeSeat('overlay')));
        ctx.slots.inject('conversation.header.leading', () => ctx.slots.register({ name: 'conversation.header.leading' }, makeSeat('leading')));
      },
    };
  },
});
