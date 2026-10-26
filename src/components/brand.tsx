// The RackPilot mark: a rack with one shelf picked, on Medusa's inverted
// button surface. Shared by the website and the demo's sidebar.

import { cn } from "./ui";

export function Mark({ large = false }: { large?: boolean }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-md bg-inverted bg-linear-to-b from-white/12 to-transparent text-inverted-fg shadow-inverted",
        large ? "size-8" : "size-6",
      )}
    >
      <svg viewBox="0 0 24 24" width={large ? 18 : 14} height={large ? 18 : 14} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 20V5M20 20V5M4 9h16M4 15h16" />
        <path d="M8 12.5h3" strokeWidth="2.4" />
      </svg>
    </span>
  );
}
