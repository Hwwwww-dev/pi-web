import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The sidebar's toast is sonner's now (components/ui/sonner.tsx, mounted once
 * in AppShell). SidebarToast.tsx is gone; SessionSidebar's `showToast` drives
 * `toast()` from "sonner" directly. These assertions pin the behavior contract
 * the old handwritten toast carried, against the source that implements it.
 */

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

/** The body of SessionSidebar's `showToast` callback. */
function showToastBody() {
  const start = source.indexOf("const showToast = useCallback(");
  assert.notEqual(start, -1, "showToast not found");
  const end = source.indexOf("\n  const ", start + 1);
  return source.slice(start, end);
}

test("the old handwritten toast is gone, with no rendering left in the sidebar", async () => {
  await assert.rejects(readFile(new URL("./SidebarToast.tsx", import.meta.url)));
  // The only SidebarToast* left is the action type the call sites build;
  // no component, no region, no has-toast class hook.
  assert.doesNotMatch(source, /from "\.\/SidebarToast"|<SidebarToast|sidebar-toast-region|has-toast/);
});

test("one toast at a time: every toast goes out under one fixed id, so a new one replaces the old", () => {
  const body = showToastBody();
  assert.match(body, /toast\(message, \{\s*id: SIDEBAR_TOAST_ID,/);
  // The id is a module constant, not a counter: the same one every call.
  const [idDeclaration] = source.match(/^const SIDEBAR_TOAST_ID = "[^"]+";$/m) ?? [];
  assert.ok(idDeclaration, "SIDEBAR_TOAST_ID is a module constant");
  assert.doesNotMatch(source, /toastIdRef/, "no per-toast id counter anymore");
});

test("the toast holds as long as it did: 10 s, and nothing else was reined in", () => {
  const body = showToastBody();
  assert.match(body, /duration: SIDEBAR_TOAST_DURATION_MS/);
  assert.match(source, /^const SIDEBAR_TOAST_DURATION_MS = 10_000;$/m);
  // Sonner's own defaults stay: pause on hover and while the page is hidden,
  // official bottom-right position. Nothing overridden.
  const [toasterMount] = appShellSource.match(/<Toaster(?![\w])[^>]*\/>/g) ?? [];
  assert.ok(toasterMount, "AppShell mounts the Toaster once");
  assert.equal(appShellSource.match(/<Toaster(?![\w])/g).length, 1);
  assert.doesNotMatch(toasterMount, /position|duration|pauseOnHover|pauseOnFocusLoss|richColors|closeButton/);
  assert.doesNotMatch(body, /pauseOnHover|pauseOnFocusLoss|position|closeButton/);
});

test("a toast's text is the message, its tail the description under it", () => {
  const body = showToastBody();
  assert.match(body, /description: tail,/);
});

test("the first action is sonner's action, and it dismisses the toast before it runs", () => {
  const body = showToastBody();
  assert.match(body, /action: primary && \{\s*label: primary\.label,/);
  // Dismissed first, so a toast the action shows itself (Undo failed)
  // replaces this one instead of being dismissed with it: the handler stops
  // sonner's own dismiss-then-close and dismisses by id first.
  assert.match(
    body,
    /onClick: \(event\) => \{\s*\/\/ Dismissed first, so a toast the action shows itself \(Undo\s*\/\/ failed\) replaces this one instead of being dismissed with it\.\s*event\.preventDefault\(\);\s*toast\.dismiss\(SIDEBAR_TOAST_ID\);\s*primary\.onClick\(\);\s*\},/,
  );
});

test("a second action survives as sonner's cancel button, which closes the toast too", () => {
  const body = showToastBody();
  assert.match(body, /cancel: secondary && \{\s*label: secondary\.label,\s*onClick: \(\) => \{\s*toast\.dismiss\(SIDEBAR_TOAST_ID\);\s*secondary\.onClick\(\);\s*\},/);
  // The one call site that ever had two actions: Undo, then View.
  const archive = source.slice(source.indexOf("const archiveFamilies = useCallback("), source.indexOf("const archiveFamily = useCallback("));
  assert.match(archive, /label: t\("sidebar\.undo"\),/);
  assert.match(archive, /\{ label: t\("sidebar\.viewArchive"\), onClick: \(\) => openArchiveView\(\) \},/);
});

test("a phone closing its drawer dismisses the toast, which used to slide away with the drawer", () => {
  // The Toaster is fixed to the viewport, outside the drawer; AppShell, which
  // owns the drawer's open state, dismisses everything when the drawer is
  // closed on a phone.
  assert.match(
    appShellSource,
    /if \(isMobile && !sidebarOpen\) toast\.dismiss\(\);\s*\}, \[isMobile, sidebarOpen\]\);/,
  );
  // toast.dismiss() without an id dismisses every active toast.
  assert.match(source, /SIDEBAR_TOAST_ID = "pi-web-sidebar-toast"/);
});

test("the Toaster hangs off the app root, not inside the transformed sidebar drawer", () => {
  const mount = appShellSource.indexOf("<Toaster");
  assert.notEqual(mount, -1, "the Toaster is mounted");
  // The AppShell root renders the sidebar's drawer (the .sidebar-container
  // div) after the shared head; the Toaster sits beside it, at the root's
  // level, so a phone's drawer transform never moves it. Between the root's
  // opening fragment and the Toaster there is only its JSX comment.
  const root = appShellSource.slice(appShellSource.indexOf("return (\n    <>"), mount);
  assert.doesNotMatch(root, /<[a-zA-Z][^>]*>/, "no element is mounted before the Toaster at the root");
  assert.ok(mount < appShellSource.indexOf('id="session-sidebar"'), "the drawer comes after the Toaster");
});
