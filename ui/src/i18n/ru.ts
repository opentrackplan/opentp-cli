import type { TranslationKey } from "./en";

export const ru: Record<TranslationKey, string> = {
	// Common
	"common.save": "Сохранить",
	"common.create": "Создать",
	"common.cancel": "Отмена",
	"common.discard": "Отменить",
	"common.download": "Скачать",
	"common.validate": "Проверить",
	"common.copy": "Копировать",
	"common.copied": "Скопировано!",
	"common.retry": "Повторить",
	"common.search": "Поиск событий...",
	"common.loading": "Загрузка плана отслеживания...",
	"common.saving": "Сохранение...",
	"common.validating": "Проверка...",

	// Sidebar
	"sidebar.allEvents": "Все события",
	"sidebar.showDeprecated": "Показать устаревшие",
	"sidebar.newEvent": "+ Новое событие",
	"sidebar.dictionaries": "Словари",

	// Mode
	"mode.viewer": "Просмотр",
	"mode.editor": "Редактор",
	"mode.editorRequiresApi": "Редактор требует подключения к API",

	// Event list
	"eventList.noResults": "Нет событий",
	"eventList.noResultsHint": "Попробуйте изменить поиск или фильтры",
	"eventList.events": "событий",
	"eventList.event": "событие",
	"eventList.params": "параметров",
	"eventList.constants": "констант",
	"eventList.selectEvent": "Выберите событие для просмотра",
	"eventList.more": "+{count} ещё",

	// Event detail (viewer)
	"detail.taxonomy": "Таксономия",
	"detail.parameters": "Параметры",
	"detail.constants": "Константы",
	"detail.constantsHint": "добавляются автоматически, не передаются разработчиком",
	"detail.sdkUsage": "Использование SDK",
	"detail.issues": "Проблемы",
	"detail.copyKey": "Копировать ключ",
	"detail.required": "обязательное",
	"detail.optional": "необязательное",
	"detail.requiredCount": "{required} обязательных, {optional} необязательных",
	"detail.noPayload": "Нет полей данных",

	// Editor
	"editor.newEvent": "Новое событие",
	"editor.editing": "Редактирование",
	"editor.unsavedChanges": "Несохранённые изменения",
	"editor.formTab": "Форма",
	"editor.yamlTab": "YAML",
	"editor.copyYaml": "Копировать YAML",
	"editor.dismiss": "Скрыть",

	// Editor form
	"form.eventKey": "Ключ события",
	"form.eventKeyHint": "Заполните поля таксономии для генерации ключа",
	"form.taxonomy": "Таксономия",
	"form.lifecycle": "Жизненный цикл",
	"form.payloadFields": "Поля данных",
	"form.addField": "+ Добавить поле",
	"form.fields": "полей",
	"form.baseFieldHint":
		'Поля с меткой "base" наследуются из базовой схемы и не могут быть удалены.',

	// Field editor
	"field.name": "Имя поля",
	"field.nameHint": "snake_case, используется как ключ в данных",
	"field.description": "Описание",
	"field.descriptionPlaceholder": "Что означает это поле",
	"field.type": "Тип",
	"field.required": "Обязательное",
	"field.requiredInPayload": "Обязательное в данных",
	"field.constant":
		"Константа (добавляется автоматически, не передаётся разработчиком)",
	"field.value": "Значение",
	"field.valuePlaceholder": "Фиксированное значение",
	"field.dictionary": "Словарь",
	"field.dictionaryHint": "Привязать к общему словарю значений",
	"field.noDictionary": "Без словаря",
	"field.enumValues": "Допустимые значения (Enum)",
	"field.enumHint": "Оставьте пустым для принятия любых значений этого типа",
	"field.enumInputPlaceholder": "Введите значение и нажмите Enter",
	"field.enumAdd": "Добавить",
	"field.enumSuggestions": "Предложения из словаря:",
	"field.removeField": "Удалить поле",
	"field.arrayItemType": "Тип элемента массива",

	// PII
	"pii.label": "Содержит персональные данные (PII)",
	"pii.kind": "Тип PII",
	"pii.masker": "Способ маскирования",

	// Lifecycle statuses
	"status.active": "активный",
	"status.draft": "черновик",
	"status.deprecated": "устаревший",
	"lifecycle.draft": "Черновик — В разработке, не в продакшене",
	"lifecycle.active": "Активный — В продакшене, отслеживается и валидируется",
	"lifecycle.deprecated": "Устаревший — Выводится из использования",

	// Confirm dialogs
	"confirm.discardTitle": "Несохранённые изменения",
	"confirm.discardMessage":
		"У вас есть несохранённые изменения. Отменить их и продолжить?",
	"confirm.discardConfirm": "Отменить",
	"confirm.discardCancel": "Продолжить редактирование",
	"confirm.deleteEventTitle": "Удалить событие",
	"confirm.deleteEventMessage":
		'Удалить «{key}»? Это удалит YAML-файл. Действие нельзя отменить.',
	"confirm.deleteTitle": "Удалить словарь",
	"confirm.deleteMessage":
		'Удалить «{key}»? Это действие нельзя отменить. События, ссылающиеся на этот словарь, будут содержать неработающие ссылки.',
	"confirm.deleteCancel": "Отмена",
	"confirm.deleteConfirm": "Удалить",

	// Toasts
	"toast.saved": "Событие сохранено: {key}",
	"toast.created": "Событие создано: {key}",
	"toast.saveFailed": "Ошибка сохранения",
	"toast.validationPassed": "Валидация пройдена",
	"toast.validationFailed": "Ошибка валидации: {count} ошибок",
	"toast.eventDeleted": "Событие удалено: {key}",
	"toast.dictSaved": "Словарь сохранён: {key}",
	"toast.dictDeleted": "Словарь удалён: {key}",

	// Dictionary list
	"dict.new": "+ Новый",
	"dict.empty": "Нет словарей",
	"dict.emptyHint": "Создайте словарь для определения переиспользуемых списков значений",
	"dict.deleteTooltip": "Удалить словарь",
	"dict.selectHint": "Выберите словарь для редактирования или создайте новый",
	"dict.newDict": "Новый словарь",
	"dict.editingDict": "Редактирование: {key}",

	// Export
	"export.loading": "Загрузка генераторов...",
	"export.title": "Экспорт",
	"export.bundle": "Экспорт пакета",
	"export.downloading": "Скачивание...",

	// Footer / meta
	"meta.file": "Файл:",
	"meta.target": "Цель:",
	"meta.values": "значений",

	// Validation result
	"validation.passed": "Валидация пройдена",
	"validation.errors": "{errors} ошибок, {warnings} предупреждений",
	"validation.errorPrefix": "\u2716",
	"validation.warningPrefix": "\u26A0",

	// Dictionary editor
	"dictEditor.keyRequired": "Ключ обязателен",
	"dictEditor.keyNoSlashPrefix": "Ключ не должен начинаться с '/'",
	"dictEditor.keyNoDotDot": "Ключ не должен содержать '..'",
	"dictEditor.keyLabel": "Ключ",
	"dictEditor.keyHint":
		"Ключ-путь, напр. taxonomy/areas или governance/statuses",
	"dictEditor.keyPlaceholder": "напр. taxonomy/areas",
	"dictEditor.valueType": "Тип значения",
	"dictEditor.values": "Значения",
	"dictEditor.valuesHint": "Введите значение и нажмите Enter для добавления",

	// Tree navigation
	"tree.navigation": "Навигация ({count})",
	"tree.collapse": "Свернуть",
	"tree.expand": "Развернуть",

	// Field extras
	"field.const": "const",
	"field.dictionaryTooltip": "Словарь: {key}",
	"field.dictBadge": "словарь",
	"field.baseBadge": "base",

	// Form extras
	"form.status": "Статус",
	"form.noFieldsHint":
		'Нет полей. Нажмите "Добавить поле" чтобы начать определение данных.',
	"form.enterField": "Введите {field}",
	"form.addCustomValue": "Ввести своё значение",
	"form.noneSelected": "— не выбрано —",
	"form.keyComplete": "Ключ заполнен",

	// Dict count
	"dict.countLabel": "{count} словарей",

	// PII extras
	"pii.badge": "PII",
	"pii.badgeTooltip": "PII: {kind}",
	"pii.badgeTooltipMasker": "PII: {kind} (маскирование: {masker})",

	// Theme
	"theme.switchToLight": "Переключить на светлую тему",
	"theme.switchToDark": "Переключить на тёмную тему",

	// Common extras
	"common.delete": "Удалить",
	"common.closePanel": "Закрыть панель",
	"common.closeDialog": "Закрыть диалог",
	"common.confirm": "Подтвердить",

	// PII editor labels
	"pii.maskerNone": "Нет",
	"pii.maskerStar": "Звёздочки (****)",
	"pii.maskerHash": "Хеш (SHA-256)",
	"pii.maskerRedact": "Удаление",
	"pii.kindUserId": "ID пользователя",
	"pii.kindEmail": "Электронная почта",
	"pii.kindPhone": "Телефон",
	"pii.kindName": "Имя",
	"pii.kindAddress": "Адрес",
	"pii.kindIpAddress": "IP-адрес",
	"pii.kindDeviceId": "ID устройства",
	"pii.kindOther": "Другое",

	// Export labels
	"export.generatorTsSdk": "TypeScript SDK",
	"export.generatorSwiftSdk": "Swift SDK",
	"export.generatorKotlinSdk": "Kotlin SDK",
	"export.generatorJson": "JSON",
	"export.generatorYaml": "YAML",
	"export.generatorTemplate": "Шаблон",
	"export.targetWeb": "Веб",
	"export.targetIos": "iOS",
	"export.targetAndroid": "Android",

	// Field type labels
	"fieldType.string": "Строка",
	"fieldType.number": "Число",
	"fieldType.integer": "Целое число",
	"fieldType.boolean": "Булево",
	"fieldType.array": "Массив",

	// Inline dictionary value manager
	"dictInline.manage": "Управление значениями",
	"dictInline.addValue": "Добавить",
	"dictInline.addPlaceholder": "Новое значение...",
	"dictInline.rename": "Переименовать",
	"dictInline.delete": "Удалить",
	"dictInline.save": "Сохранить",
	"dictInline.cancel": "Отмена",
	"dictInline.confirmDeleteTitle": "Удалить значение словаря",
	"dictInline.confirmDeleteMessage": "Удалить \"{value}\" из \"{dict}\"? События, использующие это значение, сохранят его, но оно не будет отображаться в выпадающих списках.",
	"dictInline.valueExists": "Значение уже существует",
	"dictInline.valueEmpty": "Значение не может быть пустым",
	"dictInline.saved": "Словарь обновлён",
	"dictInline.saveFailed": "Не удалось обновить словарь",

	// Platform
	"platform.roles.viewer": "Наблюдатель",
	"platform.roles.editor": "Редактор",
	"platform.roles.admin": "Администратор",
	"platform.user.logout": "Выйти",
	"platform.app.switchApp": "Переключить приложение",
	"platform.app.noApps": "Нет приложений",
	"platform.error.title": "Что-то пошло не так",
	"platform.error.retry": "Повторить",
};

