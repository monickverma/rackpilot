import type { Metadata } from "next";
import { OrderIntake } from "@/components/order-intake";
import { PageHeader } from "@/components/ui";
import { claudeConfigured } from "@/lib/claude";
import { INBOX } from "@/lib/inbox";

export const metadata: Metadata = { title: "New order" };

export default function NewOrderPage() {
  return (
    <>
      <PageHeader
        eyebrow="Orders"
        title="New WhatsApp order"
        description="RackPilot reads the message with rules, matches each line to a variant and its rack, and shows what it can reserve. Stock only changes when you confirm."
      />
      <OrderIntake inbox={INBOX} claudeEnabled={claudeConfigured()} />
    </>
  );
}
