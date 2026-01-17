
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { bcs } from "@mysten/sui/bcs";
import dotenv from "dotenv";

dotenv.config();

// --- CONSTANTS ---
// Custom FlowX Package
const FLOWX_PACKAGE_ID = "0x9a1d2dec917036db713509c113e04e953bb944902bf2d6874056aea15136b75e";
const FLOWX_POOL_REGISTRY = "0x85b6f75615b8171a90c208d7c3fc8847ffcf591cc44877e91795c8d8ce912bf0";
const FLOWX_POSITION_REGISTRY = "0x638ea4bf1886077ebe16ce656246d01d53d4c6352f0b2389213fde408aad5c3e";
const FLOWX_VERSIONED = "0xb28026a8078ed6b476b10440a411f28c7a070d3377681fb98d2d4b4c12fa74f0";
const CLOCK_ID = "0x6";

// Tokens
const MIGRATION_PACKAGE = "0x7231da1a477e77f22500ac8da82b8b9f0a38002bb9cad61e6b0b57354a07a6c2";
const MOCK_SUI = `${MIGRATION_PACKAGE}::mock_sui::MOCK_SUI`;
const SUI = "0x2::sui::SUI";

const MOCK_SUI_TREASURY = "0xbdb2aca08333abcc6007cae3e2b81dcd02b652016d1908187e85d45caa372c04";

// --- CLIENT SETUP ---
const client = new SuiClient({ url: "https://fullnode.testnet.sui.io:443" });

let keypair: Ed25519Keypair;
if (process.env.PRIVATE_KEY?.startsWith("suiprivkey")) {
    const { secretKey } = decodeSuiPrivateKey(process.env.PRIVATE_KEY);
    keypair = Ed25519Keypair.fromSecretKey(secretKey);
} else {
    // Fallback for base64
    const { fromB64 } = require("@mysten/sui/utils");
    keypair = Ed25519Keypair.fromSecretKey(fromB64(process.env.PRIVATE_KEY!).slice(1));
}

const ADMIN_ADDR = keypair.toSuiAddress();

console.log(`Setting up Old Pool (MOCK_SUI / SUI) as Admin: ${ADMIN_ADDR}`);

function sortCoins(coinA: string, coinB: string) {
    if (coinA < coinB) return [coinA, coinB];
    return [coinB, coinA];
}

async function main() {
    const tx = new Transaction();

    // 1. Sort Coins
    const [coinX, coinY] = sortCoins(MOCK_SUI, SUI);
    console.log(`Sorted: X=${coinX}, Y=${coinY}`);

    const FEE_RATE = 3000; // 0.3%
    // 1:1 Price => sqrt_price = 2^64
    const SQRT_PRICE = "18446744073709551616"; 
    
    // 2. Create & Initialize Pool
    tx.moveCall({
        target: `${FLOWX_PACKAGE_ID}::pool_manager::create_and_initialize_pool`,
        typeArguments: [coinX, coinY],
        arguments: [
            tx.object(FLOWX_POOL_REGISTRY),
            tx.pure.u64(FEE_RATE),
            tx.pure.u128(SQRT_PRICE),
            tx.object(FLOWX_VERSIONED),
            tx.object(CLOCK_ID)
        ]
    });

    // 3. Open Position
    // Construct I32 using Move calls
    const tickLower = tx.moveCall({
        target: `${FLOWX_PACKAGE_ID}::i32::neg_from`,
        arguments: [tx.pure.u32(120)]
    });

    const tickUpper = tx.moveCall({
        target: `${FLOWX_PACKAGE_ID}::i32::from`,
        arguments: [tx.pure.u32(120)]
    });
    
    const pos = tx.moveCall({
        target: `${FLOWX_PACKAGE_ID}::position_manager::open_position`,
        typeArguments: [coinX, coinY],
        arguments: [
            tx.object(FLOWX_POSITION_REGISTRY),
            tx.object(FLOWX_POOL_REGISTRY),
            tx.pure.u64(FEE_RATE),
            tickLower,
            tickUpper,
            tx.object(FLOWX_VERSIONED)
        ]
    });

    // 4. Mint Tokens for Liquidity
    const amtMOCK = 100_000_000n; // 0.1 SUI worth
    const amtSUI = 100_000_000n;
    
    // Mint MOCK_SUI
    const mockCoin = tx.moveCall({
        target: "0x2::coin::mint",
        typeArguments: [MOCK_SUI],
        arguments: [tx.object(MOCK_SUI_TREASURY), tx.pure.u64(amtMOCK)]
    });

    // Split SUI
    const suiCoin = tx.splitCoins(tx.gas, [tx.pure.u64(amtSUI)]);

    let coinXObj, coinYObj;
    if (coinX === MOCK_SUI) {
        coinXObj = mockCoin;
        coinYObj = suiCoin;
    } else {
        coinXObj = suiCoin;
        coinYObj = mockCoin;
    }

    // 5. Increase Liquidity
    tx.moveCall({
        target: `${FLOWX_PACKAGE_ID}::position_manager::increase_liquidity`,
        typeArguments: [coinX, coinY],
        arguments: [
            tx.object(FLOWX_POOL_REGISTRY),
            pos,
            coinXObj,
            coinYObj,
            tx.pure.u64(0), // Min X
            tx.pure.u64(0), // Min Y
            tx.pure.u64("18446744073709551615"), // Max U64 Deadline
            tx.object(FLOWX_VERSIONED),
            tx.object(CLOCK_ID)
        ]
    });

    // 6. Transfer Position to Admin
    tx.transferObjects([pos], tx.pure.address(ADMIN_ADDR));

    tx.setGasBudget(100_000_000);

    // Execute
    const res = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
            showEffects: true,
            showObjectChanges: true,
        },
    });

    console.log("Pool Created & Liquidity Added!");
    console.log("Digest:", res.digest);
    if (res.effects?.status.status !== "success") {
        console.error("FAILED:", res.effects?.status.error);
    }
}

main().catch(console.error);
