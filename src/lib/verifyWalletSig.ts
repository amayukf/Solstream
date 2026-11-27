import crypto from "crypto";
import { PublicKey } from "@solana/web3.js";

// ASN.1 DER SubjectPublicKeyInfo prefix for raw 32-byte Ed25519 public keys
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Verifies a detached Ed25519 signature produced by a Solana wallet (`signMessage`).
 */
export function verifySolanaWalletSignature(
  walletAddress: string,
  message: string,
  signatureBase64: string
): boolean {
  try {
    const pubkey = new PublicKey(walletAddress);
    const sigBytes = Buffer.from(signatureBase64, "base64");
    if (sigBytes.length !== 64) return false;

    const spkiDer = Buffer.concat([
      ED25519_SPKI_PREFIX,
      Buffer.from(pubkey.toBytes()),
    ]);
    const keyObj = crypto.createPublicKey({
      key: spkiDer,
      format: "der",
      type: "spki",
    });

    return crypto.verify(null, Buffer.from(message, "utf8"), keyObj, sigBytes);
  } catch {
    return false;
  }
}
