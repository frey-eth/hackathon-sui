
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromB64, toB64 } from "@mysten/sui/utils";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import dotenv from "dotenv";
import { PACKAGE_ID, DEMO_OLD_COIN_TYPE, DEMO_NEW_COIN_TYPE, MOCK_NEW_TREASURY_ID } from "./src/constants";

dotenv.config();

const client = new SuiClient({ url: "https://fullnode.testnet.sui.io:443" });

// Load Admin (Backend) Key
// In a real app, this key stays on the server.
let adminKeypair: Ed25519Keypair;
if (process.env.PRIVATE_KEY?.startsWith("suiprivkey")) {
    const { secretKey } = decodeSuiPrivateKey(process.env.PRIVATE_KEY);
    adminKeypair = Ed25519Keypair.fromSecretKey(secretKey);
} else {
    adminKeypair = Ed25519Keypair.fromSecretKey(fromB64(process.env.PRIVATE_KEY!).slice(1));
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    console.log("=== TEST SIGNATURE CLAIM logic ===");
    console.log("Admin / Backend signer:", adminKeypair.toSuiAddress());

    // 1. Create a Fresh User
    const userKeypair = new Ed25519Keypair();
    const userAddr = userKeypair.toSuiAddress();
    console.log("User:", userAddr);

    // Fund User with Gas
    await fundUserGas(userAddr);
    await sleep(5000); // Wait for Gas Object update

    // 2. Setup Vault (if needed) & Enable Claims
    // We create a fresh vault for this test to avoid state pollution
    console.log("\n--- Creating Vault ---");
    const vaultId = await createVault();
    console.log("Vault Created:", vaultId);
    await sleep(5000); // Wait for Vault indexing
    
    // Fund Vault
    await fundVault(vaultId);
    console.log("Vault Funded.");
    await sleep(5000);

    // 3. Enable Claims (Set Pubkey)
    console.log("\n--- Enabling Claims ---");
    // Get Admin Pubkey bytes
    const pubkey = adminKeypair.getPublicKey().toSuiBytes(); 
    // Note: JS SDK might give 32 bytes directly.
    
    const txEnable = new Transaction();
    txEnable.moveCall({
        target: `${PACKAGE_ID}::user_migration::enable_claims`,
        typeArguments: [DEMO_OLD_COIN_TYPE, DEMO_NEW_COIN_TYPE],
        arguments: [
            txEnable.object(vaultId),
            txEnable.pure.vector("u8", Array.from(pubkey.slice(1)))
        ]
    });
    await client.signAndExecuteTransaction({ signer: adminKeypair, transaction: txEnable });
    console.log("Claims Enabled (Pubkey set).");
    await sleep(2000);

    // 4. GENERATE SIGNATURE (Backend Logic)
    console.log("\n--- Generating Signature (Backend) ---");
    const amount = 500; // 500 Tokens
    
    // Construct Message: Address (32 bytes) + Amount (8 bytes LE)
    const addrBytes = new Uint8Array(fromB64(toB64(userKeypair.getPublicKey().toSuiBytes())).slice(1)); 
    // Wait, toSuiBytes returns 33 bytes (flag + 32). Move `address::to_bytes` returns 32 bytes.
    // Sui Address is verified hash.
    // Actually, sender address in Move is 32 bytes.
    // We need to convert hex string specificially to 32 bytes.
    const userAddrBytes = fromHexString(userAddr);
    
    const amountBytes = toLittleEndian(amount);
    
    const message = new Uint8Array(userAddrBytes.length + amountBytes.length);
    message.set(userAddrBytes);
    message.set(amountBytes, userAddrBytes.length);

    console.log("Message (Hex):", toHexString(message));
    
    const signature = await adminKeypair.sign(message);
    // SDK returns pure signature (64 bytes) for Ed25519 usually.

    // 5. USER CLAIMS
    console.log("\n--- User Claiming ---");
    const txClaim = new Transaction();
    txClaim.moveCall({
        target: `${PACKAGE_ID}::user_migration::claim_with_signature`,
        typeArguments: [DEMO_OLD_COIN_TYPE, DEMO_NEW_COIN_TYPE],
        arguments: [
            txClaim.object(vaultId),
            txClaim.pure.vector("u8", Array.from(signature)),
            txClaim.pure.u64(amount)
        ]
    });
    txClaim.setGasBudget(10_000_000);

    const res = await client.signAndExecuteTransaction({
        signer: userKeypair,
        transaction: txClaim,
        options: { showEffects: true, showBalanceChanges: true }
    });

    if (res.effects?.status.status === "success") {
        console.log(`SUCCESS! Claim Digest: ${res.digest}`);
        console.log(`Verified Balance Change:`, res.balanceChanges);
    } else {
        console.error("CLAIM FAILED:", res.effects?.status.error);
        process.exit(1);
    }

    console.log("Test Passed.");
}

