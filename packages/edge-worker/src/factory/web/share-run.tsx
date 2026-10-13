import { useId, useState } from "react";
import { Button, Modal, useToast } from "./ui";

export function ShareRun({ runId, title }: { runId: string; title?: string }) {
	const toast = useToast();
	const fieldId = useId();
	const [manual, setManual] = useState<string>();
	const [copying, setCopying] = useState(false);
	async function copy() {
		if (copying) return;
		const url = `${window.location.origin}/#/runs/${encodeURIComponent(runId)}`;
		setCopying(true);
		try {
			await navigator.clipboard.writeText(url);
			setManual(undefined);
			toast({ text: "Run link copied" });
		} catch {
			setManual(url);
		} finally {
			setCopying(false);
		}
	}
	return (
		<>
			<Button
				variant="ghost"
				aria-label={`Share run: ${title ?? runId}`}
				onClick={() => void copy()}
			>
				Share
			</Button>
			<Modal
				open={manual !== undefined}
				onOpenChange={(open) => {
					if (!open) setManual(undefined);
				}}
				title="Copy run link"
				description="Couldn’t copy the run link. Copy it manually below, or try again."
			>
				<div className="share-fallback">
					<label htmlFor={fieldId}>Run link</label>
					<input
						id={fieldId}
						readOnly
						value={manual ?? ""}
						onFocus={(event) => event.currentTarget.select()}
					/>
					<Button
						variant="secondary"
						busy={copying}
						onClick={() => void copy()}
					>
						Try again
					</Button>
				</div>
			</Modal>
		</>
	);
}
