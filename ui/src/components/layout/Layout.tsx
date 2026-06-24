import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorMode } from "../../hooks/useEditorMode";
import { useEventMutation } from "../../hooks/useEventMutation";
import { useDictionaryMutation } from "../../hooks/useDictionaryMutation";
import { useSearch } from "../../hooks/useSearch";
import { useTreeState } from "../../hooks/useTreeState";
import { buildWsUrl, useWebSocket } from "../../hooks/useWebSocket";
import { useT } from "../../i18n";
import { Modes } from "../../types";
import type { DataSource, UIMode, DictionaryDraft, OpenTPUIOptions, TrackingPlanData } from "../../types";
import { detectTreeLevels } from "../../utils/buildTree";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { DictionaryList } from "../dictionaries/DictionaryList";
import { DictionaryPanel } from "../dictionaries/DictionaryPanel";
import { EditorToolbar } from "../events/EditorToolbar";
import { EventDetail } from "../events/EventDetail";
import { EventList } from "../events/EventList";
import { Sidebar } from "./Sidebar";
import { ToastContainer, useToast } from "../common/Toast";

interface LayoutProps {
	data: TrackingPlanData;
	mode: UIMode;
	source: DataSource;
	onRefetch: () => void;
	options?: OpenTPUIOptions;
}

