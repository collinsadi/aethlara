import { useState } from 'react'
import { autofillJobApi } from '@/api/autofill'
import { MessageType } from '@/types'
import type { ScannedField, AutofillField } from '@/types'

type AutofillState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'scanned'; fields: ScannedField[] }
  | { status: 'filling' }
  | { status: 'done'; filled: number; total: number }
  | { status: 'error'; message: string }

export function useAutofill(jobId: string) {
  const [state, setState] = useState<AutofillState>({ status: 'idle' })

  const scan = async (): Promise<ScannedField[] | null> => {
    setState({ status: 'scanning' })
    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.SCAN_FIELDS,
        payload: null,
      })
      const fields: ScannedField[] = response?.payload ?? []
      setState({ status: 'scanned', fields })
      return fields
    } catch {
      setState({ status: 'error', message: 'Could not scan the page.' })
      return null
    }
  }

  const fill = async (fields: ScannedField[]) => {
    setState({ status: 'filling' })
    try {
      const pageUrl = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.url ?? ''
      const autofillFields: AutofillField[] = fields.map((f) => ({
        field_id: f.field_id,
        label: f.label,
        type: f.type,
        placeholder: f.placeholder,
        required: f.required,
        options: f.options,
      }))

      const result = await autofillJobApi(jobId, autofillFields, pageUrl)

      // Combine scanned field selector info with fill values
      const fillMap: Record<string, string | null> = {}
      for (const [key, val] of Object.entries(result.fills)) {
        fillMap[key] = val
      }

      await chrome.runtime.sendMessage({
        type: MessageType.FILL_FIELDS,
        payload: { fields, fillMap },
      })

      const filledCount = Object.values(fillMap).filter((v) => v != null).length
      setState({ status: 'done', filled: filledCount, total: fields.length })
    } catch {
      setState({ status: 'error', message: 'AI fill failed. Please try again.' })
    }
  }

  const reset = () => setState({ status: 'idle' })

  return { state, scan, fill, reset }
}
