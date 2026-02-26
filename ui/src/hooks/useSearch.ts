import { useState, useMemo, useCallback } from "react";
import type { TrackingEvent } from "../types";
import { getPayloadSchema } from "../lib/payload";

export interface UseSearchResult {
  query: string;
  setQuery: (q: string) => void;
  showDeprecated: boolean;
  setShowDeprecated: (v: boolean) => void;
  filteredEvents: TrackingEvent[];
  matchedFieldsByKey: Map<string, Set<string>>;
  totalCount: number;
}

export interface UseSearchOptions {
  events: TrackingEvent[];
  /** Selected tree node path (from useTreeState) */
  selectedTreePath: string | null;
  /** Effective tree levels (pre-computed by Layout) */
  treeLevels: string[];
  /** Called when a search query is entered to clear tree selection */
  onClearTreeSelection?: () => void;
}

export function useSearch({
  events,
  selectedTreePath,
  treeLevels,
  onClearTreeSelection,
}: UseSearchOptions): UseSearchResult {
  const [query, setQueryRaw] = useState("");
  const [showDeprecated, setShowDeprecated] = useState(false);

  // Wrap setQuery to clear tree selection when user starts searching
  const setQuery = useCallback(
    (q: string) => {
      setQueryRaw(q);
      if (q.trim() && onClearTreeSelection) {
        onClearTreeSelection();
      }
    },
    [onClearTreeSelection],
  );

  const { filteredEvents, matchedFieldsByKey } = useMemo(() => {
    let result = events;

    // 1. Filter deprecated
    if (!showDeprecated) {
      result = result.filter((e) => e.lifecycle?.status !== "deprecated");
    }

    // 2. Filter by tree selection (uses pre-computed treeLevels directly)
    if (selectedTreePath) {
      const pathParts = selectedTreePath.split("/");

      result = result.filter((event) => {
        for (let i = 0; i < pathParts.length && i < treeLevels.length; i++) {
          const fieldKey = treeLevels[i];
          const value = String(event.taxonomy[fieldKey] ?? "Unknown");
          if (value !== pathParts[i]) return false;
        }
        return true;
      });
    }

    // 3. Search by query — track which field names matched per event
    const matched = new Map<string, Set<string>>();

    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter((e) => {
        if (e.key.toLowerCase().includes(q)) return true;
        const taxValues = Object.values(e.taxonomy)
          .map(String)
          .join(" ")
          .toLowerCase();
        if (taxValues.includes(q)) return true;
        const fieldNames = Object.keys(getPayloadSchema(e.payload));
        const fieldMatches = fieldNames.filter((n) =>
          n.toLowerCase().includes(q),
        );
        if (fieldMatches.length > 0) {
          matched.set(e.key, new Set(fieldMatches));
          return true;
        }
        return false;
      });
    }

    return { filteredEvents: result, matchedFieldsByKey: matched };
  }, [events, query, selectedTreePath, treeLevels, showDeprecated]);

  const totalCount = useMemo(() => {
    if (showDeprecated) return events.length;
    return events.filter((e) => e.lifecycle?.status !== "deprecated").length;
  }, [events, showDeprecated]);

  return {
    query,
    setQuery,
    showDeprecated,
    setShowDeprecated,
    filteredEvents,
    matchedFieldsByKey,
    totalCount,
  };
}
