import type { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function FormField({
  label,
  required,
  error,
  hint,
  children,
}: FormFieldProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-content-secondary mb-1">
        {label}
        {required && <span className="text-accent-red ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-[11px] text-accent-red mt-1">{error}</p>}
      {hint && !error && (
        <p className="text-[11px] text-content-muted mt-1">{hint}</p>
      )}
    </div>
  );
}

/** Standard text input styled for the form */
interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
}

export function TextInput({
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  disabled,
  mono,
}: TextInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full px-3 py-2 bg-surface-input border border-edge-primary rounded-md text-sm text-content-primary
        placeholder:text-content-muted focus:outline-none focus:border-edge-secondary
        disabled:opacity-50 disabled:cursor-not-allowed
        ${mono ? "font-mono" : ""}`}
    />
  );
}

/** Standard select styled for the form */
interface SelectInputProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}

export function SelectInput({ value, onChange, options }: SelectInputProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 pr-8 bg-surface-input border border-edge-primary rounded-md text-sm text-content-primary focus:outline-none focus:border-edge-secondary"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
