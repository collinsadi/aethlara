import { useRef, useCallback, type KeyboardEvent, type ClipboardEvent } from "react";

interface OtpInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  length?: number;
  disabled?: boolean;
}

export function OtpInput({ value, onChange, length = 6, disabled }: OtpInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const focusInput = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, length - 1));
    inputRefs.current[clamped]?.focus();
  }, [length]);

  const handleChange = useCallback(
    (index: number, char: string) => {
      if (!/^\d?$/.test(char)) return;

      const next = [...value];
      next[index] = char;
      onChange(next);

      if (char && index < length - 1) {
        focusInput(index + 1);
      }
    },
    [value, onChange, length, focusInput]
  );

  const handleKeyDown = useCallback(
    (index: number, e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace") {
        e.preventDefault();
        if (value[index]) {
          const next = [...value];
          next[index] = "";
          onChange(next);
        } else if (index > 0) {
          const next = [...value];
          next[index - 1] = "";
          onChange(next);
          focusInput(index - 1);
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        focusInput(index - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        focusInput(index + 1);
      }
    },
    [value, onChange, focusInput]
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text/plain").replace(/\D/g, "").slice(0, length);
      if (!pasted) return;

      const next = [...value];
      for (let i = 0; i < pasted.length; i++) {
        next[i] = pasted[i];
      }
      onChange(next);
      focusInput(Math.min(pasted.length, length - 1));
    },
    [value, onChange, length, focusInput]
  );

  return (
    <div className="flex items-center justify-center gap-2.5">
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => { inputRefs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={value[i] ?? ""}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value.slice(-1))}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={[
            "w-12 h-14 rounded-xl border text-center text-xl font-semibold",
            "bg-card text-foreground transition-all duration-200",
            "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            value[i]
              ? "border-brand/40 shadow-[0_0_0_1px_rgba(253,58,37,0.1)]"
              : "border-border",
          ].join(" ")}
        />
      ))}
    </div>
  );
}
