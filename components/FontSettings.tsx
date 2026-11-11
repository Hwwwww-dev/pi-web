"use client";

import { useI18n } from "@/hooks/useI18n";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import { FONT_FAMILY_MAX_LENGTH, FONT_WEIGHT_DEFAULT, FONT_WEIGHT_OPTIONS } from "@/lib/font-preferences";
import { ConfigButton } from "./SettingsUi";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Slider } from "./ui/slider";
import { RotateCcwIcon } from "lucide-react";

const FONT_FIELDS = [
  { kind: "ui", label: "settings.uiFontFamily", placeholder: "settings.uiFontPlaceholder", reset: "settings.resetUiFont", weightLabel: "settings.uiFontWeight" },
  { kind: "mono", label: "settings.monoFontFamily", placeholder: "settings.monoFontPlaceholder", reset: "settings.resetMonoFont", weightLabel: "settings.monoFontWeight" },
] as const;

/**
 * Rows for the Fonts & layout section, shaped like the size and width rows below:
 * label, name field, weight name (Light, Regular, …) and reset on one line, the
 * weight slider under it. One shared grid, so the name fields start at the same
 * x whatever the labels' widths; each Field is a subgrid row of it.
 * The name field is drawn in the font it names, so it doubles as the preview.
 */
export function FontSettings() {
  const { t } = useI18n();
  const fonts = useFontPreferences();

  return (
    <div className="grid w-full grid-cols-[max-content_minmax(0,1fr)_auto_auto] gap-x-2 gap-y-4">
      {FONT_FIELDS.map(({ kind, label, placeholder, reset, weightLabel }) => {
        const weight = fonts[`${kind}Weight`];
        const weightIndex = FONT_WEIGHT_OPTIONS.findIndex((option) => option.value === weight);
        return (
          <Field
            key={kind}
            className="col-span-full grid grid-cols-subgrid items-center gap-y-1.5"
          >
            <FieldLabel htmlFor={`settings-font-${kind}`} className="pr-1 text-[13px] font-normal">
              {t(label)}
            </FieldLabel>
            <Input
              id={`settings-font-${kind}`}
              // The field is drawn in the font it names: the live preview.
              className={`h-[26px] px-2 ${kind === "mono" ? "[font-family:var(--font-mono)] [font-weight:var(--font-mono-weight)]" : "[font-family:var(--font-ui)] [font-weight:var(--font-ui-weight)]"} max-[640px]:h-8`}
              type="text"
              value={fonts[kind]}
              placeholder={t(placeholder)}
              maxLength={FONT_FAMILY_MAX_LENGTH}
              aria-describedby="settings-typography-description"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => fonts.setFontPreference(kind, event.target.value)}
            />
            <output
              className="min-w-[11ch] text-right text-xs text-muted-foreground"
              title={`${t(weightLabel)}: ${weight}`}
            >
              {t(FONT_WEIGHT_OPTIONS[weightIndex].label)}
            </output>
            <ConfigButton
              variant="ghost"
              size="small"
              className="size-7 p-0"
              title={t(reset)}
              aria-label={t(reset)}
              disabled={!fonts[kind] && weight === FONT_WEIGHT_DEFAULT}
              onClick={() => fonts.resetFontPreference(kind)}
            >
              <RotateCcwIcon size={14} strokeWidth={1.8} />
            </ConfigButton>
            <Slider
              className="col-span-full"
              min={FONT_WEIGHT_OPTIONS[0].value}
              max={FONT_WEIGHT_OPTIONS[FONT_WEIGHT_OPTIONS.length - 1].value}
              step={100}
              value={[weight]}
              aria-label={t(weightLabel)}
              aria-valuetext={`${weight} ${t(FONT_WEIGHT_OPTIONS[weightIndex].label)}`}
              onValueChange={(values) => fonts.setFontWeight(kind, values[0])}
            />
          </Field>
        );
      })}
    </div>
  );
}
