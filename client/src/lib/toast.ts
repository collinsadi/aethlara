/**
 * App-wide toasts (Base UI Toast with a global manager).
 *
 * Usable from hooks and event handlers without a React context:
 *   toast.success('Saved')
 *   toast.info('Dismissed Backend Engineer', { action: { label: 'Undo', onClick } })
 *   toast.error('Could not start a run', { description, link: { label, to } })
 *
 * The viewport is rendered once by <Toaster /> (components/ui/toaster.tsx).
 */
import { Toast } from '@base-ui/react/toast'

export type ToastTone = 'success' | 'error' | 'info' | 'warning'

export interface ToastLink {
  label: string
  /** In-app path, rendered with react-router <Link>. */
  to: string
}

export interface ToastData {
  link?: ToastLink
}

export interface ToastOptions {
  description?: string
  /** A button inside the toast (e.g. Undo). */
  action?: { label: string; onClick: () => void }
  /** An in-app link inside the toast (e.g. "Add API key"). */
  link?: ToastLink
  /** ms before auto-dismiss; 0 keeps it open. */
  timeout?: number
  /** Re-using an id updates the toast in place. */
  id?: string
}

export const toastManager = Toast.createToastManager()

function show(tone: ToastTone, title: string, opts: ToastOptions = {}): string {
  const interactive = Boolean(opts.action || opts.link)
  return toastManager.add<ToastData>({
    id: opts.id,
    title,
    description: opts.description,
    type: tone,
    priority: tone === 'error' ? 'high' : 'low',
    timeout: opts.timeout ?? (interactive || tone === 'error' ? 7000 : 4000),
    actionProps: opts.action
      ? { children: opts.action.label, onClick: opts.action.onClick }
      : undefined,
    data: { link: opts.link },
  })
}

export const toast = {
  success: (title: string, opts?: ToastOptions) => show('success', title, opts),
  error: (title: string, opts?: ToastOptions) => show('error', title, opts),
  info: (title: string, opts?: ToastOptions) => show('info', title, opts),
  warning: (title: string, opts?: ToastOptions) => show('warning', title, opts),
  dismiss: (id?: string) => toastManager.close(id),
}
