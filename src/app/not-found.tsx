import Link from "next/link";
import { Mark } from "@/components/brand";
import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-16">
      <div className="max-w-sm text-center">
        <Link href="/" aria-label="RackPilot home" className="inline-flex rounded-md outline-hidden focus-visible:shadow-focus">
          <Mark large />
        </Link>
        <h1 className="mt-5 text-2xl font-medium tracking-tight">Page not found</h1>
        <p className="mt-2 txt-small text-muted">There&apos;s nothing at this address.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ButtonLink href="/" size="lg">
            Home
          </ButtonLink>
          <ButtonLink href="/dashboard" variant="primary" size="lg">
            Open the live demo
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
