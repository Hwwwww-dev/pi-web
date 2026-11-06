"use client";

import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import type { McpServerInfo, McpSignInFlowInfo } from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";
import { revealHiddenCharacters } from "@/lib/mcp-server-display";
import { focusIfLost } from "@/lib/stacked-dialog";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { OAuthPastePanel } from "./OAuthPastePanel";
import { ConfigDetailGridRow } from "./SettingsUi";
import type { McpActionFailure, McpTestBlock } from "./mcp-config-helpers";
import {
  MCP_SIGN_IN_BLOCK_KEYS,
  MCP_SIGN_IN_PHASE_KEYS,
  MCP_SIGN_IN_REFUSAL_KEYS,
  mcpSignInActive,
  mcpSignInLink,
  mcpSignInOutcomeKey,
  mcpSignInOutcomeTone,
  mcpSignInShared,
  type McpSignInRun,
} from "./mcp-sign-in-helpers";

type Translate = ReturnType<typeof useI18n>["t"];

/** A line of the row: 12px in the interface font; secondary lines only dimmer, never smaller. */
function Line({ tone, className, children, ...props }: { tone?: "dim" | "warning" | "error" } & ComponentProps<"span">) {
  return (
    <span
      {...props}
      className={cn(
        "min-w-0 text-xs leading-normal text-muted-foreground [overflow-wrap:anywhere]",
        tone === "dim" && "text-muted-foreground",
        tone === "warning" && "text-warning",
        tone === "error" && "text-destructive",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The row's lines, each on its own, so no locale has to join two sentences. */
function Lines({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-1">{children}</div>;
}

/** Literal text (a URL, an error, a field name) as code: hidden characters shown escaped by the caller. */
function McpCode({ children }: { children: ReactNode }) {
  return (
    <code className="max-w-full rounded-sm border border-border bg-background px-1 font-mono text-xs text-foreground [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

/**
 * Why a sign-in request or Sign out failed, in sign-in words where the reason
 * has them. A sign-in request that timed out may still have started one,
 * which Sign in joins; a Sign out that did may still have been made.
 */
function signInFailureText(failure: McpActionFailure, t: Translate, timedOutKey = "mcp.signIn.requestTimedOut"): string {
  if (failure.timedOut) return t(timedOutKey);
  const key = failure.reason ? MCP_SIGN_IN_REFUSAL_KEYS[failure.reason] : undefined;
  if (key) return t(key);
  return failure.reason && failure.reason !== "internal" ? t(`mcp.reason.${failure.reason}`) : failure.error;
}

/**
 * Settings › MCP's Sign-in row for an HTTP server: whether `mcp-auth.json`
 * holds tokens for it, Sign in and Sign out, and a sign-in under way
 * (`lib/mcp-sign-in.ts`, polled by the panel): what it is doing, then the
 * sign-in page as a link with the paste box always shown, since a browser on
 * another device cannot reach the loopback listener the page sends it back
 * to; and how it ended. Why a button cannot be used is visible text it points
 * at. A server with its own Authorization header does not sign in and gets
 * no row: the Headers row lists that header.
 */
export function McpSignInRow({
  server,
  run,
  block,
  signOutBlock,
  controlsBusy,
  signingOut,
  onSignIn,
  onSignOut,
  onPaste,
  onCancel,
}: {
  server: McpServerInfo;
  /** The panel's sign-in for this server, if it started or joined one. */
  run: McpSignInRun | undefined;
  /** Why Sign in cannot be used. */
  block: McpTestBlock | undefined;
  /** Why Sign out cannot be used. */
  signOutBlock: McpTestBlock | undefined;
  /** A change of the panel is on its way; Sign out is one. */
  controlsBusy: boolean;
  signingOut: boolean;
  onSignIn: (server: McpServerInfo) => void;
  onSignOut: (server: McpServerInfo) => void;
  onPaste: (server: McpServerInfo, flowId: string, value: string) => void;
  onCancel: (server: McpServerInfo, flowId: string) => void;
}) {
  const { t } = useI18n();
  const blockId = useId();
  const signOutBlockId = useId();
  const noCancelId = useId();
  const signInRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const active = mcpSignInActive(run);
  // Sign in gives way to Cancel while a sign-in runs, and back; the button
  // pressed leaves the page, so focus follows to the one that replaced it.
  const wasActiveRef = useRef(active);
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!wasActive && active) focusIfLost(document, cancelRef.current);
    else if (wasActive && !active) focusIfLost(document, signInRef.current);
  }, [active]);

  if (!server.usesOAuth) {
    // Its own Authorization header, which the Headers row lists, is how it signs in: nothing to add.
    if (server.authProvider === undefined && server.headerNames.some((header) => header.toLowerCase() === "authorization")) return null;
    return (
      <ConfigDetailGridRow label={t("mcp.detail.signIn")}>
        {server.authProvider !== undefined
          ? t("mcp.signIn.provider", { provider: revealHiddenCharacters(server.authProvider) })
          : t("mcp.signIn.header")}
      </ConfigDetailGridRow>
    );
  }
  const flow = run?.flow;
  const starting = run?.starting === true;
  // Another entry of the same URL started the flow this one joined: what it found is that entry's.
  const shared = flow !== undefined && mcpSignInShared(flow, server);
  // Signing out of a URL nothing is stored for does nothing; unknown (an unreadable file) still offers it.
  // What is stored counts, not only tokens: a cancelled sign-in leaves a client registration and its
  // PKCE state, which only Sign out (or `pi mcp logout`) clears. A listing that predates the field
  // falls back to the tokens.
  const offersSignOut = (server.oauthStateStored ?? server.signedIn) !== false;
  // A sign-out on its way cancels the URL's sign-in when it arrives, so Sign in waits for it.
  const signInDisabled = starting || signingOut || block !== undefined;
  const signOutDisabled = controlsBusy || starting || signOutBlock !== undefined;
  // The authorization server has answered: a code exchange or a reconnect is on its way.
  const cancelLocked = flow?.phase === "finishing";
  return (
    <ConfigDetailGridRow label={t("mcp.detail.signIn")} tone="plain">
      <Lines>
        <Line>
          {server.signedIn === true
            ? t("mcp.signIn.signedIn")
            : server.signedIn === false
              ? t(server.oauthStateStored ? "mcp.signIn.registrationOnly" : "mcp.signIn.notSignedIn")
              : t("mcp.signIn.unknown")}
        </Line>
        {flow && active && shared && (
          <Line tone="dim">{t("mcp.signIn.shared", { name: revealHiddenCharacters(flow.name) })}</Line>
        )}
        {flow && active && (
          flow.phase === "authorize" ? (
            <McpSignInAuthorize
              key={flow.flowId}
              flow={flow}
              pasting={run?.pasting === true}
              pasteError={run?.pasteError}
              onPaste={(value) => onPaste(server, flow.flowId, value)}
            />
          ) : (
            <Line>{t(MCP_SIGN_IN_PHASE_KEYS[flow.phase] ?? "mcp.signIn.phase.connecting")}</Line>
          )
        )}
        {flow && active && cancelLocked && (
          <Line id={noCancelId} tone="dim">{t("mcp.signIn.phase.noCancel")}</Line>
        )}
        {flow && !active && !run?.gone && <McpSignInOutcome flow={flow} shared={shared} />}
        {run?.gone && <Line role="alert" tone="warning">{t("mcp.signIn.gone")}</Line>}
        {run?.error && (
          <Line role="alert" tone="error">
            {t("mcp.signIn.requestFailed")} {signInFailureText(run.error, t)}
          </Line>
        )}
        {/* Only while the flow runs: once it ended, how it ended is the answer. */}
        {active && run?.cancelError && (
          <Line role="alert" tone="error">
            {t("mcp.signIn.cancelFailed")} {signInFailureText(run.cancelError, t, "mcp.signIn.cancelTimedOut")}
          </Line>
        )}
        {run?.signOutError && (
          <Line role="alert" tone="error">
            {t("mcp.signIn.signOutFailed")} {signInFailureText(run.signOutError, t, "mcp.actionTimedOut")}
          </Line>
        )}
        {run?.signedOut && (
          <Line role="status">
            {t(run.signedOut.removed ? "mcp.signIn.signedOutDone" : "mcp.signIn.signedOutNothing")}
          </Line>
        )}
        {block && <Line id={blockId} tone="dim">{t(MCP_SIGN_IN_BLOCK_KEYS[block])}</Line>}
        {!block && signOutBlock && offersSignOut && !active && (
          <Line id={signOutBlockId} tone="dim">{t(MCP_SIGN_IN_BLOCK_KEYS[signOutBlock])}</Line>
        )}
        {/* Sign in / Cancel and Sign out wrap below each other in the narrow phone pane. */}
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {active && flow ? (
            <Button
              ref={cancelRef}
              type="button"
              size="sm"
              variant="secondary"
              disabled={run?.cancelling === true || cancelLocked}
              aria-busy={run?.cancelling === true || undefined}
              aria-describedby={cancelLocked ? noCancelId : undefined}
              onClick={() => onCancel(server, flow.flowId)}
            >
              {run?.cancelling ? t("mcp.signIn.cancelling") : t("mcp.signIn.cancel")}
            </Button>
          ) : (
            <Button
              ref={signInRef}
              type="button"
              size="sm"
              disabled={signInDisabled}
              aria-busy={starting || undefined}
              aria-describedby={block ? blockId : undefined}
              onClick={() => onSignIn(server)}
            >
              {starting ? t("mcp.signIn.starting") : t("mcp.signIn.button")}
            </Button>
          )}
          {offersSignOut && !active && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={signOutDisabled}
              aria-busy={signingOut || undefined}
              aria-describedby={signOutBlock ? (block ? blockId : signOutBlockId) : undefined}
              onClick={() => onSignOut(server)}
            >
              {signingOut ? t("mcp.signIn.signingOut") : t("mcp.signIn.signOut")}
            </Button>
          )}
        </div>
        {/* What the buttons change, while they are offered; each sentence on its own line, so no locale has to join two.
            Only while something is stored for the URL: with nothing stored there is nothing to replace. */}
        {!block && !active && offersSignOut && <Line tone="dim">{t("mcp.signIn.replaces")}</Line>}
        {offersSignOut && !signOutBlock && !active && <Line tone="dim">{t("mcp.signIn.signOutExplain")}</Line>}
      </Lines>
    </ConfigDetailGridRow>
  );
}

/**
 * The page to open and the box for the address the browser lands on, never
 * focused by itself (a phone's keyboard would cover the link). Keyed by the
 * flow, so a new sign-in starts with an empty box.
 */
function McpSignInAuthorize({
  flow,
  pasting,
  pasteError,
  onPaste,
}: {
  flow: McpSignInFlowInfo;
  pasting: boolean;
  pasteError: McpActionFailure | undefined;
  onPaste: (value: string) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // The box waits while a paste is checked, which drops focus to the page; a
  // refused paste gives it back, so the address can be corrected at once.
  const wasPastingRef = useRef(pasting);
  useEffect(() => {
    const wasPasting = wasPastingRef.current;
    wasPastingRef.current = pasting;
    if (wasPasting && !pasting) focusIfLost(document, inputRef.current);
  }, [pasting]);
  const link = mcpSignInLink(flow.authorizationUrl);
  return (
    <>
      <OAuthPastePanel
        message={t("mcp.signIn.authorize.message")}
        hint={link ? (
          <>
            {t("mcp.signIn.authorize.link")}{" "}
            <a href={link} target="_blank" rel="noopener noreferrer">{revealHiddenCharacters(link)}</a>
          </>
        ) : (
          <>
            {t("mcp.signIn.authorize.notALink")}{" "}
            <McpCode>{revealHiddenCharacters(flow.authorizationUrl ?? "")}</McpCode>
          </>
        )}
        value={value}
        placeholder={t("mcp.signIn.paste.placeholder")}
        inputLabel={t("mcp.signIn.paste.label")}
        submitLabel={pasting ? t("mcp.signIn.paste.checking") : t("mcp.signIn.paste.submit")}
        disabled={pasting}
        plainEnterSubmits={false}
        inputRef={inputRef}
        onValueChange={setValue}
        onSubmit={() => onPaste(value)}
      />
      {pasteError && (
        <Line role="alert" tone="error">
          {t("mcp.signIn.paste.refused")} {signInFailureText(pasteError, t, "mcp.signIn.paste.timedOut")}
          {/* The authorization server's own words: what the pasted address carried as its error. */}
          {pasteError.reason === "redirect-denied" && pasteError.error && (
            <> <McpCode>{revealHiddenCharacters(pasteError.error)}</McpCode></>
          )}
        </Line>
      )}
      {flow.redirectUrl && (
        <Line tone="dim">
          {t("mcp.signIn.authorize.redirect", { url: revealHiddenCharacters(flow.redirectUrl) })}
        </Line>
      )}
      <Line tone="dim">{t("mcp.signIn.authorize.wait")}</Line>
    </>
  );
}

/**
 * How the panel's last sign-in ended, and for a failure the SDK's words. A
 * `shared` one names the entry it was recorded for instead of pointing at
 * this entry's Status row.
 */
function McpSignInOutcome({ flow, shared }: { flow: McpSignInFlowInfo; shared: boolean }) {
  const { t } = useI18n();
  const key = mcpSignInOutcomeKey(flow, shared);
  if (!key) return null;
  const tone = mcpSignInOutcomeTone(flow, shared);
  return (
    <>
      <Line role="status" tone={tone === "error" ? "error" : tone === "warning" ? "warning" : undefined}>{t(key, { name: revealHiddenCharacters(flow.name) })}</Line>
      {flow.error && (
        <Line tone="error">
          {t("mcp.test.error")} <McpCode>{revealHiddenCharacters(flow.error)}</McpCode>
        </Line>
      )}
    </>
  );
}
