"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type {
  McpConfigFieldRef,
  McpConfigFileInfo,
  McpErrorResponse,
  McpOverrideKey,
  McpRefusalReason,
  McpServerInfo,
  ProjectMcpListing,
  ProjectTrustResponse,
  ProjectTrustStatus,
} from "@/lib/api-types";
import {
  mcpFieldLabel,
  mcpFileProblemDetail,
  mcpOverrideNotice,
  mcpServerHasHiddenCharacters,
  mcpServerTarget,
  mcpVariableChips,
  mcpVariableReferencesKey,
  revealHiddenCharacters,
} from "@/lib/mcp-server-display";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "./ui/alert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { Skeleton } from "./ui/skeleton";

/** How long the dialog waits for the listing before it stops holding Trust back. */
export const MCP_LISTING_TIMEOUT_MS = 10_000;

/** Why trusting failed: a route refusal carries its `reason`; a network failure has none. */
export interface ProjectTrustFailure {
  error: string;
  reason?: McpRefusalReason;
}

/** What the dialog knows about the project's `.pi/mcp.json`, and its trust as the same answer read it. */
export type ProjectTrustMcpListing =
  | { state: "loading" }
  | { state: "failed"; error?: string; reason?: McpRefusalReason; timedOut?: boolean }
  | {
      state: "loaded";
      listing: ProjectMcpListing;
      /** Absent when `trust.json` could not be read; see `statusError`. */
      status?: ProjectTrustStatus;
      statusError?: string;
    };

const STATUS_ID = "project-trust-mcp-status";
const NOTICE_ID = "project-trust-notice";

/** A line of the section: 12px; secondary lines only dimmer or warning, never smaller. */
function Line({ tone, className, ...props }: { tone?: "muted" | "dim" | "warning" } & React.ComponentProps<"p">) {
  return (
    <p
      {...props}
      className={cn(
        "mt-1.5 text-xs leading-normal [overflow-wrap:anywhere]",
        tone === "muted" && "text-muted-foreground",
        tone === "dim" && "text-muted-foreground",
        tone === "warning" && "text-warning",
        className,
      )}
    />
  );
}

/** Literal text (a path, an error, a field name) as code: hidden characters shown escaped by the caller.
    Repository text keeps ordinary white-space collapsing — its own runs of spaces or newlines stay invisible. */
