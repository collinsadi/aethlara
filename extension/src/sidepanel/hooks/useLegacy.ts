import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { jobsApi, resumesApi } from '@/background/api'
import { ensureContentScript } from '@/background/tabs'
import { sendToTab } from '@/lib/messaging'
import { errorMessage } from '@/lib/util'
import type { AutofillField, LegacyScannedField } from '@/types'

/** Saved jobs (/jobs), paged, for the "autofill with a saved job" picker. */
export function useJobsList(pageSize = 20) {
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['jobs', 'list', page, pageSize],
    queryFn: () => jobsApi.list({ pageSize, page }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
  const loadMore = () => {
    if (query.data?.pagination.has_next) setPage((p) => p + 1)
  }
  return { ...query, page, loadMore }
}

export function useResumes(enabled = true) {
  return useQuery({
    queryKey: ['resumes'],
    queryFn: () => resumesApi.list(),
    staleTime: 5 * 60_000,
    enabled,
  })
}

type AutofillState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'scanned'; scanId: string; fields: LegacyScannedField[]; tabId: number }
  | { status: 'filling' }
  | { status: 'done'; filled: number; total: number; cancelled?: boolean }
  | { status: 'error'; message: string }

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

/** Saved-job autofill: scan the active tab, ask /jobs/:id/autofill, fill after consent on the page. */
export function useAutofill(jobId: string) {
  const [state, setState] = useState<AutofillState>({ status: 'idle' })

  const scan = async () => {
    setState({ status: 'scanning' })
    try {
      const tab = await activeTab()
      if (!tab?.id || !(await ensureContentScript(tab.id))) {
        setState({ status: 'error', message: 'Aethlara cannot read this page. Reload it and try again.' })
        return
      }
      const res = await sendToTab(tab.id, { type: 'LEGACY_SCAN' })
      if (!res.fields.length) {
        setState({ status: 'error', message: 'No fillable fields found on this page.' })
        return
      }
      setState({ status: 'scanned', scanId: res.scanId, fields: res.fields, tabId: tab.id })
    } catch (err) {
      setState({ status: 'error', message: errorMessage(err, 'Could not scan the page.') })
    }
  }

  const fill = async () => {
    if (state.status !== 'scanned') return
    const { scanId, fields, tabId } = state
    setState({ status: 'filling' })
    try {
      const tab = await chrome.tabs.get(tabId)
      const payload: AutofillField[] = fields.map((f) => ({
        field_id: f.field_id,
        label: f.label,
        type: f.type,
        placeholder: f.placeholder,
        required: f.required,
        options: f.options,
      }))
      const result = await jobsApi.autofill(jobId, payload, tab.url ?? '')
      const summary = await sendToTab(tabId, { type: 'LEGACY_FILL', scanId, fills: result.fills })
      setState({ status: 'done', filled: summary.filled, total: fields.length, cancelled: summary.cancelled })
    } catch (err) {
      setState({ status: 'error', message: errorMessage(err, 'AI fill failed. Please try again.') })
    }
  }

  return { state, scan, fill, reset: () => setState({ status: 'idle' }) }
}
