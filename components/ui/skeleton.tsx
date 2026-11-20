import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // 中性灰而不是 shadcn 默认的 `bg-accent`：主题的 accent 带色相，骨架会被染成
      // 主题色（用户：骨架不要染色，全局统一和消息列表一致）。
      className={cn("animate-pulse rounded-md bg-foreground/10", className)}
      {...props}
    />
  )
}

export { Skeleton }
