// Small primitives in the style of Medusa UI, on Tailwind. Server-safe: no hooks here.

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info";

/** Tag colours per tone: fill, text and border. */
const tagClass: Record<Tone, string> = {
  neutral: "border-tag-grey-line bg-tag-grey text-tag-grey-fg",
  accent: "border-tag-blue-line bg-tag-blue text-tag-blue-fg",
  ok: "border-tag-green-line bg-tag-green text-tag-green-fg",
  warn: "border-tag-orange-line bg-tag-orange text-tag-orange-fg",
  bad: "border-tag-red-line bg-tag-red text-tag-red-fg",
  info: "border-tag-purple-line bg-tag-purple text-tag-purple-fg",
};

const dotClass: Record<Tone, string> = {
  neutral: "bg-tag-grey-dot",
  accent: "bg-tag-blue-dot",
  ok: "bg-tag-green-dot",
  warn: "bg-tag-orange-dot",
  bad: "bg-tag-red-dot",
  info: "bg-tag-purple-dot",
};

/** A white container lifted off the page by a hairline shadow. */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("overflow-hidden rounded-lg bg-panel shadow-card", className)} {...props} />;
}

/** A small rounded square holding an icon, tinted by tone. */
export function IconBadge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("grid size-6 shrink-0 place-items-center rounded-md border [&_svg]:size-3.5", tagClass[tone], className)} aria-hidden="true">
      {children}
    </span>
  );
}

export function CardHeader({ title, description, action, icon, tone }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode; tone?: Tone }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
      <div className="flex min-w-0 gap-3">
        {icon && <IconBadge tone={tone}>{icon}</IconBadge>}
        <div className="min-w-0">
          <h2 className="h2-core">{title}</h2>
          {description && <p className="mt-0.5 txt-small text-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 txt-compact-xsmall-plus", tagClass[tone], className)}>
      {children}
    </span>
  );
}

/** A state, not a label: a grey pill with a coloured dot, as Medusa shows order status. */
export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex h-5 w-fit items-center whitespace-nowrap rounded-md border border-line bg-subtle pr-1.5 txt-compact-xsmall-plus text-muted">
      <span className="grid w-5 place-items-center" aria-hidden="true">
        <span className={cn("size-2 rounded-[2px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]", dotClass[tone])} />
      </span>
      {children}
    </span>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const buttonClass = (variant: Variant, size: Size) =>
  cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-md outline-hidden transition-[color,background-color,box-shadow]",
    "disabled:pointer-events-none disabled:bg-panel-2 disabled:bg-none disabled:text-disabled disabled:shadow-button",
    size === "sm" && "h-7 gap-x-1.5 px-2 txt-compact-small-plus",
    size === "md" && "h-8 gap-x-1.5 px-3 txt-compact-small-plus",
    size === "lg" && "h-10 gap-x-2 px-4 text-[14px] font-medium leading-5",
    variant === "primary" && "bg-inverted bg-linear-to-b from-white/12 to-transparent text-inverted-fg shadow-inverted hover:bg-inverted-hover focus-visible:shadow-inverted-focus",
    variant === "secondary" && "bg-button text-fg shadow-button hover:bg-button-hover focus-visible:shadow-button-focus",
    variant === "ghost" && "text-muted hover:bg-ghost-hover hover:text-fg focus-visible:shadow-focus",
    variant === "danger" && "bg-button text-bad shadow-button hover:bg-button-hover focus-visible:shadow-button-focus",
  );

export function Button({ variant = "secondary", size = "md", className, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function ButtonLink({ variant = "secondary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={cn(buttonClass(variant, size), className)} {...props} />;
}

/** The first container on a page: its title, what it shows, and its actions. */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-col gap-3 rounded-lg bg-panel px-6 py-4 shadow-card sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1">
        <h1 className="h1-core">{title}</h1>
        {description && <div className="mt-1 max-w-3xl txt-small text-muted">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, href, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; href?: string; icon?: ReactNode }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="txt-compact-small-plus text-muted">{label}</span>
        {icon && <IconBadge tone={tone}>{icon}</IconBadge>}
      </div>
      <div className="mt-2 text-2xl font-medium tracking-tight tabular">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </>
  );
  const cls = "block rounded-lg bg-panel p-4 shadow-card";
  return href ? (
    <Link href={href} className={cn(cls, "outline-hidden transition-shadow hover:shadow-card-hover focus-visible:shadow-active")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-6 py-10 text-center txt-small text-muted">{children}</div>;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left txt-compact-small [&_tbody_tr:last-child>td]:border-b-0">{children}</table>
    </div>
  );
}

export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: "right" | "center" }) {
  return (
    <th className={cn("h-10 whitespace-nowrap border-b border-line bg-subtle pr-6 align-middle txt-compact-small-plus text-muted first:pl-6", align === "right" && "text-right", align === "center" && "text-center", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className, align, colSpan }: { children?: ReactNode; className?: string; align?: "right" | "center"; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("h-12 border-b border-line py-2 pr-6 align-middle first:pl-6", align === "right" && "text-right tabular", align === "center" && "text-center", className)}>
      {children}
    </td>
  );
}

/** Pill tabs, as Medusa's Tabs: the current one sits raised on the container. */
export const tabClass = (active: boolean) =>
  cn(
    "inline-flex h-7 items-center rounded-full px-2.5 txt-compact-small-plus outline-hidden transition-[color,background-color,box-shadow] focus-visible:shadow-focus",
    active ? "bg-panel text-fg shadow-card" : "text-muted hover:text-fg",
  );

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

/** A rack bin, styled like a key cap. */
export function Location({ code }: { code: string }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center whitespace-nowrap rounded-md border border-tag-grey-line bg-tag-grey px-1 font-mono text-[12px] font-medium text-fg">
      {code}
    </span>
  );
}

/** Medusa's dashed rule, used between sidebar sections. */
export function Divider({ className }: { className?: string }) {
  return <div role="separator" className={cn("border-t border-dashed border-line-strong", className)} />;
}

export const inputClass =
  "h-8 rounded-md bg-field px-2 txt-compact-small text-fg shadow-button outline-hidden transition-[background-color,box-shadow] placeholder:text-faint hover:bg-field-hover focus:shadow-active";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-panel-2", className)} />;
}

export function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card>
      <div className="space-y-3 px-6 py-4">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </Card>
  );
}
