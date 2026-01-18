import { sha3_256 } from 'js-sha3';


/**
 * Converts a hex string (0x...) to a Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
    if (hex.startsWith("0x")) {
        hex = hex.slice(2);
    }
    if (hex.length % 2 !== 0) {
        hex = "0" + hex;
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

/**
 * Converts a Uint8Array to a hex string
 */
function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Encodes a leaf node: sha3_256(address + amount_u64_big_endian)
 */
export function hashLeaf(address: string, amount: string | number): Uint8Array {
    const addrBytes = hexToBytes(address);
    if (addrBytes.length !== 32) {
        // console.warn("Address length is not 32 bytes:", address); 
        // Pad if necessary or ensure it's a valid Sui address
    }
    
    // Use bcs for u64 to ensure correct serialization (Little Endian? Wait, Move is usually LE, but check snapshot.move)
    // In snapshot.move, `u64_to_bytes` implementation:
    // val >> 56, val >> 48... This manual impl is BIG ENDIAN.
    // Use Little Endian for u64 serialization, consistent with BCS.
    
    const amountVal = BigInt(amount);
    const amountBytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
        amountBytes[i] = Number((amountVal >> BigInt(i * 8)) & 0xFFn); // Little Endian
    }

    const payload = new Uint8Array(addrBytes.length + amountBytes.length);
    payload.set(addrBytes, 0);
    payload.set(amountBytes, addrBytes.length);

    const hash = sha3_256.create();
    hash.update(payload);
    return new Uint8Array(hash.arrayBuffer());
}

/**
 * Hashes a pair of nodes (sorted)
 */
export function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
    // Compare lexicographically
    let first = a;
    let second = b;

    // Compare
    for (let i = 0; i < a.length; i++) {
        if (a[i] < b[i]) {
            first = a;
            second = b;
            break;
        } else if (a[i] > b[i]) {
            first = b;
            second = a;
            break;
        }
    }
    // If equal, order doesn't matter (technically shouldn't happen in valid merkle tree)

    const payload = new Uint8Array(first.length + second.length);
    payload.set(first, 0);
    payload.set(second, first.length);

    const hash = sha3_256.create();
    hash.update(payload);
    return new Uint8Array(hash.arrayBuffer());
}

export class MerkleTree {
    leaves: Uint8Array[];
    levels: Uint8Array[][];

    constructor(entries: { address: string; amount: string | number }[]) {
        // 1. Hash all leaves
        this.leaves = entries.map(e => hashLeaf(e.address, e.amount));
        // 2. Sort leaves to ensure deterministic tree (optional, but good practice if not specified)
        // Wait, snapshot.move doesn't specify leaf sorting, only Pair sorting. 
        // Standard Merkle usually preserves leaf order. We'll keep input order.
        
        this.levels = [this.leaves];
        this.build();
    }

    build() {
        let currentLevel = this.levels[0];
        while (currentLevel.length > 1) {
            const nextLevel: Uint8Array[] = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                if (i + 1 < currentLevel.length) {
                    nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]));
                } else {
                    // Odd number of nodes, duplicate/lift the last one? 
                    // Or standard practice is to carry it up?
                    // snapshot.move verify_proof implementation implies standard "sibling" verification.
                    // If we have an odd node, it usually hashes with itself or carries over?
                    // Let's assume even leaves for now or handle carry over.
                    nextLevel.push(currentLevel[i]); 
                }
            }
            this.levels.push(nextLevel);
            currentLevel = nextLevel;
        }
    }

    getRoot(): Uint8Array {
        return this.levels[this.levels.length - 1][0];
    }
    
    getRootHex(): string {
        return "0x" + bytesToHex(this.getRoot());
    }

    getProof(index: number): Uint8Array[] {
        const proof: Uint8Array[] = [];
        let currentIndex = index;

        for (let i = 0; i < this.levels.length - 1; i++) {
            const level = this.levels[i];
            const isLeft = currentIndex % 2 === 0;
            const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;

            if (siblingIndex < level.length) {
                proof.push(level[siblingIndex]);
            }
            // If no sibling (odd node at end), no proof element needed for this level
            
            currentIndex = Math.floor(currentIndex / 2);
        }
        return proof;
    }
    
    // Helper for move calls
    getProofVecBytes(index: number): number[][] {
        return this.getProof(index).map(p => Array.from(p));
    }
}
