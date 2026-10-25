"use client";

// A form bound to a Server Action that returns { ok } or { error }, with the
// outcome shown inline. Hidden fields carry ids; children are the inputs.

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/app/actions";
import { Button, cn } from "./ui";

type Action = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

export function ActionForm({
  action, hidden, children, className, confirm,
}: { action: Action; hidden?: Record<string, string | number>; children: ReactNode; className?: string; confirm?: string }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      {(state.ok || state.error) && (
        <p role="status" className={cn("mt-2 text-xs", state.error ? "text-bad" : "text-ok")}>
          {state.error ?? state.ok}
        </p>
      )}
    </form>
  );
}

export function SubmitButton({ children, variant = "secondary", size = "md", pendingText, className }: {
  children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; pendingText?: string; className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} className={className}>
      {pending ? (pendingText ?? "Working…") : children}
    </Button>
  );
}

export function PrintButton() {
  return (
    <Button type="button" variant="primary" onClick={() => window.print()}>
      Print pick list
    </Button>
  );
}
