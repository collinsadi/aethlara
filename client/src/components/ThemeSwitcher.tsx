import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme, type Theme } from "@/hooks/useTheme";

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
];

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={`inline-flex items-center rounded-xl border border-border bg-card/80 p-1 ${
        compact ? "gap-1" : "gap-1.5"
      }`}
      role="radiogroup"
      aria-label="Theme"
    >
      {themeOptions.map((option) => {
        const Icon = option.icon;
        const active = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(option.value)}
            className={`flex min-h-10 items-center justify-center rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-foreground/70 hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {!compact && <span className="ml-1.5">{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
