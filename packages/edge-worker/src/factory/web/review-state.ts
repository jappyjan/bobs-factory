import { accessState } from "./auth-state";
export function signature(value: unknown) {
	let hash = 2166136261;
	for (const c of JSON.stringify(value))
		hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
	return (hash >>> 0).toString(36);
}

export function ticketTrackingPending(run: any): boolean {
	return Boolean(
		run.ticketSync?.error ||
			run.ticketSync?.receipts?.some(
				(receipt: { delivered?: boolean; superseded?: boolean }) =>
					!receipt.delivered && !receipt.superseded,
			),
	);
}

export function readTextStored(key: string, fallback: string, session = false) {
	try {
		return (session ? sessionStorage : localStorage).getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
}
export function writeTextStored(key: string, value: string, session = false) {
	if (
		accessState().status !== "authenticated" &&
		!["factory-theme", "factory-settled-view"].includes(key)
	)
		return;
	try {
		(session ? sessionStorage : localStorage).setItem(key, value);
	} catch {
		/* Navigation, reading and actions remain available without storage. */
	}
}
export function readStored<T>(key: string, fallback: T, session = false): T {
	try {
		return JSON.parse(readTextStored(key, "null", session)) ?? fallback;
	} catch {
		return fallback;
	}
}
export function writeStored(key: string, value: unknown, session = false) {
	writeTextStored(key, JSON.stringify(value), session);
}

export function todayContext(pathname: string, state: any) {
	const review = pathname.match(/^\/runs\/([^/]+)\/review$/);
	let id = review?.[1];
	try {
		if (id) id = decodeURIComponent(id);
	} catch {
		/* malformed direct URL */
	}
	return { focusRunId: id ?? state?.focusRunId };
}
