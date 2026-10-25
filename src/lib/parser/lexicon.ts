// Vocabulary for English + Hinglish clothing orders. Every phrase is stored in
// normalised form: lower case, no hyphens or apostrophes, single spaces.

import type { Size, TokenKind } from "./types.ts";

export const FREE_SIZE_PRODUCTS = new Set(["saree", "dupatta"]);

export const PRODUCT_LABELS: Record<string, string> = {
  kurti: "Kurti",
  kurta_set: "Kurta set",
  palazzo: "Palazzo",
  legging: "Legging",
  top: "Top",
  tshirt: "T-shirt",
  night_suit: "Night suit",
  dupatta: "Dupatta",
  saree: "Saree",
  lehenga: "Lehenga",
  gown: "Gown",
  shrug: "Shrug",
  jacket: "Jacket",
  coord_set: "Co-ord set",
  shirt: "Shirt",
  jeans: "Jeans",
};

export const PRODUCTS: Record<string, string[]> = {
  kurti: ["kurti", "kurtis", "kurtie", "kurtiyan", "kurtiya", "kurty", "kurthi", "kurtee", "kurta", "kurtas"],
  kurta_set: [
    "kurta set", "kurta sets", "kurti set", "kurti sets", "suit set", "kurta pant set",
    "palazzo set", "palazzo kurta set", "kurta palazzo set", "salwar suit", "suit", "suits",
  ],
  palazzo: ["palazzo", "palazzos", "plazo", "plazzo", "palazo", "plazos", "palazzoes", "palazzo pant", "palazzo pants"],
  legging: [
    "legging", "leggings", "leggins", "legins", "leggin", "lagging", "laggings", "leggies",
    "churidar", "churidar legging", "churidar leggings",
  ],
  top: ["top", "tops"],
  tshirt: ["tshirt", "tshirts", "t shirt", "t shirts", "tee", "tees", "tshrt"],
  night_suit: [
    "night suit", "night suits", "nightsuit", "nightsuits", "night dress", "nighty", "nightie",
    "nighties", "pyjama set", "pajama set",
  ],
  dupatta: ["dupatta", "dupattas", "dupata", "duppatta", "chunni", "chunri", "chunari", "odhni"],
  saree: ["saree", "sarees", "sari", "saris", "saari", "saadi", "sadi"],
  lehenga: ["lehenga", "lehengas", "lehnga", "lengha", "chaniya choli", "chaniya", "ghagra", "ghagra choli"],
  gown: ["gown", "gowns"],
  shrug: ["shrug", "shrugs"],
  jacket: ["jacket", "jackets"],
  coord_set: ["coord", "coords", "coord set", "coord sets", "co ord", "co ord set", "co ords"],
  shirt: ["shirt", "shirts"],
  jeans: ["jeans", "jean"],
};

export const COLOURS: Record<string, string[]> = {
  black: ["black", "blk", "kala", "kaala", "kali", "kaali", "kalaa", "kaale", "kale"],
  white: ["white", "wht", "safed", "safaid", "sufaid", "safedd"],
  maroon: ["maroon", "mehroon", "maroom", "marun", "mehrun", "mahroon", "maroonish"],
  mustard: ["mustard", "mustard yellow", "sarson"],
  navy: ["navy", "navy blue", "dark blue", "navyblue", "nevy"],
  pink: ["pink", "gulabi", "baby pink", "light pink", "pinkish"],
  peach: ["peach"],
  green: ["green", "hara", "hari", "hare", "bottle green", "dark green", "parrot green", "light green"],
  rust: ["rust", "rust orange", "brick"],
  red: ["red", "laal", "lal"],
  yellow: ["yellow", "peela", "pila", "peeli", "pili", "peele"],
  magenta: ["magenta", "rani pink", "rani", "hot pink"],
  olive: ["olive", "olive green", "mehndi", "mehendi"],
  beige: ["beige", "cream", "off white", "offwhite"],
  wine: ["wine", "wine red", "burgundy"],
  teal: ["teal", "teal blue", "peacock", "peacock blue"],
  "sky blue": ["sky blue", "skyblue", "light blue", "aasmani", "asmani", "sky"],
  grey: ["grey", "gray"],
  lavender: ["lavender", "lilac", "light purple"],
  orange: ["orange", "narangi", "kesari", "saffron"],
  blue: ["blue", "neela", "nila", "neeli", "nili", "royal blue"],
  purple: ["purple", "jamuni"],
  brown: ["brown", "bhura", "coffee"],
  gold: ["gold", "golden", "sunehra"],
};

