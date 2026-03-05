import { useState, type KeyboardEvent } from "react";
import { useT } from "../../i18n";

interface EnumEditorProps {
  values: (string | number | boolean)[];
  onChange: (values: (string | number | boolean)[]) => void;
  suggestions?: (string | number | boolean)[];
  fieldType: string;
}

export function EnumEditor({
  values,
  onChange,
  suggestions,
  fieldType,
}: EnumEditorProps) {
  const { t } = useT();
  const [input, setInput] = useState("");

  const addValue = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    let value: string | number | boolean;
    if (fieldType === "number" || fieldType === "integer") {
      value = Number(trimmed);
      if (Number.isNaN(value)) return;
    } else if (fieldType === "boolean") {
      value = trimmed === "true";
    } else {
      value = trimmed;
    }

    if (!values.includes(value)) {
      onChange([...values, value]);
    }
    setInput("");
  };

  const removeValue = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addValue(input);
    }
    if (e.key === "Backspace" && input === "" && values.length > 0) {
      removeValue(values.length - 1);
    }
  };

  const availableSuggestions =
    suggestions?.filter((s) => !values.includes(s)) ?? [];

  return (
    <div>
      {/* Chips */}
      <div className="flex flex-wrap gap-1 mb-2 min-h-[28px]">
        {values.map((v, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-tertiary border border-edge-secondary rounded text-xs font-mono text-content-primary"
          >
            {String(v)}
            <button
              onClick={() => removeValue(i)}
              className="text-content-tertiary hover:text-content-primary ml-0.5"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("field.enumInputPlaceholder")}
          className="flex-1 px-2 py-1.5 bg-surface-input border border-edge-primary rounded text-xs font-mono text-content-primary placeholder:text-content-muted focus:outline-none focus:border-edge-active"
        />
        <button
          onClick={() => addValue(input)}
          disabled={!input.trim()}
          className="px-2 py-1.5 bg-surface-tertiary hover:bg-surface-active disabled:opacity-50 text-content-secondary text-xs rounded"
        >
          {t("field.enumAdd")}
        </button>
      </div>

      {/* Dictionary suggestions */}
      {availableSuggestions.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] text-content-muted mb-1">
            {t("field.enumSuggestions")}
          </p>
          <div className="flex flex-wrap gap-1">
            {availableSuggestions.slice(0, 10).map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  if (!values.includes(s)) onChange([...values, s]);
                }}
                className="px-1.5 py-0.5 bg-surface-input hover:bg-surface-tertiary border border-edge-primary rounded text-[10px] font-mono text-content-tertiary hover:text-content-primary"
              >
                + {String(s)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
