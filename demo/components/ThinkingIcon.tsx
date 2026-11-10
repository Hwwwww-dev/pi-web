import { Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThinkingIcon({ active, size = 14 }: { active: boolean; size?: number }) {
  return (
    <Lightbulb
      size={size}
      strokeWidth={1.8}
      className={cn(
        "shrink-0",
        // Lit state: warning tint plus a soft glow (was stroke + fill + drop-shadow).
        active && "text-warning [filter:drop-shadow(0_0_2px_var(--color-warning))]",
      )}
    />
  );
}
