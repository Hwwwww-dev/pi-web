"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useTheme } from "@/hooks/useTheme"
import { isDarkTheme } from "@/lib/theme"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()

  return (
    <Sonner
      theme={isDarkTheme(theme) ? "dark" : "light"}
      className="toaster group"
      // 图标按类型上色，读者不看文字也能分清“跑完了/要我处理/失败了”
      // （2026-11-20 用户：通知要有不同颜色的标识）。
      icons={{
        success: <CircleCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />,
        info: <InfoIcon className="size-4 text-sky-600 dark:text-sky-400" />,
        warning: <TriangleAlertIcon className="size-4 text-amber-600 dark:text-amber-400" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--background)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-md)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
