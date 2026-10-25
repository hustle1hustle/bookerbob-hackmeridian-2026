// Proof of Stay SDK types: the seam between the contract side and the app.
// The mock (mock.ts) and the testnet implementation implement exactly these interfaces,
// so the app swaps one for the other without touching UI code.

/** Contract errors (contracts/proof_of_stay `Error`), plus client-side failures. */
export type ContractError =
  | "HotelNotFound"
  | "TreeFull"
  | "BadLeaf"
  | "DuplicateLeaf"
  | "UnknownRoot"
  | "NullifierUsed"
  | "NonCanonical"
  | "InvalidProof"
  | "BadRating"
  | "ReviewNotFound"
  | "BadParams"
export type ClientError = "WalletNotConnected" | "UserRejected" | "InsufficientFunds" | "Network" | "Unknown"
export type ErrorName = ContractError | ClientError

export type WriteOk = { txHash: string }
export type WriteErr = { error: ErrorName; message?: string }
export type WriteResult<T = {}> = (WriteOk & T) | WriteErr

export const isErr = <T>(r: WriteResult<T>): r is WriteErr => "error" in r

/** USDC amounts are raw token units, 7 decimals (1 USDC = 10_000_000n). */
export type Usdc = bigint

export interface Hotel {
  id: number
  admin: string
  name: string
  /** Fictional demo hotel (seed data) vs real hotel (later stage). */
  demo: boolean
  price: Usdc
  discountBps: number
  /** Proven stays = leaves in the hotel's tree. */
  provenStays: number
  /** Current tree root, decimal string. Show short hex, secondary. */
  root: string
  ratingSum: number
  ratingCount: number
  verifiedCount: number
}

export interface Review {
  id: number
  hotel: number
  rating: 1 | 2 | 3 | 4 | 5
  /** sha256 of the text, hex without 0x. The chain stores only this. */
  contentHash: string
  /** Review text from the backend, checked against contentHash. null = "text unavailable". */
  text: string | null
  disclosureCommit: string
  nullifier: string
  /** Arbiter attested a disclosure: show "verified stay". */
  verified: boolean
  ledger: number
  /** Unix ms of the ledger close, when known. */
  time: number | null
  /** Transaction that verified the proof, for the "proof verified on Stellar" link. null if not indexed. */
  txHash: string | null
}

/** A stay this browser holds a per-stay Semaphore identity for. Local only, never on chain. */
export interface Stay {
  hotel: number
  /** Per-hotel stay counter used in the identity derivation. */
  stayIndex: number
  /** Identity commitment (decimal string): the only thing the guest gives the hotel at checkout. */
  commitment: string
  createdAt: number
  /** Set once the hotel checked this commitment in. */
  checkedIn: boolean
  reviewId: number | null
  discountSeasonsUsed: number[]
}

export type ProofRequest =
  | { kind: "review"; stay: Stay; rating: 1 | 2 | 3 | 4 | 5; text: string }
  | { kind: "discount"; stay: Stay; season: number }

export type ReviewDone = { reviewId: number }
export type DiscountDone = { paid: Usdc; saved: Usdc }

/** Real events the UI animates on. No fake progress. */
export type ProofEvent =
  | { stage: "download"; loaded: number; total: number } // one-time proving files (~4 MB), skipped when cached
  | { stage: "proving" } // snarkjs in the browser, 0.3 to 1.5 s
  | { stage: "verifying" } // transaction submitted, Stellar verifies the Groth16 proof on chain
  | { stage: "done"; result: WriteResult<ReviewDone | DiscountDone> }

export interface Chain {
  /** Views: free, no wallet. */
  listHotels(): Promise<Hotel[]>
  getHotel(id: number): Promise<Hotel>
  getReviews(hotel: number): Promise<Review[]>
  explorerTx(txHash: string): string
  explorerContract(): string

