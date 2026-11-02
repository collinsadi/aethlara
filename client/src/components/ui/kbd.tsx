import { cn } from "@/lib/utils"

/** Keyboard key hint, e.g. <Kbd>J</Kbd>. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-muted px-1 font-sans text-[10px] font-semibold leading-none text-muted-foreground shadow-[inset_0_-1px_0_0_var(--border)]",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
