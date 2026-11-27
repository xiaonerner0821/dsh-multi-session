// Behaviour test: closing the last tab must actually leave its Session — the main view has to move on,
// and the closed tab must never come back. Run: node test/close-last.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setImmediate as tick } from 'node:timers/promises';
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

// A page with a session catalog. `connect` scripts what connectWorkspace does; `onStart` what startSession does.
function makePage({ sessions, current, tabs, groups, groupOf, connect = 'ok', blankId = 'blank1', onStart = () => {} }) {
  const timers = [];
  const page = { now: 1_000_000, started: 0, connected: 0, opened: [], rows: sessions.map((r) => ({ ...r })), current };
  const byId = () => Object.fromEntries(page.rows.map((r) => [r.id, { id: r.id, title: r.title || '', blank: !!r.blank, running: false, retainedBy: r.id === page.current ? { mainView: 1 } : {}, updatedAt: 0 }]));
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
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'w1', sessionIds: page.rows.map((r) => r.id) }] }) } },
    uiWorkspace: {
      openSession: (id) => { page.opened.push(id); page.show(id); },
      connectWorkspace: () => {
        page.connected++;
        if (connect === 'reject') return Promise.reject(new Error('connect failed'));
        if (connect === 'empty') return Promise.resolve(undefined);
        return Promise.resolve(blankId);
      },
      startSession: () => { page.started++; onStart(page); },
    },
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: null }) }, selectPanel() {} },
  };
  ctx.get = (name) => (name === 'workspaces' ? ctx.workspaces : undefined);
  factory((n) => (n === 'react' ? React : {})).apply(ctx);
  page.tabs = () => { page.advance(200); return JSON.parse(session.get(TABS)).tabs; }; // store writes coalesce for 120 ms
  page.state = () => { page.advance(200); return JSON.parse(session.get(TABS)); };
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
        btn = [].concat(n.props.children || []).flat(Infinity).find((k) => k && k.props && k.props.className === 'dms-x');
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

// 1. Last tab, an ordinary Session: a fresh blank is opened and shown, without the racy New Session path.
{
  const p = makePage({ sessions: [{ id: 'a', title: 'A' }, { id: 'blank1', blank: true }], current: 'a', tabs: ['a'] });
  p.clickClose('a');
  await tick();
  check('1 opens the fresh blank', p.opened, ['blank1']);
  check('1 leaves the race-prone startSession out', p.started, 0);
  check('1 tabs follow the view', p.tabs(), ['blank1']);
  check('1 the closed tab stays closed', p.tabs().includes('a'), false);
}

// 2. The reported bug: the last tab is itself the empty New Session, which DSH would just reopen.
{
  const p = makePage({ sessions: [{ id: 'blank1', blank: true }], current: 'blank1', tabs: ['blank1'] });
  p.clickClose('blank1');
  await tick();
  check('2 blank last tab is kept', p.tabs(), ['blank1']);
  check('2 no pointless work', [p.connected, p.started], [0, 0]);
}

// 3. Opening the replacement fails: the tab stays closed, and the closed Session is never shown as a tab again.
{
  const p = makePage({ sessions: [{ id: 'a', title: 'A' }], current: 'a', tabs: ['a'], connect: 'reject' });
  p.clickClose('a');
  await tick();
  check('3 falls back to New Session', p.started, 1);
  check('3 closed tab is not resurrected', p.tabs(), []);
  p.advance(10000); p.emit();
  check('3 still not resurrected later', p.tabs(), []);
}

// 4. connectWorkspace resolves without a Session: same fallback, still no resurrection.
{
  const p = makePage({ sessions: [{ id: 'a', title: 'A' }], current: 'a', tabs: ['a'], connect: 'empty' });
  p.clickClose('a');
  await tick();
  check('4 falls back when there is no Session', p.started, 1);
  check('4 closed tab is not resurrected', p.tabs(), []);
}

// 5. A slow replacement still ends on the new blank only.
{
  const p = makePage({ sessions: [{ id: 'a', title: 'A' }, { id: 'blank1', blank: true }], current: 'a', tabs: ['a'] });
  p.clickClose('a');
  p.advance(1500);
  check('5 nothing shown before the blank arrives', p.tabs(), []);
  await tick();
  p.advance(5000); p.emit();
  check('5 only the blank tab after', p.tabs(), ['blank1']);
}

// 6. Closing one of several tabs still switches to the most recent survivor (unchanged behaviour).
{
  const p = makePage({ sessions: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], current: 'b', tabs: ['a', 'b'] });
  p.clickClose('b');
  await tick();
  check('6 closes to the neighbour', p.current, 'a');
  check('6 no replacement requested', [p.connected, p.started], [0, 0]);
  check('6 tabs', p.tabs(), ['a']);
}

// 7. Closing a background tab never touches the main view, nor opens anything.
{
  const p = makePage({ sessions: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], current: 'b', tabs: ['a', 'b'] });
  p.clickClose('a');
  await tick();
  check('7 background close keeps view', p.current, 'b');
  check('7 nothing opened', [p.connected, p.started, p.opened], [0, 0, []]);
  check('7 tabs', p.tabs(), ['b']);
}

// 8. A grouped last tab: the group goes with it, and the replacement tab is not dragged into the group.
{
  const p = makePage({ sessions: [{ id: 'a', title: 'A' }, { id: 'blank1', blank: true }], current: 'a', tabs: ['a'],
    groups: [{ id: 'g1', name: '组 1', color: 'blue' }], groupOf: { a: 'g1' } });
  p.clickClose('a');
  await tick();
  check('8 replacement shown', p.tabs(), ['blank1']);
  check('8 empty group dropped', p.state().groups, []);
  check('8 replacement not in a group', p.state().groupOf.blank1, undefined);
}

console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