const SIZES: Record<Size, string[]> = {
  S: ["s", "small", "sml"],
  M: ["m", "medium", "med", "medum", "midium"],
  L: ["l", "large", "lrg", "lg"],
  XL: ["xl", "extra large", "x large", "xlarge"],
  XXL: ["xxl", "2xl", "double xl", "dbl xl", "xx large", "xxlarge"],
  XXXL: ["xxxl", "3xl", "triple xl"],
  FREE: ["free size", "freesize", "free"],
};

/** Chest sizes some customers use instead of letters ("40 size"). */
export const NUMERIC_SIZES: Record<number, Size> = { 36: "S", 38: "M", 40: "L", 42: "XL", 44: "XXL" };

export const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, ek: 1, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6,
  chhah: 6, saat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, baarah: 12,
  "half dozen": 6, "aadha dozen": 6, "adha dozen": 6,
};

/** "do" is 2 only when it starts a quantity, never after these verbs ("bhej do"). */
export const DO_VERBS = new Set([
  "de", "bhej", "kar", "rakh", "dikha", "bata", "send", "le", "la", "pack", "karke", "bhijwa", "dikhao",
]);

const DESCRIPTORS = [
  "cotton", "rayon", "chikankari", "chikan", "lucknowi", "anarkali", "aline", "straight", "printed",
  "print", "block", "blockprint", "jaipuri", "bandhani", "bandhej", "khadi", "georgette", "chiffon",
  "silk", "banarasi", "satin", "festive", "embroidered", "embroidery", "mirror", "angrakha", "peplum",
  "crop", "round", "neck", "polo", "collar", "ankle", "woollen", "woolen", "sequin", "party", "denim", "mirror work",
  "phulkari", "short", "long", "plain", "designer", "heavy", "quilted", "lycra", "linen",
];

const UNITS = [
  "pc", "pcs", "piece", "pieces", "pis", "peice", "peices", "nos", "x", "set", "sets", "nag", "qty",
  "quantity", "dozen", "dozens", "darjan",
];

const EACH = ["each", "ea", "har ek", "harek", "per size", "per colour", "per color", "sab", "sabhi"];

/** Due phrases map to a label that due.ts resolves against the message date. */
const DUE: Record<string, string[]> = {
  monday: ["monday", "mon", "somvar", "somwar"],
  tuesday: ["tuesday", "tue", "tues", "mangalvar", "mangalwar"],
  wednesday: ["wednesday", "wed", "budhvar", "budhwar"],
  thursday: ["thursday", "thu", "thur", "thurs", "guruvar", "guruwar"],
  friday: ["friday", "fri", "shukravar", "shukrawar"],
  saturday: ["saturday", "sat", "shanivar", "shaniwar"],
  sunday: ["sunday", "sun", "ravivar", "raviwar", "itwar", "itvaar"],
  today: ["today", "aaj", "aaj hi", "tonight", "aaj shaam", "aaj raat"],
  tomorrow: ["tomorrow", "tmrw", "tmr", "kal"],
  "day-after": ["parso", "parson", "day after tomorrow"],
  "this-week": ["this week", "is hafte", "iss hafte", "is week"],
  "next-week": ["next week", "agle hafte", "agle week"],
  diwali: ["diwali se pehle", "before diwali", "diwali tak", "diwali", "deepawali"],
};

/** Words that only connect a due phrase ("Saturday tak", "by Friday"). */
const DUE_CONNECTORS = ["tak", "tk", "ko", "by", "before", "till", "until", "se pehle"];

const URGENT = ["urgent", "urgently", "jaldi", "jldi", "asap", "turant", "fatafat", "emergency"];

export const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6,
  june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

export const DATE_SUFFIX_WORDS = new Set(["tak", "tk", "tarikh", "tareekh", "tareek", "date"]);
export const PRICE_WORDS = new Set(["wala", "wali", "wale", "waala", "waali", "waale", "rs", "rupees", "rupaye", "rupay", "inr"]);
export const SIZE_WORDS = new Set(["size", "sizes", "saiz", "sz", "no", "number", "num"]);
export const CODE_MARKERS = new Set(["design", "dsn", "code", "article", "art", "style"]);

/** Word separators: they end one line item and start the next. */
export const SEPARATOR_WORDS = new Set(["aur", "and", "or", "also", "plus", "phir", "fir", "then"]);

