# Requests to the core contract (routed by the coordinator, not edited here)

Status: both delivered in contract v2 `CBEGVNZF…L5EBY` (`book_amount`, `book_with_discount_amount`, `redeem`) and used by the bridge.

## 1. Per-order amount for real stores
**Now:** a `Merchant` has one `price`; `book` / `book_with_discount` always charge it. A Shopify store has many items, quantities and shipping, so the UCP module can only take one item at one price (the tee, 40.80 test USDC) on the Stellar path.
**Ask:** `book_with_discount_amount(merchant, guest, season, amount, order_ref, proof, root, nullifier)` (and the full-price twin), where `amount` and `order_ref` (32-byte hash of the store order) are authorized by the merchant admin (`admin.require_auth()` on a signed quote, or the admin co-signs). Discount still applied by the contract from `discount_bps`, so a merchant cannot quote one price and charge another without signing it.
**Why:** any cart, multi-item orders, shipping; the on-chain record names the order it paid.

## 2. Nullifier spend without a USDC transfer (card fallback)
**Now:** the only way to burn a discount nullifier is `book_with_discount`, which also moves USDC. When the buyer pays with a Shopify test card instead, the bridge can only reserve the nullifier off chain.
**Ask:** `redeem(merchant, guest, season, proof, root, nullifier)`: same checks and spend as `book_with_discount`, no transfer, event `redeem`. Optionally `admin.require_auth()` so only the merchant's bridge can call it.
**Why:** one discount per past purchase per season stays enforced on Stellar whatever rail pays.

Neither blocks the demo.
