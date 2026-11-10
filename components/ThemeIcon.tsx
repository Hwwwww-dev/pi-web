import { MoonIcon, SunIcon, MonitorIcon } from "lucide-react";
import type { ThemePreference } from "@/lib/theme";

export function ThemeIcon({ preference, size = 17 }: { preference: ThemePreference; size?: number }) {
  const className = "shrink-0";
  if (preference === "light") return <SunIcon className={className} size={size} strokeWidth={1.8} aria-hidden />;
  if (preference === "dark") return <MoonIcon className={className} size={size} strokeWidth={1.8} aria-hidden />;
  return <MonitorIcon className={className} size={size} strokeWidth={1.8} aria-hidden />;
}
