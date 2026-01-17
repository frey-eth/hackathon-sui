
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromB64 } from "@mysten/sui/utils";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import dotenv from "dotenv";
import { 
    PACKAGE_ID, 
    MOCK_NEW_TREASURY_ID, 
    DEMO_NEW_COIN_TYPE,
    FLOWX_POOL_REGISTRY,
    FLOWX_VERSIONED,
    CLOCK_ID
} from "./src/constants";

dotenv.config();

// --- CONFIG ---
const client = new SuiClient({ url: "https://fullnode.testnet.sui.io:443" });
const SUI_COIN_TYPE = "0x2::sui::SUI";

// FlowX Package ID (from create_old_pool.ts)
const FLOWX_PACKAGE_ID = "0x9a1d2dec917036db713509c113e04e953bb944902bf2d6874056aea15136b75e"; 

// --- HARDCODED OLD TOKEN ---
const OLD_PKG_ID = "0x7231da1a477e77f22500ac8da82b8b9f0a38002bb9cad61e6b0b57354a07a6c2";
const DEMO_OLD_COIN_TYPE_FIXED = `${OLD_PKG_ID}::mock_sui::MOCK_SUI`;
const MOCK_OLD_TREASURY_ID_FIXED = "0xbdb2aca08333abcc6007cae3e2b81dcd02b652016d1908187e85d45caa372c04";

