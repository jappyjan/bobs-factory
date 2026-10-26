export function roleOutputKey(run: any, name: string): string | undefined {
	return Object.hasOwn(run.outputs ?? {}, name) ? name : undefined;
}
export function roleOutput(run: any, name: string): any {
	return run.outputs?.[name];
}
