import { useMemo } from "react";
import { useT } from "../../i18n";
import type { TrackingEvent, TaxonomyField } from "../../types";
import type { UseTreeStateResult } from "../../hooks/useTreeState";
import { buildTree, type TreeNode } from "../../utils/buildTree";
import { TreeNodeItem } from "./TreeNode";

interface TreeNavProps {
	events: TrackingEvent[];
	taxonomyDefs: Record<string, TaxonomyField>;
	treeState: UseTreeStateResult;
	effectiveTreeLevels: string[];
	showDeprecated: boolean;
	/** Called when a leaf event node is clicked */
	onEventSelect?: (eventKey: string) => void;
	/** Currently selected event key (for highlight) */
	selectedEventKey?: string | null;
}

export function TreeNav({
	events,
	taxonomyDefs,
	treeState,
	effectiveTreeLevels,
	showDeprecated,
	onEventSelect,
	selectedEventKey,
}: TreeNavProps) {
	const { t } = useT();
	// Filter deprecated before building tree
	const filteredEvents = useMemo(() => {
		if (showDeprecated) return events;
		return events.filter((e) => e.lifecycle?.status !== "deprecated");
	}, [events, showDeprecated]);

	// Build tree from events + taxonomy config, using pre-computed levels
	const tree = useMemo(
		() => buildTree(filteredEvents, taxonomyDefs, effectiveTreeLevels),
		[filteredEvents, taxonomyDefs, effectiveTreeLevels],
	);

	// If no effective levels, fall back to flat list
	if (effectiveTreeLevels.length === 0) {
		return (
			<div className="p-2 text-xs text-content-muted">
				{filteredEvents.length} {t("eventList.events")}
			</div>
		);
	}

	// "All events" button
	const totalCount = filteredEvents.length;

	// Collect all node paths for "expand all"
	const allPaths = useMemo(() => {
		const paths: string[] = [];
		function collect(nodes: TreeNode[]) {
			for (const node of nodes) {
				paths.push(node.path);
				collect(node.children);
			}
		}
		collect(tree);
		return paths;
	}, [tree]);

	// Recursive renderer
	function renderNodes(nodes: TreeNode[]) {
		return nodes.map((node) => (
			<TreeNodeItem
				key={node.path}
				node={node}
				isExpanded={treeState.expanded.has(node.path)}
				isSelected={treeState.selectedPath === node.path}
				onToggle={treeState.toggle}
				onSelect={treeState.select}
				onEventSelect={onEventSelect}
				selectedEventKey={selectedEventKey}
				renderChildren={renderNodes}
			/>
		));
	}

	return (
		<div>
			{/* Header with expand/collapse all */}
			<div className="flex items-center justify-between px-2 py-1.5">
				<span className="text-[10px] text-content-muted uppercase tracking-wider font-medium">
					{t("tree.navigation", { count: totalCount })}
				</span>
				<button
					type="button"
					onClick={() => {
						if (treeState.expanded.size > 0) {
							treeState.collapseAll();
						} else {
							treeState.expandAll(allPaths);
						}
					}}
					className="text-[10px] text-content-muted hover:text-content-secondary cursor-pointer"
				>
					{treeState.expanded.size > 0 ? t("tree.collapse") : t("tree.expand")}
				</button>
			</div>

			{/* "All events" option */}
			<div
				onClick={() => treeState.select(null)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						treeState.select(null);
					}
				}}
				className={`flex items-center gap-1.5 py-1.5 px-2 cursor-pointer rounded transition-colors ${
					treeState.selectedPath === null
						? "bg-surface-active text-content-primary"
						: "text-content-secondary hover:text-content-primary hover:bg-surface-hover"
				}`}
				role="button"
				tabIndex={0}
			>
				<span className="text-xs font-medium">{t("sidebar.allEvents")}</span>
				<span className="text-[10px] text-content-muted ml-auto tabular-nums">
					{totalCount}
				</span>
			</div>

			{/* Tree */}
			<div className="mt-1">{renderNodes(tree)}</div>
		</div>
	);
}
