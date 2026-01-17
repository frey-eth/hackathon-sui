
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromB64 } from '@mysten/sui/utils';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Configuration
const NETWORK = 'testnet';
const PACKAGE_ID = process.env.VITE_PACKAGE_ID; // Require these in .env
const POOL_REGISTRY_ID = '0x40aa5119ae0633e7ba3c80fe4fd3d9b5277300dead42f6f9e565e7dd589cf6cb'; // FlowX Testnet
const VERSIONED_ID = '1'; // You need to find this from Explorer for FlowX
const CLOCK_ID = '0x6';

// Setup Client
const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

// Load Keypair
// NOTE: Ensure your ~/.sui/sui_config/sui.keystore has a key, or put PRIVATE_KEY in .env
const getSigner = () => {
    const pk = process.env.PRIVATE_KEY;
    if (!pk) throw new Error("Please set PRIVATE_KEY in .env");

    if (pk.startsWith('suiprivkey')) {
        const { secretKey } = decodeSuiPrivateKey(pk);
        return Ed25519Keypair.fromSecretKey(secretKey);
    }
    return Ed25519Keypair.fromSecretKey(fromB64(pk));
};

const keypair = getSigner();

const executeTx = async (tx: Transaction, description: string) => {
    console.log(`\n--- Executing: ${description} ---`);
    try {
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
            options: {
                showEffects: true,
                showObjectChanges: true,
            },
        });
        console.log(`Status: ${result.effects?.status.status}`);
        if (result.effects?.status.status === 'failure') {
            console.error(`Error: ${result.effects.status.error}`);
            process.exit(1);
        }
        return result;
    } catch (e) {
        console.error("Execution failed:", e);
        throw e;
    }
};

const main = async () => {
    console.log(`Target Package: ${PACKAGE_ID}`);
    console.log(`Signer: ${keypair.toSuiAddress()}`);

    if (!PACKAGE_ID) {
        throw new Error("VITE_PACKAGE_ID not set in .env");
    }

    // --- 1. MINT OLD MOCK TOKEN ---
    // We assume MOCK_TOKEN is in the package. 
    // We need the TreasuryCap for MOCK_TOKEN (Old)
    // For this test, we might need to query it or have it configured.
    // If we can't find it, we'll assume the user has some OLD coins.

    // OPTION: We'll skip Minting if we don't have the TreasuryCap obj ID.
    
    // --- 2. CREATE PROJECT ---
    const createProjectTx = new Transaction();
    // Args: TreasuryCap, StartTime, Duration, Numerator, Denominator, MinTarget
    // NOTE: This assumes we have these objects. 
    // For now, we'll comment it out or leave as placeholder.
    
    // --- 3. MIGRATE (User Flow) ---
    // User sends OLD tokens.
    const migrateTx = new Transaction();
    const oldCoin = migrateTx.object('0xOLD_COIN_ID'); // Replace with actual Coin ID
    migrateTx.moveCall({
        target: `${PACKAGE_ID}::migration_project::migrate`,
        arguments: [
            migrateTx.object('0xPROJECT_ID'), // Replace
            migrateTx.object(CLOCK_ID),
            oldCoin
        ],
        typeArguments: [
            `${PACKAGE_ID}::mock_token::MOCK_TOKEN`, // Old
            `${PACKAGE_ID}::mock_new_token::MOCK_NEW_TOKEN` // New
        ]
    });
    // await executeTx(migrateTx, "Migrate Old Tokens");

    // --- 4. CLAIM (User Flow) ---
    // User claims NEW tokens after migration ends.
    const claimTx = new Transaction();
    claimTx.moveCall({
        target: `${PACKAGE_ID}::claim_with_mft::claim`,
        arguments: [
            claimTx.object('0xPROJECT_ID'), 
            claimTx.object('0xUSER_MIGRATION_ID'), 
            claimTx.object('0xMFT_COIN_ID'), 
            claimTx.object(CLOCK_ID)
        ],
        typeArguments: [
            `${PACKAGE_ID}::mock_token::MOCK_TOKEN`, // Old
            `${PACKAGE_ID}::mock_new_token::MOCK_NEW_TOKEN` // New
        ]
    });
    // await executeTx(claimTx, "Claim New Tokens");

    // --- 6. CREATE POOL (FlowX) ---
    // [Removed as per user request]
    console.log("Skipping FlowX Pool Creation (Integration removed).");
    console.log("Done checking flow construction.");
};

main();
