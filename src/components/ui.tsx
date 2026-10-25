// Small shadcn-style primitives on Tailwind. Server-safe: no hooks here.

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-xl border border-line bg-panel shadow-card", className)} {...props} />;
}

export function CardHeader({ title, description, action, icon }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          {icon && <span className="text-muted">{icon}</span>}
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[13px] leading-5 text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "bg-panel-2 text-muted ring-line",
  accent: "bg-accent-soft text-accent ring-accent/20",
  ok: "bg-ok-soft text-ok ring-ok/20",
  warn: "bg-warn-soft text-warn ring-warn/25",
  bad: "bg-bad-soft text-bad ring-bad/20",
  info: "bg-info-soft text-info ring-info/20",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", toneClass[tone], className)}>
      {children}
    </span>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const buttonClass = (variant: Variant, size: "sm" | "md") =>
  cn(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-3.5 text-sm",
    variant === "primary" && "bg-accent text-accent-fg shadow-card hover:bg-accent/90",
    variant === "secondary" && "border border-line-strong bg-panel text-fg shadow-card hover:bg-panel-2",
    variant === "ghost" && "text-muted hover:bg-panel-2 hover:text-fg",
    variant === "danger" && "border border-bad/30 bg-panel text-bad hover:bg-bad-soft",
  );

export function Button({ variant = "secondary", size = "md", className, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md" }) {
  return <button className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function ButtonLink({ variant = "secondary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" | "md" }) {
  return <Link className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium text-muted">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, href, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; href?: string; icon?: ReactNode }) {
  const body = (
    <>
      <div className="flex items-center justify-between text-[13px] text-muted">
        {label}
        {icon && <span className={tone ? toneText[tone] : "text-faint"}>{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </>
  );
  const cls = "block rounded-xl border border-line bg-panel p-4 shadow-card";
  return href ? <Link href={href} className={cn(cls, "transition-colors hover:border-line-strong")}>{body}</Link> : <div className={cls}>{body}</div>;
}

export const toneText: Record<Tone, string> = {
  neutral: "text-fg", accent: "text-accent", ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-info",
};

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-muted">{children}</div>;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}

export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: "right" | "center" }) {
  return (
    <th className={cn("whitespace-nowrap border-b border-line bg-panel-2/60 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted first:pl-5 last:pr-5", align === "right" && "text-right", align === "center" && "text-center", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className, align, colSpan }: { children?: ReactNode; className?: string; align?: "right" | "center"; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-line px-3 py-2.5 align-middle first:pl-5 last:pr-5", align === "right" && "text-right tabular", align === "center" && "text-center", className)}>
      {children}
    </td>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("whitespace-nowrap font-mono text-[12px]", className)}>{children}</span>;
}

export function Swatch({ colour, hex }: { colour: string; hex: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/15 dark:ring-white/20" style={{ background: hex }} />
      <span className="capitalize">{colour}</span>
    </span>
  );
}

export function Location({ code }: { code: string }) {
  return <span className="inline-flex items-center whitespace-nowrap rounded-md border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] font-medium text-fg">{code}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "h-9 w-full rounded-lg border border-line-strong bg-panel px-3 text-sm shadow-card outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-panel-2", className)} />;
}

export function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card>
      <div className="space-y-3 p-5">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </Card>
  );
}