function McpCode({ dim = false, block = false, className, children }: { dim?: boolean; block?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <code
      className={cn(
        "font-mono text-xs",
        block ? "mt-1 block" : "inline-block",
        dim ? "text-muted-foreground" : "text-foreground",
        className,
      )}
    >
      {children}
    </code>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function trustStatusFrom(data: ProjectTrustResponse): ProjectTrustStatus {
  const status: ProjectTrustStatus = {
    requiresTrust: data.requiresTrust,
    trusted: data.trusted,
    decision: data.decision,
    inherited: data.inherited,
  };
  if (data.decisionPath !== undefined) status.decisionPath = data.decisionPath;
  if (data.decisionError !== undefined) status.decisionError = data.decisionError;
  return status;
}

/** The listing and the status a GET answer carries; a 500 for an unreadable trust store still carries the listing. */
export function projectTrustListingFrom(
  ok: boolean,
  status: number,
  data: Partial<ProjectTrustResponse & McpErrorResponse>,
): ProjectTrustMcpListing {
  const listing: ProjectMcpListing | undefined = Array.isArray(data.mcpServers)
    ? {
        mcpServers: data.mcpServers,
        ...(data.mcpFile ? { mcpFile: data.mcpFile } : {}),
        ...(data.mcpError !== undefined ? { mcpError: data.mcpError } : {}),
      }
    : undefined;
  if (ok && !data.error && listing && typeof data.requiresTrust === "boolean") {
    return { state: "loaded", listing, status: trustStatusFrom(data as ProjectTrustResponse) };
  }
  if (data.reason === "trust-unreadable" && listing) {
    return { state: "loaded", listing, statusError: data.error ?? `HTTP ${status}` };
  }
  return { state: "failed", error: data.error ?? `HTTP ${status}`, reason: data.reason };
}

/** Why the dialog no longer offers Trust: the folder's trust changed since the page read it. */
function settledTrustNotice(status: ProjectTrustStatus | undefined): string | undefined {
  if (!status) return undefined;
  if (!status.requiresTrust) return "mcp.reason.trust-not-required";
  if (status.trusted) return "trust.alreadyTrusted";
  return undefined;
}

/**
 * Asks before trusting a project, and lists what its `.pi/mcp.json` would
 * connect once trusted (ADR 0006: the visibility that replaced per-entry
 * approval). The listing is fetched when the dialog opens, not taken from the
 * status the page loaded with: the file can change in between. Trust waits for
 * it, so the list cannot appear under a click already on its way, but a
 * listing that fails or takes too long stops holding Trust back. The same
 * answer carries the folder's trust as it is now, which goes to `onStatus`;
 * a folder trusted meanwhile, or no longer needing trust, is no longer offered
 * Trust. It opens from the page's restricted-mode banner and from Settings ›
 * MCP's trust notice, above Settings, so Escape closes it alone.
 */
export function ProjectTrustDialog({
  cwd,
  busy,
  error,
  onCancel,
  onConfirm,
  onStatus,
}: {
  cwd: string;
  busy: boolean;
  error: ProjectTrustFailure | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** The fresh status the dialog read, so the page's restricted-mode banner can follow it. */
  onStatus?: (status: ProjectTrustStatus) => void;
}) {
  const [listing, setListing] = useState<ProjectTrustMcpListing>({ state: "loading" });
  // Read through a ref, so a new callback on every page render does not fetch again.
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    let active = true;
    let timedOut = false;
    setListing({ state: "loading" });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, MCP_LISTING_TIMEOUT_MS);
    fetch(`/api/project-trust?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as Partial<ProjectTrustResponse & McpErrorResponse>;
        if (!active) return;
        const next = projectTrustListingFrom(response.ok, response.status, data);
        setListing(next);
        if (next.state === "loaded" && next.status) onStatusRef.current?.(next.status);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setListing(timedOut ? { state: "failed", timedOut: true } : { state: "failed", error: errorMessage(reason) });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cwd]);

  return (
    <ProjectTrustDialogView
      cwd={cwd}
      busy={busy}
      error={error}
      listing={listing}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

/** The dialog for a listing in any state, without the fetch. */
function ProjectTrustDialogView({
  cwd,
  busy,
  error,
  listing,
  onCancel,
  onConfirm,
}: {
  cwd: string;
  busy: boolean;
  error: ProjectTrustFailure | null;
  listing: ProjectTrustMcpListing;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // The dialog can open above Settings › MCP: both are Radix layers, so
  // Escape closes the topmost one only, focus moves into it as it opens and
  // back to what had it once it closes. Escape is ignored while trusting,
  // like the Cancel button, but still never reaches Settings.
  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <AlertDialogContent
        className="settings-phone-safe z-[1100] flex max-h-[100dvh] w-[480px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-xl p-0"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <ProjectTrustDialogBody cwd={cwd} busy={busy} error={error} listing={listing} onCancel={onCancel} onConfirm={onConfirm} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The dialog's content: Radix's portal does not render server-side, so tests render this inside an open root. */
export function ProjectTrustDialogBody({
  cwd,
  busy,
  error,
  listing,
  onCancel,
  onConfirm,
}: {
  cwd: string;
  busy: boolean;
  error: ProjectTrustFailure | null;
  listing: ProjectTrustMcpListing;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const loading = listing.state === "loading";
  const notice = listing.state === "loaded" ? settledTrustNotice(listing.status) : undefined;

  return (
    <>
      <div className="flex min-h-0 gap-3 overflow-auto px-[18px] pt-[18px] pb-3.5 [overscroll-behavior:contain]">
        <ShieldCheck aria-hidden="true" strokeWidth={2} className="mt-px size-5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <AlertDialogTitle id="project-trust-title" className="text-base font-bold text-foreground">
            {t("trust.dialogTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription id="project-trust-description" className="mt-[7px] text-xs leading-[1.6] text-muted-foreground">
            {t("trust.dialogBody")}
          </AlertDialogDescription>
          <code className="mt-2.5 block rounded-sm border border-border bg-background px-2.5 py-2 font-mono text-xs text-foreground [overflow-wrap:anywhere]">
            {revealHiddenCharacters(cwd)}
          </code>
          {notice && <p id={NOTICE_ID} role="status" className="mt-2.5 text-xs leading-normal text-foreground">{t(notice)}</p>}
          {listing.state === "loaded" && listing.statusError !== undefined && (
            <div className="mt-3">
              <Line tone="warning">{t("mcp.reason.trust-unreadable")}</Line>
              <McpCode dim block className="[overflow-wrap:anywhere]">{revealHiddenCharacters(listing.statusError)}</McpCode>
            </div>
          )}
          <ProjectTrustMcpSection listing={listing} />
        </div>
      </div>
      {/* Outside the scrolling body, so a long server list cannot hide it. */}
      {error && <ProjectTrustError error={error} />}
      <Separator />
      <div className="flex shrink-0 justify-end gap-2 px-[18px] py-2.5">
        {/* A plain button rather than AlertDialogCancel: the page unmounts the
            dialog on cancel, so no Radix close bookkeeping is needed. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs"
          disabled={busy}
          onClick={onCancel}
        >
          {notice ? t("trust.close") : t("trust.cancel")}
        </Button>
        {/* A plain button: confirming keeps the dialog open while it trusts;
            the page closes it when the run settles. */}
        {!notice && (
          <Button
            type="button"
            size="sm"
            className="text-xs aria-busy:cursor-wait"
            onClick={onConfirm}
            disabled={busy || loading}
            aria-busy={busy || undefined}
            aria-describedby={loading ? STATUS_ID : undefined}
          >
            {busy ? t("trust.trusting") : t("trust.trustProject")}
          </Button>
        )}
      </div>
    </>
  );
}

/** Why trusting failed: the translated reason, or for an internal or network failure its diagnostic. */
function ProjectTrustError({ error }: { error: ProjectTrustFailure }) {
  const { t } = useI18n();
  const translated = error.reason !== undefined && error.reason !== "internal";
  return (
    <Alert variant="destructive" className="mx-[18px] mb-2.5 max-h-[30vh] min-w-0 shrink-0 overflow-auto">
      <AlertDescription className="col-start-2 min-w-0 gap-1 text-xs leading-normal">
        {translated ? t(`mcp.reason.${error.reason}`) : t("trust.trustFailed")}
        {!translated && <McpCode block className="[overflow-wrap:anywhere]">{revealHiddenCharacters(error.error)}</McpCode>}
      </AlertDescription>
    </Alert>
  );
}

/** The trust dialog's list of the project's MCP servers; exported for tests. */
export function ProjectTrustMcpSection({ listing }: { listing: ProjectTrustMcpListing }) {
  const { t } = useI18n();
  if (listing.state === "loading") {
    return (
      <div>
        <p id={STATUS_ID} role="status" className="mt-3 text-xs leading-normal text-muted-foreground">{t("trust.mcp.loading")}</p>
        <Skeleton className="mt-2 h-3 w-40" />
      </div>
    );
  }
  if (listing.state === "failed" || listing.listing.mcpError !== undefined || !listing.listing.mcpFile) {
    let detail: string | undefined;
    if (listing.state === "failed") {
      // An internal failure has nothing to translate: its diagnostic is the reason.
      detail = listing.reason && listing.reason !== "internal" ? t(`mcp.reason.${listing.reason}`) : listing.error;
    } else {
      detail = listing.listing.mcpError;
    }
    const timedOut = listing.state === "failed" && listing.timedOut;
    return (
      <div className="mt-3">
        <Line tone="warning">{t(timedOut ? "trust.mcp.timedOut" : "trust.mcp.loadFailed")}</Line>
        {detail && <McpCode dim block className="[overflow-wrap:anywhere]">{revealHiddenCharacters(detail)}</McpCode>}
      </div>
    );
  }

  const { mcpFile: file, mcpServers: servers } = listing.listing;
  // No file and nothing wrong with one: there is nothing about MCP to say.
  if (!file.exists && file.problems.length === 0) return null;
  return (
    <section className="mt-3.5" aria-labelledby="project-trust-mcp-title">
      <div id="project-trust-mcp-title" className="text-xs font-semibold text-foreground">{t("trust.mcp.title")}</div>
      {servers.length > 0 && <p className="mt-1.5 text-xs leading-normal text-muted-foreground">{t("trust.mcp.intro")}</p>}
      <McpFileProblems file={file} />
      {servers.length === 0 && file.problems.length === 0 && (
        <Line>{t("trust.mcp.none")}</Line>
      )}
      {servers.some((server) => !server.validated) && (
        <Line>{t("trust.mcp.unchecked")}</Line>
      )}
      {servers.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-2">
          {servers.map((server) => <McpServerItem key={server.name} server={server} />)}
        </ul>
      )}
    </section>
  );
}

function McpFileProblems({ file }: { file: McpConfigFileInfo }) {
  const { t } = useI18n();
  return (
    <>
      {file.problems.map((problem) => {
        const detail = mcpFileProblemDetail(problem, file.realPath);
        return (
          <div key={problem.reason} className="mt-1.5">
            <Line tone="warning">{t(`mcp.fileProblem.${problem.reason}`)}</Line>
            {detail && <McpCode dim block className="[overflow-wrap:anywhere]">{detail}</McpCode>}
          </div>
        );
      })}
    </>
  );
}

function McpFieldChips({ fields }: { fields: McpConfigFieldRef[] }) {
  const { t } = useI18n();
  return (
    <>
      {fields.map((field) => {
        const label = mcpFieldLabel(field);
        return (
          <code key={`${field.kind}\0${field.name ?? ""}`} className="mr-1 mt-0.5 inline-block rounded-[3px] bg-secondary px-1 py-px font-mono text-xs text-foreground [overflow-wrap:anywhere]">
            {t(label.key, label.params)}
          </code>
        );
      })}
    </>
  );
}

function McpVariableChips({ server }: { server: McpServerInfo }) {
  const { t } = useI18n();
  return (
    <>
      {mcpVariableChips(server.variableReferences).map(({ variable, field }) => {
        const label = mcpFieldLabel(field);
        return (
          <code key={`${variable}\0${field.kind}\0${field.name ?? ""}`} className="mr-1 mt-0.5 inline-block rounded-[3px] bg-secondary px-1 py-px font-mono text-xs text-foreground [overflow-wrap:anywhere]">
            {t("mcp.server.variableIn", { variable, field: t(label.key, label.params) })}
          </code>
        );
      })}
    </>
  );
}

function McpServerItem({ server }: { server: McpServerInfo }) {
  const { t } = useI18n();
  const overrideText = (keys: McpOverrideKey[]) => {
    const notice = mcpOverrideNotice(keys);
    return t(notice.key, notice.params);
  };
  const target = mcpServerTarget(server);
  // A refused entry never connects, so nothing in it runs or is sent.
  const connects = server.invalidError === undefined;
  return (
    <li className="min-w-0 rounded-sm border border-border bg-background px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 text-xs font-semibold text-foreground [overflow-wrap:anywhere]">{revealHiddenCharacters(server.name)}</span>
        {server.transport && (
          <Badge variant="secondary" className="shrink-0 rounded-[3px] px-[5px] py-px text-xs text-muted-foreground">
            {t(`mcp.transport.${server.transport}`)}
          </Badge>
        )}
      </div>
      {target !== undefined && (
        <code className="mt-1.5 block font-mono text-xs leading-normal text-foreground [overflow-wrap:anywhere]">{target}</code>
      )}
      {server.cwd !== undefined && (
        <Line>{t("trust.mcp.cwd", { path: revealHiddenCharacters(server.cwd) })}</Line>
      )}
      {mcpServerHasHiddenCharacters(server) && (
        <Line tone="warning">{t("mcp.server.hiddenCharacters")}</Line>
      )}
      {server.invalidError !== undefined && (
        <Line tone="warning">
          {t("mcp.server.invalid")} <McpCode className="[overflow-wrap:anywhere]">{revealHiddenCharacters(server.invalidError)}</McpCode>
        </Line>
      )}
      {server.webPasswordField && (
        <Line tone="warning">
          {t("mcp.server.webPassword")} <McpFieldChips fields={[server.webPasswordField]} />
        </Line>
      )}
      {!server.enabled && <Line>{t("mcp.server.disabled")}</Line>}
      {connects && server.commandFields.length > 0 && (
        <Line tone="warning">
          {t("mcp.server.commandFields")} <McpFieldChips fields={server.commandFields} />
        </Line>
      )}
      {connects && server.variableReferences.length > 0 && (
        <Line tone="warning">
          {t(mcpVariableReferencesKey(server))} <McpVariableChips server={server} />
        </Line>
      )}
      {server.replacesGlobal && <Line tone="warning">{t("mcp.server.replacesGlobal")}</Line>}
      {server.override && <Line tone="warning">{overrideText(server.override.keys)}</Line>}
      {server.masked && <Line tone="dim">{t("mcp.server.masked")}</Line>}
    </li>
  );
}
