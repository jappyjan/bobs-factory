import { useEffect, useRef } from "react";
import { launchAssetLimits } from "../LaunchAssetLimits";
import { api } from "./client";
import { useCurrentForm, useFormState } from "./form-state";
import { FileIcon, PaperclipIcon } from "./launcher-icons";

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
export const uploadLimitsHint = "Any file type · up to 10 files, 25 MiB each";

/** Private uploads belong to one project/workflow draft and clear on scope changes. */
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
		if (!files.length) return;
		const existing = current.current;
		if (files.length + existing.length > launchAssetLimits.count) {
			setError("Attach up to 10 files. Remove one first.");
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
			setError("Attachments must total 100 MiB or less. Remove one first.");
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
									? { ...row, status: "error", error: cause.message }
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
export type LaunchUploads = ReturnType<typeof useLaunchUploads>;

/** A paperclip that opens the native picker for one declared files field. */
export function AttachButton({
	field,
	uploads,
	disabled,
}: {
	field: any;
	uploads: LaunchUploads;
	disabled: boolean;
}) {
	const input = useRef<HTMLInputElement>(null);
	const label = `Attach files${field.required ? " (required)" : ""}`;
	return (
		<>
			<button
				type="button"
				className="launcher-icon-button"
				aria-label={label}
				title={`${field.label}: ${uploadLimitsHint}`}
				disabled={disabled}
				onClick={() => input.current?.click()}
			>
				<PaperclipIcon />
				{field.required && !uploads.selection[field.name]?.length && (
					<span className="launcher-required-dot" aria-hidden="true" />
				)}
			</button>
			<input
				ref={input}
				hidden
				type="file"
				multiple
				tabIndex={-1}
				aria-hidden="true"
				onChange={(event) => {
					uploads.add(field.name, Array.from(event.target.files ?? []));
					event.target.value = "";
				}}
			/>
		</>
	);
}

/** Compact attachment chips shown above the prompt, like a chat composer. */
export function AttachmentChips({
	uploads,
	labels,
}: {
	uploads: LaunchUploads;
	labels?: Record<string, string>;
}) {
	if (!uploads.uploads.length && !uploads.error) return null;
	const failed = uploads.uploads.filter((item) => item.status === "error");
	return (
		<div className="launcher-attachments">
			{uploads.uploads.length > 0 && (
				<ul aria-label="Attachments">
					{uploads.uploads.map((item) => (
						<li
							key={item.localId}
							className="launcher-chip"
							data-status={item.status}
							title={item.error ?? item.file.name}
						>
							<span className="launcher-chip-icon" aria-hidden="true">
								{item.status === "uploading" || item.status === "removing" ? (
									<span className="spinner" />
								) : (
									<FileIcon />
								)}
							</span>
							<span className="launcher-chip-text">
								<span className="launcher-chip-name">{item.file.name}</span>
								<small>
									{item.status === "error"
										? "Upload failed"
										: item.status === "uploading"
											? "Uploading…"
											: item.status === "removing"
												? "Removing…"
												: fileSize(item.file.size)}
									{labels?.[item.field] ? ` · ${labels[item.field]}` : ""}
								</small>
							</span>
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
			)}
			{failed.length > 0 && (
				<p className="error" role="alert">
					{failed[0]!.error ?? "Upload failed"}. Remove the file and attach it
					again to retry.
				</p>
			)}
			{uploads.error && (
				<p className="error" role="alert">
					{uploads.error}{" "}
					<button type="button" className="link" onClick={uploads.clearError}>
						Dismiss
					</button>
				</p>
			)}
		</div>
	);
}
