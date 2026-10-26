# Prompt log

Every prompt sent to the Claude Code session (Claude Opus 5.5) that built RackPilot, word for word and oldest first.

The brief asked for a voice-only build. Prompt 2 records that the organisers' updated rules no longer require voice, so this log is a record of the build. It is not proof that every prompt was dictated.

Prompts sent to the coordinating session that started this one are not included.

## 1. 25 Oct 2026, 09:13 PM IST

_The task brief. It was written by the coordinating Claude Code session that started this build session, not typed here by the user; it still describes the original voice-only rules._

> Background (from the session that started this one):
> The user (GitHub: monickverma; `gh` already authenticated) is entering the Hacker House Goa 2026 Wild Card. It grants remote participation in the Oct 28–31 Goa residency, and every valid submission is accepted, so it is pass/fail on the rules rather than a ranking.
>
> **Official rules**
> - Build the whole project by voice with Wispr Flow. AI coding tools are fine; hand-typed code is not.
> - The screen recording must show the build process, not just the result.
> - The project must work but need not be production-ready.
> - Wispr Flow signup via the referral link is mandatory.
> - Each person submits individually, and resubmission is not allowed.
>
> **Form fields:** name, referral link used (Yes), GitHub id, team name, contact number, repo link, and a demo video link on public social media. The form says the video won't be used for judging, so link it from the README too.
>
> **Why this idea:** the user chose RackPilot after reviewing past HHGoa winners. What the winners shared:
> - a narrow real user
> - a working demo
> - deterministic logic, with the LLM only explaining
> - honest measurement
>
> Close analogues: Ledgerline (AI invoice checks for Indian small businesses), DumpIt (messy speech into a structured board), and Kavach (rules decide, the LLM explains).
>
> **Machine:** Windows 11 with PowerShell and Git Bash. This folder (`C:\Users\KIIT\hhgoa-rackpilot`) was created empty for this project.
>
> Task:
> You are the build partner for **RackPilot**, the user's Hacker House Goa 2026 (HHGoa) Wild Card entry. The user dictates every prompt to you with Wispr Flow while screen-recording, and you write all the code. The entry only counts if the project is built by voice and the recording shows the build happening, so the order of work below matters.
>
> ## Your first turn (do this now)
> 1. Do not create any project files yet. Check the toolchain read-only: `node -v`, `npm -v`, `git --version`, `gh auth status`. Report anything missing or outdated.
> 2. Give the user a short readiness checklist:
>    - **Wispr Flow account:** created through https://ref.wisprflow.ai/hhg. This is mandatory. Sign up in the same browser right after clicking, with the same email they'll use on the submission form.
>    - **Recording:** OBS (or similar) capturing screen and mic, with the Wispr Flow indicator visible.
>    - **Voice only:** from here on, every instruction comes by voice.
> 3. Propose the build order below as 5–8 short steps, then stop and wait for their first dictated prompt.
>
> ## What RackPilot is
> An AI operations assistant for a small Indian clothing shop. Orders arrive as WhatsApp-style messages, often in Hinglish (e.g. "Bhaiya 3 black kurti M, 2 L, 1 maroon XL, Saturday tak"). RackPilot:
> - turns each message into a structured order
> - checks and reserves stock by size, colour and rack location
> - prints pick lists
> - flags low or conflicting stock
>
> The core rule: stock, reservations and recommendations come from deterministic code and database queries. An LLM may only parse messy text and phrase explanations, and every claim links to the rows behind it.
>
> ## Wild Card scope (deadline Oct 26, 2026, 11:59 PM IST)
> - **Module A, inventory and racks:**
>   - Products and variants: SKU, size S–XXL, colour.
>   - Rack locations such as `R3-B2`.
>   - On-hand, reserved and available counts.
>   - A `stock_movements` ledger that records every change: receive, reserve, release, sale, adjust, exchange.
> - **Module B, order processing:**
>   - **Paste and parse:** the user pastes a message and gets line items back.
>   - **Parser:** build a rule-based parser first (sizes, colours, quantities, Hinglish filler like "pc", "aur", "chahiye") so the demo works without an API key. Add an optional server-side LLM fallback for messy messages; its key goes in `.env.local` and is never committed.
>   - **Draft:** match lines to variants and show a draft order with unmatched words highlighted.
>   - **On confirm:** reserve stock, flag lines that are short or conflict with other orders, and generate a pick list grouped and sorted by rack. Then the user picks and fulfils the order, and the sale is recorded.
> - **Stretch, only if time allows (Module C):**
>   - low-stock alerts (days of cover vs supplier lead time)
>   - ageing and dead stock
>   - best-selling variants
>   - a reorder suggestion that shows its evidence, e.g. "14 sold in 30 days, 3 left, 6 reserved, supplier takes 10 days"
> - **Saved for the Oct 28–31 residency, do not build now:**
>   - **The ₹30,000 "what should I order?" plan:**
>     - need = daily sales × (lead time + review period) − (on hand − reserved + on order)
>     - round up to the supplier's size-set packs
>     - rank by margin per rupee until the budget runs out
>     - then purchase order and receiving
>   - **"Ask your business" questions:** answered through fixed query templates, never free-form SQL written by an LLM.
>
> ## Data
> - **Synthetic shop, clearly labelled as such:**
>   - about 40 products and 300 variants
>   - racks R1–R6 × shelves A–D
>   - 3 suppliers with 5–14 day lead times and size-set packs (e.g. S1:M2:L2:XL1)
>   - 6 months of sales with a festive peak (Navratri/Diwali), a realistic size curve (M and L sell most), and a few dead-stock items
> - **Parser test set:** 40–50 sample WhatsApp orders in English and Hinglish, each with its expected parse. Report the parser's accuracy (e.g. "46/50 correct") in the README.
> - **No real WhatsApp integration:** pasting a message or a simulated chat is enough.
>
> ## Suggested stack (confirm with the user before scaffolding)
> - Next.js (App Router, TypeScript) with Drizzle and SQLite locally.
> - For the hosted demo, a database that persists, whichever the user prefers: Turso, Supabase or Neon.
> - Deploy on Vercel.
>
> ## How to work while they record
> - Work in small, visible steps. After each step, say what to look at (`localhost` URL or page).
> - Keep replies short.
> - Append each dictated prompt verbatim to `docs/prompts.md` as proof of voice-building.
> - Never commit secrets.
> - Don't create the GitHub repo, push or deploy until the user says to.
>
> ## Done means
> - **A public GitHub repo whose README covers:**
>   - the problem, live link and video link
>   - architecture and how to run it
>   - what's synthetic, and the parser accuracy
>   - a "Built 100% by voice with Wispr Flow" line linking `docs/prompts.md`
> - **A deployed demo of this 90-second flow:**
>   1. Paste the Hinglish order. It parses, finds maroon XL short, reserves the rest, and prints a pick list with rack locations.
>   2. The low-stock and dead-stock flags appear.
>   3. Fulfil the order and the movements show up in the ledger.
> - **Time to spare:** the user still has to cut a ~5-minute video (20 s problem, 3 min build, 1 min demo) and submit the form by about 9 PM IST on Oct 26.
>
> Shared notes folder for this group of sessions (outside the repo; read siblings' notes there, leave hand-over notes or large findings there instead of pasting them into messages): C:\Users\KIIT\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_956d25ac-94b9-4c6f-93ef-cb25f7e68dec

## 2. 25 Oct 2026, 09:19 PM IST

> Here's something: the new rules dropped in, and I could hand-type it, so I do not need to particularly use the voice to build it. The hackathon organizer emailed me this thing, and now we are going to build it with our Opus 5.5, layout the project, and start building fast.

## 3. 25 Oct 2026, 09:36 PM IST

_Sent while Claude was working; picked up mid-turn._

> One thing I forgot to mention: you could look at the good modern UIs. I really want a good design. Also, look at the existing solution and how their tech stack works. Find their documentation and GitHub repos, and look at whether it is worthwhile. I really want a sleek, professional, and modern design. That's it.

## 4. 25 Oct 2026, 10:48 PM IST

_Chosen from a suggested reply that Claude offered in the Claude desktop app._

> I freed space on C:. Continue: run the app, verify the demo in the browser, add the Claude fallback, write the README, prompt log and eval report, and commit locally.

## 5. 26 Oct 2026, 12:51 AM IST

> I hit my usage limit while you were working, but it has reset now. Please continue from where you left off.

## 6. 26 Oct 2026, 01:31 AM IST

_Chosen from a suggested reply that Claude offered in the Claude desktop app._

> Yes: create the public GitHub repo under monickverma and push rackpilot-v1 as main.

## 7. 26 Oct 2026, 01:35 AM IST

> could you fine me repo like this real good from x github reddit etc

## 8. 26 Oct 2026, 01:41 AM IST

_Chosen from a suggested reply that Claude offered in the Claude desktop app._

> Yes: add the best matches to the README's prior-work table, fix the Chat2Cash row, then commit and push.

## 9. 26 Oct 2026, 01:48 AM IST

> medusajs design copy it mostly and better it if you have to also use light theme as default

## 10. 26 Oct 2026, 02:55 AM IST

> Try again

## 11. 26 Oct 2026, 12:09 PM IST

_Chosen from a suggested reply that Claude offered in the Claude desktop app._

> Yes: commit the Medusa redesign and push it to main.
