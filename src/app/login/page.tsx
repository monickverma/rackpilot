import type { Metadata } from "next";
import Link from "next/link";
import { Mark } from "@/components/brand";
import { Badge, Card } from "@/components/ui";
import { demoUsers } from "@/lib/auth";
import { SignIn } from "./sign-in";

export const metadata: Metadata = { title: "Sign in" };

const ROLE_CAN: Record<string, string> = {
  owner: "Everything, including approving stock adjustments, purchase plans and closing cases.",
  warehouse: "Picking, dispatch, transfers, counts and resolving StockSleuth cases. Can't adjust stock.",
  accounts: "Orders, invoices, payments and resolving OrderTrace cases.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const users = await demoUsers();
  const businesses = [...new Map(users.map((u) => [u.businessId, u])).values()];
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/" className="mb-8 inline-flex items-center gap-2 txt-compact-small-plus">
        <Mark /> RackPilot
      </Link>
      <h1 className="text-2xl font-medium tracking-tight">Sign in to the demo</h1>
      <p className="mt-2 max-w-xl txt-small text-muted">
        Two synthetic businesses share this deployment. Each sees only its own records: the backend scopes every query to the signed-in user&apos;s business. Pick a person to see what their role allows.
      </p>
      <div className="mt-8 space-y-4">
        {businesses.map((b) => (
          <Card key={b.businessId}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-6 py-4">
              <div>
                <h2 className="h2-core">{b.businessName}</h2>
                <p className="txt-small text-muted">{b.city}</p>
              </div>
              <Badge tone={b.kind === "wholesaler" ? "accent" : "info"}>{b.kind === "wholesaler" ? "Clothing wholesaler · main demo" : "Independent apparel brand"}</Badge>
            </div>
            <ul className="divide-y divide-line">
              {users.filter((u) => u.businessId === b.businessId).map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">{u.name} <span className="font-normal text-muted">· {u.title}</span></div>
                    <div className="text-xs text-muted">{ROLE_CAN[u.role]}</div>
                  </div>
                  <SignIn userId={u.id} name={u.name} next={next} primary={u.role === "owner" && b.kind === "wholesaler"} />
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-xs text-faint">Demo sign-in only: no passwords. A real deployment would use Supabase Auth or similar in front of the same role checks.</p>
    </div>
  );
}
