
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromB64 } from "@mysten/sui/utils";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import dotenv from "dotenv";

dotenv.config();

// --- CONSTANTS ---
// Adjust these if you redeploy
const PACKAGE_ID = "0x9967efe09c53160bbf2cc645ab7fe6e1b03807eb6faf7f5984bb24d4cd61f1b9"; 
const OLD_PACKAGE_ID = "0x7231da1a477e77f22500ac8da82b8b9f0a38002bb9cad61e6b0b57354a07a6c2"; 

const OLD_COIN_TYPE = `${OLD_PACKAGE_ID}::mock_sui::MOCK_SUI`;
const NEW_COIN_TYPE = `${PACKAGE_ID}::mock_new_token::MOCK_NEW_TOKEN`;

const OLD_TREASURY_ID = "0xbdb2aca08333abcc6007cae3e2b81dcd02b652016d1908187e85d45caa372c04";
const NEW_TREASURY_ID = "0xa87d26ebf7678f0fd3d22c51dd6cbd5cd0d3f50ed3cbc48b5dc245db84e8952b";

const USER_COUNT = 10;
const INITIAL_OLD_BALANCE = 1000;

// --- CLIENT ---
const client = new SuiClient({ url: "https://fullnode.testnet.sui.io:443" });

let adminKeypair: Ed25519Keypair;
if (process.env.PRIVATE_KEY?.startsWith("suiprivkey")) {
    const { secretKey } = decodeSuiPrivateKey(process.env.PRIVATE_KEY);
    adminKeypair = Ed25519Keypair.fromSecretKey(secretKey);
} else {
    adminKeypair = Ed25519Keypair.fromSecretKey(fromB64(process.env.PRIVATE_KEY!).slice(1));
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- TYPES ---
interface UserState {
    id: number;
    keypair: Ed25519Keypair;
    address: string;
    coinObjectId?: string;
}

// --- MAIN ---
async function main() {
    console.log("=== STARTING FULL END-TO-END SIMULATION ===");
    console.log("Admin:", adminKeypair.toSuiAddress());

    // --- STEP 1: ADMIN SETUP (VAULT) ---
    console.log("\n--- STEP 1: ADMIN SETUP ---");
    console.log("Creating Vault...");
    const vaultId = await createVault();
    console.log("Vault Created:", vaultId);

    // Wait for indexing/consensus
    await sleep(2000);

    console.log("Funding Vault...");
    await fundVault(vaultId);
    console.log("Vault Funded.");
    
    // Wait for gas object version update
    await sleep(5000);


    // --- STEP 2: USER SETUP (Mock Existing State) ---
    console.log("\n--- STEP 2: USER SETUP (Mock Existing Users) ---");
    const users: UserState[] = [];
    const userAddrs: string[] = [];

    // Generate Users
    for (let i = 1; i <= USER_COUNT; i++) {
        const kp = new Ed25519Keypair();
        users.push({ id: i, keypair: kp, address: kp.toSuiAddress() });
        userAddrs.push(kp.toSuiAddress());
        console.log(`User ${i} generated: ${kp.toSuiAddress()}`);
    }

    // Bulk Fund & Capture Coins
    console.log(`\nBulk Funding ${USER_COUNT} users...`);
    // Pass userAddrs to helper
    const userCoinMap = await bulkFundUsers(userAddrs);
    console.log(`Bulk Funding executed. Captured ${userCoinMap.size} Coin Objects.`);

    // Map coins to users
    for (const u of users) {
        if (userCoinMap.has(u.address)) {
            u.coinObjectId = userCoinMap.get(u.address);
        } else {
            console.warn(`WARN: User ${u.id} missing coin object in capture map.`);
        }
    }

    // Wait for consensus propagation (safe measure)
    await sleep(5000);


    // --- STEP 3: EXECUTE MIGRATION ---
    console.log("\n--- STEP 3: USER MIGRATION ---");
    
    let successCount = 0;
    for (const user of users) {
        if (!user.coinObjectId) {
            console.error(`Skipping User ${user.id} (No Coin ID).`);
            continue;
        }

        console.log(`\nMigrating User ${user.id}...`);
        try {
            const digest = await migrateUser(user.keypair, vaultId, user.coinObjectId);
            console.log(`User ${user.id} SUCCESS! Digest: ${digest}`);
            successCount++;
        } catch (e) {
            console.error(`User ${user.id} FAILED:`, e);
        }
        
        // Rate limit
        await sleep(500); 
    }

    console.log(`\n=== SIMULATION COMPLETE ===`);
    console.log(`Total Success: ${successCount}/${USER_COUNT}`);
}


// --- HELPERS ---

async function createVault(): Promise<string> {
    const tx = new Transaction();
    // Explicit Gas Selection
    const gas = await getLargestGasCoin();
    tx.setGasPayment([gas]);

    // 1. Mint 100 New Tokens
    const initialFund = tx.moveCall({
        target: `${PACKAGE_ID}::mock_new_token::mint`,
        arguments: [tx.object(NEW_TREASURY_ID), tx.pure.u64(100)],
    });
    // 2. Create Vault
    tx.moveCall({
        target: `${PACKAGE_ID}::user_migration::create_vault`,
        typeArguments: [OLD_COIN_TYPE, NEW_COIN_TYPE],
        arguments: [initialFund],
    });

    const res = await client.signAndExecuteTransaction({
        signer: adminKeypair,
        transaction: tx,
        options: { showObjectChanges: true, showEffects: true }
    });

    if (res.effects?.status.status !== "success") {
        throw new Error(`Vault Creation Failed: ${res.effects?.status.error}`);
    }

    const created = res.objectChanges?.find(c => 
        c.type === "created" && c.objectType.includes("user_migration::MigrationVault")
    );
    if (!created || !("objectId" in created)) throw new Error("Vault object not found in changes");
    return created.objectId;
}

async function fundVault(vaultId: string) {
    const tx = new Transaction();
    const gas = await getLargestGasCoin();
    tx.setGasPayment([gas]);

    const fund = tx.moveCall({
        target: `${PACKAGE_ID}::mock_new_token::mint`,
        arguments: [tx.object(NEW_TREASURY_ID), tx.pure.u64(10_000_000_000)],
    });

    tx.moveCall({
        target: `${PACKAGE_ID}::user_migration::deposit`,
        typeArguments: [OLD_COIN_TYPE, NEW_COIN_TYPE],
        arguments: [tx.object(vaultId), fund],
    });

    await client.signAndExecuteTransaction({
        signer: adminKeypair,
        transaction: tx,
    });
}

async function bulkFundUsers(addresses: string[]): Promise<Map<string, string>> {
    const tx = new Transaction();
    const gas = await getLargestGasCoin();
    tx.setGasPayment([gas]);
    
    for (const addr of addresses) {
        // 1. Send Gas (0.05 SUI should be plenty for 1 tx)
        const [gasCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(50_000_000)]); 
        tx.transferObjects([gasCoin], tx.pure.address(addr));

        // 2. Mint Old Token (1000)
        const oldCoins = tx.moveCall({
            target: `${OLD_PACKAGE_ID}::mock_sui::mint`,
            arguments: [tx.object(OLD_TREASURY_ID), tx.pure.u64(INITIAL_OLD_BALANCE)], 
        });
        tx.transferObjects([oldCoins], tx.pure.address(addr));
    }

    // Execute
    const res = await client.signAndExecuteTransaction({ 
        signer: adminKeypair, 
        transaction: tx,
        options: { showObjectChanges: true, showEffects: true }
    });

    if (res.effects?.status.status !== "success") {
        throw new Error(`Bulk Fund Tx Failed: ${res.effects?.status.error}`);
    }

    // Parse Response for Coin IDs
    const map = new Map<string, string>();
    if (res.objectChanges) {
        for (const change of res.objectChanges) {
            // We look for the MINTED Old Tokens
            if (change.type === 'created' && change.objectType.includes("mock_sui::MOCK_SUI")) {
                if ("owner" in change && typeof change.owner === 'object' && "AddressOwner" in change.owner) {
                    const ownerAddr = change.owner.AddressOwner;
                    // Check if this object belongs to one of our target users
                    if (addresses.includes(ownerAddr)) {
                        map.set(ownerAddr, change.objectId);
                    }
                }
            }
        }
    }
    return map;
}

