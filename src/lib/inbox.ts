// A simulated WhatsApp inbox for the demo. Synthetic customers and messages;
// the first one is the 90-second demo order.

export interface InboxMessage {
  id: string;
  customer: string;
  time: string;
  text: string;
}

export const INBOX: InboxMessage[] = [
  { id: "m1", customer: "Sunita B.", time: "10:42 am", text: "Bhaiya 3 black kurti M, 2 L, 1 maroon XL, Saturday tak" },
  { id: "m2", customer: "Anjali M.", time: "10:31 am", text: "Hi! Chikankari kurti white L 2 and peach M 1 please. Need by Friday" },
  { id: "m3", customer: "Meena J.", time: "10:05 am", text: "didi ek kaala legging M aur 2 safed L kal tak bhej do" },
  { id: "m4", customer: "Zoya A.", time: "9:48 am", text: "Banarasi silk saree red 1 aur green 1, Diwali se pehle chahiye" },
  { id: "m5", customer: "Harpreet K.", time: "9:30 am", text: "Mirror work kurti magenta S 1, black M 1. 28 tak" },
  { id: "m6", customer: "Ritu G.", time: "9:12 am", text: "2 cotton palazzo black XL urgent hai" },
  { id: "m7", customer: "Farah N.", time: "Yesterday", text: "Need 1 denim jacket L and 2 shirts M" },
  { id: "m8", customer: "Lakshmi V.", time: "Yesterday", text: "Ek anarkali kurti chahiye, size L" },
  // The rules misread this one (they pair every colour with every size), so it shows the Claude fallback.
  { id: "m9", customer: "Simran D.", time: "Yesterday", text: "Sis plz send black legging medium 2pc n white one in L, also that mustard kurti u showed in story, M" },
];
