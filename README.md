# Proof of Stay

Guests prove they stayed at a hotel without revealing who they are, and get honest reviews and returning-guest discounts in return. Private by default, accountable when needed.

Built at HackMeridian 2026 (Stellar) by BookerBob. Work in progress, see [PLAN.md](PLAN.md) and [PRIOR_WORK.md](PRIOR_WORK.md).

## Beyond hotels

A hotel in this contract is just "a place where you were a customer": one tree of customers per merchant, one nullifier per (action, merchant, period). The same circuit and contract shape extends to merchants over UCP (Universal Commerce Protocol), with reviews only from proven buyers and a returning-customer discount the buyer's agent applies at agentic checkout, and then to restaurants, services and events.

## Roadmap

- Generalize `Hotel` to `Merchant` with a merchant type, and let a UCP order be an entry into the tree.
- Night resale on SDEX, hidden ratings revealed at k>=5, portable loyalty across a hotel network.
- Blind arbiter in a TEE, agent spending limits via OpenZeppelin policies and x402.
