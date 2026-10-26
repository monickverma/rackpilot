// The synthetic businesses. Everything here is made up for the demo and the
// app labels it as such: no real company, customer or supplier is described.

export type Profile = "steady" | "festive" | "winter" | "summer";

export interface SupplierDef {
  code: string;
  name: string;
  city: string;
  leadTimeDays: number;
  moqUnits: number;
  packSize: number;
  paymentTerms: string;
}

export interface ProductDef {
  code: string;
  name: string;
  design: string;
  category: string;
  brand: string;
  keywords: string;
  supplier: string;
  colours: string[];
  sizes: "tops" | "tops-xl" | "bottoms";
  cost: number;
  price: number;
  /** Relative share of wholesale demand. */
  weight: number;
  profile: Profile;
  /** Rack and first shelf of the product's home bins. */
  rack: string;
  shelf: number;
  /** Day (relative to today) the product was first stocked; default the start of history. */
  launchDay?: number;
  /** Day after which customers stopped ordering it: the dead stock in the demo. */
  demandUntilDay?: number;
}

export interface UserDef {
  name: string;
  email: string;
  role: "owner" | "warehouse" | "accounts";
  title: string;
}

export interface BusinessDef {
  slug: string;
  name: string;
  kind: "wholesaler" | "brand" | "retailer";
  city: string;
  tagline: string;
  historyDays: number;
  ordersPerDay: number;
  /** Day of the week the business is closed (0 = Sunday). */
  closedWeekday: number;
  users: UserDef[];
  suppliers: SupplierDef[];
  customers: { code: string; name: string; city: string; creditDays: number }[];
  products: ProductDef[];
  /** Extra sellable locations that are not product home bins. */
  extraLocations: { code: string; rack: string; shelf: string; bin: string }[];
  /** Plant the demo discrepancies (only the main demo business). */
  scenarios: boolean;
}

export const SIZE_SETS = {
  tops: ["S", "M", "L", "XL", "XXL"],
  "tops-xl": ["S", "M", "L", "XL"],
  bottoms: ["28", "30", "32", "34", "36"],
} as const;

/** Share of a product's demand by size. */
export const SIZE_SHARE: Record<string, number> = {
  S: 0.12, M: 0.28, L: 0.3, XL: 0.2, XXL: 0.1,
  "28": 0.1, "30": 0.22, "32": 0.3, "34": 0.24, "36": 0.14,
};

export const COLOUR_CODES: Record<string, string> = {
  black: "BLK", white: "WHT", navy: "NVY", grey: "GRY", beige: "BGE", olive: "OLV", maroon: "MRN", blue: "BLU",
  pink: "PNK", sky: "SKY", mustard: "MST", indigo: "IND", khaki: "KHK", brown: "BRN", ecru: "ECR", rust: "RST",
};

