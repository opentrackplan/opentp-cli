import { useState, useCallback } from "react";

export interface UseTreeStateResult {
	/** Set of expanded node paths */
	expanded: Set<string>;
	/** Toggle a node's expanded state */
	toggle: (path: string) => void;
	/** Expand a specific node */
	expand: (path: string) => void;
	/** Collapse a specific node */
	collapse: (path: string) => void;
	/** Expand all nodes */
	expandAll: (paths: string[]) => void;
	/** Collapse all nodes */
	collapseAll: () => void;

	/** Currently selected node path (for filtering) */
	selectedPath: string | null;
	/** Select a node (filters event list to this subtree) */
	select: (path: string | null) => void;
}

export function useTreeState(): UseTreeStateResult {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [selectedPath, setSelectedPath] = useState<string | null>(null);

	const toggle = useCallback((path: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	const expand = useCallback((path: string) => {
		setExpanded((prev) => new Set(prev).add(path));
	}, []);

	const collapse = useCallback((path: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			next.delete(path);
			return next;
		});
	}, []);

	const expandAll = useCallback((paths: string[]) => {
		setExpanded(new Set(paths));
	}, []);

	const collapseAll = useCallback(() => {
		setExpanded(new Set());
	}, []);

	const select = useCallback((path: string | null) => {
		setSelectedPath((prev) => (prev === path ? null : path)); // toggle off if same
	}, []);

	return {
		expanded,
		toggle,
		expand,
		collapse,
		expandAll,
		collapseAll,
		selectedPath,
		select,
	};
}
