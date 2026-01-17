import { getFullnodeUrl } from "@mysten/sui/client";
import { createNetworkConfig } from "@mysten/dapp-kit";

const { networkConfig, useNetworkVariable, useNetworkConfig } = createNetworkConfig({
	testnet: {
		url: getFullnodeUrl("testnet"),
	},
	mainnet: {
		url: getFullnodeUrl("mainnet"),
	},
});

export { useNetworkVariable, useNetworkConfig, networkConfig };
