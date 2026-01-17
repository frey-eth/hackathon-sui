
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromB64 } from "@mysten/sui/utils";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import dotenv from "dotenv";

dotenv.config();

// --- CONFIGURATION ---
const PACKAGE_ID = "0xcddc051667cb9708e2e24b53881a02503e1f22696b3be49e02d87ebd62ab2263"; // NEW Migration Package
const ADMIN_CAP_ID = "0x677fa43221e135151e8cbf002a30bdd127e53efae15e54fe133784d7c0e2123b";

// External FlowX Dependencies
const FLOWX_POOL_REGISTRY = "0x85b6f75615b8171a90c208d7c3fc8847ffcf591cc44877e91795c8d8ce912bf0";
const FLOWX_VERSIONED = "0xb28026a8078ed6b476b10440a411f28c7a070d3377681fb98d2d4b4c12fa74f0";

// Coin Types
// OLD COIN: From the PREVIOUS package (which has the Pool)
const OLD_COIN_TYPE = "0x7231da1a477e77f22500ac8da82b8b9f0a38002bb9cad61e6b0b57354a07a6c2::mock_sui::MOCK_SUI";
// NEW COIN: From the NEW package
const NEW_COIN_TYPE = `${PACKAGE_ID}::mock_new_token::MOCK_NEW_TOKEN`;

// Treasuries
const OLD_TREASURY_ID = "0xbdb2aca08333abcc6007cae3e2b81dcd02b652016d1908187e85d45caa372c04"; // From Old Package
const NEW_TREASURY_ID = "0x8eaa678f890f225711a351abc5983454848d62cf430e48e3a1a5ba5d184ebdca"; // From New Package

// Config
const OLD_FEE_RATE = 3000; // 3000 = Real Mode (Read from FlowX Pool)
const NEW_TOKEN_SUPPLY = 1_000_000_000_000; // 1T
const OLD_TOKEN_SUPPLY = 1_000_000_000_000; // 1T

// --- CLIENT SETUP ---
const client = new SuiClient({ url: "https://fullnode.testnet.sui.io:443" });

let keypair: Ed25519Keypair;
if (process.env.PRIVATE_KEY?.startsWith("suiprivkey")) {
    const { secretKey } = decodeSuiPrivateKey(process.env.PRIVATE_KEY);
    keypair = Ed25519Keypair.fromSecretKey(secretKey);
} else {
    keypair = Ed25519Keypair.fromSecretKey(fromB64(process.env.PRIVATE_KEY!).slice(1));
}

async function main() {
    console.log("Using Admin:", keypair.toSuiAddress());
    console.log("Package:", PACKAGE_ID);
    console.log("Old Coin:", OLD_COIN_TYPE);

    const tx = new Transaction();

    tx.moveCall({
        target: `${PACKAGE_ID}::migration::migrate_with_flowx`,
        typeArguments: [OLD_COIN_TYPE, NEW_COIN_TYPE],
        arguments: [
            tx.object(ADMIN_CAP_ID),
            tx.object(FLOWX_POOL_REGISTRY),
            tx.object(FLOWX_VERSIONED),
            tx.pure.u64(OLD_FEE_RATE),
            tx.pure.u128(OLD_TOKEN_SUPPLY),
            tx.object(NEW_TREASURY_ID),
            tx.pure.u64(NEW_TOKEN_SUPPLY),
            tx.object("0x6") // Clock
        ]
    });

    tx.setGasBudget(100_000_000);

    const res = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
            showEffects: true,
            showObjectChanges: true,
            showEvents: true,
        },
    });

    console.log("Transaction Digest:", res.digest);
    if (res.effects?.status.status === "success") {
        console.log("SUCCESS! Migration executed.");
    } else {
        console.error("FAILED:", res.effects?.status.error);
        process.exit(1);
    }
}

main().catch(console.error);
