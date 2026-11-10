/**
 * Focus restore for panels and dialogs. The Escape-stacking half of this file
 * (capture-phase dialog Escape, stacked-dialog open/close) is gone: Radix's
 * DismissableLayer — behind the official dialog/popover/alert-dialog — owns
 * that now. What stays is the cross-panel focus handing that no primitive
 * provides. Client-safe: the document is passed in, so tests can hand over a
 * stand-in.
 */

interface Focusable {
  focus(options?: FocusOptions): void;
}

/** The part of `document` `focusIfLost()` reads. */
export interface FocusDocument {
  readonly activeElement: Element | null;
  readonly body: Element | null;
}

/**
 * Moves focus to `target` when the element that had it left the page, so focus
 * fell back to `body` (or nowhere): a control that went away under the
 * keyboard, such as Settings › MCP's Trust… button, which the trust dialog
 * hands focus back to on close and the panel's reload then removes with its
 * notice. Focus anywhere else is where the user put it, and stays. Returns
 * whether it moved focus.
 */
export function focusIfLost(doc: FocusDocument, target: Focusable | null): boolean {
  const active = doc.activeElement;
  if (!target || (active && active !== doc.body)) return false;
  target.focus({ preventScroll: true });
  return true;
}

/** A control a change was started from: whether it is still on the page, and still disabled. */
export interface PressedControl extends Focusable {
  readonly isConnected: boolean;
  readonly disabled?: boolean;
}

/**
 * Focus after a change whose control was disabled while it ran, such as a
 * switch in Settings › MCP: a focused element that becomes disabled loses
 * focus (the HTML focus-fixup rule drops it to `body`), so a keyboard user
 * would land on the page behind the panel. Focus goes back to that control,
 * or to `fallback` when the control left the page or is disabled still (a
 * server just turned off that may not be turned on again); as with
 * `focusIfLost()`, only when focus fell to the page. Nothing moves when no
 * control had focus to begin with (a click that focuses nothing, as in Safari).
 */
export function focusAfterChange(doc: FocusDocument, control: PressedControl | null, fallback: Focusable | null): boolean {
  if (!control) return false;
  return focusIfLost(doc, control.isConnected && !control.disabled ? control : fallback);
}