// --- ADMIN KEY ---
let adminKeypair: Ed25519Keypair;
if (process.env.PRIVATE_KEY?.startsWith("suiprivkey")) {
    const { secretKey } = decodeSuiPrivateKey(process.env.PRIVATE_KEY);
    adminKeypair = Ed25519Keypair.fromSecretKey(secretKey);
} else {
    adminKeypair = Ed25519Keypair.fromSecretKey(fromB64(process.env.PRIVATE_KEY!).slice(1));
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getLargestGasCoin(owner: string) {
    const coins = await client.getCoins({ owner, coinType: SUI_COIN_TYPE });
    if (coins.data.length === 0) throw new Error(`No SUI found for ${owner}`);
    const largest = coins.data.sort((a, b) => Number(b.balance) - Number(a.balance))[0];
    return largest;
}

// Find AdminCap dynamically
async function findAdminCap(owner: string) {
    let cursor = null;
    let hasNext = true;
    while (hasNext) {
        const res: any = await client.getOwnedObjects({
            owner,
            options: { showType: true },
            cursor
        });
        const found = res.data.find((o: any) => o.data?.type?.includes(`${PACKAGE_ID}::migration::AdminCap`));
        if (found) return found.data.objectId;
        hasNext = res.hasNextPage;
        cursor = res.nextCursor;
    }
    throw new Error("AdminCap not found for " + owner);
}

// --- MAIN FLOW ---
async function main() {
    console.log("=== GRAND UNIFIED SIMULATION: Existed Pool -> New Pool ===");
    console.log(`Admin: ${adminKeypair.toSuiAddress()}`);
    console.log(`Old Coin (Fixed): ${DEMO_OLD_COIN_TYPE_FIXED}`);
    console.log("Using Hardcoded Old Treasury...");

    // --- STEP 1: CREATE OLD POOL ---
    console.log("\n--- STEP 1: Setting up OLD POOL (FlowX) ---");
    await mintOldTokensToAdmin(MOCK_OLD_TREASURY_ID_FIXED, 100_000_000_000); 
    await createOldPool(MOCK_OLD_TREASURY_ID_FIXED, 100_000_000, 100_000_000); 
    console.log(`Old Pool Created/Liquidity Added`);
    await sleep(5000);

    // --- STEP 2: USER SIMULATION ---
    console.log("\n--- STEP 2: Simulating 2 Existing Users ---");
    // const fundedUsers = await createAndFundUsers(2, MOCK_OLD_TREASURY_ID_FIXED);
    // console.log(`Funded ${fundedUsers.length} users.`);
    // await sleep(5000);

    // --- STEP 3: USER MIGRATION ---
    console.log("\n--- STEP 3: Users Migrate Old -> New ---");
    // const vaultId = await createMigrationVault();
    // console.log(`Migration Vault: ${vaultId}`);
    // await sleep(5000); 
    // await fundVault(vaultId); 
    // await sleep(5000);

    // for (const [i, data] of fundedUsers.entries()) {
    //     console.log(`User ${i+1} migrating...`);
    //     await migrateUser(data.user, vaultId, data.coinId);
    // }
    console.log("Skipping User Migration (Gas Constraints).");
    
    // --- STEP 4: LIQUIDITY MIGRATION ---
    console.log("\n--- STEP 4: LIQUIDITY MIGRATION (migrate_with_flowx) ---");
    console.log("Waiting for state convergence...");
    await sleep(5000); 
    console.log("Reading Old Pool Liquidity -> Creating New Pool...");
    
    const digest = await executeLiquidityMigration(1000); 
    console.log(`Liquidity Migration Success! Digest: ${digest}`);

    console.log("\n=== SIMULATION COMPLETE ===");
}

// --- HELPERS ---

async function mintOldTokensToAdmin(treasuryId: string, amount: number) {
    const tx = new Transaction();
    const coin = tx.moveCall({
        target: `${OLD_PKG_ID}::mock_sui::mint`, 
        arguments: [tx.object(treasuryId), tx.pure.u64(amount)]
    });
    tx.transferObjects([coin], tx.pure.address(adminKeypair.toSuiAddress()));
    const gas = await getLargestGasCoin(adminKeypair.toSuiAddress());
    tx.setGasPayment([{ objectId: gas.coinObjectId, version: gas.version, digest: gas.digest }]);
    await client.signAndExecuteTransaction({ signer: adminKeypair, transaction: tx });
}

async function createOldPool(treasuryId: string, amtX: number, amtY: number) {
    const [coinX, coinY] = sortCoins(DEMO_OLD_COIN_TYPE_FIXED, SUI_COIN_TYPE);
    const FEE_RATE = 3000;
    const SQRT_PRICE = "18446744073709551616"; 
    const tx = new Transaction();
    const gas = await getLargestGasCoin(adminKeypair.toSuiAddress());
    tx.setGasPayment([{ objectId: gas.coinObjectId, version: gas.version, digest: gas.digest }]);
    tx.moveCall({
         target: `${FLOWX_PACKAGE_ID}::pool_manager::create_and_initialize_pool`,
         typeArguments: [coinX, coinY],
         arguments: [tx.object(FLOWX_POOL_REGISTRY), tx.pure.u64(FEE_RATE), tx.pure.u128(SQRT_PRICE), tx.object(FLOWX_VERSIONED), tx.object(CLOCK_ID)]
    });
    const tickLower = tx.moveCall({ target: `${FLOWX_PACKAGE_ID}::i32::neg_from`, arguments: [tx.pure.u32(120)] });
    const tickUpper = tx.moveCall({ target: `${FLOWX_PACKAGE_ID}::i32::from`, arguments: [tx.pure.u32(120)] });
    const POS_REGISTRY = "0x638ea4bf1886077ebe16ce656246d01d53d4c6352f0b2389213fde408aad5c3e";
    const pos = tx.moveCall({
        target: `${FLOWX_PACKAGE_ID}::position_manager::open_position`,
        typeArguments: [coinX, coinY],
        arguments: [tx.object(POS_REGISTRY), tx.object(FLOWX_POOL_REGISTRY), tx.pure.u64(FEE_RATE), tickLower, tickUpper, tx.object(FLOWX_VERSIONED)]
    });
    const mockMint = tx.moveCall({
        target: `${OLD_PKG_ID}::mock_sui::mint`,
        arguments: [tx.object(treasuryId), tx.pure.u64(amtX)]
    });
    const [suiMint] = tx.splitCoins(tx.gas, [tx.pure.u64(amtY)]);
    let coinXObj, coinYObj;
    if (coinX === DEMO_OLD_COIN_TYPE_FIXED) { coinXObj = mockMint; coinYObj = suiMint; } 
    else { coinXObj = suiMint; coinYObj = mockMint; }
    tx.moveCall({
        target: `${FLOWX_PACKAGE_ID}::position_manager::increase_liquidity`,
        typeArguments: [coinX, coinY],
        arguments: [tx.object(FLOWX_POOL_REGISTRY), pos, coinXObj, coinYObj, tx.pure.u64(0), tx.pure.u64(0), tx.pure.u64("18446744073709551615"), tx.object(FLOWX_VERSIONED), tx.object(CLOCK_ID)]
    });
    tx.transferObjects([pos], tx.pure.address(adminKeypair.toSuiAddress()));
    try { await client.signAndExecuteTransaction({ signer: adminKeypair, transaction: tx }); } 
    catch (e: any) { console.warn("Pool Init warning:", e.message.slice(0, 100)); }
}

async function createAndFundUsers(count: number, treasuryId: string) {
    const users: Ed25519Keypair[] = [];
    const tx = new Transaction();
    const gasCoin = await getLargestGasCoin(adminKeypair.toSuiAddress());
    tx.setGasPayment([{ objectId: gasCoin.coinObjectId, version: gasCoin.version, digest: gasCoin.digest }]);
    const gasAmounts = Array(count).fill(tx.pure.u64(10_000_000));
    const gasCoins = tx.splitCoins(tx.gas, gasAmounts);
    for (let i = 0; i < count; i++) {
        const u = new Ed25519Keypair();
        users.push(u);
        tx.transferObjects([gasCoins[i]], tx.pure.address(u.toSuiAddress()));
        const mock = tx.moveCall({ target: `${OLD_PKG_ID}::mock_sui::mint`, arguments: [tx.object(treasuryId), tx.pure.u64(1000)] });
        tx.transferObjects([mock], tx.pure.address(u.toSuiAddress()));
    }
    const res = await client.signAndExecuteTransaction({ signer: adminKeypair, transaction: tx, options: { showEffects: true } });
    console.log(`CreateAndFund Tx: ${res.digest}`);
    await sleep(2000); 
    const txDetails = await client.getTransactionBlock({ digest: res.digest, options: { showObjectChanges: true } });
    const fundedUsers: { user: Ed25519Keypair, coinId: string }[] = [];
    for (const u of users) {
        const coin = txDetails.objectChanges?.find(c => 
            (c.type === "created" || c.type === "mutated") && (c as any).owner?.AddressOwner === u.toSuiAddress() && (c as any).objectType?.includes("mock_sui::MOCK_SUI")
        );
        if (coin && 'objectId' in coin) fundedUsers.push({ user: u, coinId: coin.objectId });
        else console.warn(`Warning: Could not find MOCK coin for user ${u.toSuiAddress()}`);
    }
    return fundedUsers;
}

async function createMigrationVault() {
    const tx = new Transaction();
    const gas = await getLargestGasCoin(adminKeypair.toSuiAddress());
    tx.setGasPayment([{ objectId: gas.coinObjectId, version: gas.version, digest: gas.digest }]);
    const initialFund = tx.moveCall({ target: `${PACKAGE_ID}::mock_new_token::mint`, arguments: [tx.object(MOCK_NEW_TREASURY_ID), tx.pure.u64(100)] });
    tx.moveCall({ target: `${PACKAGE_ID}::user_migration::create_vault`, typeArguments: [DEMO_OLD_COIN_TYPE_FIXED, DEMO_NEW_COIN_TYPE], arguments: [initialFund] });
    const res = await client.signAndExecuteTransaction({ signer: adminKeypair, transaction: tx, options: { showObjectChanges: true } });
    return (res.objectChanges?.find(c => c.type === "created" && c.objectType.includes("MigrationVault")) as any).objectId;
}

async function fundVault(vaultId: string) {
    const tx = new Transaction();
    const gas = await getLargestGasCoin(adminKeypair.toSuiAddress());
    tx.setGasPayment([{ objectId: gas.coinObjectId, version: gas.version, digest: gas.digest }]);
    const fund = tx.moveCall({ target: `${PACKAGE_ID}::mock_new_token::mint`, arguments: [tx.object(MOCK_NEW_TREASURY_ID), tx.pure.u64(1000000)] });
    tx.moveCall({ target: `${PACKAGE_ID}::user_migration::deposit`, typeArguments: [DEMO_OLD_COIN_TYPE_FIXED, DEMO_NEW_COIN_TYPE], arguments: [tx.object(vaultId), fund] });
    await client.signAndExecuteTransaction({ signer: adminKeypair, transaction: tx });
}

async function migrateUser(user: Ed25519Keypair, vaultId: string, coinId: string) {
    const tx = new Transaction();
    tx.moveCall({ target: `${PACKAGE_ID}::user_migration::migrate`, typeArguments: [DEMO_OLD_COIN_TYPE_FIXED, DEMO_NEW_COIN_TYPE], arguments: [tx.object(vaultId), tx.object(coinId)] });
    tx.setGasBudget(10_000_000); 
    await client.signAndExecuteTransaction({ signer: user, transaction: tx });
}

async function executeLiquidityMigration(oldSupply: number) {
    const tx = new Transaction();
    const gas = await getLargestGasCoin(adminKeypair.toSuiAddress());
    tx.setGasPayment([{ objectId: gas.coinObjectId, version: gas.version, digest: gas.digest }]);

    const realAdminCap = await findAdminCap(adminKeypair.toSuiAddress());
    console.log(`DEBUG: Found Real AdminCap: ${realAdminCap}`);

    const FEE_RATE = 3000;
    const NEW_SUPPLY = 1_000_000_000n; 
    tx.moveCall({
        target: `${PACKAGE_ID}::migration::migrate_with_flowx`,
        typeArguments: [DEMO_OLD_COIN_TYPE_FIXED, DEMO_NEW_COIN_TYPE],
        arguments: [
            tx.object(realAdminCap),
            tx.object(FLOWX_POOL_REGISTRY),
            tx.object(FLOWX_VERSIONED),
            tx.pure.u64(FEE_RATE),
            tx.pure.u128(BigInt(oldSupply)), 
            tx.object(MOCK_NEW_TREASURY_ID),
            tx.pure.u64(NEW_SUPPLY),
            tx.object(CLOCK_ID)
        ]
    });
    const res = await client.signAndExecuteTransaction({ signer: adminKeypair, transaction: tx, options: { showEffects: true } });
    if (res.effects?.status.status !== "success") throw new Error(`Migrate Failed: ${res.effects?.status.error}`);
    return res.digest;
}

function sortCoins(a: string, b: string) { return a < b ? [a, b] : [b, a]; }

main().catch(console.error);
