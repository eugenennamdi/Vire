import { randomBytes } from "node:crypto";
import { keccak256, type Account, type Address, type Hex } from "viem";
import type { TakerProof } from "./types.js";

const TAKER_CONTROL_TYPES = {
  TakerControl: [
    { name: "taker", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "issuedAt", type: "uint256" },
  ],
} as const;

interface CachedGrant {
  proof: TakerProof;
  expiresAtMs: number;
}

/**
 * Generates and caches EIP-712 TakerControl proofs for keyless wallet-only Textile FX calls.
 * When a Partner API key is configured, Textile ignores takerProof and this manager is not invoked.
 */
export class TakerProofManager {
  private readonly cache = new Map<string, CachedGrant>();
  // Textile grants last ~12h when paired with nonceSecret; refresh conservatively at 11h.
  private readonly grantTtlMs = 11 * 60 * 60 * 1000;

  async getOrCreateProof(params: {
    account: Account & { signTypedData?: (args: unknown) => Promise<Hex> };
    chainId: number;
    forceFresh?: boolean;
  }): Promise<TakerProof> {
    const taker: Address = params.account.address;
    const key = `${taker.toLowerCase()}:${params.chainId}`;
    const existing = this.cache.get(key);
    if (!params.forceFresh && existing && Date.now() < existing.expiresAtMs) {
      return existing.proof;
    }

    if (!params.account.signTypedData) {
      throw new Error("Taker account does not support signTypedData for keyless TakerControl proof");
    }

    const nonceSecret = `0x${randomBytes(32).toString("hex")}` as Hex;
    const nonce = keccak256(nonceSecret);
    const issuedAt = Math.floor(Date.now() / 1000);

    const signature = await params.account.signTypedData({
      domain: {
        name: "Textile Taker Control",
        version: "1",
        chainId: params.chainId,
      },
      types: TAKER_CONTROL_TYPES,
      primaryType: "TakerControl",
      message: {
        taker,
        chainId: BigInt(params.chainId),
        nonce,
        issuedAt: BigInt(issuedAt),
      },
    });

    const proof: TakerProof = {
      nonce,
      nonceSecret,
      issuedAt,
      signature,
      scheme: "eip712",
    };

    this.cache.set(key, {
      proof,
      expiresAtMs: Date.now() + this.grantTtlMs,
    });
    return proof;
  }

  invalidate(taker: Address, chainId: number): void {
    this.cache.delete(`${taker.toLowerCase()}:${chainId}`);
  }
}
