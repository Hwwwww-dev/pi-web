"use client";

import { useI18n } from "@/hooks/useI18n";
import { parseContextWindow } from "@/lib/model-context";
import { Input } from "@/components/ui/input";

export interface ModelContextSettings {
  overrides?: Record<string, unknown>;
  disabled: boolean;
  onChange: (modelId: string, value: string | undefined) => void;
}

/**
 * Like custom-model fields, this edits the Models panel's draft, not the file.
 * Blank means no override; the placeholder is the window pi resolves now.
 */
export function ModelContextWindow({ modelName, effective, value, onChange, disabled = false, describedBy }: {
  modelName: string;
  effective?: number;
  value: unknown;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  const { t } = useI18n();
  const invalid = value !== undefined && parseContextWindow(value) === undefined;
  return (
    <Input
      type="text"
      inputMode="numeric"
      // Eight digits wide (ch follows the phones' 16px form text), and no
      // taller than the name and id beside it, so the row keeps its height.
      className="h-6 w-[calc(8ch+16px)] shrink-0 rounded-md border-input bg-background px-2 text-right font-mono"
      value={value === undefined ? "" : String(value)}
      placeholder={effective === undefined ? undefined : String(effective)}
      title={t("models.contextWindow")}
      aria-label={t("models.contextForModel", { model: modelName })}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value.trim() === "" ? undefined : event.target.value)}
    />
  );
}
