import { useId, useRef, useState } from "react"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

interface TagInputProps {
  value: string[]
  onChange: (next: string[]) => void
  id?: string
  placeholder?: string
  /** Hard cap on the number of tags (mirrors server limits). */
  maxItems?: number
  /** Longer entries are clipped to this many characters. */
  maxLength?: number
  disabled?: boolean
  invalid?: boolean
  className?: string
  "aria-label"?: string
  "aria-describedby"?: string
}

/**
 * Chip input for string lists. Enter, comma or Tab adds the typed value,
 * Backspace on an empty field removes the last chip, and pasting a
 * comma/newline separated list adds every entry. Duplicates are ignored
 * case-insensitively.
 */
function TagInput({
  value,
  onChange,
  id,
  placeholder,
  maxItems,
  maxLength = 100,
  disabled,
  invalid,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: TagInputProps) {
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const autoId = useId()
  const inputId = id ?? autoId
  const full = maxItems !== undefined && value.length >= maxItems

  const add = (raw: string) => {
    const parts = raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length === 0) {
      setText("")
      return
    }
    const next = [...value]
    for (const part of parts) {
      const clipped = part.slice(0, maxLength)
      if (next.some((v) => v.toLowerCase() === clipped.toLowerCase())) continue
      if (maxItems !== undefined && next.length >= maxItems) break
      next.push(clipped)
    }
    if (next.length !== value.length) onChange(next)
    setText("")
  }

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
    inputRef.current?.focus()
  }

  return (
    <div
      className={cn(
        "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-1.5 text-sm transition-colors",
        "focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20",
        invalid && "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
        disabled && "cursor-not-allowed opacity-60",
        className
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted py-0.5 pl-2.5 pr-1 text-xs font-medium text-foreground"
        >
          <span className="truncate">{tag}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation()
              remove(i)
            }}
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
            aria-label={`Remove ${tag}`}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={text}
        disabled={disabled || full}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        placeholder={full ? `Limit of ${maxItems} reached` : value.length === 0 ? placeholder : "Add more…"}
        onChange={(e) => {
          const v = e.target.value
          if (v.includes(",")) add(v)
          else setText(v)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || (e.key === "Tab" && text.trim())) {
            e.preventDefault()
            add(text)
          } else if (e.key === "Backspace" && !text && value.length > 0) {
            e.preventDefault()
            onChange(value.slice(0, -1))
          }
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text")
          if (/[,\n]/.test(pasted)) {
            e.preventDefault()
            add(text + pasted)
          }
        }}
        onBlur={() => {
          if (text.trim()) add(text)
        }}
        className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  )
}

export { TagInput }
