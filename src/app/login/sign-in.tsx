"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { callApi } from "@/components/client";
import { Button } from "@/components/ui";

export function SignIn({ userId, name, next, primary }: { userId: number; name: string; next?: string; primary?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-bad">{error}</span>}
      <Button
        variant={primary ? "primary" : "secondary"} size="sm" disabled={pending} aria-label={`Sign in as ${name}`}
        onClick={() => start(async () => {
          const r = await callApi("/api/session", { userId });
          if (!r.ok) return setError(r.error ?? "Couldn't sign in.");
          router.push(next && /^\/(?![/\\])/.test(next) ? next : "/dashboard");
          router.refresh();
        })}
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </span>
  );
}
