import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClient, useSuiClientQuery } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useState } from "react";
import { CLOCK_ID, DEMO_NEW_COIN_TYPE, DEMO_OLD_COIN_TYPE, FLOWX_POOL_REGISTRY, FLOWX_VERSIONED, MFT_TREASURY_ID, MOCK_NEW_TREASURY_ID, MOCK_OLD_TREASURY_ID, MODULE_ADMIN, MODULE_CLAIM, MODULE_PROJECT, PACKAGE_ID, ADMIN_CAP_ID } from "./constants";

function App() {
  const account = useCurrentAccount();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();
  const client = useSuiClient();

  const [projectId, setProjectId] = useState<string>(""); 
  const [oldTokenAmount, setOldTokenAmount] = useState("");
  const [mockTreasuryId, setMockTreasuryId] = useState(MOCK_OLD_TREASURY_ID);
  
  // Liquidity Migration State
  const [adminCapId, setAdminCapId] = useState(ADMIN_CAP_ID);
  const [oldFeeRate] = useState("3000"); // 0.3%
  const [newTokenSupply, setNewTokenSupply] = useState("1000000000"); // 1B 

  // --- Data Fetching ---
  const { data: userObjects } = useSuiClientQuery("getOwnedObjects", {
    owner: account?.address || "",
    options: { showType: true, showContent: true },
  }, {
    enabled: !!account,
  });

  const userMigrations = userObjects?.data?.filter(obj => 
    obj.data?.type?.includes(`${PACKAGE_ID}::user_migration::UserMigration`)
  ) || [];

  const mftCoins = userObjects?.data?.filter(obj => 
    obj.data?.type?.includes(`::mft_receipt::MFT_RECEIPT>`)
  ) || [];

  // --- Actions ---
  
  const migrateLiquidity = () => {
      if (!adminCapId) return alert("Please enter AdminCap ID");
      
      const tx = new Transaction();
      // migrate_with_flowx(admin, registry, versioned, old_fee, old_supply, new_treasury, new_supply, clock)
      
      const OLD_SUPPLY = 1_000_000_000_000; // Hardcoded supply of old token for demo
      
      tx.moveCall({
          target: `${PACKAGE_ID}::migration::migrate_with_flowx`,
          typeArguments: [
              DEMO_OLD_COIN_TYPE,   // Old Coin
              DEMO_NEW_COIN_TYPE    // New Coin
          ],
          arguments: [
              tx.object(adminCapId),
              tx.object(FLOWX_POOL_REGISTRY),
              tx.object(FLOWX_VERSIONED),
              tx.pure.u64(Number(oldFeeRate)),
              tx.pure.u128(OLD_SUPPLY),
              tx.object(MOCK_NEW_TREASURY_ID),
              tx.pure.u64(Number(newTokenSupply)),
              tx.object(CLOCK_ID)
          ]
      });

      signAndExecute({ transaction: tx }, { 
          onSuccess: (res) => alert("Liquidity Migration executed! New Pool Created. Digest: " + res.digest),
          onError: (e) => alert("Error: " + e.message)
      });
  };

  const initializeProject = () => {
    if (!account) return;
    const tx = new Transaction();
    const startTime = Date.now() + 10000; 
    const duration = 60000 * 5; 
       
    tx.moveCall({
      target: `${PACKAGE_ID}::${MODULE_PROJECT}::create_project`,
      typeArguments: [
        DEMO_OLD_COIN_TYPE,
        DEMO_NEW_COIN_TYPE
      ],
      arguments: [
        tx.object(MFT_TREASURY_ID),
        tx.pure.u64(startTime),
        tx.pure.u64(duration),
        tx.pure.u64(1), 
        tx.pure.u64(1),
        tx.pure.u64(0), 
      ],
    });

    signAndExecute(
      { transaction: tx },
      {
        onSuccess: (result) => alert("Project Initialized! Check console."),
        onError: (err) => alert("Failed: " + err.message),
      }
    );
  };
  
  // ... (migrate and claim functions unchanged, handled by partial replacement hopefully? No, previous was monolithic block)
  // Re-implementing migrate/claim to be safe since I'm targeting a large block.
  
  const migrate = () => {
    if (!projectId) return alert("Enter Project ID first");
    
    const tx = new Transaction();
    const [coin] = tx.moveCall({
        target: `${PACKAGE_ID}::mock_token::mint`,
        arguments: [
            tx.object(mockTreasuryId),
            tx.pure.u64(Number(oldTokenAmount))
        ]
    });
    
    tx.moveCall({
      target: `${PACKAGE_ID}::${MODULE_PROJECT}::migrate`,
      typeArguments: [DEMO_OLD_COIN_TYPE, DEMO_NEW_COIN_TYPE],
      arguments: [
        tx.object(projectId),
        tx.object(CLOCK_ID),
        coin
      ]
    });

    signAndExecute({ transaction: tx }, { onSuccess: () => alert("Migrated!") });
  };

  const claim = (userMigId: string, mftCoinId: string) => {
     if (!projectId) return alert("Set Project ID above");
     
     const tx = new Transaction();
     tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_CLAIM}::claim`,
        typeArguments: [DEMO_OLD_COIN_TYPE, DEMO_NEW_COIN_TYPE],
        arguments: [
            tx.object(projectId),
            tx.object(userMigId),
            tx.object(mftCoinId),
            tx.object(CLOCK_ID)
        ]
     });
     signAndExecute({ transaction: tx }, { onSuccess: () => alert("Claimed!") });
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 font-sans">
      <header className="flex justify-between items-center mb-12">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Migrate.fun (Sui Testnet)
        </h1>
        <ConnectButton />
      </header>

      {!account ? (
        <div className="text-center text-gray-400 mt-20">Please connect your wallet</div>
      ) : (
        <div className="max-w-4xl mx-auto space-y-12">
          
          {/* Section 4: Liquidity Migration (NEW) */}
           <section className="bg-slate-800 p-6 rounded-xl border border-cyan-700 shadow-xl shadow-cyan-900/20">
            <h2 className="text-xl font-bold mb-4 text-cyan-400">⚡ Liquidity-Driven Migration (Admin)</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                     <label className="block text-sm text-gray-400 mb-1">AdminCap ID</label>
                     <input 
                         value={adminCapId} 
                         onChange={e => setAdminCapId(e.target.value)}
                         placeholder="0x..."
                         className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm"
                     />
                </div>
                 <div>
                     <label className="block text-sm text-gray-400 mb-1">New Token Supply to Mint</label>
                     <input 
                         value={newTokenSupply} 
                         onChange={e => setNewTokenSupply(e.target.value)}
                         className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm"
                     />
                </div>
            </div>
            
             <button 
                 onClick={migrateLiquidity}
                 className="w-full bg-cyan-600 hover:bg-cyan-500 py-3 rounded font-bold text-lg transition flex items-center justify-center gap-2"
               >
                 <span>🚀 Execute Liquidity Migration</span>
               </button>
             <p className="text-xs text-cyan-200 mt-2 text-center">
                 Reads Old Pool ({Number(oldFeeRate)/10000}%) → Mints New Tokens → Creates New Pool with Correct Price.
             </p>
          </section>

          {/* Section 1: Legacy Receipt Setup (Admin) */}
          <section className="bg-slate-800 p-6 rounded-xl border border-slate-700 opacity-70 hover:opacity-100 transition">
            <h2 className="text-xl font-semibold mb-4 text-blue-300">Legacy: MFT Receipt Project Setup</h2>
            <div className="flex gap-4 items-center flex-wrap">
               <button 
                 onClick={initializeProject}
                 className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded font-medium transition"
               >
                 Initialize Project
               </button>
            </div>
          </section>

          {/* Configuration */}
           <section className="bg-slate-800 p-6 rounded-xl border border-slate-700">
            <h2 className="text-xl font-semibold mb-4 text-yellow-300">Configuration</h2>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm text-gray-400 mb-1">Project Object ID</label>
                    <input 
                        value={projectId} 
                        onChange={e => setProjectId(e.target.value)}
                        placeholder="0x..."
                        className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm"
                    />
                </div>
                <div>
                    <label className="block text-sm text-gray-400 mb-1">OLD Token Treasury (Shared)</label>
                    <input 
                        value={mockTreasuryId} 
                        onChange={e => setMockTreasuryId(e.target.value)}
                        placeholder="0x..."
                        className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm"
                    />
                </div>
            </div>
          </section>

          {/* Section 2: Migrate */}
          <section className="bg-slate-800 p-6 rounded-xl border border-slate-700">
            <h2 className="text-xl font-semibold mb-4 text-green-300">2. Migrate</h2>
            <div className="flex gap-4 items-end">
                <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">Amount OLD</label>
                    <input 
                        type="number"
                        value={oldTokenAmount}
                        onChange={e => setOldTokenAmount(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-600 rounded p-2"
                    />
                </div>
                <button 
                 onClick={migrate}
                 className="bg-green-600 hover:bg-green-500 px-6 py-2 rounded font-medium transition h-10"
               >
                 Mint & Migrate
               </button>
            </div>
             <p className="text-xs text-gray-500 mt-2">Mints OLD tokens and migrates them in one transaction.</p>
          </section>

           {/* Section 3: Claim */}
          <section className="bg-opacity-50 bg-slate-800 p-6 rounded-xl border border-slate-700">
            <h2 className="text-xl font-semibold mb-4 text-purple-300">3. Claim</h2>
            <p className="text-sm text-gray-400 mb-4">
                Select your UserMigration object and MFT Coin to claim.
            </p>
            
            <div className="grid grid-cols-1 gap-4">
                {userMigrations.length === 0 && <p className="text-gray-500 italic">No UserMigration objects found.</p>}
                
                {userMigrations.map(mig => {
                    const migId = mig.data?.objectId!;
                    // Find matching coins? Effectively we just pick one.
                    const coins = mftCoins;
                    
                    return (
                        <div key={migId} className="bg-slate-900 p-4 rounded border border-slate-700 flex justify-between items-center">
                            <div>
                                <div className="text-sm font-mono text-purple-200">Migration: {migId.slice(0, 10)}...</div>
                                <div className="text-xs text-gray-500">MFT Coins Available: {coins.length}</div>
                            </div>
                            
                            {coins.length > 0 ? (
                                <button
                                    onClick={() => claim(migId, coins[0].data?.objectId!)}
                                    className="bg-purple-600 hover:bg-purple-500 px-4 py-1 rounded text-sm"
                                >
                                    Claim with 1st Coin
                                </button>
                            ) : (
                                <span className="text-xs text-red-400">No MFT Coin</span>
                            )}
                        </div>
                    );
                })}
            </div>
          </section>

        </div>
      )}
    </div>
  );
}

export default App;