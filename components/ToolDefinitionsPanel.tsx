"use client";

import { useEffect, useMemo, useState } from "react";
import type { ToolEntry } from "@/lib/tool-presets";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  loading: boolean;
  tools: ToolEntry[] | null;
  translate: Translate;
}

interface ParameterField {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  allowedValues?: string;
  defaultValue?: string;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatSchemaType(schema: Record<string, unknown>): string {
  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : null;
  if (variants) {
    return variants
      .map((variant) => variant && typeof variant === "object"
        ? formatSchemaType(variant as Record<string, unknown>)
        : "unknown")
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(" | ");
  }

  if (schema.const !== undefined) return formatValue(schema.const);
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.type === undefined) {
    return [...new Set(schema.enum.map((value) => value === null ? "null" : typeof value))].join(" | ");
  }

  const rawType = schema.type;
  const type = Array.isArray(rawType)
    ? rawType.filter((value): value is string => typeof value === "string").join(" | ")
    : typeof rawType === "string"
      ? rawType
      : typeof schema.$ref === "string"
        ? schema.$ref.split("/").pop() ?? "object"
        : "unknown";

  if (type === "array") {
    const items = schema.items;
    const itemType = items && typeof items === "object"
      ? formatSchemaType(items as Record<string, unknown>)
      : "unknown";
    return `${itemType}[]`;
  }
  return type;
}

export function getToolParameterFields(parameters?: Record<string, unknown>): ParameterField[] {
  if (!parameters || !parameters.properties || typeof parameters.properties !== "object") return [];
  const properties = parameters.properties as Record<string, unknown>;
  const required = new Set(
    Array.isArray(parameters.required)
      ? parameters.required.filter((value): value is string => typeof value === "string")
      : [],
  );

  return Object.entries(properties).map(([name, value]) => {
    const schema = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      name,
      type: formatSchemaType(schema),
      description: typeof schema.description === "string" ? schema.description : undefined,
      required: required.has(name),
      allowedValues: Array.isArray(schema.enum) ? schema.enum.map(formatValue).join(", ") : undefined,
      defaultValue: schema.default === undefined ? undefined : formatValue(schema.default),
    };
  });
}

/** An inline "nothing yet" line: the Empty state, compact and left-aligned like the pane's text. */
function EmptyState({ children }: { children: string }) {
  return (
    <Empty className="flex-none items-start gap-0 rounded-none border-0 p-3.5 text-left md:p-3.5">
      <EmptyHeader className="items-start text-left">
        <EmptyTitle className="text-xs font-normal italic text-muted-foreground [overflow-wrap:anywhere]">{children}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

/** While the tools load, a few quiet rows stand in for the list. */
function LoadingRows() {
  return (
    <div className="flex-none px-2 py-2">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="mb-px h-9 rounded-none" />
      ))}
    </div>
  );
}

