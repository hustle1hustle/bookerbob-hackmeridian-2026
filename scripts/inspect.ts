import { rpc, xdr, scValToNative, Address } from "@stellar/stellar-sdk"
const r: any = await new rpc.Server("https://soroban-testnet.stellar.org").getTransaction(process.argv[2])
const e: any = xdr.TransactionEnvelope.fromXDR(r.envelopeXdr.toXDR("base64"), "base64")
const hf = e.v1.tx.operations[0].body.invokeHostFunctionOp.hostFunction
console.log(hf.type, Object.keys(hf))
const ic = hf.invokeContract
console.log(Object.keys(ic), String(ic.functionName))
for (const a of ic.args) { try { console.log(a.type, scValToNative(a)) } catch (err) { console.log(a.type, "ERR", (err as Error).message) } }
try { console.log(Address.fromScAddress(ic.contractAddress).toString()) } catch (err) { console.log("addr ERR", (err as Error).message, JSON.stringify(ic.contractAddress, (_, v) => v instanceof Uint8Array ? `b${v.length}` : v)) }
try { console.log("ret", scValToNative(r.returnValue)) } catch (err) { console.log("ret ERR", (err as Error).message) }
