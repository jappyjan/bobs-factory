import type { ProviderCheck } from "./ProviderReadiness.js";
export interface ProviderCheckState {
	checkReceipts?: Record<
		string,
		{
			failure: NonNullable<ProviderCheck["failure"]>;
			metadataRecheck?: boolean;
			failureLogExcerpt?: string;
		}
	>;
}
