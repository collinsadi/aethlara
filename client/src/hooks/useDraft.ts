/**
 * Local edit buffer for a settings section.
 *
 * - `dirty` compares the draft with the latest server value.
 * - When the server value changes (another section saved, a refetch) the
 *   draft follows it — unless the user has unsaved edits here, which are
 *   kept. After saving, call `setDraft(serverValue)` to adopt the server's
 *   normalised copy.
 */
import { useState } from 'react'

export function useDraft<T>(server: T) {
  const serverJson = JSON.stringify(server)
  const [draft, setDraft] = useState<T>(server)
  const [baseJson, setBaseJson] = useState(serverJson)

  if (serverJson !== baseJson) {
    setBaseJson(serverJson)
    if (JSON.stringify(draft) === baseJson) setDraft(server)
  }

  const dirty = JSON.stringify(draft) !== serverJson
  const patch = (partial: Partial<T>) => setDraft((prev) => ({ ...prev, ...partial }))
  const reset = () => setDraft(server)
  return { draft, setDraft, patch, dirty, reset }
}
