import { useState } from "react";
import type { WsStatus } from "../../hooks/useWebSocket";
import { Modes } from "../../types";
import type { OpenTPConfig, UIMode, TrackingEvent } from "../../types";
import type { UseTreeStateResult } from "../../hooks/useTreeState";
import { Permissions } from "../../types/platform";
import { RoleGate } from "../../core/platform/RoleGate";
import { useBranding } from "../../core/platform/useBranding";
import { useT } from "../../i18n";
import { ExportPanel } from "../export/ExportPanel";
import { LocaleSwitcher } from "../common/LocaleSwitcher";
import { ModeToggle } from "../common/ModeToggle";
import { ThemeToggle } from "../common/ThemeToggle";
import { TreeNav } from "../tree/TreeNav";
import { AppSwitcher } from "./AppSwitcher";
import { UserMenu } from "./UserMenu";

interface SidebarProps {
	config: OpenTPConfig;
	mode: UIMode;
	canEdit: boolean;
	onModeChange: (mode: UIMode) => void;
	onNewEvent: () => void;
	events: TrackingEvent[];
	treeState: UseTreeStateResult;
	effectiveTreeLevels: string[];
	query: string;
	onQueryChange: (q: string) => void;
	totalCount: number;
	showDeprecated: boolean;
	onShowDeprecatedChange: (v: boolean) => void;
	wsStatus?: WsStatus;
	activeView?: "events" | "dictionaries";
	onManageDictionaries?: () => void;
	onSwitchToEvents?: () => void;
	baseUrl?: string;
	onExportError?: (message: string) => void;
	/** Called when a leaf event in the tree is clicked */
	onEventSelect?: (eventKey: string) => void;
	/** Currently selected event key (for tree highlight) */
	selectedEventKey?: string | null;
}

const WS_DOT_STYLES: Record<WsStatus, string> = {
	connected: "bg-accent-green",
	connecting: "bg-accent-amber",
	disconnected: "bg-content-muted",
};

const WS_DOT_TITLES: Record<WsStatus, string> = {
	connected: "Live reload: connected",
	connecting: "Live reload: reconnecting\u2026",
	disconnected: "Live reload: disconnected",
};

export function Sidebar({
	config,
	mode,
	canEdit,
	onModeChange,
	onNewEvent,
	events,
	treeState,
	effectiveTreeLevels,
	query,
	onQueryChange,
	totalCount: _totalCount,
	showDeprecated,
	onShowDeprecatedChange,
	wsStatus,
	activeView,
	onManageDictionaries,
	onSwitchToEvents,
	baseUrl,
	onExportError,
	onEventSelect,
	selectedEventKey,
}: SidebarProps) {
	const { t } = useT();
	const { title: brandingTitle, logo, accentClasses } = useBranding();
	const [logoError, setLogoError] = useState(false);

	const displayTitle = brandingTitle !== "OpenTP" ? brandingTitle : config.info.title;

	return (
		<aside className="w-56 border-r border-edge-primary flex flex-col bg-surface-primary overflow-hidden">
			{/* Header */}
			<div className="p-4 border-b border-edge-primary">
				<div className="flex items-center gap-2">
					{logo && !logoError && (
						<img
							src={logo}
							alt={displayTitle}
							className="max-h-8 shrink-0"
							onError={() => setLogoError(true)}
						/>
					)}
					<h1 className="text-sm font-semibold text-content-primary truncate">
						{displayTitle}
					</h1>
				</div>
				<p className="text-[11px] text-content-tertiary mt-0.5">
					v{config.info.version}
				</p>
			</div>

			{/* App switcher (hidden when <=1 app) */}
			<AppSwitcher />

			{/* Search */}
			<div className="p-2 border-b border-edge-primary">
				<input
					type="text"
					placeholder={t("common.search")}
					value={query}
					onChange={(e) => onQueryChange(e.target.value)}
					onFocus={() => onSwitchToEvents?.()}
					className="w-full px-2.5 py-1.5 bg-surface-input border border-edge-primary rounded text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:border-edge-secondary"
				/>
			</div>

			{/* Action buttons — only in editor mode */}
			{mode === Modes.EDITOR && (
				<div className="p-2 border-b border-edge-primary space-y-1.5">
					<RoleGate action={Permissions.CREATE_EVENT}>
						<button
							type="button"
							onClick={onNewEvent}
							className={`w-full px-2 py-2 text-xs rounded-lg transition-colors ${
								activeView === "events"
									? `${accentClasses.bgLight} hover:bg-surface-hover border ${accentClasses.border} ${accentClasses.text}`
									: "bg-surface-tertiary hover:bg-surface-hover border border-edge-primary text-content-secondary"
							}`}
						>
							{t("sidebar.newEvent")}
						</button>
					</RoleGate>
					{onManageDictionaries && (
						<RoleGate action={Permissions.MANAGE_DICTS}>
							<button
								type="button"
								onClick={onManageDictionaries}
								className={`w-full px-2 py-2 text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
									activeView === "dictionaries"
										? `${accentClasses.bgLight} hover:bg-surface-hover border ${accentClasses.border} ${accentClasses.text}`
										: "bg-surface-tertiary hover:bg-surface-hover border border-edge-primary text-content-secondary"
								}`}
							>
								<svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
									<path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.331 0 4.473.89 6.074 2.356.092.086.14.13.174.162a.396.396 0 00.504 0c.034-.032.082-.076.174-.162A8.968 8.968 0 0118 18c1.052 0 2.062.18 3 .512V4.262A8.959 8.959 0 0018 3.75a8.967 8.967 0 00-6 2.292z" />
								</svg>
								{t("sidebar.dictionaries")}
							</button>
						</RoleGate>
					)}
				</div>
			)}

			{/* Tree navigation */}
			<nav className="flex-1 min-h-0 overflow-y-auto p-2" onClick={() => onSwitchToEvents?.()}>
				<TreeNav
					events={events}
					taxonomyDefs={config.spec.events.taxonomy}
					treeState={treeState}
					effectiveTreeLevels={effectiveTreeLevels}
					showDeprecated={showDeprecated}
					onEventSelect={onEventSelect}
					selectedEventKey={selectedEventKey}
				/>
			</nav>

			{/* Export panel — only when connected to API */}
			{baseUrl !== undefined && (
				<ExportPanel baseUrl={baseUrl} onError={onExportError} />
			)}

			{/* Footer */}
			<div className="shrink-0 p-3 border-t border-edge-primary space-y-2">
				<UserMenu />
				<label className="flex items-center gap-2 text-[11px] text-content-tertiary cursor-pointer">
					<input
						type="checkbox"
						checked={showDeprecated}
						onChange={(e) => onShowDeprecatedChange(e.target.checked)}
						className="rounded border-edge-secondary bg-surface-input"
					/>
					{t("sidebar.showDeprecated")}
				</label>
				<div className="flex items-center gap-1.5">
					{wsStatus && wsStatus !== "disconnected" && (
						<span
							className={`inline-block w-1.5 h-1.5 rounded-full ${WS_DOT_STYLES[wsStatus]}`}
							title={WS_DOT_TITLES[wsStatus]}
						/>
					)}
					<RoleGate action={Permissions.SWITCH_MODE}>
						<ModeToggle
							mode={mode}
							canEdit={canEdit}
							onModeChange={onModeChange}
						/>
					</RoleGate>
				</div>
				<div className="flex items-center justify-between">
					<LocaleSwitcher />
					<ThemeToggle />
				</div>
			</div>
		</aside>
	);
}
