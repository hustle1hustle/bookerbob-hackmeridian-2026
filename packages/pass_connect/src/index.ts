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
  /** Sign-in found no passkey for this site on this device (or the prompt was closed). Never falls back to create. */
  | "NoPasskey"

export class PassConnectException extends Error {
  // Explicit field instead of a parameter property: Node's type stripping (scripts, tests) rejects those.
  readonly code: PassConnectError
  constructor(code: PassConnectError, message: string) {
    super(message)
    this.code = code
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
  /** Name shown in the OS passkey list for a NEW credential, e.g. "BookerBob demo 16:40". */
  displayName?: string
  /** true = register a NEW passkey. Default (sign in) only ever calls navigator.credentials.get(). */
  create?: boolean
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
  /** The passkey's name, from its user handle ("bb1:<name>") or the name it was created with. */
  name?: string
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

// The user handle carries the passkey's name, so a discoverable sign-in on any device can show which passkey it is.
const HANDLE = "bb1:"
const handleFor = (name: string) => new TextEncoder().encode((HANDLE + name).slice(0, 64))
const nameFromHandle = (h: ArrayBuffer | null | undefined) => {
  if (!h) return undefined
  const t = new TextDecoder().decode(new Uint8Array(h))
  return t.startsWith(HANDLE) ? t.slice(HANDLE.length) : undefined
}
const PRF_SALT = new TextEncoder().encode("bookerbob/pass_connect/v1")

/** Discoverable sign-in: navigator.credentials.get() with no allowCredentials, PRF in the same prompt. Never creates. */
async function signIn(opts: PassConnectOptions, rpId: string): Promise<{ stored: Stored; seed: Uint8Array }> {
  let a: PublicKeyCredential | null
  try {
    a = (await navigator.credentials.get({
      publicKey: { challenge: challenge(), rpId, userVerification: "required", extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs },
    })) as PublicKeyCredential | null
  } catch (e) {
    const name = e && typeof e === "object" && "name" in e ? String((e as { name: string }).name) : ""
    if (name === "NotAllowedError" || name === "AbortError") throw new PassConnectException("NoPasskey", "no passkey for this site on this device")
    throw mapWebAuthnError(e)
  }
  if (!a) throw new PassConnectException("NoPasskey", "no passkey for this site on this device")
  const credentialId = b64url.enc(new Uint8Array(a.rawId))
  const first = (a.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first
  const prev = loadStored(opts)
  let seed: Uint8Array
  let binding: Stored["binding"] = "prf"
  if (first) seed = await sha256(new Uint8Array(first))
  else if (prev?.credentialId === credentialId && prev.seedHex) {
    seed = fromHex(prev.seedHex)
    binding = "credential-bound"
  } else throw new PassConnectException("PasskeyFailed", "this passkey cannot sign in on this browser (no PRF)")
  const { kp } = signerFromSeed(seed)
  const name = nameFromHandle((a.response as AuthenticatorAssertionResponse).userHandle) ?? (prev?.credentialId === credentialId ? prev.name : undefined)
  const stored: Stored = { credentialId, address: kp.publicKey(), binding, createdAt: prev?.credentialId === credentialId ? prev.createdAt : Date.now(), ...(binding === "credential-bound" ? { seedHex: prev!.seedHex } : {}), ...(name ? { name } : {}) }
  saveStored(opts, stored)
  return { stored, seed }
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
          // the remembered credential gave no seed: sign in again (pick a passkey), never create one
          clearStored(opts)
          return connectPasskey({ ...opts, create: false })
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
        // seed drift: sign in again (pick a passkey), never create one
        clearStored(opts)
        return connectPasskey({ ...opts, create: false })
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

    if (!opts.create) {
      const { stored, seed } = await signIn(opts, rpId)
      const session: PassSession = { module: MODULE, kind: "passkey", address: stored.address, credentialId: stored.credentialId, binding: stored.binding, createdAt: stored.createdAt, signer: { publicKey: stored.address, signTransaction: async () => ({ signedTxXdr: "" }) } }
      return { session, seed }
    }

    // Registration (explicit create only)
    const name = opts.displayName ?? "BookerBob guest"
    const userId = handleFor(name)
    const cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: rpName, id: rpId },
        user: { id: userId, name: opts.displayName ?? "bookerbob-guest", displayName: opts.displayName ?? "BookerBob guest" },
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
    saveStored(opts, { credentialId, seedHex, address: kp.publicKey(), binding, createdAt, name })
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

export function restorePasskey(opts: PassConnectOptions = {}): { address: string; credentialId: string; binding: Stored["binding"]; name?: string } | null {
  const st = loadStored(opts)
  if (!st) return null
  if (!StrKey.isValidEd25519PublicKey(st.address)) return null
  return { address: st.address, credentialId: st.credentialId, binding: st.binding, name: st.name }
}

export function disconnectPasskey(opts: PassConnectOptions = {}) {
  // Keep credential for next login; only clear active SDK wallet elsewhere.
  // Call clearStored(opts) to fully forget.
  void opts
}
