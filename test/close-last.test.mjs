// Behaviour test: closing the last tab must never leave its Session on screen without a tab.
// Run: node test/close-last.test.mjs  (no dependencies; loads client.js into a fake page)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SRC = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8');
const TABS = 'dsh-multi-session.tabs.v3';

const storage = (map) => ({ getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) });
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
  Fragment: 'F', memo: (f) => f,
  useState: (i) => [typeof i === 'function' ? i() : i, () => {}], useRef: (i) => ({ current: i }), useCallback: (f) => f,
  useSyncExternalStore: (s, g) => g(), useEffect() {}, useLayoutEffect() {},
};

// A page with a session catalog; `startSession` behaviour is scripted per case.
function makePage({ sessions, current, tabs, groups, groupOf, onStart }) {
  const timers = [];
  const page = { now: 1_000_000, started: 0, opened: [] };
  const byId = () => Object.fromEntries(page.rows.map((r) => [r.id, { id: r.id, title: r.title || '', blank: !!r.blank, running: false, retainedBy: r.id === page.current ? { mainView: 1 } : {}, updatedAt: 0 }]));
  page.rows = sessions.map((r) => ({ ...r }));
  page.current = current;
  const subs = new Set();
  page.list = () => ({ phase: 'ready', ids: page.rows.map((r) => r.id), byId: byId() });
  page.emit = () => { for (const f of [...subs]) f(); };
  page.show = (id) => { page.current = id; page.emit(); };
  page.advance = (ms) => {
    page.now += ms;
    for (const t of timers.splice(0)) { if (t.at <= page.now) t.fn(); else timers.push(t); }
  };
  const session = new Map([[TABS, JSON.stringify({ tabs, pinned: [], seen: {}, current, groups: groups || [], groupOf: groupOf || {} })]]);
  const window = {
    localStorage: storage(new Map()), sessionStorage: storage(session),
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), CSS: { escape: (s) => s },
  };
  const document = {
    hidden: false, head: null,
    documentElement: { hasAttribute: () => false, style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' } },
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {} }), baseURI: 'http://x/',
  };
  window.document = document;
  let factory;
  window.__ModuleLoader__ = { load: (m) => { factory = m.factory; } };
  const FakeDate = class extends Date { static now() { return page.now; } };
  const sandbox = {
    window, document, navigator: { userAgent: 'Mozilla/5.0 Chrome/140' }, performance: { getEntriesByType: () => [{ type: 'reload' }] },
    console, setTimeout: (fn, ms) => { timers.push({ fn, at: page.now + (ms || 0) }); return timers.length; }, clearTimeout() {},
    setInterval: () => 0, clearInterval() {}, queueMicrotask, Promise, Date: FakeDate, Math, JSON, URL,
    getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const seats = {};
  const ctx = {
    effect: (fn, label) => { try { fn(); } catch (e) { if (process.env.DEBUG) console.log('effect failed', label, e); } },
    slots: { inject: (n, f) => f(), register: (meta, comp) => { seats[meta.name] = comp; return () => {}; } },
    locale: { register: () => () => {}, bind: () => (k) => k, subscribe: () => () => {}, getSnapshot: () => 0 },
    sessions: {
      list: { getSnapshot: () => page.list(), subscribe: (f) => { subs.add(f); return () => subs.delete(f); } },
      retain: () => ({ ready: new Promise(() => {}), release() {} }),
      retainInfo: () => ({ getSnapshot: () => ({ retainedBy: {} }), subscribe: () => () => {} }),
    },
    uiWorkspace: {
      openSession: (id) => { page.opened.push(id); page.show(id); },
      startSession: () => { page.started++; onStart(page); },
    },
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: null }) }, selectPanel() {} },
  };
  factory((n) => (n === 'react' ? React : {})).apply(ctx);
  page.flush = () => page.advance(200); // store writes are coalesced for 120 ms
  page.tabs = () => { page.flush(); return JSON.parse(session.get(TABS)).tabs; };
  page.state = () => { page.flush(); return JSON.parse(session.get(TABS)); };
  // drive the real tab strip: render the seat, find the close button of a tab and click it
  const seat = seats['conversation.header.leading'];
  page.clickClose = (id) => {
    const root = seat({ useSessions: (s) => s(page.list()), useSessionStatus: (s) => s(new Map()), usePanelInfo: (s) => s({ activePanelId: null }) });
    let btn = null;
    const render = (n) => {
      if (!n || btn) return;
      if (Array.isArray(n)) { n.forEach(render); return; }
      if (typeof n !== 'object') return;
      if (typeof n.type === 'function') { render(n.type(n.props)); return; }
      if (n.props && n.props['data-id'] === id) {
        const kids = [].concat(n.props.children || []).flat(Infinity);
        btn = kids.find((k) => k && k.props && k.props.className === 'dms-x');
        return;
      }
      if (n.props) render(n.props.children);
    };
    render(root);
    if (!btn) throw new Error(`close button for ${id} not found`);
    btn.props.onClick({ stopPropagation() {} });
  };
  return page;
}

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`);
};

// 1. Last tab, ordinary Session; New Session opens a fresh blank -> the old tab goes, the blank gets one.
{
  const p = makePage({ sessions: [{ id: 'a', title: 'A' }, { id: 'blank1', blank: true }], current: 'a', tabs: ['a'],
    onStart: (pg) => pg.show('blank1') });
  p.clickClose('a');
  check('1 last tab -> new blank opened', p.current, 'blank1');
  check('1 tabs follow the view', p.tabs(), ['blank1']);
}

// 2. The reported bug: last tab is itself the empty New Session. DSH would reopen the same blank.
{
  const p = makePage({ sessions: [{ id: 'blank1', blank: true }], current: 'blank1', tabs: ['blank1'],
    onStart: (pg) => pg.show('blank1') });
  p.clickClose('blank1');
  check('2 blank last tab is kept', p.tabs(), ['blank1']);
  check('2 no pointless New Session request', p.started, 0);
}

// 3. New Session never lands (fails / superseded): the Session stays on screen, so its tab comes back.
{
  const p = makePage({ sessions: [{ id: 'a', title: 'A' }], current: 'a', tabs: ['a'], onStart: () => {} });
  p.clickClose('a');
  check('3 tab hidden while New Session is pending', p.tabs(), []);
  p.advance(5000); p.emit();
  check('3 tab restored after New Session failed', p.tabs(), ['a']);
}

// 4. New Session is slow but arrives within the wait: no flicker back.
{
  let land;
  const p = makePage({ sessions: [{ id: 'a', title: 'A' }, { id: 'blank1', blank: true }], current: 'a', tabs: ['a'],
    onStart: (pg) => { land = () => pg.show('blank1'); } });
  p.clickClose('a');
  p.advance(1500); land();
  p.advance(5000); p.emit();
  check('4 slow New Session -> only the blank tab', p.tabs(), ['blank1']);
}

// 5. Closing one of several tabs still switches to the most recent survivor (unchanged behaviour).
{
  const p = makePage({ sessions: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], current: 'b', tabs: ['a', 'b'], onStart: () => {} });
  p.clickClose('b');
  check('5 closes to the neighbour', p.current, 'a');
  check('5 no New Session', p.started, 0);
  check('5 tabs', p.tabs(), ['a']);
}

// 6. Closing a background tab never touches the main view.
{
  const p = makePage({ sessions: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], current: 'b', tabs: ['a', 'b'], onStart: () => {} });
  p.clickClose('a');
  check('6 background close keeps view', p.current, 'b');
  check('6 tabs', p.tabs(), ['b']);
}

// 7. The restored tab keeps the group it was in when it closed.
{
  const p = makePage({ sessions: [{ id: 'a', title: 'A' }], current: 'a', tabs: ['a'],
    groups: [{ id: 'g1', name: '组 1', color: 'blue' }], groupOf: { a: 'g1' }, onStart: () => {} });
  p.clickClose('a');
  p.advance(5000); p.emit();
  check('7 tab restored', p.tabs(), ['a']);
  check('7 still in its group', p.state().groupOf.a, 'g1');
}

console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
