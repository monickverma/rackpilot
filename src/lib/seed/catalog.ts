// The synthetic shop: 3 suppliers, 40 products, ~300 variants on racks R1-R6.
// Everything here is made up for the demo.

export const SHOP = {
  name: "Rang Mahal Garments",
  city: "Indore",
  note: "Synthetic demo shop. Products, customers, suppliers and sales are generated.",
};

export interface SupplierDef {
  id: number;
  name: string;
  city: string;
  leadTimeDays: number;
  /** Size-set pack the supplier ships, e.g. S1:M2:L2:XL1:XXL1. */
  packRatio: string;
}

export const SUPPLIERS: SupplierDef[] = [
  { id: 1, name: "Jaipur Prints Co.", city: "Jaipur", leadTimeDays: 7, packRatio: "S1:M2:L2:XL1:XXL1" },
  { id: 2, name: "Surat Textile Hub", city: "Surat", leadTimeDays: 5, packRatio: "S1:M2:L2:XL2:XXL1" },
  { id: 3, name: "Tiruppur Knitwear", city: "Tiruppur", leadTimeDays: 14, packRatio: "S2:M3:L3:XL2:XXL1" },
];

/** Demand shape over the year; see seasonMultiplier in generate.ts. */
export type Profile = "default" | "festive" | "navratri" | "chaniya" | "diwali" | "winter";

export interface ProductDef {
  code: string;
  name: string;
  category: string;
  supplierId: number;
  colours: string[];
  free?: boolean;
  cost: number;
  price: number;
  /** Relative demand; 1.0 is about 0.9 units a day across all variants. */
  popularity: number;
  profile: Profile;
  rack: string;
  keywords: string;
  /** Sells only around a festival; see SEASONS in insights.ts. */
  season?: "navratri";
  /** Bought once, then stopped selling: the dead stock in the demo. */
  dead?: { introDay: number; activeUntilDay: number; dailyDemand: number };
}

