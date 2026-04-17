import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "btn-tf animate-btn-shine text-primary-foreground active:not-aria-[haspopup]:translate-y-px [a]:hover:opacity-95",
        outline:
          "btn-tf-secondary animate-btn-shine active:not-aria-[haspopup]:translate-y-px",
        secondary:
          "rounded-full bg-neutral-100 text-primary shadow-[0px_-2px_0px_0px_#e9e9e9_inset] hover:bg-neutral-200 dark:bg-neutral-800 dark:shadow-[0px_-2px_0px_0px_#18181b_inset] dark:hover:bg-neutral-700",
        ghost:
          "rounded-xl hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "rounded-none border-0 !text-brand underline-offset-4 hover:underline h-auto min-h-0 p-0 shadow-none bg-transparent hover:!text-brand",
      },
      size: {
        default:
          "h-auto min-h-[52px] gap-3 rounded-full px-6 py-3.5 text-base font-semibold has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
        xs: "h-6 gap-1 rounded-full px-3 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-full px-4 text-[0.8rem] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-auto min-h-[56px] gap-3 rounded-full px-8 py-4 text-base font-semibold",
        icon: "size-10 rounded-full",
        "icon-xs": "size-6 rounded-full [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-full",
        "icon-lg": "size-11 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
