import type { ReactNode } from "react";
import { getPayloadSchema } from "../../lib/payload";
import { useT } from "../../i18n";
import type { EventDraft, Field } from "../../types";
import { CopyButton } from "../common/CopyButton";

interface YamlPreviewProps {
	draft: EventDraft;
	specVersion: string;
}

export function YamlPreview({ draft, specVersion }: YamlPreviewProps) {
	const { t } = useT();
	const yaml = buildYamlString(draft, specVersion);

	return (
		<div className="relative">
			<div className="absolute top-2 right-2">
				<CopyButton text={yaml} label={t("editor.copyYaml")} />
			</div>
			<pre className="text-xs font-mono bg-surface-input border border-edge-primary rounded-lg p-4 overflow-auto max-h-[calc(100vh-200px)] text-content-primary leading-relaxed">
				{highlightYaml(yaml)}
			</pre>
		</div>
	);
}

function buildYamlString(draft: EventDraft, specVersion: string): string {
	const lines: string[] = [];

	lines.push(`opentp: "${specVersion}"`);
	lines.push("");
	lines.push("event:");
	lines.push(`  key: "${draft.key}"`);
	lines.push("");

	// Lifecycle
	lines.push("  lifecycle:");
	lines.push(`    status: ${draft.lifecycle?.status ?? "draft"}`);
	lines.push("");

	// Taxonomy
	lines.push("  taxonomy:");
	for (const [key, value] of Object.entries(draft.taxonomy)) {
		if (value !== undefined && value !== "") {
			lines.push(`    ${key}: "${value}"`);
		}
	}
	lines.push("");

	// Payload
	const schema = getPayloadSchema(draft.payload);
	lines.push("  payload:");
	if (Object.keys(schema).length > 0) {
		lines.push("    schema:");
		for (const [name, field] of Object.entries(schema)) {
			lines.push(`      ${name}:`);
			appendFieldLines(lines, field, 8);
		}
	} else {
		lines.push("    schema: {}");
	}

	return lines.join("\n");
}

function appendFieldLines(lines: string[], field: Field, indent: number): void {
	const pad = " ".repeat(indent);

	if (field.value !== undefined) {
		const val =
			typeof field.value === "string" ? `"${field.value}"` : field.value;
		lines.push(`${pad}value: ${val}`);
		return;
	}

	lines.push(`${pad}type: ${field.type ?? "string"}`);
	if (field.required) lines.push(`${pad}required: true`);
	if (field.description)
		lines.push(`${pad}description: "${field.description}"`);
	if (field.dict) lines.push(`${pad}dict: "${field.dict}"`);
	if (field.enum && field.enum.length > 0) {
		lines.push(`${pad}enum:`);
		for (const v of field.enum) {
			const formatted = typeof v === "string" ? `"${v}"` : v;
			lines.push(`${pad}  - ${formatted}`);
		}
	}
	if (field.type === "array" && field.items) {
		lines.push(`${pad}items:`);
		lines.push(`${pad}  type: ${field.items.type ?? "string"}`);
	}
	if (field.pii) {
		lines.push(`${pad}pii:`);
		lines.push(`${pad}  kind: ${field.pii.kind ?? "unknown"}`);
		if (field.pii.masker) lines.push(`${pad}  masker: ${field.pii.masker}`);
	}
}

/** Simple YAML syntax highlighting using JSX spans */
function highlightYaml(yaml: string): ReactNode[] {
	const lines = yaml.split("\n");
	const result: ReactNode[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineKey = `${i}:${line}`;

		// Comment lines
		if (line.trimStart().startsWith("#")) {
			result.push(
				<span key={lineKey} className="text-content-muted">
					{line}
					{"\n"}
				</span>,
			);
			continue;
		}

		// Key-value pairs
		const keyMatch = line.match(/^(\s*)([\w-]+)(:)(.*)/);
		if (keyMatch) {
			const [, indent, key, colon, rest] = keyMatch;
			result.push(
				<span key={lineKey}>
					{indent}
					<span className="text-accent-blue">{key}</span>
					<span className="text-content-tertiary">{colon}</span>
					{highlightValue(rest)}
					{"\n"}
				</span>,
			);
			continue;
		}

		// List items
		const listMatch = line.match(/^(\s*)(- )(.*)/);
		if (listMatch) {
			const [, indent, dash, value] = listMatch;
			result.push(
				<span key={lineKey}>
					{indent}
					<span className="text-content-tertiary">{dash}</span>
					{highlightValue(value)}
					{"\n"}
				</span>,
			);
			continue;
		}

		result.push(
			<span key={lineKey}>
				{line}
				{"\n"}
			</span>,
		);
	}

	return result;
}

function highlightValue(value: string): ReactNode {
	const trimmed = value.trim();

	// Strings in quotes
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return <span className="text-accent-green"> {value}</span>;
	}
	// Numbers
	if (/^\s*\d+(\.\d+)?$/.test(value)) {
		return <span className="text-purple-400"> {value}</span>;
	}
	// Booleans
	if (/^\s*(true|false)$/.test(value)) {
		return <span className="text-accent-amber"> {value}</span>;
	}
	return <span className="text-content-primary"> {value}</span>;
}
