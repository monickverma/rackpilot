import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-xl font-medium">Not found</h1>
      <p className="mt-2 txt-small text-muted">That record doesn&apos;t exist in this business.</p>
      <Link href="/dashboard" className="mt-6 inline-block text-[13px] text-accent hover:underline">Back to the dashboard</Link>
    </div>
  );
}
