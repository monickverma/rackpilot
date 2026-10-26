"use client";

// Light is the default. Picking dark sets data-theme="dark" on <html> and is
// remembered; the inline script in the root layout applies it before paint.

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "./icons";
import { cn } from "./ui";

type Theme = "light" | "dark";

const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};
const current = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function setTheme(theme: Theme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem("rp-theme", theme);
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
  for (const l of listeners) l();
}

const OPTIONS = [
  { theme: "light", label: "Light", Icon: SunIcon },
  { theme: "dark", label: "Dark", Icon: MoonIcon },
] as const;

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, () => "light" as Theme);
  return (
    <div role="group" aria-label="Theme" className="grid grid-cols-2 gap-0.5 rounded-md bg-panel-2 p-0.5">
      {OPTIONS.map(({ theme: t, label, Icon }) => (
        <button
          key={t}
          type="button"
          onClick={() => setTheme(t)}
          aria-pressed={theme === t}
          className={cn(
            "flex h-6 items-center justify-center gap-1.5 rounded-[5px] txt-compact-xsmall-plus outline-hidden transition-[color,background-color,box-shadow] focus-visible:shadow-focus",
            theme === t ? "bg-panel text-fg shadow-card" : "text-faint hover:text-fg",
          )}
        >
          <Icon size={13} />
          {label}
        </button>
      ))}
    </div>
  );
}
