/**
 * pass_connect — connect with passkey (WebAuthn) → Stellar-capable session.
 *
 * Phase 1 (hackathon): platform passkey binds an Ed25519 signer derived via
 * WebAuthn PRF when available, else a credential-bound local seed. The
 * address is a classic G… key funded on testnet via Friendbot.
 *
 * Phase 2 (hook): swap `createSession` for Smart Account Kit C… wallets +
 * OpenZeppelin Channels relayer (see docs/modules/pass_connect.md).
 *
 * Other modules (verify_onchain_zk, discount) take `PassSession` and never
 * talk to WebAuthn themselves.
 */
import { Keypair, StrKey } from "@stellar/stellar-sdk"

export const MODULE = "pass_connect" as const

export type PassConnectError =
  | "PasskeyUnsupported"
  | "UserCancelled"
  | "PasskeyFailed"
  | "Network"

export class PassConnectException extends Error {
  constructor(
    readonly code: PassConnectError,
    message: string,
  ) {
    super(message)
    this.name = "PassConnectException"
  }
}

export interface PassConnectOptions {
  /** Relying party name shown in the OS prompt. */
  rpName?: string
  /** Host / RP id. Default: location.hostname in browser. */
  rpId?: string
  /** localStorage key prefix. */
  storageKey?: string
  /** Friendbot URL for first-time funding (testnet). Empty = skip. */
  friendbotUrl?: string
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">
}

export interface PassSigner {
  publicKey: string
  signTransaction: (xdr: string, opts?: { networkPassphrase?: string; address?: string }) => Promise<{ signedTxXdr: string; signerAddress?: string }>
  signAuthEntry?: (entryXdr: string, opts?: { networkPassphrase?: string; address?: string }) => Promise<{ signedAuthEntry: string; signerAddress?: string }>
}

export interface PassSession {
  module: typeof MODULE
  kind: "passkey"
  /** Stellar address (G… in phase 1). */
  address: string
  /** Base64url credential id. */
  credentialId: string
  /** How the seed was obtained. */
  binding: "prf" | "credential-bound"
  createdAt: number
  signer: PassSigner
}

type Stored = {
  credentialId: string
  /** Hex 32-byte seed when PRF was unavailable (credential-bound). Never when PRF. */
  seedHex?: string
  address: string
  binding: "prf" | "credential-bound"
  createdAt: number
}

const b64url = {
  enc: (buf: ArrayBuffer | Uint8Array) => {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    let s = ""
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!)
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  },
  dec: (s: string) => {
    const pad = "=".repeat((4 - (s.length % 4)) % 4)
    const b = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"))
    const u = new Uint8Array(b.length)
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i)
    return u
  },
}

const toHex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, "0")).join("")
const fromHex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map((x) => parseInt(x, 16)))

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", data.slice())
  return new Uint8Array(digest)
}

function challenge(n = 32): Uint8Array {
  const u = new Uint8Array(n)
  crypto.getRandomValues(u)
  return u
}

function mapWebAuthnError(e: unknown): PassConnectException {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: string }).name) : ""
  if (name === "NotAllowedError" || name === "AbortError") return new PassConnectException("UserCancelled", "passkey prompt dismissed")
  if (name === "NotSupportedError") return new PassConnectException("PasskeyUnsupported", "WebAuthn not supported in this browser")
  return new PassConnectException("PasskeyFailed", e instanceof Error ? e.message : "passkey failed")
}

export function isPasskeyAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined" && typeof navigator.credentials?.create === "function"
}

function storeOf(opts: PassConnectOptions) {
  return opts.storage ?? (typeof localStorage !== "undefined" ? localStorage : null)
}

function keyName(opts: PassConnectOptions) {
  return opts.storageKey ?? "bookerbob.pass_connect.v1"
}

function signerFromSeed(seed: Uint8Array, networkPassphraseDefault?: string): { kp: Keypair; signer: PassSigner } {
  if (seed.length !== 32) throw new PassConnectException("PasskeyFailed", "seed must be 32 bytes")
  const kp = Keypair.fromRawEd25519Seed(seed as unknown as Buffer)
  const signer: PassSigner = {
    publicKey: kp.publicKey(),
    async signTransaction(xdr, o) {
      void xdr
      void o
      void networkPassphraseDefault
      throw new PassConnectException("PasskeyFailed", "use sessionToKeypair + contract.basicNodeSigner in the host SDK")
    },
  }
  return { kp, signer }
}

/** Recover Keypair for the host SDK (testnet.ts wires basicNodeSigner). */
export function sessionToKeypair(session: PassSession, seed: Uint8Array): Keypair {
  void session
  return Keypair.fromRawEd25519Seed(seed as unknown as Buffer)
}

async function deriveSeedPrf(credentialId: Uint8Array, rpId: string): Promise<Uint8Array | null> {
  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: challenge(),
        rpId,
        allowCredentials: [{ type: "public-key", id: credentialId }],
        userVerification: "required",
        extensions: { prf: { eval: { first: new TextEncoder().encode("bookerbob/pass_connect/v1") } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null
    if (!assertion) return null
    const ext = assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }
    const first = ext.prf?.results?.first
    if (!first) return null
    return sha256(new Uint8Array(first))
  } catch {
    return null
  }
}

