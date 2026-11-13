"use client";

import { useEffect, useMemo, useState } from "react";
import type { ToolEntry } from "@/lib/tool-presets";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
    <Empty className="flex-none items-start gap-0 border-0 p-3.5 text-left">
      <EmptyHeader className="items-start text-left">
        <EmptyTitle className="text-sm font-normal text-muted-foreground [overflow-wrap:anywhere]">{children}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

/** While the tools load, a few quiet rows stand in for the list. */
function LoadingRows() {
  return (
    <div className="flex-none p-2">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="mb-1 h-8" />
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
    // 高度随内容，超过 min(640px,70dvh) 时封顶。外层 flex 必需：其封顶后内层 grid 才有确定高度，
    // 两列各自的 overflow-auto 才能滚动（grid 行不会自行收缩）。
    <div className="flex max-h-[min(640px,70dvh)] min-h-0 flex-col overflow-hidden bg-card">
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] grid-cols-[clamp(140px,26%,220px)_minmax(0,1fr)] max-[640px]:grid-cols-[136px_minmax(0,1fr)]">
      <nav aria-label={translate("tools.title")} className="flex min-h-0 min-w-0 flex-col bg-muted/40">
        {/* 名称行始终折行，不横向溢出：x 轴锁定，行 min-w-0，超长名称折至第二行。 */}
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1.5">
          {declaredTools && declaredTools.length > 0 ? (
            <ItemGroup className="gap-0.5">
              {declaredTools.map((tool) => {
                const selected = tool.name === selectedTool?.name;
                return (
                  <Item asChild key={tool.name} size="xs" variant={selected ? "muted" : "default"}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedToolName(tool.name)}
                      className="cursor-pointer text-left hover:bg-muted"
                    >
                      <ItemContent>
                        <ItemTitle className="line-clamp-none w-full font-mono text-xs font-medium whitespace-normal [overflow-wrap:anywhere]">
                          {tool.name}
                        </ItemTitle>
                      </ItemContent>
                    </button>
                  </Item>
                );
              })}
            </ItemGroup>
          ) : declaredTools ? (
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
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            <FieldGroup className="gap-5">
              {selectedTool.description && (
                <Field>
                  <FieldLabel>{translate("tools.description")}</FieldLabel>
                  <FieldDescription className="whitespace-pre-wrap [overflow-wrap:anywhere]">{selectedTool.description}</FieldDescription>
                </Field>
              )}

              <Field>
                <FieldLabel>
                  {translate("tools.parameters")}
                  <span className="font-normal text-muted-foreground">{translate("tools.parameterCount", { count: fields.length })}</span>
                </FieldLabel>
                {fields.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{translate("tools.parameters")}</TableHead>
                        <TableHead>{translate("tools.description")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fields.map((field) => (
                        <TableRow key={field.name}>
                          <TableCell className="whitespace-normal align-top">
                            <code className="text-xs [overflow-wrap:anywhere]">{field.name}</code>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <code className="text-xs text-muted-foreground">{field.type}</code>
                              <Badge variant="outline">{translate(field.required ? "tools.required" : "tools.optional")}</Badge>
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-normal align-top text-muted-foreground">
                            {field.description && <span className="block [overflow-wrap:anywhere]">{field.description}</span>}
                            {field.allowedValues && (
                              <span className="block text-xs">
                                {translate("tools.allowedValues")}: <code>{field.allowedValues}</code>
                              </span>
                            )}
                            {field.defaultValue !== undefined && (
                              <span className="block text-xs">
                                {translate("tools.defaultValue")}: <code>{field.defaultValue}</code>
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <FieldDescription>{translate("tools.noParameters")}</FieldDescription>
                )}
              </Field>

              {selectedTool.promptGuidelines && selectedTool.promptGuidelines.length > 0 && (
                <Field>
                  <FieldLabel>{translate("tools.guidelines")}</FieldLabel>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
                    {selectedTool.promptGuidelines.map((guideline, index) => (
                      <li key={`${selectedTool.name}:${index}`}>{guideline}</li>
                    ))}
                  </ul>
                </Field>
              )}
            </FieldGroup>
          </div>
        ) : declaredTools ? (
          <EmptyState>{translate("tools.noTools")}</EmptyState>
        ) : loading ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-3">
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
    </div>
  );
}
