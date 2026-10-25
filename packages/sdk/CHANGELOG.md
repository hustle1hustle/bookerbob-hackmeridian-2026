# @bookerbob/pos-sdk changelog

Breaking changes are marked **BREAKING**. Consumers: `app/`, the agent, the UCP module.

## 0.2.0 (Sun 25 Oct)
- **BREAKING** `Hotel` is now `Merchant` with `kind` (`hotel`, `cafe`, `shop`, ...). `chain.listHotels/getHotel` are `listMerchants/getMerchant`; `Review.hotel`, `Stay.hotel` and `DisclosurePackage.hotel` are `merchant`; `HotelNotFound` is `MerchantNotFound`.
- Added `chain.faucet()`, `chain.balance()`, `disclosure.submit()`, `disclosure.queue()`, `Dispute`, wallet kind `"local"` (demo key kept in the browser), client errors `NotDemoMerchant`, `NotInTree`, `DisclosureRejected`.
- `createSdk({ mode: "testnet", testnet: { apiUrl } })` returns the real implementation: views over Stellar RPC, browser proving with Semaphore v4 depth-10 artifacts, reviews through the BookerBob relayer.
- Low-level modules for servers and scripts: `contract.ts` (typed views, `write`), `derive.ts` (scopes, messages, stay identities), `prove.ts`, `convert.ts`, `disclosure.ts`.

## 0.1.0 (Sun 25 Oct)
- Types and in-memory mock of `chain`, `prover`, `wallet`, `stays`, `disclosure`.
