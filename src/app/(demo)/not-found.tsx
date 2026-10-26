import { ButtonLink, Card } from "@/components/ui";

// Shown when an order or SKU in the demo doesn't exist. On the live site this
// usually means the server instance restarted and rebuilt a fresh shop.
export default function DemoNotFound() {
  return (
    <Card className="mx-auto mt-8 max-w-lg px-6 py-8 text-center">
      <h1 className="h1-core">Not in the demo shop</h1>
      <p className="mt-2 txt-small text-muted">
        There&apos;s no order or SKU at this address. If you made it a moment ago, the live demo may have restarted: each server instance builds a fresh
        shop when it starts.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <ButtonLink href="/dashboard" variant="primary">
          Go to the dashboard
        </ButtonLink>
        <ButtonLink href="/orders">See orders</ButtonLink>
      </div>
    </Card>
  );
}
