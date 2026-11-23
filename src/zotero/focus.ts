import { getPref } from "../utils/prefs";

const ATTR = "refwright-focus";
const STYLE_ID = "refwright-focus-style";
const READER_CSS = `
:root[${ATTR}] .toolbar, :root[${ATTR}] #reader-ui > .toolbar { display: none !important; }
:root[${ATTR}] .split-view { top: 0 !important; }`;

interface WinState {
  wasFull: boolean;
  ctxWasCollapsed: boolean;
  closedSidebars: Set<any>;
}
const states = new WeakMap<Window, WinState>();
const g = (k: string) => getPref(k as any) as any;

const readersOf = (win: Window) =>
  ((Zotero.Reader as any)._readers ?? []).filter(
    (r: any) => r._window === win || !r._window,
  );

function readerDoc(r: any): Document | undefined {
  try {
    return r._iframeWindow?.document;
  } catch {
    return undefined;
  }
}

function styleReader(r: any, on: boolean) {
  const doc = readerDoc(r);
  if (!doc?.documentElement) return;
  if (!doc.getElementById(STYLE_ID)) {
    const s = doc.createElement("style");
    s.id = STYLE_ID;
    s.textContent = READER_CSS;
    (doc.head ?? doc.documentElement).appendChild(s);
  }
  doc.documentElement.toggleAttribute(ATTR, on);
}

const sidebarOpen = (r: any) =>
  !!(r._sidebarOpen ?? r._internalReader?._state?.sidebarOpen);

function enterReader(r: any, st: WinState) {
  styleReader(r, true);
  if (sidebarOpen(r)) {
    try {
      r.toggleSidebar(false);
      st.closedSidebars.add(r);
    } catch (e) {
      ztoolkit.log("focus: sidebar", e);
    }
  }
}

const ctxPane = (win: any) => win.ZoteroContextPane;

export const isFocused = (win: Window) => states.has(win);

export function setFocus(win: Window, on: boolean) {
  const root = win.document.documentElement!;
  if (on === isFocused(win)) return;
  if (on) {
    const st: WinState = {
      wasFull: win.fullScreen,
      ctxWasCollapsed: !!ctxPane(win)?.collapsed,
      closedSidebars: new Set(),
    };
    states.set(win, st);
    root.toggleAttribute(ATTR, true);
    try {
      if (ctxPane(win) && !st.ctxWasCollapsed) ctxPane(win).collapsed = true;
    } catch (e) {
      ztoolkit.log("focus: context pane", e);
    }
    for (const r of readersOf(win)) enterReader(r, st);
    if (g("focus.fullscreen") && !st.wasFull) win.fullScreen = true;
  } else {
    const st = states.get(win)!;
    states.delete(win);
    root.toggleAttribute(ATTR, false);
    try {
      if (ctxPane(win) && !st.ctxWasCollapsed) ctxPane(win).collapsed = false;
    } catch (e) {
      ztoolkit.log("focus: context pane", e);
    }
    for (const r of readersOf(win)) styleReader(r, false);
    for (const r of st.closedSidebars) {
      try {
        r.toggleSidebar(true);
      } catch {
        /* reader closed */
      }
    }
    if (!st.wasFull && win.fullScreen) win.fullScreen = false;
  }
}

export const toggleFocus = (win: Window = Zotero.getMainWindow()) =>
  setFocus(win, !isFocused(win));

const isMac = () => Zotero.isMac;
export function isFocusKey(e: KeyboardEvent) {
  if (isMac()) return e.ctrlKey && e.metaKey && !e.altKey && e.code === "KeyF";
  return e.key === "F11" && !e.ctrlKey && !e.metaKey && !e.altKey;
}

function onKey(this: Window, e: KeyboardEvent) {
  if (!g("focus.shortcut") || !isFocusKey(e)) return;
  e.preventDefault();
  e.stopPropagation();
  toggleFocus(Zotero.getMainWindow());
}

/** leaving fullscreen with Esc ends focus mode too, unless fullscreen was on before */
function onFullscreen(this: Window) {
  const st = states.get(this);
  if (st && !st.wasFull && !this.fullScreen) setFocus(this, false);
}

const bound = new WeakSet<Window>();
export function attachFocus(win: Window) {
  if (bound.has(win)) return;
  bound.add(win);
  win.addEventListener("keydown", onKey as any, true);
  win.addEventListener("sizemodechange", onFullscreen as any);
}
export function detachFocus(win: Window) {
  if (isFocused(win)) setFocus(win, false);
  win.removeEventListener("keydown", onKey as any, true);
  win.removeEventListener("sizemodechange", onFullscreen as any);
  bound.delete(win);
}

/** called when a reader renders: hook its keys and, in focus mode, hide its chrome */
export function onReaderReady(reader: any, doc: Document) {
  const rwin = doc.defaultView;
  if (rwin && !bound.has(rwin)) {
    bound.add(rwin);
    rwin.addEventListener("keydown", onKey as any, true);
  }
  const main = Zotero.getMainWindow();
  const st = states.get(main);
  if (st) setTimeout(() => enterReader(reader, st), 300);
}