// --- Utils ---

async function createVault(): Promise<string> {
    const tx = new Transaction();
    const coins = await client.getCoins({ owner: adminKeypair.toSuiAddress(), coinType: "0x2::sui::SUI" });
    // Use generic gas logic (assume sufficient)
    const initialFund = tx.moveCall({
        target: `${PACKAGE_ID}::mock_new_token::mint`,
        arguments: [tx.object(MOCK_NEW_TREASURY_ID), tx.pure.u64(100)],
    });
    tx.moveCall({
        target: `${PACKAGE_ID}::user_migration::create_vault`,
        typeArguments: [DEMO_OLD_COIN_TYPE, DEMO_NEW_COIN_TYPE],
        arguments: [initialFund],
    });
    const res = await client.signAndExecuteTransaction({
        signer: adminKeypair, transaction: tx,
        options: { showObjectChanges: true, showEffects: true }
    });
    const created = res.objectChanges?.find(c => 
        c.type === "created" && c.objectType.includes("user_migration::MigrationVault")
    );
    if (!created || !("objectId" in created)) throw new Error("Vault object not found");
    return created.objectId;
}

async function fundVault(vaultId: string) {
    const tx = new Transaction();
    const fund = tx.moveCall({
        target: `${PACKAGE_ID}::mock_new_token::mint`,
        arguments: [tx.object(MOCK_NEW_TREASURY_ID), tx.pure.u64(10000)],
    });
    tx.moveCall({
        target: `${PACKAGE_ID}::user_migration::deposit`,
        typeArguments: [DEMO_OLD_COIN_TYPE, DEMO_NEW_COIN_TYPE],
        arguments: [tx.object(vaultId), fund],
    });
    await client.signAndExecuteTransaction({ signer: adminKeypair, transaction: tx });
}

async function fundUserGas(addr: string) {
    const tx = new Transaction();
    const [gas] = tx.splitCoins(tx.gas, [tx.pure.u64(50_000_000)]);
    tx.transferObjects([gas], tx.pure.address(addr));
    await client.signAndExecuteTransaction({ signer: adminKeypair, transaction: tx });
}
// Fix helper call in main script text logic above... actually let's implement the helper correctly below.

function toLittleEndian(val: number): Uint8Array {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setBigUint64(0, BigInt(val), true); // true for little-endian
    return new Uint8Array(buffer);
}

function fromHexString(hexString: string): Uint8Array {
    if (hexString.startsWith("0x")) hexString = hexString.slice(2);
    const match = hexString.match(/.{1,2}/g);
    if (!match) return new Uint8Array();
    return new Uint8Array(match.map(byte => parseInt(byte, 16)));
}

function toHexString(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

main().catch(console.error);

// Note: Re-implementing fundUserGas properly in the replacing block.
async function fundUserGasReal(addr: string) { // Renamed for clarity in this thought block, will be fundUserGas in file
    const tx = new Transaction();
    const [gas] = tx.splitCoins(tx.gas, [tx.pure.u64(50_000_000)]);
    tx.transferObjects([gas], tx.pure.address(addr));
    await client.signAndExecuteTransaction({ signer: adminKeypair, transaction: tx });
}
