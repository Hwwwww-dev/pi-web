import { NextResponse } from "next/server";
import {
  ADVANCED_SETTINGS,
  advancedSettingSpec,
  defaultAdvancedSettings,
  normalizeAdvancedSettings,
  type AdvancedSettingValue,
  type AdvancedSettings,
} from "@/lib/advanced-settings";
import { readAdvancedSettings, resetAdvancedSettings, writeAdvancedSettings } from "@/lib/advanced-settings-file";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// Settings › Advanced: one GET/PATCH pair for the whole parameter table. The
// spec (defaults, ranges, gating) lives in lib/advanced-settings.ts and travels
// with the client bundle, so a response only carries the values.

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json({
      values: readAdvancedSettings(),
      defaults: defaultAdvancedSettings(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function readPatch(body: unknown): Record<string, AdvancedSettingValue> | { error: string } {
  const entries = (body as { values?: unknown } | null)?.values;
  if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
    return { error: "values must be an object" };
  }
  const patch: Record<string, AdvancedSettingValue> = {};
  for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
    // An unknown key is a client that is older or newer than this build: the
    // page shows the table this build knows, so a stray key is dropped, not an
    // error — but a wrong type for a known key is a real bug and says so.
    const spec = advancedSettingSpec(key);
    if (!spec) continue;
    if (spec.kind === "switch" && typeof value !== "boolean") return { error: `${key} must be a boolean` };
    if (spec.kind === "number" && typeof value !== "number") return { error: `${key} must be a number` };
    if (spec.kind === "choice" && typeof value !== "string") return { error: `${key} must be a string` };
    patch[key] = value as AdvancedSettingValue;
  }
  return patch;
}

export async function PATCH(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if ((body as { reset?: unknown } | null)?.reset === true) {
    try {
      return NextResponse.json({ values: await resetAdvancedSettings() });
    } catch (error) {
      return errorResponse(error);
    }
  }
  const patch = readPatch(body);
  if ("error" in patch) return NextResponse.json({ error: patch.error }, { status: 400 });
  try {
    const values: AdvancedSettings = await writeAdvancedSettings(patch);
    return NextResponse.json({ values: normalizeAdvancedSettings(values) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** The table itself, for a client that wants to render before it has any values. */
export async function OPTIONS() {
  return NextResponse.json({ spec: ADVANCED_SETTINGS });
}
