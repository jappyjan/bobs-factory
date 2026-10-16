/** Small stroke icons for the launch composer; they inherit the text colour. */
const Icon = ({ children }: { children: React.ReactNode }) => (
	<svg
		className="launcher-svg"
		viewBox="0 0 24 24"
		width="18"
		height="18"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
		focusable="false"
	>
		{children}
	</svg>
);
export const ChevronIcon = () => (
	<Icon>
		<path d="m6 9 6 6 6-6" />
	</Icon>
);
export const ArrowUpIcon = () => (
	<Icon>
		<path d="M12 19V5M5 12l7-7 7 7" />
	</Icon>
);
export const PaperclipIcon = () => (
	<Icon>
		<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
	</Icon>
);
export const SlidersIcon = () => (
	<Icon>
		<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
		<circle cx="16" cy="6" r="2" />
		<circle cx="10" cy="12" r="2" />
		<circle cx="18" cy="18" r="2" />
	</Icon>
);
export const SparkIcon = () => (
	<Icon>
		<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
	</Icon>
);
export const BrainIcon = () => (
	<Icon>
		<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1Z" />
		<path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1" />
	</Icon>
);
export const FileIcon = () => (
	<Icon>
		<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
		<path d="M14 3v5h5" />
	</Icon>
);
export const FolderIcon = () => (
	<Icon>
		<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
	</Icon>
);
