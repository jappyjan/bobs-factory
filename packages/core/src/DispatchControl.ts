import { z } from "zod";

/** Trusted local authority. Never serialize this capability into provider inputs. */
export interface DispatchControl {
	/** Invoke write synchronously at the final comparison; do not await its result under the owner lock. */
	run<T>(write: () => T): Promise<{ value: T }>;
}

export class UnsentDispatchError extends Error {
	constructor(public readonly reason: "superseded" | "unavailable") {
		super(
			reason === "superseded"
				? "This unsent decision display was superseded; use the renewed decision."
				: "Current decision dispatch authority is unavailable; delivery remains pending.",
		);
	}
}

/** Private durable reference, resolved by the owning runtime after recovery. */
export interface ViewDeliveryIdentity {
	version: 1;
	runId: string;
	receiptKey: string;
	batchId: string;
	digest: string;
	deliveryId: string;
}

export const ViewDeliveryIdentitySchema = z
	.object({
		version: z.literal(1),
		runId: z.string().min(1).max(256),
		receiptKey: z.string().min(1).max(512),
		batchId: z.string().min(1).max(256),
		digest: z.string().regex(/^[a-f0-9]{64}$/),
		deliveryId: z.string().min(1).max(256),
	})
	.strict();

export interface ViewDeliveryControl extends DispatchControl {
	identity: ViewDeliveryIdentity;
}
