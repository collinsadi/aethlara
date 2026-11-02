import { Toast } from '@base-ui/react/toast'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { toastManager, type ToastData, type ToastTone } from '@/lib/toast'
import { cn } from '@/lib/utils'

const TONE_ICON = {
  success: { icon: CheckCircle2, className: 'text-success' },
  error: { icon: XCircle, className: 'text-destructive' },
  warning: { icon: AlertTriangle, className: 'text-warning' },
  info: { icon: Info, className: 'text-muted-foreground' },
} as const

/** Renders app toasts. Mount once, inside the router (toast links use <Link>). */
export function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager} limit={4}>
      <Toast.Portal>
        <Toast.Viewport className="fixed z-[100] bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:w-[380px] flex flex-col gap-2 outline-none">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}

function ToastList() {
  const { toasts } = Toast.useToastManager()
  return toasts.map((t) => {
    const tone = (t.type ?? 'info') as ToastTone
    const { icon: Icon, className } = TONE_ICON[tone] ?? TONE_ICON.info
    const link = (t.data as ToastData | undefined)?.link
    return (
      <Toast.Root
        key={t.id}
        toast={t}
        swipeDirection="right"
        className={cn(
          'glass-strong relative rounded-2xl p-3.5 pr-10 shadow-lg outline-none',
          'transition-[opacity,translate] duration-200 ease-out',
          'focus-visible:ring-2 focus-visible:ring-brand/40',
          'data-[starting-style]:opacity-0 data-[starting-style]:translate-y-2',
          'data-[ending-style]:opacity-0 data-[ending-style]:translate-x-6',
          'data-[limited]:hidden'
        )}
      >
        <Toast.Content className="flex items-start gap-3">
          <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-hidden />
          <div className="min-w-0 flex-1">
            <Toast.Title className="text-sm font-semibold leading-5 text-foreground" />
            <Toast.Description className="mt-0.5 text-xs leading-5 text-muted-foreground" />
            {(t.actionProps?.children || link) && (
              <div className="mt-2 flex items-center gap-4">
                <Toast.Action className="rounded text-xs font-semibold text-brand hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-brand" />
                {link && (
                  <Link
                    to={link.to}
                    onClick={() => toastManager.close(t.id)}
                    className="rounded text-xs font-semibold text-foreground hover:text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    {link.label}
                  </Link>
                )}
              </div>
            )}
          </div>
        </Toast.Content>
        <Toast.Close
          aria-label="Dismiss notification"
          className="absolute right-2.5 top-2.5 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
        >
          <X className="size-3.5" aria-hidden />
        </Toast.Close>
      </Toast.Root>
    )
  })
}