export const SAFFRON: BusinessDef = {
  slug: "saffron-thread",
  name: "Saffron Thread Apparel",
  kind: "wholesaler",
  city: "Gandhi Nagar, Delhi",
  tagline: "Wholesale menswear and basics for retailers across North India",
  historyDays: 150,
  ordersPerDay: 2.6,
  closedWeekday: 1, // Monday, as in many Delhi wholesale markets
  users: [
    { name: "Arjun Malhotra", email: "arjun@saffron.example", role: "owner", title: "Owner" },
    { name: "Ravi Kumar", email: "ravi@saffron.example", role: "warehouse", title: "Warehouse lead" },
    { name: "Sana Qureshi", email: "sana@saffron.example", role: "accounts", title: "Accounts" },
    { name: "Deepak Yadav", email: "deepak@saffron.example", role: "warehouse", title: "Picker and packer" },
  ],
  suppliers: [
    { code: "TKM", name: "Tiruppur Knit Mills", city: "Tiruppur", leadTimeDays: 10, moqUnits: 100, packSize: 10, paymentTerms: "30% advance, balance in 30 days" },
    { code: "LFH", name: "Ludhiana Fleece House", city: "Ludhiana", leadTimeDays: 12, moqUnits: 60, packSize: 6, paymentTerms: "Full payment in 21 days" },
    { code: "ADW", name: "Ahmedabad Denim Works", city: "Ahmedabad", leadTimeDays: 14, moqUnits: 50, packSize: 5, paymentTerms: "50% advance, balance on delivery" },
    { code: "KSC", name: "Kolkata Shirting Co.", city: "Kolkata", leadTimeDays: 7, moqUnits: 36, packSize: 6, paymentTerms: "Full payment in 15 days" },
  ],
  customers: [
    { code: "C01", name: "Mehra Menswear", city: "Karol Bagh, Delhi", creditDays: 15 },
    { code: "C02", name: "Style Point", city: "Lajpat Nagar, Delhi", creditDays: 15 },
    { code: "C03", name: "Urban Thread Boutique", city: "Noida", creditDays: 21 },
    { code: "C04", name: "Royal Garments", city: "Meerut", creditDays: 30 },
    { code: "C05", name: "Trendz Collection", city: "Gurugram", creditDays: 15 },
    { code: "C06", name: "Fashion Junction", city: "Panipat", creditDays: 21 },
    { code: "C07", name: "Kapoor Cloth House", city: "Rohtak", creditDays: 30 },
    { code: "C08", name: "The Denim Den", city: "Ghaziabad", creditDays: 15 },
    { code: "C09", name: "Shree Balaji Garments", city: "Sonipat", creditDays: 21 },
    { code: "C10", name: "Nawabi Collections", city: "Lucknow", creditDays: 30 },
    { code: "C11", name: "Gupta Fashion Hub", city: "Agra", creditDays: 21 },
    { code: "C12", name: "Click Clothing", city: "Faridabad", creditDays: 15 },
  ],
  products: [
    { code: "TSH", name: "Classic Crew Tee", design: "180 GSM combed cotton, crew neck", category: "t-shirt", brand: "Saffron Basics", keywords: "tee tshirt t-shirt crew round neck basic plain", supplier: "TKM", colours: ["white", "navy", "black", "grey"], sizes: "tops", cost: 118, price: 165, weight: 16, profile: "steady", rack: "R-12", shelf: 1 },
    { code: "OVT", name: "Oversized Drop-Shoulder Tee", design: "240 GSM cotton, boxy fit", category: "t-shirt", brand: "Saffron Basics", keywords: "tee tshirt t-shirt oversized oversize drop shoulder boxy baggy", supplier: "TKM", colours: ["black", "white", "beige", "olive"], sizes: "tops", cost: 165, price: 235, weight: 12, profile: "steady", rack: "R-11", shelf: 1 },
    { code: "GRT", name: "Monsoon Waves Graphic Tee", design: "Printed graphic, 180 GSM", category: "t-shirt", brand: "Saffron Basics", keywords: "tee tshirt graphic printed print monsoon waves", supplier: "TKM", colours: ["white", "black"], sizes: "tops", cost: 130, price: 189, weight: 4, profile: "steady", rack: "R-11", shelf: 5, launchDay: -140, demandUntilDay: -92 },
    { code: "POL", name: "Pique Polo", design: "Cotton pique, two-button placket", category: "polo", brand: "Saffron Basics", keywords: "polo collar collared pique", supplier: "TKM", colours: ["navy", "white", "maroon"], sizes: "tops", cost: 205, price: 299, weight: 7, profile: "steady", rack: "R-10", shelf: 1 },
    { code: "TNK", name: "Ribbed Tank", design: "Ribbed cotton vest", category: "vest", brand: "Saffron Basics", keywords: "tank vest baniyan sleeveless ribbed", supplier: "TKM", colours: ["white", "black"], sizes: "tops-xl", cost: 72, price: 110, weight: 1.5, profile: "summer", rack: "R-10", shelf: 4 },
    { code: "SHT", name: "Oxford Shirt", design: "Cotton oxford, button-down collar", category: "shirt", brand: "Saffron Basics", keywords: "shirt oxford formal button down", supplier: "KSC", colours: ["blue", "white", "pink"], sizes: "tops", cost: 285, price: 415, weight: 8, profile: "steady", rack: "R-07", shelf: 1 },
    { code: "LIN", name: "Linen-Blend Shirt", design: "Linen-cotton blend, relaxed fit", category: "shirt", brand: "Saffron Basics", keywords: "shirt linen summer relaxed", supplier: "KSC", colours: ["white", "sky", "olive"], sizes: "tops-xl", cost: 370, price: 540, weight: 4, profile: "summer", rack: "R-08", shelf: 1 },
    { code: "CRD", name: "Corduroy Overshirt", design: "8-wale corduroy, two chest pockets", category: "shirt", brand: "Saffron Basics", keywords: "shirt overshirt corduroy cord shacket", supplier: "KSC", colours: ["brown", "olive"], sizes: "tops-xl", cost: 420, price: 619, weight: 2, profile: "winter", rack: "R-08", shelf: 4, launchDay: -18 },
    { code: "KRT", name: "Cotton Kurta", design: "Mid-length cotton kurta", category: "kurta", brand: "Rangeela", keywords: "kurta kurtas ethnic festive cotton", supplier: "KSC", colours: ["white", "mustard", "maroon"], sizes: "tops", cost: 295, price: 449, weight: 5, profile: "festive", rack: "R-09", shelf: 1 },
    { code: "NHR", name: "Nehru Jacket", design: "Jacquard Nehru jacket", category: "jacket", brand: "Rangeela", keywords: "nehru jacket modi bandhgala ethnic festive", supplier: "KSC", colours: ["black", "maroon"], sizes: "tops-xl", cost: 510, price: 749, weight: 2.5, profile: "festive", rack: "R-09", shelf: 4 },
    { code: "HOD", name: "Pullover Hoodie", design: "320 GSM brushed fleece, kangaroo pocket", category: "hoodie", brand: "Saffron Basics", keywords: "hoodie hoody hooded sweatshirt fleece winter", supplier: "LFH", colours: ["black", "grey", "maroon"], sizes: "tops", cost: 380, price: 559, weight: 6, profile: "winter", rack: "R-05", shelf: 1 },
    { code: "SWT", name: "Crew Sweatshirt", design: "Brushed fleece crew neck", category: "sweatshirt", brand: "Saffron Basics", keywords: "sweatshirt crew fleece winter", supplier: "LFH", colours: ["navy", "grey"], sizes: "tops", cost: 320, price: 469, weight: 4, profile: "winter", rack: "R-06", shelf: 1 },
    { code: "JOG", name: "Fleece Joggers", design: "Cuffed fleece joggers", category: "joggers", brand: "Saffron Basics", keywords: "jogger joggers track lower fleece", supplier: "LFH", colours: ["black", "grey", "navy"], sizes: "tops", cost: 225, price: 329, weight: 6, profile: "steady", rack: "R-04", shelf: 1 },
    { code: "TRK", name: "Track Pants", design: "Polyester track pants, side stripe", category: "track pants", brand: "Saffron Basics", keywords: "track pant pants lower trackpant", supplier: "LFH", colours: ["black", "navy"], sizes: "tops", cost: 190, price: 279, weight: 4, profile: "steady", rack: "R-04", shelf: 4 },
    { code: "DNM", name: "Slim Fit Jeans", design: "11 oz stretch denim, slim fit", category: "jeans", brand: "Saffron Denim", keywords: "jeans jean denim slim", supplier: "ADW", colours: ["indigo", "black"], sizes: "bottoms", cost: 410, price: 599, weight: 8, profile: "steady", rack: "R-01", shelf: 1 },
    { code: "CHN", name: "Cotton Chinos", design: "Stretch cotton twill chinos", category: "chinos", brand: "Saffron Denim", keywords: "chinos chino trousers pants cotton", supplier: "ADW", colours: ["khaki", "navy", "olive"], sizes: "bottoms", cost: 350, price: 510, weight: 5, profile: "steady", rack: "R-02", shelf: 1 },
    { code: "SHO", name: "Cargo Shorts", design: "Six-pocket cotton cargo shorts", category: "shorts", brand: "Saffron Denim", keywords: "shorts cargo half pant summer", supplier: "ADW", colours: ["khaki", "olive"], sizes: "bottoms", cost: 240, price: 349, weight: 4, profile: "summer", rack: "R-03", shelf: 1 },
    { code: "DNJ", name: "Denim Jacket", design: "Rigid denim trucker jacket", category: "jacket", brand: "Saffron Denim", keywords: "jacket denim trucker", supplier: "ADW", colours: ["indigo"], sizes: "tops-xl", cost: 640, price: 929, weight: 1.2, profile: "winter", rack: "R-03", shelf: 4 },
  ],
  extraLocations: [
    { code: "A-SR-S1-B01", rack: "SR", shelf: "1", bin: "01" },
    { code: "A-SR-S1-B02", rack: "SR", shelf: "1", bin: "02" },
    { code: "A-R12-S5-B12", rack: "R-12", shelf: "5", bin: "12" },
  ],
  scenarios: true,
};

