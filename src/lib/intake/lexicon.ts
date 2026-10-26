// Words the rule-based order reader knows. Products are not listed here: they
// are matched against each business's own catalogue (name, category and
// keywords), so the same reader works for any tenant.

/** Canonical colour -> words customers use for it (English and Hindi). */
export const COLOURS: Record<string, string[]> = {
  black: ["black", "blk", "kala", "kaala", "kali", "kaali"],
  white: ["white", "wht", "safed", "safaid"],
  navy: ["navy", "navy blue", "dark blue", "nevi"],
  blue: ["blue", "neela", "nila", "neeli"],
  grey: ["grey", "gray", "slate", "ash"],
  beige: ["beige", "cream", "sand"],
  olive: ["olive", "olive green", "army green", "army"],
  maroon: ["maroon", "wine", "burgundy"],
  pink: ["pink", "gulabi", "baby pink"],
  sky: ["sky", "sky blue", "light blue", "aasmani"],
  mustard: ["mustard", "peela", "yellow"],
  indigo: ["indigo", "dark denim", "denim blue"],
  khaki: ["khaki", "beige khaki", "fawn"],
  brown: ["brown", "bhura", "coffee", "chocolate"],
  ecru: ["ecru", "off white", "off-white", "natural"],
  rust: ["rust", "terracotta", "brick"],
};

export const SIZE_WORDS: Record<string, string> = {
  s: "S", small: "S", m: "M", medium: "M", med: "M", l: "L", large: "L", xl: "XL", xxl: "XXL", "2xl": "XXL", xxxl: "XXL",
  "28": "28", "30": "30", "32": "32", "34": "34", "36": "36",
};

export const NUMBER_WORDS: Record<string, number> = {
  ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, paanch: 5, panch: 5, five: 5, chhe: 6, che: 6, six: 6,
  saat: 7, seven: 7, aath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10, barah: 12, twelve: 12, dozen: 12, darjan: 12,
  pandrah: 15, fifteen: 15, bees: 20, twenty: 20, pachees: 25, pachis: 25, tees: 30, thirty: 30, chalis: 40, forty: 40, pachaas: 50, fifty: 50,
};

/** Words that carry no order information. */
export const FILLER = new Set([
  "bhai", "bhaiya", "bhaiyya", "ji", "sir", "hi", "hello", "namaste", "please", "pls", "plz", "chahiye", "chaiye", "bhejo", "bhej", "bhejna",
  "bhejdo", "dena", "de", "dedo", "send", "need", "want", "order", "piece", "pieces", "pc", "pcs", "pcs.", "nos", "qty", "size", "sizes",
  "colour", "color", "in", "of", "the", "a", "an", "for", "me", "mujhe", "hume", "humko", "ko", "ka", "ki", "ke", "se", "hai", "hain",
  "bhi", "aur", "and", "also", "plus", "with", "wale", "wala", "waali", "wali", "rang", "set", "thanks", "thank", "you", "dhanyavad", "ok",
  "okay", "everything", "sab", "saare", "sare", "maal", "stock", "by", "tak", "tk", "till", "until", "before", "pehle", "ready", "rakhna",
  "rakho", "karo", "kar", "do", "is", "this", "that", "next", "time", "same", "as", "last", "pichla", "jaisa", "mein", "me",
]);

/** Words that mean "the same quantity for each size". */
export const EACH_WORDS = new Set(["each", "har", "harek", "har-ek", "every", "per", "sabme", "sabmein"]);

export const URGENT_WORDS = new Set(["urgent", "urgently", "jaldi", "asap", "turant", "fast", "immediately"]);

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export const WEEKDAY_SHORT: Record<string, string> = { sun: "sunday", mon: "monday", tue: "tuesday", tues: "tuesday", wed: "wednesday", thu: "thursday", thur: "thursday", thurs: "thursday", fri: "friday", sat: "saturday", somvar: "monday", mangalvar: "tuesday", budhvar: "wednesday", guruvar: "thursday", shukravar: "friday", shanivar: "saturday", ravivar: "sunday" };

export const DUE_WORDS: Record<string, string> = {
  today: "today", aaj: "today", tonight: "today", tomorrow: "tomorrow", tmrw: "tomorrow", tmr: "tomorrow", kal: "tomorrow",
  parso: "day-after", parson: "day-after",
};

/** How the seed and the sample inbox phrase each demo product in a message. */
export const SPOKEN: Record<string, string[]> = {
  TSH: ["crew tee", "plain tee", "round neck tee", "basic tee"],
  OVT: ["oversized tee", "oversized t-shirt", "drop shoulder tee"],
  GRT: ["graphic tee", "printed tee"],
  POL: ["polo", "polo tshirt"],
  TNK: ["vest", "tank"],
  SHT: ["oxford shirt", "oxford"],
  LIN: ["linen shirt"],
  CRD: ["cord overshirt", "corduroy shirt"],
  KRT: ["kurta"],
  NHR: ["nehru jacket", "modi jacket"],
  HOD: ["hoodie"],
  SWT: ["sweatshirt"],
  JOG: ["joggers", "jogger"],
  TRK: ["track pant", "trackpant"],
  DNM: ["jeans", "slim jeans"],
  CHN: ["chinos", "chino"],
  SHO: ["cargo shorts", "shorts"],
  DNJ: ["denim jacket"],
  OGT: ["organic tee"],
  RLS: ["linen shirt"],
  WLT: ["wide leg trouser"],
};
