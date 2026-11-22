"use client";

import { useMemo, useState } from "react";
import { DownloadIcon, RotateCcwIcon, SearchIcon, UploadIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { useAdvancedSettings, useAdvancedSettingsActions } from "@/hooks/useAdvancedSettings";
import {
  ADVANCED_GROUPS,
  ADVANCED_SETTINGS,
  defaultAdvancedSettings,
  isAdvancedSettingVisible,
  normalizeAdvancedSettings,
  type AdvancedChoiceSpec,
  type AdvancedNumberSpec,
  type AdvancedSettingEffect,
  type AdvancedSettingSpec,
  type AdvancedSettings,
  type AdvancedSwitchSpec,
  type LocalizedText,
} from "@/lib/advanced-settings";
import {
  ConfigButton,
  ConfigCard,
  ConfigPanelShell,
  ConfigSwitch,
} from "@/components/SettingsUi";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Settings › 高级参数: 每一个写死在代码里的手感参数都变成可调。
 *
 * 三项页面约定（用户已定）：
 * 1. 每个参数旁标生效方式 —— 改完立刻生效 / 下一条消息生效 / 需刷新页面。
 * 2. 「常用 / 专家」两级：调了容易让人以为程序坏了的参数默认收起。
 * 3. 主开关关掉时子项**整行隐藏**，不是置灰。
 *
 * 参数表本身在 `lib/advanced-settings.ts`：默认值、范围、门控、三种语言的
 * 名字都写在一处，页面只负责画。
 */

/** 参数名与说明按当前语言取；未知语言落回中文（与 i18n 的兜底一致）。 */
export function localized(text: LocalizedText, locale: string): string {
  if (locale === "en") return text.en;
  if (locale === "zh-TW") return text.tw;
  return text.zh;
}

const EFFECT_LABEL: Record<AdvancedSettingEffect, LocalizedText> = {
  live: { zh: "改完立刻生效", tw: "改完立刻生效", en: "Applies immediately" },
  "next-message": { zh: "下一条消息生效", tw: "下一條訊息生效", en: "Applies to the next message" },
  reload: { zh: "需刷新页面", tw: "需重新整理頁面", en: "Needs a page reload" },
};

function EffectTag({ effect, locale }: { effect: AdvancedSettingEffect; locale: string }) {
  return (
    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-4 text-muted-foreground">
      {localized(EFFECT_LABEL[effect], locale)}
    </span>
  );
}

/** 一行参数：官方 Field（横向）——左边名字与说明，右边控件；改过默认值才出现「恢复默认」。 */
function AdvancedRow({
  spec,
  locale,
  changed,
  onReset,
  children,
}: {
  spec: AdvancedSettingSpec;
  locale: string;
  changed: boolean;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <Field orientation="horizontal" data-advanced-setting={spec.key}>
      <FieldContent className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <FieldTitle className="text-sm font-medium">{localized(spec.label, locale)}</FieldTitle>
          <EffectTag effect={spec.effect} locale={locale} />
          {changed && (
            <ConfigButton
              variant="ghost"
              size="small"
              className="h-5 px-1 text-muted-foreground"
              onClick={onReset}
              title={locale === "en" ? "Reset to default" : "恢复默认"}
              aria-label={locale === "en" ? "Reset to default" : "恢复默认"}
            >
              <RotateCcwIcon className="size-3" />
            </ConfigButton>
          )}
        </div>
        {spec.hint && <FieldDescription className="text-xs">{localized(spec.hint, locale)}</FieldDescription>}
      </FieldContent>
      <div className="flex shrink-0 items-center">{children}</div>
    </Field>
  );
}

function SwitchRow({
  spec,
  locale,
  value,
  onChange,
  onReset,
}: {
  spec: AdvancedSwitchSpec;
  locale: string;
  value: boolean;
  onChange: (next: boolean) => void;
  onReset: () => void;
}) {
  return (
    <AdvancedRow spec={spec} locale={locale} changed={value !== spec.default} onReset={onReset}>
      <ConfigSwitch checked={value} label={localized(spec.label, locale)} onChange={onChange} />
    </AdvancedRow>
  );
}

/**
 * 数字项：本地草稿 + 提交时钳制。
 *
 * 边打边 PATCH 会把 `1` 当成终值（从 16 改成 120 时会先写 1 再写 12），所以
 * 只有失焦或回车才提交，服务端仍按范围再钳一次。
 */
function NumberRow({
  spec,
  locale,
  value,
  onChange,
  onReset,
}: {
  spec: AdvancedNumberSpec;
  locale: string;
  value: number;
  onChange: (next: number) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
    if (!Number.isFinite(parsed)) return;
    const bounded = Math.min(spec.max, Math.max(spec.min, parsed));
    if (bounded !== value) onChange(bounded);
  };
  return (
    <AdvancedRow spec={spec} locale={locale} changed={value !== spec.default} onReset={onReset}>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          inputMode="decimal"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={draft ?? String(value)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setDraft(null);
          }}
          aria-label={localized(spec.label, locale)}
          className="h-8 w-24 text-right tabular-nums"
        />
        {spec.unit && <span className="w-6 shrink-0 text-xs text-muted-foreground">{spec.unit}</span>}
      </div>
    </AdvancedRow>
  );
}