export const INDIGO_LANE: BusinessDef = {
  slug: "indigo-lane",
  name: "Indigo Lane",
  kind: "brand",
  city: "Bengaluru",
  tagline: "Independent label: organic cotton and linen essentials",
  historyDays: 90,
  ordersPerDay: 1.2,
  closedWeekday: 0,
  users: [
    { name: "Nisha Rao", email: "nisha@indigolane.example", role: "owner", title: "Founder" },
    { name: "Karthik S.", email: "karthik@indigolane.example", role: "warehouse", title: "Studio dispatch" },
  ],
  suppliers: [
    { code: "CBE", name: "Coimbatore Organic Mills", city: "Coimbatore", leadTimeDays: 15, moqUnits: 40, packSize: 4, paymentTerms: "Full payment in 30 days" },
  ],
  customers: [
    { code: "S01", name: "Kora Concept Store", city: "Indiranagar, Bengaluru", creditDays: 30 },
    { code: "S02", name: "The Loom Room", city: "Pune", creditDays: 30 },
    { code: "S03", name: "Website orders", city: "Online", creditDays: 0 },
  ],
  products: [
    { code: "OGT", name: "Organic Everyday Tee", design: "GOTS organic cotton jersey", category: "t-shirt", brand: "Indigo Lane", keywords: "tee tshirt organic", supplier: "CBE", colours: ["ecru", "indigo"], sizes: "tops-xl", cost: 260, price: 690, weight: 6, profile: "steady", rack: "R-01", shelf: 1 },
    { code: "RLS", name: "Relaxed Linen Shirt", design: "Washed linen", category: "shirt", brand: "Indigo Lane", keywords: "shirt linen relaxed", supplier: "CBE", colours: ["ecru", "rust"], sizes: "tops-xl", cost: 640, price: 1890, weight: 3, profile: "steady", rack: "R-01", shelf: 3 },
    { code: "WLT", name: "Wide-Leg Trouser", design: "Cotton-linen twill", category: "trousers", brand: "Indigo Lane", keywords: "trouser trousers pants wide leg", supplier: "CBE", colours: ["indigo"], sizes: "bottoms", cost: 720, price: 2190, weight: 2, profile: "steady", rack: "R-02", shelf: 1 },
  ],
  extraLocations: [],
  scenarios: false,
};

export const BUSINESSES = [SAFFRON, INDIGO_LANE];

/** Demand multiplier for a product's profile on a calendar day (month 1-12). */
export function seasonFactor(profile: Profile, month: number, day: number): number {
  const md = month * 100 + day;
  const diwaliRun = md >= 1001 && md <= 1107; // Diwali is 8 Nov 2026
  switch (profile) {
    case "festive":
      return diwaliRun ? 2.6 : md >= 915 && md < 1001 ? 1.4 : 0.8;
    case "winter":
      return month >= 11 || month <= 1 ? 2.2 : month === 10 ? 1.3 + (day / 31) * 0.9 : month === 9 ? 0.6 : 0.25;
    case "summer":
      return month >= 4 && month <= 6 ? 1.6 : month === 7 || month === 8 ? 0.9 : month === 9 ? 0.35 : 0.08;
    default:
      return diwaliRun ? 1.25 : 1;
  }
}