export function ToolDefinitionsPanel({ loading, tools, translate }: Props) {
  // What the model is sent: under codemode's "only" mode the active built-in tools are reached
  // from scripts, and codemode's description lists them.
  const declaredTools = useMemo(
    () => tools?.filter((tool) => tool.active && !tool.declarationHidden) ?? null,
    [tools],
  );
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);

  useEffect(() => {
    setSelectedToolName((current) => (
      declaredTools?.some((tool) => tool.name === current)
        ? current
        : declaredTools?.[0]?.name ?? null
    ));
  }, [declaredTools]);

  const selectedTool = declaredTools?.find((tool) => tool.name === selectedToolName)
    ?? declaredTools?.[0]
    ?? null;
  const fields = selectedTool ? getToolParameterFields(selectedTool.parameters) : [];

  return (
    <div className="grid h-[min(600px,75dvh)] min-h-60 grid-cols-[clamp(112px,26%,220px)_minmax(0,1fr)] overflow-hidden border-b bg-card max-[640px]:grid-cols-[112px_minmax(0,1fr)]">
      <nav
        aria-label={translate("tools.title")}
        className="flex min-h-0 min-w-0 flex-col border-r bg-[color-mix(in_srgb,var(--bg-panel)_94%,var(--bg))]"
      >
        <div className="min-h-0 flex-1 overflow-auto">
          {declaredTools && declaredTools.length > 0 ? declaredTools.map((tool) => {
            const selected = tool.name === selectedTool?.name;
            return (
              // A pressed list row, not a command Button: its hover is the dim bg-secondary,
              // which Button's variants do not carry (ghost hovers on the selected bg-accent).
              <button
                key={tool.name}
                type="button"
                data-selected={selected}
                aria-pressed={selected}
                onClick={() => setSelectedToolName(tool.name)}
                className="flex min-h-[38px] w-full cursor-pointer items-center border-b border-border bg-transparent px-3 py-2 text-left text-muted-foreground hover:bg-secondary hover:text-foreground data-[selected=true]:bg-accent data-[selected=true]:text-foreground data-[selected=true]:shadow-[inset_2px_0_0_var(--accent)] max-[640px]:px-2.5"
              >
                <code className="max-w-full text-[11px] font-semibold [overflow-wrap:anywhere]">{tool.name}</code>
              </button>
            );
          }) : declaredTools ? (
            <EmptyState>{translate("tools.noTools")}</EmptyState>
          ) : loading ? (
            <LoadingRows />
          ) : (
            <EmptyState>{translate("tools.load")}</EmptyState>
          )}
        </div>
      </nav>

      <section aria-label={translate("tools.details")} className="flex min-h-0 min-w-0 flex-col">
        {selectedTool ? (
          <div className="min-h-0 flex-1 overflow-auto p-3.5 pb-5 max-[640px]:p-3">
            {selectedTool.description && (
              <section className="flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold text-dim">{translate("tools.description")}</div>
                <div className="whitespace-pre-wrap text-xs/relaxed text-muted-foreground [overflow-wrap:anywhere]">{selectedTool.description}</div>
              </section>
            )}

            <section className={cn("flex flex-col gap-1.5", selectedTool.description && "mt-[18px]")}>
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-dim">
                <span>{translate("tools.parameters")}</span>
                <span className="whitespace-nowrap font-normal">{translate("tools.parameterCount", { count: fields.length })}</span>
              </div>
              {fields.length > 0 ? (
                <div className="border-t border-border">
                  {fields.map((field) => (
                    <div
                      className="grid grid-cols-[minmax(88px,0.75fr)_minmax(0,1.5fr)] gap-3 border-b border-border py-2.5 text-[11px]/[1.45] max-[640px]:grid-cols-[minmax(74px,0.7fr)_minmax(0,1.3fr)] max-[640px]:gap-2"
                      key={field.name}
                    >
                      <div className="flex min-w-0 flex-col gap-[3px] text-foreground">
                        <code className="[overflow-wrap:anywhere]">{field.name}</code>
                        <Badge
                          variant="outline"
                          className={cn("w-fit border-current/35 px-1 py-0 font-mono text-[10px] leading-[14px]", field.required ? "text-primary" : "text-dim")}
                        >
                          {translate(field.required ? "tools.required" : "tools.optional")}
                        </Badge>
                      </div>
                      <div className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
                        <code className="mb-[3px] block text-foreground">{field.type}</code>
                        {field.description && <div>{field.description}</div>}
                        {field.allowedValues && (
                          <div className="mt-1 text-dim">
                            {translate("tools.allowedValues")}: <code className="text-muted-foreground">{field.allowedValues}</code>
                          </div>
                        )}
                        {field.defaultValue !== undefined && (
                          <div className="mt-1 text-dim">
                            {translate("tools.defaultValue")}: <code className="text-muted-foreground">{field.defaultValue}</code>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pb-2.5 pt-0.5 text-[11px] text-dim">{translate("tools.noParameters")}</div>
              )}
            </section>

            {selectedTool.promptGuidelines && selectedTool.promptGuidelines.length > 0 && (
              <section className="mt-[18px] flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold text-dim">{translate("tools.guidelines")}</div>
                <ul className="m-0 pl-[18px] text-[11px]/[1.5] text-muted-foreground">
                  {selectedTool.promptGuidelines.map((guideline, index) => (
                    <li key={`${selectedTool.name}:${index}`}>{guideline}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        ) : declaredTools ? (
          <EmptyState>{translate("tools.noTools")}</EmptyState>
        ) : loading ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3.5 pb-5 max-[640px]:p-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-full max-w-md" />
            <Skeleton className="h-3 w-full max-w-sm" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : (
          <EmptyState>{translate("tools.load")}</EmptyState>
        )}
      </section>
    </div>
  );
}
