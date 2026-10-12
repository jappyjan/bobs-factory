// Render only the verified provider inventory selected by release discovery.
import { requireValue, TARGETS } from "./binary-release.mjs";
import { releaseChannel } from "./release-candidate.mjs";

const escapeHtml = (value) =>
	String(value).replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[c],
	);
const labels = {
	"darwin-arm64": "macOS Apple Silicon",
	"darwin-x64": "macOS Intel",
	"linux-x64": "Linux x64",
	"linux-arm64": "Linux ARM64",
};
export function renderDesktopDownloads(state) {
	return [
		["Default", state.stable],
		["Nightly", state.nightly],
	]
		.map(([name, selected]) => {
			const m = selected?.manifest;
			if (!m || m.status !== "available")
				return `<h3>${name}</h3><p class="status">No validated ${name.toLowerCase()} desktop release is available yet.</p>`;
			requireValue(
				m.repository === "jappyjan/bobs-factory" &&
					m.tag === `v${m.version}` &&
					releaseChannel(m.version),
				"Invalid website release identity",
			);
			const channel = releaseChannel(m.version);
			const rows = [];
			for (const target of TARGETS) {
				const formats = target.startsWith("darwin")
					? ["dmg"]
					: ["AppImage", "deb"];
				for (const format of formats) {
					const assetTarget = target.replace(/^darwin-/, "mac-");
					const file = `bobs-factory-desktop-${m.version}-${assetTarget}.${format}`;
					const record = m.assets?.find((a) => a.file === file);
					if (!record) continue;
					const delivered =
						format === "deb"
							? m.desktop?.additionalAssets?.find((a) => a.file === file)
							: m.desktop?.artifacts?.find(
									(a) => a.target === target && a.archive?.file === file,
								)?.archive;
					if (!delivered) continue;
					requireValue(
						delivered.sha256 === record.sha256 &&
							delivered.size === record.size,
						"Website installer differs from validated desktop inventory",
					);
					requireValue(
						/^[a-f0-9]{64}$/.test(record.sha256) &&
							Number.isSafeInteger(record.size) &&
							record.size > 0,
						"Invalid website desktop asset inventory",
					);
					const href = `https://github.com/jappyjan/bobs-factory/releases/download/${encodeURIComponent(m.tag)}/${encodeURIComponent(file)}`;
					rows.push(
						`<li><a href="${escapeHtml(href)}">${labels[target]} · ${format}</a></li>`,
					);
				}
			}
			const details = `https://github.com/jappyjan/bobs-factory/releases/tag/${encodeURIComponent(m.tag)}`;
			return `<h3>${name} · ${escapeHtml(channel)} ${escapeHtml(m.version)}</h3>${rows.length ? `<ul>${rows.join("\n")}</ul>` : '<p class="status">This validated release has no desktop installers.</p>'}<p><a href="${details}">Release notes and SHA-256 inventory</a></p>`;
		})
		.join("\n");
}
export function updateDownloadsPage(template, state) {
	const start = "<!-- verified-desktop-downloads:start -->",
		end = "<!-- verified-desktop-downloads:end -->";
	requireValue(
		template.split(start).length === 2 &&
			template.split(end).length === 2 &&
			template.indexOf(start) < template.indexOf(end),
		"Missing or ambiguous website download markers",
	);
	return (
		template.slice(0, template.indexOf(start) + start.length) +
		"\n" +
		renderDesktopDownloads(state) +
		"\n" +
		template.slice(template.indexOf(end))
	);
}
