import type { ReactNode } from "react";
import { useT } from "../../i18n";
import type { TreeNode as TreeNodeType } from "../../utils/buildTree";
import { getAreaBadgeClasses } from "../../utils/areaColors";

interface TreeNodeProps {
	node: TreeNodeType;
	isExpanded: boolean;
	isSelected: boolean;
	onToggle: (path: string) => void;
	onSelect: (path: string) => void;
	/** Called when a leaf event is clicked */
	onEventSelect?: (eventKey: string) => void;
	/** Currently selected event key (for highlight) */
	selectedEventKey?: string | null;
	/** Render children recursively */
	renderChildren: (children: TreeNodeType[]) => ReactNode;
}

export function TreeNodeItem({
	node,
	isExpanded,
	isSelected,
	onToggle,
	onSelect,
	onEventSelect,
	selectedEventKey,
	renderChildren,
}: TreeNodeProps) {
	const { t } = useT();
	const hasChildren = node.children.length > 0 || node.events.length > 0;
	const indent = node.depth * 16; // px per level
	const isUnknownNode = node.label === "Unknown";

	return (
		<div>
			<div
				className={`flex items-center gap-1.5 py-1.5 pr-2 cursor-pointer rounded transition-colors ${
					isSelected
						? "bg-surface-active text-content-primary"
						: "text-content-secondary hover:text-content-primary hover:bg-surface-hover"
				}`}
				style={{ paddingLeft: `${8 + indent}px` }}
				onClick={() => {
					onSelect(node.path);
					if (hasChildren && !isExpanded) onToggle(node.path);
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onSelect(node.path);
						if (hasChildren && !isExpanded) onToggle(node.path);
					}
				}}
				role="button"
				tabIndex={0}
			>
				{/* Expand/collapse arrow */}
				{hasChildren && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onToggle(node.path);
						}}
						className="w-4 h-4 flex items-center justify-center text-content-muted hover:text-content-secondary shrink-0 cursor-pointer"
						aria-label={isExpanded ? t("tree.collapse") : t("tree.expand")}
					>
						<span
							className={`text-[10px] transition-transform duration-150 ${
								isExpanded ? "rotate-90" : ""
							}`}
						>
							▶
						</span>
					</button>
				)}

				{/* Spacer if no children (leaf alignment) */}
				{!hasChildren && <span className="w-4 shrink-0" />}

				{/* Label */}
				{node.depth === 0 ? (
					// Area node - show colored badge
					<span
						className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${getAreaBadgeClasses(node.label)}`}
					>
						{node.label}
					</span>
				) : (
					// Non-area node - normal text
					<span className={`text-xs truncate flex-1 font-normal ${isUnknownNode ? "italic opacity-60" : ""}`}>
						{node.label}
					</span>
				)}

				{/* Event count */}
				<span className="text-[10px] text-content-muted shrink-0 tabular-nums">
					{node.eventCount}
				</span>
			</div>

			{/* Children */}
			{isExpanded && hasChildren && (
				<div>
					{node.children.length > 0 && renderChildren(node.children)}

					{/* Leaf events (at the deepest level) */}
					{node.events.length > 0 &&
						node.events.map((event) => {
							const eventName = event.key.split("::").pop() ?? event.key;
							const isActive = selectedEventKey === event.key;
							return (
								<div
									key={event.key}
									className={`flex items-center gap-1.5 py-1 pr-2 cursor-pointer rounded ${
										isActive
											? "bg-surface-active text-content-primary"
											: "text-content-tertiary hover:text-content-secondary hover:bg-surface-hover"
									}`}
									style={{ paddingLeft: `${8 + (node.depth + 1) * 16}px` }}
									onClick={(e) => {
										e.stopPropagation();
										onEventSelect?.(event.key);
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											onEventSelect?.(event.key);
										}
									}}
									role="button"
									tabIndex={0}
								>
									<span className="w-4 shrink-0" />
									<span className="text-xs truncate flex-1">{eventName}</span>
								</div>
							);
						})}
				</div>
			)}
		</div>
	);
}