export const PRODUCTS: ProductDef[] = [
  // R1 - everyday kurtis
  { code: "K101", name: "Cotton A-Line Kurti", category: "kurti", supplierId: 1, colours: ["black", "maroon", "mustard", "navy"], cost: 280, price: 549, popularity: 1.8, profile: "default", rack: "R1", keywords: "cotton aline daily" },
  { code: "K102", name: "Rayon Straight Kurti", category: "kurti", supplierId: 1, colours: ["black", "pink"], cost: 260, price: 499, popularity: 1.2, profile: "default", rack: "R1", keywords: "rayon straight" },
  { code: "K103", name: "Chikankari Kurti", category: "kurti", supplierId: 1, colours: ["white", "peach"], cost: 450, price: 899, popularity: 1.0, profile: "default", rack: "R1", keywords: "chikankari chikan lucknowi embroidered" },
  { code: "K104", name: "Anarkali Kurti", category: "kurti", supplierId: 1, colours: ["maroon", "green"], cost: 520, price: 999, popularity: 1.0, profile: "festive", rack: "R1", keywords: "anarkali flared festive" },
  { code: "K105", name: "Block Print Kurti", category: "kurti", supplierId: 1, colours: ["navy", "rust"], cost: 300, price: 599, popularity: 0.8, profile: "default", rack: "R1", keywords: "block print printed jaipuri" },
  { code: "K106", name: "Bandhani Kurti", category: "kurti", supplierId: 1, colours: ["red", "yellow"], cost: 340, price: 699, popularity: 0.8, profile: "navratri", rack: "R1", keywords: "bandhani bandhej" },
  // R2 - more kurtis and tops
  { code: "K107", name: "Mirror Work Kurti", category: "kurti", supplierId: 1, colours: ["black", "magenta"], cost: 480, price: 949, popularity: 0.8, profile: "navratri", rack: "R2", keywords: "mirror navratri festive" },
  { code: "K108", name: "Short Kurti", category: "kurti", supplierId: 1, colours: ["white", "olive"], cost: 220, price: 399, popularity: 0.7, profile: "default", rack: "R2", keywords: "short" },
  { code: "K109", name: "Khadi Kurti", category: "kurti", supplierId: 1, colours: ["beige"], cost: 380, price: 749, popularity: 0.5, profile: "default", rack: "R2", keywords: "khadi handloom" },
  { code: "K110", name: "Georgette Kurti", category: "kurti", supplierId: 2, colours: ["wine", "teal"], cost: 360, price: 699, popularity: 0.6, profile: "festive", rack: "R2", keywords: "georgette party" },
  { code: "K111", name: "Angrakha Kurti", category: "kurti", supplierId: 1, colours: ["mustard"], cost: 400, price: 799, popularity: 0.5, profile: "default", rack: "R2", keywords: "angrakha" },
  { code: "K112", name: "Embroidered Rayon Kurti", category: "kurti", supplierId: 1, colours: ["maroon"], cost: 420, price: 849, popularity: 0.6, profile: "festive", rack: "R2", keywords: "embroidered embroidery rayon" },
  { code: "T501", name: "Georgette Top", category: "top", supplierId: 2, colours: ["black", "peach"], cost: 260, price: 499, popularity: 0.8, profile: "default", rack: "R2", keywords: "georgette" },
  { code: "T502", name: "Peplum Top", category: "top", supplierId: 2, colours: ["lavender"], cost: 280, price: 549, popularity: 0.5, profile: "default", rack: "R2", keywords: "peplum" },
  { code: "T503", name: "Crop Top", category: "top", supplierId: 3, colours: ["white"], cost: 180, price: 349, popularity: 0.6, profile: "default", rack: "R2", keywords: "crop" },
  // R3 - sets and palazzos
  { code: "S201", name: "Cotton Kurta Set", category: "kurta_set", supplierId: 1, colours: ["pink", "sky blue"], cost: 520, price: 999, popularity: 0.8, profile: "default", rack: "R3", keywords: "cotton kurta pant set" },
  { code: "S202", name: "Festive Kurta Set", category: "kurta_set", supplierId: 2, colours: ["maroon", "green"], cost: 900, price: 1799, popularity: 0.7, profile: "festive", rack: "R3", keywords: "festive embroidered silk" },
  { code: "S203", name: "Palazzo Kurta Set", category: "kurta_set", supplierId: 1, colours: ["mustard", "teal"], cost: 750, price: 1499, popularity: 0.6, profile: "default", rack: "R3", keywords: "palazzo three piece" },
  { code: "C1401", name: "Cotton Co-ord Set", category: "coord_set", supplierId: 3, colours: ["olive"], cost: 480, price: 949, popularity: 0.5, profile: "default", rack: "R3", keywords: "cotton" },
  { code: "C1402", name: "Rayon Co-ord Set", category: "coord_set", supplierId: 2, colours: ["black"], cost: 520, price: 999, popularity: 0.5, profile: "default", rack: "R3", keywords: "rayon" },
  { code: "P301", name: "Cotton Palazzo", category: "palazzo", supplierId: 1, colours: ["white", "black"], cost: 180, price: 349, popularity: 1.3, profile: "default", rack: "R3", keywords: "cotton plain" },
  { code: "P302", name: "Printed Palazzo", category: "palazzo", supplierId: 1, colours: ["navy"], cost: 200, price: 399, popularity: 0.5, profile: "default", rack: "R3", keywords: "printed print" },
  // R4 - leggings, tees, nightwear
  { code: "L401", name: "Churidar Legging", category: "legging", supplierId: 2, colours: ["black", "white", "maroon"], cost: 120, price: 249, popularity: 1.6, profile: "default", rack: "R4", keywords: "churidar cotton lycra" },
  { code: "L402", name: "Ankle Legging", category: "legging", supplierId: 2, colours: ["black", "grey"], cost: 130, price: 279, popularity: 1.0, profile: "default", rack: "R4", keywords: "ankle" },
  { code: "TS601", name: "Round Neck T-Shirt", category: "tshirt", supplierId: 3, colours: ["black", "white"], cost: 150, price: 299, popularity: 1.1, profile: "default", rack: "R4", keywords: "round neck cotton" },
  { code: "TS602", name: "Polo T-Shirt", category: "tshirt", supplierId: 3, colours: ["navy"], cost: 220, price: 449, popularity: 0.5, profile: "default", rack: "R4", keywords: "polo collar" },
  { code: "N701", name: "Cotton Night Suit", category: "night_suit", supplierId: 3, colours: ["pink", "sky blue"], cost: 350, price: 699, popularity: 0.7, profile: "default", rack: "R4", keywords: "cotton pyjama" },
  { code: "N702", name: "Satin Night Suit", category: "night_suit", supplierId: 3, colours: ["wine"], cost: 450, price: 899, popularity: 0.4, profile: "default", rack: "R4", keywords: "satin" },
  // R5 - dupattas and sarees (free size)
  { code: "D801", name: "Chiffon Dupatta", category: "dupatta", supplierId: 1, colours: ["white", "red", "pink", "mustard"], free: true, cost: 120, price: 249, popularity: 0.8, profile: "default", rack: "R5", keywords: "chiffon" },
  { code: "D802", name: "Bandhani Dupatta", category: "dupatta", supplierId: 1, colours: ["red", "green", "yellow"], free: true, cost: 180, price: 399, popularity: 0.5, profile: "navratri", rack: "R5", keywords: "bandhani bandhej" },
  { code: "D803", name: "Phulkari Dupatta", category: "dupatta", supplierId: 1, colours: ["orange", "pink"], free: true, cost: 260, price: 549, popularity: 0.4, profile: "festive", rack: "R5", keywords: "phulkari embroidered" },
  { code: "SR901", name: "Georgette Saree", category: "saree", supplierId: 2, colours: ["pink", "navy", "wine"], free: true, cost: 650, price: 1299, popularity: 0.6, profile: "festive", rack: "R5", keywords: "georgette party" },
  { code: "SR902", name: "Cotton Saree", category: "saree", supplierId: 2, colours: ["white", "yellow"], free: true, cost: 450, price: 899, popularity: 0.4, profile: "default", rack: "R5", keywords: "cotton" },
  // R6 - festive, occasion and the back rack
  { code: "SR903", name: "Banarasi Silk Saree", category: "saree", supplierId: 2, colours: ["red", "maroon", "green"], free: true, cost: 1500, price: 2999, popularity: 0.5, profile: "diwali", rack: "R6", keywords: "silk banarasi festive" },
  { code: "LH1001", name: "Navratri Chaniya Choli", category: "lehenga", supplierId: 2, colours: ["red", "pink"], cost: 1100, price: 2199, popularity: 0.3, profile: "chaniya", rack: "R6", keywords: "chaniya choli navratri mirror", season: "navratri" },
  { code: "G1101", name: "Sequin Party Gown", category: "gown", supplierId: 2, colours: ["black", "wine"], cost: 1200, price: 2499, popularity: 0, profile: "default", rack: "R6", keywords: "sequin party", dead: { introDay: -150, activeUntilDay: -118, dailyDemand: 0.09 } },
  { code: "G1102", name: "Anarkali Gown", category: "gown", supplierId: 2, colours: ["maroon"], cost: 900, price: 1799, popularity: 0.3, profile: "festive", rack: "R6", keywords: "anarkali festive" },
  { code: "SH1201", name: "Woollen Shrug", category: "shrug", supplierId: 3, colours: ["grey", "maroon"], cost: 380, price: 749, popularity: 0, profile: "winter", rack: "R6", keywords: "woollen woolen winter", dead: { introDay: -172, activeUntilDay: -140, dailyDemand: 0.06 } },
  { code: "J1301", name: "Denim Jacket", category: "jacket", supplierId: 3, colours: ["blue"], cost: 650, price: 1299, popularity: 0, profile: "default", rack: "R6", keywords: "denim", dead: { introDay: -165, activeUntilDay: -72, dailyDemand: 0.06 } },
  { code: "J1302", name: "Quilted Jacket", category: "jacket", supplierId: 3, colours: ["mustard"], cost: 700, price: 1399, popularity: 0.15, profile: "winter", rack: "R6", keywords: "quilted winter" },
];

export const CUSTOMERS = [
  "Priya S.", "Neha K.", "Kavita R.", "Anjali M.", "Pooja D.", "Sunita B.", "Meena J.", "Ritu G.",
  "Farah N.", "Lakshmi V.", "Harpreet K.", "Zoya A.", "Deepa T.", "Rekha P.", "Shalini C.", "Nisha W.",
];