export function Layout({ data, mode, source, onRefetch, options }: LayoutProps) {
	const { t } = useT();
	const { config, events } = data;
	const [selectedEventKey, setSelectedEventKey] = useState<string | null>(null);
	const [activeView, setActiveView] = useState<"events" | "dictionaries">("events");

	// Dictionary editor state
	const [selectedDictKey, setSelectedDictKey] = useState<string | null>(null);
	const [dictDraft, setDictDraftRaw] = useState<DictionaryDraft | null>(null);
	const dictDraftRef = useRef<DictionaryDraft | null>(null);

	// Sync wrapper: updates the ref immediately (before React re-renders),
	// so handleDictSave always reads the latest draft via dictDraftRef.current
	// even if React 18 batching defers the re-render.
	const setDictDraft = useCallback((value: DictionaryDraft | null) => {
		dictDraftRef.current = value;
		setDictDraftRaw(value);
	}, []);

	// Tree state for hierarchical navigation
	const treeState = useTreeState();

	// Get taxonomy keys from config for tree-based filtering
	const taxonomyKeys = useMemo(
		() => Object.keys(config.spec.events.taxonomy),
		[config.spec.events.taxonomy],
	);

	// Compute effective tree levels: use options.treeLevels override or auto-detect
	const effectiveTreeLevels = useMemo(() => {
		const override = options?.treeLevels;
		if (override && override.length > 0) {
			// Warn about unknown field keys
			for (const key of override) {
				if (!config.spec.events.taxonomy[key]) {
					console.warn(
						`[opentp-ui] treeLevels: unknown taxonomy field "${key}" — ignoring. Valid fields: ${taxonomyKeys.join(", ")}`,
					);
				}
			}
			// Filter to only valid keys
			return override.filter((key) => !!config.spec.events.taxonomy[key]);
		}
		return detectTreeLevels(events, config.spec.events.taxonomy);
	}, [options?.treeLevels, events, config.spec.events.taxonomy, taxonomyKeys]);

	const clearTreeSelection = useCallback(() => treeState.select(null), [treeState]);

	const search = useSearch({
		events,
		selectedTreePath: treeState.selectedPath,
		treeLevels: effectiveTreeLevels,
		onClearTreeSelection: clearTreeSelection,
	});

	const editor = useEditorMode(mode, source);
	const baseUrl = source.type === "api" ? source.baseUrl : "";
	const mutation = useEventMutation(baseUrl);
	const dictMutation = useDictionaryMutation(baseUrl);

	const wsUrl = source.type === "api" ? buildWsUrl() : null;
	const ws = useWebSocket({
		url: wsUrl,
		onMessage: useCallback(() => onRefetch(), [onRefetch]),
	});

	const { messages: toastMessages, addToast, dismissToast } = useToast();

	// Confirm dialog state
	const [confirmOpen, setConfirmOpen] = useState(false);
	const pendingAction = useRef<(() => void) | null>(null);

	// Delete confirm state (shared for events and dictionaries)
	const [deleteTarget, setDeleteTarget] = useState<{ type: "event" | "dict"; key: string } | null>(null);

	const selectedEvent = selectedEventKey
		? (events.find((e) => e.key === selectedEventKey) ?? null)
		: null;

	// When switching to editor mode with an event already selected, create the draft
	useEffect(() => {
		if (editor.mode === Modes.EDITOR && selectedEvent && !editor.draft) {
			editor.editEvent(selectedEvent);
		}
	}, [editor.mode]); // eslint-disable-line react-hooks/exhaustive-deps

	const listExpanded = activeView === "events"
		? !selectedEvent && !(editor.mode === Modes.EDITOR && editor.draft)
		: !selectedDictKey && !dictDraft;

	/** Run an action, guarding with confirm dialog if draft is dirty */
	const guardDirty = useCallback(
		(action: () => void) => {
			const isDirty = editor.draft?.isDirty || dictDraft?.isDirty;
			if (isDirty) {
				pendingAction.current = action;
				setConfirmOpen(true);
			} else {
				action();
			}
		},
		[editor.draft?.isDirty, dictDraft?.isDirty],
	);

	const handleConfirm = useCallback(() => {
		setConfirmOpen(false);
		pendingAction.current?.();
		pendingAction.current = null;
	}, []);

	const handleCancelConfirm = useCallback(() => {
		setConfirmOpen(false);
		pendingAction.current = null;
	}, []);

	// ── Event handlers ───────────────────────────────────────

	const handleSelectEvent = useCallback(
		(key: string) => {
			// Toggle: clicking the already-selected event deselects it
			if (key === selectedEventKey && !(editor.mode === Modes.EDITOR && editor.draft?.isDirty)) {
				setSelectedEventKey(null);
				editor.discardDraft();
				mutation.clearValidation();
				mutation.clearError();
				return;
			}

			const doSelect = () => {
				setActiveView("events");
				setSelectedEventKey(key);
				setSelectedDictKey(null);
				setDictDraft(null);
				mutation.clearValidation();
				mutation.clearError();
				if (editor.mode === Modes.EDITOR) {
					const event = events.find((e) => e.key === key);
					if (event) editor.editEvent(event);
				}
			};

			if (editor.mode === Modes.EDITOR && editor.draft?.isDirty) {
				guardDirty(doSelect);
			} else {
				doSelect();
			}
		},
		[editor, events, guardDirty, selectedEventKey, mutation],
	);

	const handleCloseDetail = useCallback(() => {
		guardDirty(() => {
			setSelectedEventKey(null);
			setSelectedDictKey(null);
			setDictDraft(null);
			editor.discardDraft();
			dictMutation.clearError();
		});
	}, [editor, dictMutation, guardDirty]);

	const handleSave = useCallback(async () => {
		if (!editor.draft) return;
		const draftKey = editor.draft.key;
		const result = await mutation.save(editor.draft);
		if (result) {
			addToast("success", t("toast.saved", { key: draftKey }));
			const savedKey = result.key;
			editor.markSaved(savedKey);
			setSelectedEventKey(savedKey);
			onRefetch();
		} else {
			addToast("error", mutation.error ?? t("toast.saveFailed"));
		}
	}, [editor, mutation, onRefetch, addToast, t]);

	const handleValidate = useCallback(async () => {
		if (!editor.draft?.key) return;
		await mutation.validate(editor.draft);
	}, [editor.draft, mutation]);

	const handleDownload = useCallback(() => {
		if (!editor.draft) return;
		mutation.download(editor.draft);
	}, [editor.draft, mutation]);

	const handleDiscard = useCallback(() => {
		guardDirty(() => editor.discardDraft());
	}, [editor, guardDirty]);

	const handleNewEvent = useCallback(() => {
		guardDirty(() => {
			setActiveView("events");
			editor.newEvent(config.spec.events.payload?.schema);
			mutation.clearValidation();
			mutation.clearError();
			setSelectedEventKey(null);
			setSelectedDictKey(null);
			setDictDraft(null);
		});
	}, [editor, guardDirty, config.spec.events.payload?.schema, mutation]);

	// ── Dictionary handlers ──────────────────────────────────

	const handleSwitchToEvents = useCallback(() => {
		if (activeView !== "events") {
			setActiveView("events");
		}
	}, [activeView]);

	const handleManageDictionaries = useCallback(() => {
		guardDirty(() => {
			setActiveView("dictionaries");
			setSelectedEventKey(null);
			setSelectedDictKey(null);
			setDictDraft(null);
			editor.discardDraft();
		});
	}, [editor, guardDirty]);

	const handleSelectDict = useCallback(
		(key: string) => {
			const doSelect = () => {
				setSelectedDictKey(key);
				const meta = data.dictionaryMeta[key];
				if (meta) {
					setDictDraft({
						originalKey: key,
						key,
						type: meta.type,
						values: [...meta.values],
						isDirty: false,
					});
				}
			};

			if (dictDraft?.isDirty) {
				guardDirty(doSelect);
			} else {
				doSelect();
			}
		},
		[data.dictionaryMeta, dictDraft?.isDirty, guardDirty],
	);

	const handleNewDict = useCallback(() => {
		guardDirty(() => {
			setSelectedDictKey(null);
			setDictDraft({
				originalKey: null,
				key: "",
				type: "string",
				values: [],
				isDirty: false,
			});
		});
	}, [guardDirty]);

	const handleDictSave = useCallback(async () => {
		const currentDraft = dictDraftRef.current;
		if (!currentDraft) return;
		const result = await dictMutation.save(currentDraft);
		if (result) {
			const savedKey = result.key;
			addToast("success", t("toast.dictSaved", { key: savedKey }));
			setSelectedDictKey(savedKey);
			setDictDraft(
				dictDraftRef.current
					? { ...dictDraftRef.current, originalKey: savedKey, key: savedKey, isDirty: false }
					: null,
			);
			onRefetch();
		} else {
			addToast("error", dictMutation.error ?? t("toast.saveFailed"));
		}
	}, [dictMutation, addToast, onRefetch, t]);

	const handleDictDiscard = useCallback(() => {
		guardDirty(() => {
			setDictDraft(null);
			setSelectedDictKey(null);
			dictMutation.clearError();
		});
	}, [dictMutation, guardDirty]);

	const handleDictValueUpdated = useCallback(() => {
		onRefetch();
	}, [onRefetch]);

	const handleDictDelete = useCallback((key: string) => {
		setDeleteTarget({ type: "dict", key });
	}, []);

	const handleEventDelete = useCallback(() => {
		if (!editor.draft?.originalKey) return;
		setDeleteTarget({ type: "event", key: editor.draft.originalKey });
	}, [editor.draft?.originalKey]);

	const handleDeleteConfirm = useCallback(async () => {
		if (!deleteTarget) return;
		const { type, key } = deleteTarget;
		setDeleteTarget(null);

		if (type === "event") {
			const result = await mutation.remove(key);
			if (result) {
				addToast("success", t("toast.eventDeleted", { key }));
				editor.discardDraft();
				setSelectedEventKey(null);
				onRefetch();
			}
		} else {
			const result = await dictMutation.remove(key);
			if (result) {
				addToast("success", t("toast.dictDeleted", { key }));
				if (dictDraft?.originalKey === key) {
					setDictDraft(null);
					setSelectedDictKey(null);
				}
				onRefetch();
			}
		}
	}, [deleteTarget, mutation, dictMutation, addToast, dictDraft, editor, onRefetch, t]);

	// Keyboard shortcut: Cmd/Ctrl+S to save
	// Uses a ref to always call the latest save handler without re-subscribing
	// the event listener on every state change (avoids stale closure race condition).
	const keyboardSaveRef = useRef<() => void>();
	keyboardSaveRef.current = () => {
		if (activeView === "dictionaries" && dictDraft?.isDirty) {
			handleDictSave();
		} else if (editor.draft?.isDirty) {
			handleSave();
		}
	};

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "s") {
				e.preventDefault();
				keyboardSaveRef.current?.();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const showDetailPanel = activeView === "events"
		? selectedEvent || (editor.mode === Modes.EDITOR && editor.draft)
		: dictDraft;

	return (
		<div className="flex justify-center h-full bg-surface-primary text-content-primary">
		<div className="flex w-full max-w-[1440px] h-full border-x border-edge-primary">
			<Sidebar
				config={config}
				mode={editor.mode}
				canEdit={editor.canEdit}
				onModeChange={editor.setMode}
				onNewEvent={handleNewEvent}
				events={events}
				treeState={treeState}
				effectiveTreeLevels={effectiveTreeLevels}
				query={search.query}
				onQueryChange={search.setQuery}
				totalCount={search.totalCount}
				showDeprecated={search.showDeprecated}
				onShowDeprecatedChange={search.setShowDeprecated}
				wsStatus={wsUrl ? ws.status : undefined}
				activeView={activeView}
				onManageDictionaries={handleManageDictionaries}
				onSwitchToEvents={handleSwitchToEvents}
				baseUrl={source.type === "api" ? source.baseUrl : undefined}
				onExportError={(msg) => addToast("error", msg)}
				onEventSelect={handleSelectEvent}
				selectedEventKey={selectedEventKey}
			/>

			{/* List panel (middle) */}
			<div
				className={`border-r border-edge-primary ${
					listExpanded ? "w-full max-w-2xl" : "w-80"
				}`}
			>
				{activeView === "dictionaries" ? (
					<DictionaryList
						dictionaryMeta={data.dictionaryMeta}
						selectedKey={selectedDictKey}
						onSelect={handleSelectDict}
						onNew={handleNewDict}
						onDelete={handleDictDelete}
						expanded={listExpanded}
					/>
				) : (
					<EventList
						events={search.filteredEvents}
						selectedKey={selectedEventKey}
						onSelect={handleSelectEvent}
						expanded={listExpanded}
						matchedFieldsByKey={search.matchedFieldsByKey}
					/>
				)}
			</div>

			{/* Detail panel (right) */}
			<main className="flex-1 flex flex-col">
				{activeView === "dictionaries" ? (
					<>
						{showDetailPanel && (
							<div className="flex items-center justify-end px-4 pt-3">
								<button
									onClick={handleCloseDetail}
									className="p-1 text-content-tertiary hover:text-content-secondary transition-colors"
									aria-label={t("common.closePanel")}
								>
									<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
										<path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</div>
						)}
						<div className="flex-1 overflow-hidden">
							<DictionaryPanel
								draft={dictDraft}
								mutation={dictMutation}
								onSave={handleDictSave}
								onDiscard={handleDictDiscard}
								onDraftChange={setDictDraft}
							/>
						</div>
					</>
				) : (
					<>
						{(selectedEvent || (editor.mode === Modes.EDITOR && editor.draft)) && (
							<div className="flex items-center justify-end px-4 pt-3">
								<button
									onClick={handleCloseDetail}
									className="p-1 text-content-tertiary hover:text-content-secondary transition-colors"
									aria-label={t("common.closePanel")}
								>
									<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
										<path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</div>
						)}
						{editor.mode === Modes.EDITOR && editor.draft && (
							<EditorToolbar
								draft={editor.draft}
								saving={mutation.saving}
								validating={mutation.validating}
								error={mutation.error}
								validationResult={mutation.validationResult}
								onSave={handleSave}
								onDownload={handleDownload}
								onValidate={handleValidate}
								onDiscard={handleDiscard}
								onDelete={handleEventDelete}
								onClearError={mutation.clearError}
							/>
						)}
						<div className="flex-1 overflow-y-auto">
							{selectedEvent || (editor.mode === Modes.EDITOR && editor.draft) ? (
								<EventDetail
									event={
										selectedEvent ?? {
											key: editor.draft?.key ?? "",
											relativePath: "",
											taxonomy: editor.draft?.taxonomy ?? {},
											payload: editor.draft?.payload,
										}
									}
									mode={editor.mode}
									draft={editor.draft}
									config={config}
									dictionaries={data.dictionaries}
									onDraftChange={editor.updateDraft}
									dictionaryMeta={data.dictionaryMeta}
									baseUrl={source.type === "api" ? source.baseUrl : null}
									onDictUpdated={handleDictValueUpdated}
									addToast={addToast}
								/>
							) : (
								<div className="flex items-center justify-center h-full text-content-tertiary text-sm">
									{t("eventList.selectEvent")}
								</div>
							)}
						</div>
					</>
				)}
			</main>
		</div>

			{/* Toast notifications */}
			<ToastContainer messages={toastMessages} onDismiss={dismissToast} />

			{/* Confirm dialog for unsaved changes */}
			<ConfirmDialog
				open={confirmOpen}
				title={t("confirm.discardTitle")}
				message={t("confirm.discardMessage")}
				confirmLabel={t("confirm.discardConfirm")}
				cancelLabel={t("confirm.discardCancel")}
				danger
				onConfirm={handleConfirm}
				onCancel={handleCancelConfirm}
			/>

			{/* Confirm dialog for event/dictionary deletion */}
			<ConfirmDialog
				open={deleteTarget !== null}
				title={t(deleteTarget?.type === "event" ? "confirm.deleteEventTitle" : "confirm.deleteTitle")}
				message={t(
					deleteTarget?.type === "event" ? "confirm.deleteEventMessage" : "confirm.deleteMessage",
					{ key: deleteTarget?.key ?? "" },
				)}
				confirmLabel={t("confirm.deleteConfirm")}
				cancelLabel={t("confirm.deleteCancel")}
				danger
				onConfirm={handleDeleteConfirm}
				onCancel={() => setDeleteTarget(null)}
			/>
		</div>
	);
}
