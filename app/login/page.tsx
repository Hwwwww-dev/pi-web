"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import { safeLoginDestination } from "@/lib/login-destination";

function safeDestination(): string {
  const destination = new URLSearchParams(window.location.search).get("next");
  return safeLoginDestination(destination, window.location.origin);
}

function LoginForm() {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const failureMessage = async (response: Response): Promise<string> => {
    if (response.status === 401) return t("auth.invalidPassword");
    if (response.status !== 429) return t("auth.loginFailed");
    const seconds = Number(response.headers.get("retry-after"));
    return t("auth.tooManyAttempts", { seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 1 });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/web-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError(await failureMessage(response));
        return;
      }
      window.location.replace(safeDestination());
    } catch {
      setError(t("auth.loginFailed"));
    } finally {
      setBusy(false);
    }
  };

  // shadcn 登录页：品牌与表单由 Card 原语承载，安全区内边距用于独立模式（PWA）。
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[max(24px,env(safe-area-inset-top))_max(24px,env(safe-area-inset-right))_max(24px,env(safe-area-inset-bottom))_max(24px,env(safe-area-inset-left))]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Image src="/icons/logo.svg" width={48} height={48} alt="" priority unoptimized className="shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <CardTitle>Pi Web</CardTitle>
              <CardDescription>{t("auth.prompt")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <Label className="sr-only" htmlFor="web-login-password">{t("auth.password")}</Label>
              <Input
                id="web-login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("auth.password")}
                autoComplete="current-password"
                autoFocus
                required
                disabled={busy}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert" aria-live="polite">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={busy || !password}>
              <svg className="size-4" width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="2" y1="7" x2="11" y2="7" />
                <polyline points="7.5 3 12 7 7.5 11" />
              </svg>
              {busy ? t("auth.loggingIn") : t("auth.logIn")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return <I18nProvider><LoginForm /></I18nProvider>;
}
