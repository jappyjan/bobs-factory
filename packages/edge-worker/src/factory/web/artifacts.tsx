import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Component, type ReactNode, useEffect, useMemo, useState } from "react";
import { api, artifactsOf, friendly, screenshotUrl } from "./client";
import { LazyImage } from "./media";
import { useRestorableState } from "./restoration";
import { Button, External, Markdown, Modal, useToast } from "./ui";
export function artifactType(value: unknown) {
	return typeof value === "string" ? "document" : "structure";
}
const typeIcons: Record<string, string> = { document: "📄", structure: "🗂️" };
export function artifactSummary(value: any): string {
	if (value?.summary && typeof value.summary === "object")
		return Object.entries(value.summary)
			.slice(0, 5)
			.map(([key, v]) => `${key}: ${v}`)
			.join(" · ");
	return value?.__artifactPreview
		? `${Math.ceil(value.size / 1024)} KB · open to inspect`
		: typeof value === "string"
			? value.slice(0, 160)
			: typeof value?.summary === "string"
				? value.summary
				: "Open result";
}
export function ArtifactCard({
	artifact,
	run: _run,
	onOpen,
}: {
	artifact: any;
	run: any;
	onOpen: (name: string, image?: number) => void;
}) {
	const kind = artifactType(artifact.value);
	return (
		<button
			type="button"
			className={`artifact-card artifact-${kind}`}
			onClick={() => onOpen(artifact.name)}
		>
			<span className="artifact-icon">{typeIcons[kind]}</span>
			<span className="artifact-copy">
				<strong>{artifact.title}</strong>
				<span>{artifactSummary(artifact.value)}</span>
			</span>
		</button>
	);
}
export function Structure({
	value,
	depth = 0,
}: {
	value: any;
	depth?: number;
}): any {
	const [limit, setLimit] = useState(40);
	if (value === null || value === undefined || value === "")
		return <span className="muted">—</span>;
	if (typeof value === "boolean")
		return <span>{value ? "✅ Yes" : "❌ No"}</span>;
	if (typeof value === "string")
		return /^https?:\/\/\S+$/.test(value) ? (
			<External href={value}>{value} ↗</External>
		) : (
			<Markdown>{value}</Markdown>
		);
	if (typeof value !== "object") return String(value);
	if (Array.isArray(value))
		return (
			<ul>
				{value.slice(0, limit).map((item, i) => (
					<li key={i}>
						{depth > 1 && typeof item === "object" ? (
							<details>
								<summary>Item {i + 1}</summary>
								<Structure value={item} depth={depth + 1} />
							</details>
						) : (
							<Structure value={item} depth={depth + 1} />
						)}
					</li>
				))}
				{value.length > limit && (
					<li>
						<Button variant="ghost" onClick={() => setLimit(limit + 40)}>
							Show 40 more ({value.length - limit} remaining)
						</Button>
					</li>
				)}
			</ul>
		);
	return (
		<dl className="structure">
			{Object.entries(value).map(([key, item]) => (
				<div key={key}>
					<dt>
						{key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ")}
					</dt>
					<dd>
						<Structure value={item} depth={depth + 1} />
					</dd>
				</div>
			))}
		</dl>
	);
}
export function RenderArtifact({
	v,
}: {
	v: any;
	name: string;
	run: any;
	onImage: (i: number) => void;
}) {
	return typeof v === "string" ? (
		<Markdown>{v}</Markdown>
	) : (
		<Structure value={v} />
	);
}
export function Inspector({
	run,
	selected,
	onClose,
	onChange,
}: {
	run: any;
	selected: { name: string; image?: number } | undefined;
	onClose: () => void;
	onChange: (name: string, image?: number) => void;
}) {
	const toast = useToast(),
		cache = useQueryClient(),
		artifacts = useMemo(
			() => artifactsOf({ outputs: run.outputs }),
			[run.outputs],
		),
		index = artifacts.findIndex((a) => a.name === selected?.name),
		artifact = artifacts[index];
	const [raw, setRaw] = useRestorableState(
		`inspector/raw/${run.id}/${selected?.name}`,
		false,
	);
	const full = useQuery({
		queryKey: [
			"artifact",
			run.id,
			selected?.name,
			artifact?.value?.__artifactHash,
		],
		enabled: Boolean(selected && artifact?.value?.__artifactPreview),
		queryFn: ({ signal }) =>
			api(
				`/api/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(selected!.name)}?v=${encodeURIComponent(artifact?.value?.__artifactHash ?? "")}`,
				{ signal },
			),
		staleTime: 60000,
		gcTime: 300000,
	});
	const v = full.data ?? artifact?.value;
	useEffect(() => {
		if (!selected) return;
		// Do not prefetch large documents on mobile/data-saving connections.
		const connection = (navigator as any).connection;
		if (
			connection?.saveData ||
			/(^|-)2g$/.test(connection?.effectiveType ?? "")
		)
			return;
		for (const adjacent of [artifacts[index - 1], artifacts[index + 1]]) {
			if (adjacent?.value?.__artifactPreview && adjacent.value.size < 512000)
				void cache.prefetchQuery({
					queryKey: [
						"artifact",
						run.id,
						adjacent.name,
						adjacent.value.__artifactHash,
					],
					queryFn: ({ signal }) =>
						api(
							`/api/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(adjacent.name)}?v=${encodeURIComponent(adjacent.value.__artifactHash ?? "")}`,
							{ signal },
						),
					staleTime: 60000,
					gcTime: 300000,
				});
		}
		if (selected.image !== undefined) {
			const next = selected.image + 1;
			if (v?.screenshots?.[next]) {
				const image = new Image();
				image.src = screenshotUrl(run, next, selected.name);
			}
		}
	}, [selected, index, run, artifacts, cache, v?.screenshots]);

	const move = (delta: number) => {
		if (!selected) return;
		if (selected.image !== undefined) {
			const length = v?.screenshots?.length ?? 0;
			if (length)
				onChange(selected.name, (selected.image + delta + length) % length);
		} else if (artifacts.length)
			onChange(
				artifacts[(index + delta + artifacts.length) % artifacts.length]!.name,
			);
	};
	const shot = v?.screenshots?.[selected?.image ?? -1];
	return (
		<Modal
			open={Boolean(selected)}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title={
				<>
					<span className="artifact-icon">{typeIcons[artifactType(v)]}</span>
					{artifact?.title ?? friendly[selected?.name ?? ""] ?? "Artifact"}
				</>
			}
			description={`from ${artifact?.name ?? "step"} · ${run.title}`}
			className="inspector"
			onKeyDown={(event: any) => {
				if (event.target.closest("input,textarea,select,video,.evidence-video"))
					return;
				if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
					event.preventDefault();
					move(event.key === "ArrowLeft" ? -1 : 1);
				}
				if (event.key === "Escape" && selected?.image !== undefined) {
					event.preventDefault();
					event.stopPropagation();
					onChange(selected.name);
				}
			}}
		>
			<div className="inspector-toolbar">
				<div className="toggle">
					<button
						type="button"
						aria-pressed={!raw}
						onClick={() => setRaw(false)}
					>
						Rendered
					</button>
					<button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>
						Raw JSON
					</button>
				</div>
				<Button
					variant="ghost"
					onClick={() =>
						void navigator.clipboard
							.writeText(JSON.stringify(v, null, 2))
							.then(() => toast({ text: "Copied JSON" }))
							.catch(() => toast({ text: "Could not copy JSON" }))
					}
				>
					Copy JSON
				</Button>
				<div className="artifact-nav">
					<Button
						variant="icon"
						aria-label="Previous artifact"
						onClick={() => move(-1)}
					>
						‹
					</Button>
					<strong>
						{index + 1} of {artifacts.length}
					</strong>
					<Button
						variant="icon"
						aria-label="Next artifact"
						onClick={() => move(1)}
					>
						›
					</Button>
				</div>
			</div>
			<div
				className="inspector-body"
				key={`${selected?.name}/${selected?.image ?? "all"}/${raw}`}
			>
				{full.isLoading ? (
					<p role="status">
						Loading {Math.ceil((artifact?.value as any)?.size / 1024)} KB…
					</p>
				) : full.error ? (
					<p role="alert">{full.error.message}</p>
				) : raw ? (
					<pre>{JSON.stringify(v, null, 2)}</pre>
				) : shot ? (
					<div className="lightbox">
						<LazyImage
							src={screenshotUrl(run, selected!.image!, selected!.name)}
							alt={shot.caption}
						/>
						<h3>{shot.caption}</h3>
						<p className="muted">
							{shot.area} · {shot.state}
						</p>
						<div className="actions">
							<Button variant="secondary" onClick={() => move(-1)}>
								‹ Prev
							</Button>
							<span>
								{selected!.image! + 1} of {v.screenshots.length}
							</span>
							<Button variant="secondary" onClick={() => move(1)}>
								Next ›
							</Button>
							<Button variant="ghost" onClick={() => onChange(selected!.name)}>
								All screenshots
							</Button>
							<External
								href={`${location.origin}${screenshotUrl(run, selected!.image!, selected!.name)}`}
							>
								Open original ↗
							</External>
						</div>
					</div>
				) : (
					<ArtifactBoundary key={selected!.name} value={v}>
						<RenderArtifact
							name={selected!.name}
							v={v}
							run={run}
							onImage={(i) => onChange(selected!.name, i)}
						/>
					</ArtifactBoundary>
				)}
			</div>
		</Modal>
	);
}

class ArtifactBoundary extends Component<
	{ value: unknown; children: ReactNode },
	{ fallback: boolean }
> {
	state = { fallback: false };
	static getDerivedStateFromError() {
		return { fallback: true };
	}
	render() {
		return this.state.fallback ? (
			<Structure value={this.props.value} />
		) : (
			this.props.children
		);
	}
}