function ChoiceRow({
  spec,
  locale,
  value,
  onChange,
  onReset,
}: {
  spec: AdvancedChoiceSpec;
  locale: string;
  value: string;
  onChange: (next: string) => void;
  onReset: () => void;
}) {
  return (
    <AdvancedRow spec={spec} locale={locale} changed={value !== spec.default} onReset={onReset}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-40" aria-label={localized(spec.label, locale)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {spec.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {localized(option.label, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </AdvancedRow>
  );
}

function SettingRow({
  spec,
  locale,
  values,
  onSet,
}: {
  spec: AdvancedSettingSpec;
  locale: string;
  values: AdvancedSettings;
  onSet: (key: string, value: boolean | number | string) => void;
}) {
  const value = values[spec.key];
  const reset = () => onSet(spec.key, spec.default);
  if (spec.kind === "switch") {
    return <SwitchRow spec={spec} locale={locale} value={value === true} onChange={(next) => onSet(spec.key, next)} onReset={reset} />;
  }
  if (spec.kind === "number") {
    return (
      <NumberRow
        spec={spec}
        locale={locale}
        value={typeof value === "number" ? value : spec.default}
        onChange={(next) => onSet(spec.key, next)}
        onReset={reset}
      />
    );
  }
  return (
    <ChoiceRow
      spec={spec}
      locale={locale}
      value={typeof value === "string" ? value : spec.default}
      onChange={(next) => onSet(spec.key, next)}
      onReset={reset}
    />
  );
}

/** 导出整页参数：一份文件，换设备或回滚都用它。 */
function downloadSettings(values: AdvancedSettings): void {
  const blob = new Blob([JSON.stringify(values, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pi-web-advanced-settings.json";
  link.click();
  URL.revokeObjectURL(url);
}

export function AdvancedConfig({ embedded = true, onClose }: { embedded?: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const values = useAdvancedSettings();
  const { set, reset, apply } = useAdvancedSettingsActions();
  const [query, setQuery] = useState("");
  const [showExpert, setShowExpert] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaults = useMemo(() => defaultAdvancedSettings(), []);

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ADVANCED_GROUPS.map((group) => {
      const specs = ADVANCED_SETTINGS.filter((spec) => {
        if (spec.group !== group.id) return false;
        if (spec.expert && !showExpert) return false;
        if (!isAdvancedSettingVisible(spec, values)) return false;
        if (!needle) return true;
        // 搜索同时过滤分组名：输入「图片」就整组留下。
        const haystack = [
          localized(spec.label, locale),
          spec.hint ? localized(spec.hint, locale) : "",
          spec.key,
          localized(group.label, locale),
        ].join(" ").toLowerCase();
        return haystack.includes(needle);
      });
      return { group, specs };
    }).filter((entry) => entry.specs.length > 0);
  }, [locale, query, showExpert, values]);

  const changedCount = ADVANCED_SETTINGS.filter((spec) => values[spec.key] !== defaults[spec.key]).length;

  const handleSet = (key: string, value: boolean | number | string) => {
    setError(null);
    void set(key, value).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  const importFile = (file: File) => {
    void file.text().then((text) => {
      const next = normalizeAdvancedSettings(JSON.parse(text));
      return apply(next);
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  return (
    <ConfigPanelShell
      embedded={embedded}
      title={t("settings.advanced")}
      onClose={onClose}
      width={900}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.advancedSearch")}
            aria-label={t("settings.advancedSearch")}
            className="h-8 pl-8"
          />
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <ConfigSwitch
            size="small"
            checked={showExpert}
            label={t("settings.advancedExpert")}
            onChange={(next) => setShowExpert(next)}
          />
          {t("settings.advancedExpert")}
        </label>
      </div>

      {/* 这一页没有主从结构（没有可点进去的行），所以不用 `ConfigDetail`：
           它在手机上是“详情面板”，列表层级会被 `max-[640px]:hidden` 藏掉，
           整页就只剩标题（2026-11-22 用户反馈“参数是空的”）。 */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-8">
        <FieldGroup className="min-w-0 gap-4">
          {visibleGroups.map(({ group, specs }) => (
            <ConfigCard key={group.id} title={localized(group.label, locale)}>
              <FieldGroup className="min-w-0 gap-5">
                {specs.map((spec) => (
                  <SettingRow
                    key={spec.key}
                    spec={spec}
                    locale={locale}
                    values={values}
                    onSet={handleSet}
                  />
                ))}
              </FieldGroup>
            </ConfigCard>
          ))}
          {visibleGroups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("settings.advancedNoMatch")}</p>
          )}
          {error && (
            <p className="text-xs text-destructive" role="alert">{error}</p>
          )}
        </FieldGroup>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2.5">
        <span className={cn("min-w-0 flex-1 text-xs text-muted-foreground")}>
          {t("settings.advancedChanged", { count: String(changedCount) })}
        </span>
        <ConfigButton variant="ghost" onClick={() => downloadSettings(values)} title={t("settings.advancedExport")}>
          <DownloadIcon className="size-3.5" />
          {t("settings.advancedExport")}
        </ConfigButton>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
          <UploadIcon className="size-3.5" />
          {t("settings.advancedImport")}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) importFile(file);
            }}
          />
        </label>
        <ConfigButton
          variant="danger"
          disabled={changedCount === 0}
          onClick={() => {
            setError(null);
            void reset().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
          }}
        >
          {t("settings.advancedResetAll")}
        </ConfigButton>
      </div>
    </ConfigPanelShell>
  );
}
