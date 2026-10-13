import { useEffect, useRef } from "react";
import { launchAssetLimits } from "../LaunchAssetLimits";
import { api } from "./client";
import { useCurrentForm, useFormState } from "./form-state";

interface Upload {
	localId: string;
	field: string;
	file: File;
	status: "uploading" | "ready" | "error" | "removing";
	id?: string;
	error?: string;
}
export function fileSize(bytes: number) {
	return bytes >= 1024 * 1024
		? `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
		: `${Math.ceil(bytes / 1024)} KiB`;
}
export function useLaunchUploads(
	context: string,
	config: any,
	repositoryId: string,
	workflow: string,
) {
	const [draft, setDraft] = useFormState(context, () => crypto.randomUUID());
	const [uploads, setUploads] = useFormState<Upload[]>(
		`${context}/${draft}`,
		[],
	);
	const [error, setError] = useFormState(`${context}/${draft}`, "");
	const isCurrent = useCurrentForm(`${context}/${draft}`);
	const current = useRef(uploads);
	current.current = uploads;
	const controllers = useRef(new Map<string, AbortController>());
	useEffect(() => {
		void context;
		void draft;
		const active = controllers.current;
		return () => {
			for (const controller of active.values()) controller.abort();
			active.clear();
		};
	}, [context, draft]);
	const update = (fn: (items: Upload[]) => Upload[]) => {
		if (!isCurrent()) return;
		current.current = fn(current.current);
		setUploads(current.current);
	};
	const add = (field: string, files: File[]) => {
		const existing = current.current;
		if (files.length + existing.length > launchAssetLimits.count) {
			setError("Select up to 10 files; remove a file first.");
			return;
		}
		if (files.some((file) => file.size > launchAssetLimits.fileBytes)) {
			setError("Each file must be 25 MiB or smaller.");
			return;
		}
		if (
			[...existing.map((item) => item.file), ...files].reduce(
				(sum, file) => sum + file.size,
				0,
			) > launchAssetLimits.totalBytes
		) {
			setError("Files must total 100 MiB or less; remove a file first.");
			return;
		}
		setError("");
		const next = files.map(
			(file): Upload => ({
				localId: crypto.randomUUID(),
				field,
				file,
				status: "uploading",
			}),
		);
		update((items) => [...items, ...next]);
		for (const item of next) {
			const controller = new AbortController();
			controllers.current.set(item.localId, controller);
			const metadata = {
				draft,
				field,
				workflow,
				repositoryId,
				repositoryIds: config.repositories.find(
					(repo: any) => repo.id === repositoryId,
				)?.repositoryIds ?? [repositoryId],
				name: item.file.name,
				mime: item.file.type,
			};
			void api(
				`/api/launch-assets?metadata=${encodeURIComponent(JSON.stringify(metadata))}`,
				{
					method: "POST",
					headers: { "Content-Type": "application/octet-stream" },
					body: item.file,
					signal: controller.signal,
				},
			)
				.then((asset) =>
					update((items) =>
						items.map((row) =>
							row.localId === item.localId
								? { ...row, status: "ready", id: asset.id }
								: row,
						),
					),
				)
				.catch((cause) => {
					if (!controller.signal.aborted)
						update((items) =>
							items.map((row) =>
								row.localId === item.localId
									? {
											...row,
											status: "error",
											error: `${cause.message}. Remove this file and select it again to retry.`,
										}
									: row,
							),
						);
				})
				.finally(() => controllers.current.delete(item.localId));
		}
	};
	const remove = async (item: Upload) => {
		controllers.current.get(item.localId)?.abort();
		if (item.id) {
			update((items) =>
				items.map((row) =>
					row.localId === item.localId ? { ...row, status: "removing" } : row,
				),
			);
			try {
				await api(`/api/launch-assets/${draft}/${item.id}`, {
					method: "DELETE",
					body: "{}",
				});
			} catch (cause) {
				update((items) =>
					items.map((row) =>
						row.localId === item.localId
							? { ...row, status: "error", error: (cause as Error).message }
							: row,
					),
				);
				return;
			}
		}
		update((items) => items.filter((row) => row.localId !== item.localId));
		setError("");
	};
	return {
		draft,
		uploads,
		error,
		clearError: () => setError(""),
		add,
		remove,
		reset: () => {
			setDraft(crypto.randomUUID());
		},
		blocked: Boolean(error) || uploads.some((item) => item.status !== "ready"),
		selection: Object.fromEntries(
			[...new Set(uploads.map((item) => item.field))].map((field) => [
				field,
				uploads
					.filter((item) => item.field === field && item.id)
					.map((item) => item.id!),
			]),
		),
	};
}
export function UploadField({
	field,
	uploads,
	disabled,
}: {
	field: any;
	uploads: ReturnType<typeof useLaunchUploads>;
	disabled: boolean;
}) {
	return (
		<fieldset className="launch-uploads" disabled={disabled}>
			<legend>
				{field.label}
				{field.required ? " *" : " (optional)"}
			</legend>
			<label className="upload-picker">
				<span>📎 Add files</span>
				<input
					aria-label={`Add ${field.label}`}
					type="file"
					multiple
					onChange={(event) => {
						uploads.add(field.name, Array.from(event.target.files ?? []));
						event.target.value = "";
					}}
				/>
			</label>
			<small>Any file type · 10 files · 25 MiB each · 100 MiB total</small>
			{field.description && <small>{field.description}</small>}
			<ul>
				{uploads.uploads
					.filter((item) => item.field === field.name)
					.map((item) => (
						<li key={item.localId}>
							<div>
								<span className="upload-name">{item.file.name}</span>
								<small>
									{fileSize(item.file.size)} ·{" "}
									{item.status === "ready"
										? "Uploaded"
										: item.status === "uploading"
											? "Uploading…"
											: item.status === "removing"
												? "Removing…"
												: "Upload failed"}
								</small>
								{item.error && (
									<p className="error" role="alert">
										{item.error}
									</p>
								)}
							</div>
							<button
								type="button"
								aria-label={`Remove ${item.file.name}`}
								disabled={item.status === "removing"}
								onClick={() => void uploads.remove(item)}
							>
								×
							</button>
						</li>
					))}
			</ul>
			{uploads.uploads.some((item) => item.status === "error") && (
				<button type="button" onClick={uploads.reset}>
					Clear all attachments and retry
				</button>
			)}
			{uploads.error && (
				<p className="error" role="alert">
					{uploads.error}{" "}
					<button type="button" onClick={uploads.clearError}>
						Dismiss selection error
					</button>
				</p>
			)}
		</fieldset>
	);
}
