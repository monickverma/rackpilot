import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { claudeConfigured } from "@/lib/ai/claude";
import { requireSession } from "@/lib/auth";
import { customers } from "@/lib/ops/orders";
import { Intake } from "./intake";

export const metadata: Metadata = { title: "New order" };

const SAMPLES = [
  { id: "spec", label: "Two tees (from the spec)", channel: "message" as const, customer: "Style Point", text: "Bhai, 2 black oversized tees size L, 1 white tee size M. Need everything by tomorrow." },
  { id: "shirts", label: "20 blue oxford shirts", channel: "message" as const, customer: "Mehra Menswear", text: "Bhai, 20 blue oxford shirt M chahiye. Kal tak bhej do." },
  { id: "runs", label: "Size runs, one colour not stocked", channel: "message" as const, customer: "Royal Garments", text: "navy hoodie M L XL 10 each, black joggers M-12 L-12. Jaldi bhejna" },
  { id: "voice", label: "Voice-note transcript", channel: "voice" as const, customer: "The Denim Den", text: "haan bhai Denim Den se bol raha hoon, 15 khaki chinos 32 aur 10 34, aur 12 grey hoodie L, parso tak bhej dena" },
  { id: "vague", label: "Vague: no colour or size", channel: "message" as const, customer: "Click Clothing", text: "20 polo aur 10 kurta chahiye" },
];

export default async function NewOrder({ searchParams }: { searchParams: Promise<{ sample?: string }> }) {
  const s = await requireSession();
  const { sample } = await searchParams;
  const list = await customers(s);
  return (
    <>
      <PageHeader
        title="New order"
        description="Paste a message, a voice-note transcript, or upload a photo or PDF of an order sheet. RackPilot reads it into lines and matches each to a variant. When it isn't sure, it asks you to choose; it never invents a SKU. Nothing is reserved until you confirm."
      />
      <Intake customers={list} samples={SAMPLES} initial={SAMPLES.find((x) => x.id === sample) ?? null} claude={claudeConfigured()} />
    </>
  );
}
