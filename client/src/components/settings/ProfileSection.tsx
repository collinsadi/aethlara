import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Pencil, Loader2, Check, X } from 'lucide-react'
import { useUpdateProfile } from '@/hooks/useProfile'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'

const schema = z.object({
  full_name: z.string().min(1, 'Name is required').max(120, 'Too long'),
})

export function ProfileSection() {
  const user = useAuthStore((s) => s.user)
  const [editing, setEditing] = useState(false)
  const updateProfile = useUpdateProfile()

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { full_name: user?.full_name ?? '' },
  })

  const cancel = () => {
    reset({ full_name: user?.full_name ?? '' })
    setEditing(false)
  }

  const onSubmit = async ({ full_name }: { full_name: string }) => {
    await updateProfile.mutateAsync(full_name)
    setEditing(false)
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-foreground font-heading">Profile</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your display name.</p>
      </div>

      <div className="glass-card p-5 space-y-4">
        {/* Email — read-only */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Email
          </label>
          <p className="text-sm text-foreground">{user?.email}</p>
        </div>

        {/* Full name */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Full name
          </label>
          {editing ? (
            <form onSubmit={handleSubmit(onSubmit)} className="flex items-start gap-2">
              <div className="flex-1">
                <input
                  type="text"
                  {...register('full_name')}
                  autoFocus
                  className="field-input w-full text-sm"
                />
                {errors.full_name && (
                  <p className="text-xs text-red-500 mt-1">{errors.full_name.message}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={updateProfile.isPending}
                className={cn(
                  'p-2 rounded-lg bg-brand text-white hover:bg-brand/90 transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed shrink-0'
                )}
                aria-label="Save"
              >
                {updateProfile.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Check className="w-4 h-4" />
                }
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={updateProfile.isPending}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground transition-colors shrink-0"
                aria-label="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-sm text-foreground flex-1">{user?.full_name || '—'}</p>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Edit name"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