async function getLargestGasCoin(): Promise<{ objectId: string, version: string, digest: string }> {
    const coins = await client.getCoins({
        owner: adminKeypair.toSuiAddress(), 
        coinType: "0x2::sui::SUI" 
    });
    
    if (coins.data.length === 0) throw new Error("No SUI coins found for Admin");
    
    // Log coins
    console.log(`Found ${coins.data.length} SUI coins:`);
    coins.data.forEach(c => console.log(`- ${c.coinObjectId}: ${c.balance} MIST`));

    // Sort by balance desc
    const sorted = coins.data.sort((a, b) => Number(b.balance) - Number(a.balance));
    const selected = sorted[0];
    console.log(`Selected Largest: ${selected.coinObjectId} (${selected.balance} MIST)`);
    
    if (Number(selected.balance) < 1_000_000_000) {
        console.warn("WARNING: Largest coin is < 1 SUI. Setup might fail.");
    }

    return {
        objectId: selected.coinObjectId,
        version: selected.version,
        digest: selected.digest
    };
}

async function migrateUser(userKp: Ed25519Keypair, vaultId: string, coinId: string): Promise<string> {
    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::user_migration::migrate`,
        typeArguments: [OLD_COIN_TYPE, NEW_COIN_TYPE],
        arguments: [tx.object(vaultId), tx.object(coinId)]
    });
    tx.setGasBudget(10_000_000);

    const res = await client.signAndExecuteTransaction({
        signer: userKp,
        transaction: tx,
        options: { showEffects: true }
    });

    if (res.effects?.status.status !== "success") {
        throw new Error(`Tx Failed: ${res.effects?.status.error}`);
    }
    return res.digest;
}

main().catch(console.error);