async function deriveSeedBound(credentialId: Uint8Array, localSalt: Uint8Array): Promise<Uint8Array> {
  const cat = new Uint8Array(credentialId.length + localSalt.length + 16)
  cat.set(credentialId, 0)
  cat.set(localSalt, credentialId.length)
  cat.set(new TextEncoder().encode("pass_connect/v1"), credentialId.length + localSalt.length)
  return sha256(cat)
}

function loadStored(opts: PassConnectOptions): Stored | null {
  const s = storeOf(opts)
  if (!s) return null
  try {
    const raw = s.getItem(keyName(opts))
    return raw ? (JSON.parse(raw) as Stored) : null
  } catch {
    return null
  }
}

function saveStored(opts: PassConnectOptions, st: Stored) {
  storeOf(opts)?.setItem(keyName(opts), JSON.stringify(st))
}

export function clearStored(opts: PassConnectOptions = {}) {
  storeOf(opts)?.removeItem(keyName(opts))
}

/**
 * Create or restore a passkey session.
 * Returns session + raw seed (host must keep seed only in memory / wire signer; seedHex may be in storage for credential-bound).
 */
export async function connectPasskey(opts: PassConnectOptions = {}): Promise<{ session: PassSession; seed: Uint8Array }> {
  if (!isPasskeyAvailable()) throw new PassConnectException("PasskeyUnsupported", "this browser has no WebAuthn")

  const rpName = opts.rpName ?? "BookerBob"
  const rpId = opts.rpId ?? (typeof location !== "undefined" ? location.hostname : "localhost")
  const existing = loadStored(opts)

  try {
    if (existing) {
      const credId = b64url.dec(existing.credentialId)
      let seed: Uint8Array
      let binding = existing.binding
      if (existing.binding === "prf" || !existing.seedHex) {
        const prf = await deriveSeedPrf(credId, rpId)
        if (prf) {
          seed = prf
          binding = "prf"
        } else if (existing.seedHex) {
          seed = fromHex(existing.seedHex)
          binding = "credential-bound"
        } else {
          // re-prompt create path by falling through — treat as missing
          clearStored(opts)
          return connectPasskey(opts)
        }
      } else {
        // Touch the authenticator so the user confirms login
        await navigator.credentials.get({
          publicKey: {
            challenge: challenge(),
            rpId,
            allowCredentials: [{ type: "public-key", id: credId }],
            userVerification: "required",
          },
        })
        seed = fromHex(existing.seedHex)
      }
      const { kp } = signerFromSeed(seed)
      if (kp.publicKey() !== existing.address) {
        // seed drift — rebind
        clearStored(opts)
        return connectPasskey(opts)
      }
      const session: PassSession = {
        module: MODULE,
        kind: "passkey",
        address: kp.publicKey(),
        credentialId: existing.credentialId,
        binding,
        createdAt: existing.createdAt,
        signer: { publicKey: kp.publicKey(), signTransaction: async () => ({ signedTxXdr: "" }) },
      }
      return { session, seed }
    }

    // Registration
    const userId = challenge(16)
    const cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: rpName, id: rpId },
        user: { id: userId, name: "bookerbob-guest", displayName: "BookerBob guest" },
        challenge: challenge(),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        timeout: 90_000,
        attestation: "none",
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null
    if (!cred) throw new PassConnectException("UserCancelled", "no credential created")

    const credId = new Uint8Array(cred.rawId)
    const credentialId = b64url.enc(credId)
    let seed = await deriveSeedPrf(credId, rpId)
    let binding: Stored["binding"] = "prf"
    let seedHex: string | undefined
    if (!seed) {
      const salt = challenge(32)
      seed = await deriveSeedBound(credId, salt)
      binding = "credential-bound"
      seedHex = toHex(seed)
    }
    const { kp } = signerFromSeed(seed)
    const friendbot = opts.friendbotUrl ?? "https://friendbot.stellar.org"
    if (friendbot) {
      await fetch(`${friendbot}/?addr=${encodeURIComponent(kp.publicKey())}`).catch(() => null)
    }
    const createdAt = Date.now()
    saveStored(opts, { credentialId, seedHex, address: kp.publicKey(), binding, createdAt })
    const session: PassSession = {
      module: MODULE,
      kind: "passkey",
      address: kp.publicKey(),
      credentialId,
      binding,
      createdAt,
      signer: { publicKey: kp.publicKey(), signTransaction: async () => ({ signedTxXdr: "" }) },
    }
    return { session, seed }
  } catch (e) {
    if (e instanceof PassConnectException) throw e
    throw mapWebAuthnError(e)
  }
}

export function restorePasskey(opts: PassConnectOptions = {}): { address: string; credentialId: string; binding: Stored["binding"] } | null {
  const st = loadStored(opts)
  if (!st) return null
  if (!StrKey.isValidEd25519PublicKey(st.address)) return null
  return { address: st.address, credentialId: st.credentialId, binding: st.binding }
}

export function disconnectPasskey(opts: PassConnectOptions = {}) {
  // Keep credential for next login; only clear active SDK wallet elsewhere.
  // Call clearStored(opts) to fully forget.
  void opts
}
