# Claude Design handoff: Proof of Stay web app (BookerBob, HackMeridian 2026)

Deliver CODE, not a prototype: React + TypeScript components for a Vite app, with the craft already implemented (layout, type, color, motion, all states). The build session wires them to the chain through the 3 bind points below and does not touch the visual layer. Hard deadline: components by Mon 26 Oct 03:00 Lisbon. The integrated app must be live by 06:00, and the 2-4 min demo video is recorded from it.

## What it is
Guests prove they stayed at a hotel without revealing who they are. In return they get honest reviews and a returning-guest discount. One zero-knowledge proof (Semaphore v4, verified on Stellar testnet) powers three things: an anonymous review (one per stay), a discount on a repeat booking (paid in USDC in the same transaction), and a dispute flow where the guest discloses only to an arbiter.
Tagline: **private by default, accountable when needed.**

Audience, in order: hackathon judges (they open the live URL on a laptop, often WITHOUT a wallet, and must understand it in 30 seconds), then the demo video, then guests, hotels and an agent.

## Screens (one page, three roles behind a switcher: Guest / Hotel / Arbiter)
Without a wallet, the app opens in **read-only mode**: all hotels, ratings and reviews are visible, and actions ask the viewer to connect.

### Guest
1. **Hotels list.** Each card: name, price in USDC, discount %, **verified rating** (avg of proven reviews), review count, how many are arbiter-verified, and a "proven stays" count (tree size). A filter for max price. The agent pick is highlighted when the agent ran ("Bob picked this: best proven rating under 120 USDC").
2. **Hotel page.** Header with rating, then the review feed. Each review shows:
   - stars;
   - the text;
   - a "proof verified on Stellar" badge linking to the tx on stellar.expert;
   - a "verified stay" mark when the arbiter has attested it;
   - its age, in ledgers or as a time.
   No author, ever. Below the feed: book (full price) or book with the returning-guest discount.
3. **My stays.** The stays this browser holds a stay-identity for, kept locally, never on chain. Per stay there are three actions: write a review, use the returning-guest discount (once per season), and disclose to the arbiter.
4. **Write review.** Star rating 1-5 and text. Then the proof moment (see Moments). On a second review from the same stay, the rejection screen ("this stay already reviewed", not a generic error).
5. **Discount booking.** Price strike-through to the discounted price, then the proof moment, then "paid X USDC, saved Y" with the tx link.

### Hotel
6. **Checkout desk.** Paste or scan the guest's commitment (QR), confirm, and see the leaf join the tree with the new root (short hex) and a tx link.
7. **Review feed** for this hotel, with a "dispute" button per review.

### Arbiter
8. **Dispute queue.** Per dispute: the guest's disclosure package (secret, signature, leaf index), a 3-step check (commitment matches, signature valid, leaf in tree), then "attest". After that the hotel sees only "verified stay", never who.

## The moments that sell it (spend the craft here)
- **The proof moment.** The browser generates a zero-knowledge proof. It takes 0.3-1.5 s, plus a one-time ~4 MB download of the proving files on the first use. Then Stellar verifies it on chain. Show it as a short, honest sequence: preparing, proving, verifying on Stellar, done with the tx link. No fake progress bars. The video's cold open is the final frame: **"proof verified, price dropped"**.
- **Rejected double review.** The same stay cannot review twice. Make the refusal feel like the system working, not an error.
- **Rating comparison** (hotel page or landing): "public platform rating 9.1 from 2,000 unverified reviews" next to "8.4 from 12 proven stays". The left number is static demo copy.
- **What each party sees** (small explainer, landing or footer): hotel, arbiter, public, nobody. This is the security model, drawn simply.

## Data contract (what the chain gives you; design for exactly this)
From contract `proof_of_stay` (view calls, free, no wallet needed):
- `hotel_count() -> u32`
- `get_hotel(id) -> { admin, name, price (USDC, 7 decimals), discount_bps, tree (size), roots, rating_sum, rating_count, verified_count }`
- `get_rating(id) -> { sum, count, verified_count }` (avg = sum / count; count 0 = "no proven reviews yet", never "0.0")
- `get_reviews(hotel) -> [{ hotel, rating 1-5, content_hash, disclosure_commit, nullifier, verified, ledger }]`

The contract stores only the hash of the review text. The text comes from our backend by `content_hash`, and the app checks that the hash matches. If the text is missing, show the stars and "text unavailable", never an empty card.

Write calls return a tx hash and fail with one of these errors. Each needs human copy:
- HotelNotFound, UnknownRoot ("this proof is for an older state of the hotel, refresh and retry");
- NullifierUsed (already reviewed / discount already used this season);
- NonCanonical, InvalidProof ("the proof did not check out");
- BadRating, ReviewNotFound, DuplicateLeaf (already checked in), TreeFull, BadParams.

Missing-data rule: a block with no data drops or shows a plain empty state. It never shows zeros or spinners that never end.

## Bind points (the only seams the build touches)
1. `chain`: `listHotels()`, `getHotel(id)`, `getReviews(id)`, `checkout(hotel, commitment)`, `book(hotel)`, `bookWithDiscount(hotel, season)`, `postReview(hotel, rating, text)`, `attest(reviewId)`. Every write returns `{ txHash } | { error: ErrorName }`.
2. `prover`: `prove(kind, hotel, ...) -> AsyncIterable<'download' | 'proving' | 'verifying' | 'done'>`. The UI animates on these real events.
3. `wallet`: `connect() / address / signer`. Passkey first, Freighter as fallback; read-only when not connected.

Components must take data as props and call these three. Ship a mock implementation of all three so the screens render standalone, and so we can screenshot every state.

## Seed data reality (design for this, not for richer data)
- 3 fictional hotels in Lisbon (we name them), each with 5-12 reviews, 1-3 arbiter-verified, 1 discount booking, 1 open dispute.
- Banner: "demo data on Stellar testnet". Every review is still a real proof and a real transaction.
- Later stage (if time): real Lisbon hotels via our booking partner, with real reviews only. The design must hold with 0-3 reviews per hotel.

## Visual direction
- Brand: **BookerBob**, an agentic hotel desk, with its own palette.
- Feel: travel and trust, calm, premium hospitality. Not a crypto dashboard: no neon, no gradients-on-black, no wallet-first UI. Chain detail (hashes, roots) stays small and secondary, one click away.
- Desktop first (judges), responsive to mobile (the video may show the guest on a phone).
- Light and dark. Accessible contrast. Visible keyboard focus.
- Copy is lowercase-friendly, plain, no em dashes, no emoji. Words: proven, verified stay, private. Never "anonymous forever" or "fully anonymous".

## Deliverables
1. The component tree for screens 1-8 plus the shared shell (role switcher, read-only banner, connect button), as TS/React code.
2. Every state per action: idle, needs wallet, downloading, proving, verifying, success, and each error.
3. Mock `chain`, `prover` and `wallet` modules, plus fixture data that matches the seed reality above.
4. A screenshot per screen and state, so the build can verify render parity against them card by card.
5. Font loading with an explicit fallback, and the tokens as one CSS file.
