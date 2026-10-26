// Supplier terms and house policies for the retrieval part of the assistant
// ("what is Tiruppur's minimum order?"). Synthetic, like the rest of the demo.
// Each section becomes one searchable chunk.

export interface PolicyDoc {
  title: string;
  kind: "supplier_terms" | "policy";
  supplier?: string;
  sections: [heading: string, body: string][];
}

export const SAFFRON_POLICIES: PolicyDoc[] = [
  {
    title: "Tiruppur Knit Mills: supply terms",
    kind: "supplier_terms",
    supplier: "TKM",
    sections: [
      ["Lead time", "Standard lead time is 10 days from purchase order confirmation to delivery at our Gandhi Nagar warehouse. During September to November the mill may add 3 to 4 days because of festive demand; they confirm the dispatch date in writing."],
      ["Minimum order quantity and packs", "Minimum order is 100 pieces per purchase order across all styles. Each colour and size is packed in multiples of 10 pieces. Mixed purchase orders across tees, polos and tanks are allowed."],
      ["Pricing and price breaks", "Prices are fixed for the season. Orders above 600 pieces get 3% off the invoice value. Printed graphic tees carry a ₹12 per piece printing charge included in the unit cost."],
      ["Payment terms", "30% advance with the purchase order and the balance within 30 days of delivery. Late payments above 45 days stop further dispatches."],
      ["Defects and returns", "Defective pieces (holes, misprints, shade variation) can be returned within 7 days of delivery with photos. The mill credits defective pieces at invoice value; they do not take back unsold stock."],
    ],
  },
  {
    title: "Ludhiana Fleece House: supply terms",
    kind: "supplier_terms",
    supplier: "LFH",
    sections: [
      ["Lead time", "Lead time is 12 days. Peak winter months (November to January) can stretch to 16 days; book hoodies and sweatshirts by mid-October for the winter peak."],
      ["Minimum order quantity and packs", "Minimum order is 60 pieces per purchase order. Each colour and size ships in packs of 6 pieces."],
      ["Payment terms", "Full payment within 21 days of delivery. No advance is required for repeat buyers."],
      ["Defects and returns", "Pilling or zip defects reported within 10 days are replaced in the next shipment. Unsold stock is not accepted back."],
    ],
  },
  {
    title: "Ahmedabad Denim Works: supply terms",
    kind: "supplier_terms",
    supplier: "ADW",
    sections: [
      ["Lead time", "Lead time is 14 days for stocked washes. New washes or custom fits take 25 days and need a sample approval first."],
      ["Minimum order quantity and packs", "Minimum order is 50 pieces per purchase order. Each colour and waist size is packed in multiples of 5 pieces."],
      ["Payment terms", "50% advance with the purchase order and 50% on delivery."],
      ["Defects and returns", "Wash or stitching defects can be returned within 15 days. Shorts and seasonal styles are not taken back once the season ends."],
    ],
  },
  {
    title: "Kolkata Shirting Co.: supply terms",
    kind: "supplier_terms",
    supplier: "KSC",
    sections: [
      ["Lead time", "Lead time is 7 days for regular shirts and kurtas. Nehru jackets need 10 days during the wedding and festive season."],
      ["Minimum order quantity and packs", "Minimum order is 36 pieces per purchase order. Each colour and size is packed in multiples of 6 pieces."],
      ["Payment terms", "Full payment within 15 days of delivery. A 2% discount applies if paid within 5 days."],
      ["Defects and returns", "Defective pieces can be exchanged within 7 days. Kurtas bought for Diwali cannot be returned after 15 November."],
    ],
  },
  {
    title: "Customer returns and exchanges policy",
    kind: "policy",
    sections: [
      ["Eligibility", "Retailers can return resellable pieces within 10 days of dispatch with the invoice number. Pieces must have tags attached."],
      ["Damaged in transit", "Damage in transit must be reported within 48 hours with photos of the parcel. Damaged pieces go to the quarantine area, not back to the rack."],
      ["Restocking", "Resellable returns are restocked to their home bin the same day and recorded as a customer return movement. A credit note is issued for the returned quantity."],
    ],
  },
  {
    title: "Stock counts and adjustments policy",
    kind: "policy",
    sections: [
      ["Cycle counts", "Each rack is counted at least once a month. Counts are entered on the handheld or a count sheet with the bin code."],
      ["Investigating variances", "Any count that differs from the recorded quantity opens a StockSleuth investigation. Check open pick lists, the packing area, unreceived transfers and the showroom rail before adjusting."],
      ["Who can approve adjustments", "Only the owner can approve a stock adjustment. The adjustment must reference the investigation and give a reason. Warehouse staff can recount and record findings but cannot adjust stock."],
    ],
  },
  {
    title: "Credit and billing policy",
    kind: "policy",
    sections: [
      ["Invoicing", "Invoice the quantity actually dispatched. Backordered quantities are invoiced when they ship, so one order can have several invoices."],
      ["Credit terms", "Each retailer has 15, 21 or 30 days of credit. Balances more than 30 days past due put the retailer on hold for new orders."],
      ["Payment allocation", "Every payment must be allocated to an invoice on the day it is received. Unallocated payments and overpayments are reviewed by accounts and refunded or carried forward."],
    ],
  },
];

export const INDIGO_POLICIES: PolicyDoc[] = [
  {
    title: "Coimbatore Organic Mills: supply terms",
    kind: "supplier_terms",
    supplier: "CBE",
    sections: [
      ["Lead time", "Lead time is 15 days for GOTS-certified fabric garments."],
      ["Minimum order quantity and packs", "Minimum order is 40 pieces per purchase order, in packs of 4 per colour and size."],
    ],
  },
];