const FILLERS = [
  // greetings and forms of address
  "hi", "hii", "hiii", "hello", "helo", "hey", "namaste", "namaskar", "ji", "jee", "bhaiya", "bhaiyya",
  "bhaiyaa", "bhaiyaji", "bhai", "bhaisaab", "bhaisahab", "didi", "di", "dii", "sir", "madam", "mam",
  "maam", "aunty", "uncle", "dear", "team", "gm", "good morning", "good evening",
  // politeness
  "please", "pls", "plz", "plss", "plzz", "kindly", "thanks", "thank", "thankyou", "thank you", "thx",
  "ty", "tq", "dhanyavad", "shukriya", "ok", "okay", "okk",
  // Hinglish verbs
  "chahiye", "chaiye", "chahie", "chahiyee", "chiye", "chaihye", "chayie", "bhejo", "bhej", "bhejna",
  "bhejiye", "bhejdo", "bhej do", "bhej dena", "bhejdena", "dena", "de", "dedo", "de do", "dijiye",
  "dijiyega", "rakh", "rakhna", "rakho", "rakhdo", "rakh do", "rakhlo", "rakh lo", "rakhiye", "karo",
  "kar", "kardo", "kar do", "karna", "kariye", "karke", "karungi", "karunga", "kar diya", "diya",
  "lena", "lunga", "lungi", "milega", "milegi", "mil", "jayega", "jayegi", "hoga", "hogi", "hai", "hain",
  "he", "h", "tha", "thi", "hu", "hoon", "dikhao", "dikha", "batao", "bata", "batana", "chahta", "chahti",
  "pack", "packing", "ready", "confirm", "check", "bhijwa", "bhijwado",
  // English verbs and pronouns
  "send", "need", "needed", "want", "wanted", "get", "give", "order", "ordered", "ordering", "deliver",
  "delivery", "dispatch", "ship", "could", "can", "would", "will", "you", "me", "my", "mine", "i", "im",
  "we", "us", "our", "do",
  // grammar words
  "ka", "ki", "ke", "se", "mein", "me", "mai", "main", "par", "pe", "bhi", "bas", "the", "a", "an",
  "of", "in", "for", "with", "to", "at", "is", "are", "it", "this", "that", "these", "those", "some",
  "any", "colour", "color", "colours", "colors", "rang", "wala", "wali", "wale", "vala", "vali", "vale",
  "waala", "waali", "waale", "wo", "woh", "vo", "ye", "yeh", "jo", "same", "dono", "sabse", "pehle",
  "abhi", "jaise", "wahi", "wohi", "total", "only", "sirf", "bus", "also", "more", "aur bhi",
  // markers whose meaning comes from a neighbouring number ("40 size", "design 104", "549 rs")
  "size", "sizes", "saiz", "sz", "no", "number", "num", "design", "dsn", "code", "article", "art",
  "style", "rs", "rupees", "rupaye", "rupay", "inr", "tarikh", "tareekh", "tareek", "date",
  // colour modifiers without a colour of their own
  "dark", "light",
  // more Hinglish glue
  "le", "lo", "li", "liya", "kya", "kyaa", "hai kya", "available", "stock", "mila", "milta", "per",
];

export interface LexEntry {
  kind: TokenKind;
  value?: string | number;
}

function build(): Map<string, LexEntry> {
  const map = new Map<string, LexEntry>();
  // Later groups only fill gaps, so put the most specific meanings first.
  const add = (phrase: string, entry: LexEntry) => {
    if (!map.has(phrase)) map.set(phrase, entry);
  };
  for (const [label, phrases] of Object.entries(DUE)) {
    for (const p of phrases) add(p, { kind: "due", value: label });
  }
  for (const [key, phrases] of Object.entries(PRODUCTS)) {
    for (const p of phrases) add(p, { kind: "product", value: key });
  }
  for (const [colour, phrases] of Object.entries(COLOURS)) {
    for (const p of phrases) add(p, { kind: "colour", value: colour });
  }
  for (const [size, phrases] of Object.entries(SIZES)) {
    for (const p of phrases) add(p, { kind: "size", value: size });
  }
  for (const [word, n] of Object.entries(NUMBER_WORDS)) add(word, { kind: "qty", value: n });
  for (const p of EACH) add(p, { kind: "each" });
  for (const p of UNITS) add(p, { kind: "unit", value: p });
  for (const p of DESCRIPTORS) add(p, { kind: "descriptor", value: p });
  for (const p of URGENT) add(p, { kind: "urgent" });
  for (const p of DUE_CONNECTORS) add(p, { kind: "filler", value: "due-connector" });
  for (const p of SEPARATOR_WORDS) add(p, { kind: "sep" });
  for (const p of FILLERS) add(p, { kind: "filler" });
  return map;
}

export const LEXICON = build();
export const MAX_PHRASE_WORDS = 3;
