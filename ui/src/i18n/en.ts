export const en = {
	// Common
	"common.save": "Save",
	"common.create": "Create",
	"common.cancel": "Cancel",
	"common.discard": "Discard",
	"common.download": "Download",
	"common.validate": "Validate",
	"common.copy": "Copy",
	"common.copied": "Copied!",
	"common.retry": "Retry",
	"common.search": "Search events...",
	"common.loading": "Loading tracking plan...",
	"common.saving": "Saving...",
	"common.validating": "Validating...",

	// Sidebar
	"sidebar.allEvents": "All events",
	"sidebar.showDeprecated": "Show deprecated",
	"sidebar.newEvent": "+ New Event",
	"sidebar.dictionaries": "Dictionaries",

	// Mode
	"mode.viewer": "Viewer",
	"mode.editor": "Editor",
	"mode.editorRequiresApi": "Editor requires API connection",

	// Event list
	"eventList.noResults": "No events found",
	"eventList.noResultsHint": "Try adjusting your search or filters",
	"eventList.events": "events",
	"eventList.event": "event",
	"eventList.params": "params",
	"eventList.constants": "constants",
	"eventList.selectEvent": "Select an event to view details",
	"eventList.more": "+{count} more",

	// Event detail (viewer)
	"detail.taxonomy": "Taxonomy",
	"detail.parameters": "Parameters",
	"detail.constants": "Constants",
	"detail.constantsHint": "auto-injected, not passed by developer",
	"detail.sdkUsage": "SDK Usage",
	"detail.issues": "Issues",
	"detail.copyKey": "Copy key",
	"detail.required": "required",
	"detail.optional": "optional",
	"detail.requiredCount": "{required} required, {optional} optional",
	"detail.noPayload": "No payload fields defined",

	// Editor
	"editor.newEvent": "New Event",
	"editor.editing": "Editing",
	"editor.unsavedChanges": "Unsaved changes",
	"editor.formTab": "Form",
	"editor.yamlTab": "YAML",
	"editor.copyYaml": "Copy YAML",
	"editor.dismiss": "Dismiss",

	// Editor form
	"form.eventKey": "Event Key",
	"form.eventKeyHint": "Fill taxonomy fields to generate key",
	"form.taxonomy": "Taxonomy",
	"form.lifecycle": "Lifecycle",
	"form.payloadFields": "Payload Fields",
	"form.addField": "+ Add Field",
	"form.fields": "fields",
	"form.baseFieldHint":
		'Fields marked "base" are inherited from the tracking plan base schema and cannot be removed.',

	// Field editor
	"field.name": "Field Name",
	"field.nameHint": "snake_case, used as payload key",
	"field.description": "Description",
	"field.descriptionPlaceholder": "What this field represents",
	"field.type": "Type",
	"field.required": "Required",
	"field.requiredInPayload": "Required in payload",
	"field.constant":
		"Constant value (auto-injected, not passed by developer)",
	"field.value": "Value",
	"field.valuePlaceholder": "Fixed value",
	"field.dictionary": "Dictionary",
	"field.dictionaryHint": "Link to a shared dictionary for enum values",
	"field.noDictionary": "No dictionary",
	"field.enumValues": "Allowed Values (Enum)",
	"field.enumHint": "Leave empty to accept any value of the type",
	"field.enumInputPlaceholder": "Type value and press Enter",
	"field.enumAdd": "Add",
	"field.enumSuggestions": "Suggestions from dictionary:",
	"field.removeField": "Remove field",
	"field.arrayItemType": "Array Item Type",

	// PII
	"pii.label": "Contains PII (Personal Data)",
	"pii.kind": "PII Kind",
	"pii.masker": "Masking Strategy",

	// Lifecycle statuses
	"status.active": "active",
	"status.draft": "draft",
	"status.deprecated": "deprecated",
	"lifecycle.draft": "Draft — Work in progress, not yet in production",
	"lifecycle.active": "Active — In production, tracked and validated",
	"lifecycle.deprecated": "Deprecated — Being phased out, will be removed",

	// Confirm dialogs
	"confirm.discardTitle": "Unsaved changes",
	"confirm.discardMessage":
		"You have unsaved changes. Discard them and continue?",
	"confirm.discardConfirm": "Discard",
	"confirm.discardCancel": "Keep editing",
	"confirm.deleteEventTitle": "Delete event",
	"confirm.deleteEventMessage":
		'Delete "{key}"? This will remove the YAML file. This cannot be undone.',
	"confirm.deleteTitle": "Delete dictionary",
	"confirm.deleteMessage":
		'Delete "{key}"? This cannot be undone. Any events referencing this dictionary will have dangling dict references.',
	"confirm.deleteCancel": "Cancel",
	"confirm.deleteConfirm": "Delete",

	// Toasts
	"toast.saved": "Event saved: {key}",
	"toast.created": "Event created: {key}",
	"toast.saveFailed": "Save failed",
	"toast.validationPassed": "Validation passed",
	"toast.validationFailed": "Validation failed: {count} errors",
	"toast.eventDeleted": "Event deleted: {key}",
	"toast.dictSaved": "Dictionary saved: {key}",
	"toast.dictDeleted": "Dictionary deleted: {key}",

	// Dictionary list
	"dict.new": "+ New",
	"dict.empty": "No dictionaries",
	"dict.emptyHint": "Create a dictionary to define reusable value lists",
	"dict.deleteTooltip": "Delete dictionary",
	"dict.selectHint": "Select a dictionary to edit or create a new one",
	"dict.newDict": "New Dictionary",
	"dict.editingDict": "Editing: {key}",

	// Export
	"export.loading": "Loading generators...",
	"export.title": "Export",
	"export.bundle": "Export Bundle",
	"export.downloading": "Downloading...",

	// Footer / meta
	"meta.file": "File:",
	"meta.target": "Target:",
	"meta.values": "values",

	// Validation result
	"validation.passed": "Validation passed",
	"validation.errors": "{errors} error{errorPlural}, {warnings} warning{warningPlural}",
	"validation.errorPrefix": "\u2716",
	"validation.warningPrefix": "\u26A0",

	// Dictionary editor
	"dictEditor.keyRequired": "Key is required",
	"dictEditor.keyNoSlashPrefix": "Key must not start with '/'",
	"dictEditor.keyNoDotDot": "Key must not contain '..'",
	"dictEditor.keyLabel": "Key",
	"dictEditor.keyHint":
		"Path-based key, e.g. taxonomy/areas or governance/statuses",
	"dictEditor.keyPlaceholder": "e.g. taxonomy/areas",
	"dictEditor.valueType": "Value Type",
	"dictEditor.values": "Values",
	"dictEditor.valuesHint": "Type a value and press Enter to add it",

	// Tree navigation
	"tree.navigation": "Navigation ({count})",
	"tree.collapse": "Collapse",
	"tree.expand": "Expand",

	// Field extras
	"field.const": "const",
	"field.dictionaryTooltip": "Dictionary: {key}",
	"field.dictBadge": "dict",
	"field.baseBadge": "base",

	// Form extras
	"form.status": "Status",
	"form.noFieldsHint":
		'No fields yet. Click "Add Field" to start defining the payload.',
	"form.enterField": "Enter {field}",
	"form.addCustomValue": "Add custom value",
	"form.noneSelected": "— not selected —",
	"form.keyComplete": "Key is complete",

	// Dict count
	"dict.countLabel": "{count} dictionaries",

	// PII extras
	"pii.badge": "PII",
	"pii.badgeTooltip": "PII: {kind}",
	"pii.badgeTooltipMasker": "PII: {kind} (masker: {masker})",

	// Theme
	"theme.switchToLight": "Switch to light theme",
	"theme.switchToDark": "Switch to dark theme",

	// Common extras
	"common.delete": "Delete",
	"common.closePanel": "Close detail panel",
	"common.closeDialog": "Close dialog",
	"common.confirm": "Confirm",

	// PII editor labels
	"pii.maskerNone": "None",
	"pii.maskerStar": "Star (****)",
	"pii.maskerHash": "Hash (SHA-256)",
	"pii.maskerRedact": "Redact (remove)",
	"pii.kindUserId": "User ID",
	"pii.kindEmail": "Email",
	"pii.kindPhone": "Phone",
	"pii.kindName": "Name",
	"pii.kindAddress": "Address",
	"pii.kindIpAddress": "IP Address",
	"pii.kindDeviceId": "Device ID",
	"pii.kindOther": "Other",

	// Export labels
	"export.generatorTsSdk": "TypeScript SDK",
	"export.generatorSwiftSdk": "Swift SDK",
	"export.generatorKotlinSdk": "Kotlin SDK",
	"export.generatorJson": "JSON",
	"export.generatorYaml": "YAML",
	"export.generatorTemplate": "Template",
	"export.targetWeb": "Web",
	"export.targetIos": "iOS",
	"export.targetAndroid": "Android",

	// Field type labels
	"fieldType.string": "String",
	"fieldType.number": "Number",
	"fieldType.integer": "Integer",
	"fieldType.boolean": "Boolean",
	"fieldType.array": "Array",

	// Inline dictionary value manager
	"dictInline.manage": "Manage values",
	"dictInline.addValue": "Add",
	"dictInline.addPlaceholder": "New value...",
	"dictInline.rename": "Rename",
	"dictInline.delete": "Remove",
	"dictInline.save": "Save",
	"dictInline.cancel": "Cancel",
	"dictInline.confirmDeleteTitle": "Remove dictionary value",
	"dictInline.confirmDeleteMessage": "Remove \"{value}\" from \"{dict}\"? Events using this value will keep it but it won't appear in dropdowns.",
	"dictInline.valueExists": "Value already exists",
	"dictInline.valueEmpty": "Value cannot be empty",
	"dictInline.saved": "Dictionary updated",
	"dictInline.saveFailed": "Failed to update dictionary",

	// Platform
	"platform.roles.viewer": "Viewer",
	"platform.roles.editor": "Editor",
	"platform.roles.admin": "Admin",
	"platform.user.logout": "Log out",
	"platform.app.switchApp": "Switch app",
	"platform.app.noApps": "No apps",
	"platform.error.title": "Something went wrong",
	"platform.error.retry": "Retry",
} as const;

export type TranslationKey = keyof typeof en;