  /** Hotel role (wallet = hotel admin). Returns the new root. */
  checkout(hotel: number, commitment: string): Promise<WriteResult<{ root: string }>>
  /** Guest, full price. */
  book(hotel: number): Promise<WriteResult<{ paid: Usdc }>>
  /** Guest, returning-guest discount. Drains prover.prove({ kind: "discount" }). */
  bookWithDiscount(stay: Stay, season: number): Promise<WriteResult<DiscountDone>>
  /** Guest, anonymous review. Drains prover.prove({ kind: "review" }). */
  postReview(stay: Stay, rating: 1 | 2 | 3 | 4 | 5, text: string): Promise<WriteResult<ReviewDone>>
  /** Arbiter. */
  attest(reviewId: number): Promise<WriteResult>
}

export interface Prover {
  /** Generates the proof in the browser and submits it; yields real stages, ends with "done". */
  prove(req: ProofRequest): AsyncIterable<ProofEvent>
  /** True once the proving files are cached (no download stage next time). */
  ready(): boolean
}

export type WalletKind = "passkey" | "freighter"

export interface Wallet {
  /** null = read-only mode. */
  readonly address: string | null
  readonly kind: WalletKind | null
  connect(kind?: WalletKind): Promise<string>
  disconnect(): void
  onChange(cb: (address: string | null) => void): () => void
}

/** Guest-side local stays (per-stay identities derived from a master secret in this browser). */
export interface Stays {
  list(): Stay[]
  /** New stay identity for a hotel; show its commitment (QR / copy) at the checkout desk. */
  create(hotel: number): Stay
  /** Refresh checkedIn by looking the commitment up on chain. */
  sync(): Promise<Stay[]>
}

/** What the guest privately hands the arbiter in a dispute. */
export interface DisclosurePackage {
  reviewId: number
  hotel: number
  commitment: string
  leafIndex: number
  /** Secret behind disclosure_commit = Poseidon(dk). */
  dk: string
  /** EdDSA-Poseidon signature by the stay identity over reviewId. */
  signature: { r8: [string, string]; s: string }
  publicKey: [string, string]
}

export interface DisclosureCheck {
  commitmentMatches: boolean
  signatureValid: boolean
  leafInTree: boolean
}

export interface Disclosure {
  build(stay: Stay): Promise<DisclosurePackage>
  /** Arbiter: the 3-step check shown before "attest". */
  check(pkg: DisclosurePackage): Promise<DisclosureCheck>
}

export interface Sdk {
  mode: "mock" | "testnet"
  chain: Chain
  prover: Prover
  wallet: Wallet
  stays: Stays
  disclosure: Disclosure
}

/** Human copy for each error, per the design handoff. */
export const errorCopy: Record<ErrorName, string> = {
  HotelNotFound: "this hotel does not exist",
  TreeFull: "this hotel's guest tree is full",
  BadLeaf: "that is not a valid stay code",
  DuplicateLeaf: "this guest is already checked in",
  UnknownRoot: "this proof is for an older state of the hotel, refresh and retry",
  NullifierUsed: "this stay already used it",
  NonCanonical: "the proof did not check out",
  InvalidProof: "the proof did not check out",
  BadRating: "pick 1 to 5 stars",
  ReviewNotFound: "review not found",
  BadParams: "invalid request",
  WalletNotConnected: "connect to continue",
  UserRejected: "signing was cancelled",
  InsufficientFunds: "not enough USDC",
  Network: "Stellar testnet did not respond, retry",
  Unknown: "something went wrong, retry",
}

/** NullifierUsed copy depends on the action. */
export const nullifierCopy = { review: "this stay already reviewed", discount: "discount already used this season" } as const

export const USDC_DECIMALS = 7
export const formatUsdc = (v: Usdc, digits = 2): string => (Number(v) / 10 ** USDC_DECIMALS).toFixed(digits)
export const averageRating = (h: Pick<Hotel, "ratingSum" | "ratingCount">): number | null =>
  h.ratingCount === 0 ? null : h.ratingSum / h.ratingCount
export const shortHex = (dec: string, n = 6): string => {
  const h = BigInt(dec).toString(16).padStart(64, "0")
  return `0x${h.slice(0, n)}…${h.slice(-4)}`
}
