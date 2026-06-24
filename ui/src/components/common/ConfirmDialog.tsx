import { useT } from "../../i18n";

interface ConfirmDialogProps {
	open: boolean;
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

export function ConfirmDialog({
	open,
	title,
	message,
	confirmLabel,
	cancelLabel,
	danger,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const { t } = useT();
	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			{/* Backdrop */}
			<button
				type="button"
				className="absolute inset-0 bg-black/60 cursor-default"
				onClick={onCancel}
				aria-label={t("common.closeDialog")}
				tabIndex={-1}
			/>

			{/* Dialog */}
			<div className="relative bg-surface-secondary border border-edge-primary rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
				<h3 className="text-sm font-semibold text-content-primary mb-2">{title}</h3>
				<p className="text-xs text-content-secondary mb-4">{message}</p>
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="px-3 py-1.5 text-xs text-content-secondary hover:text-content-primary bg-surface-tertiary hover:bg-surface-hover rounded"
					>
						{cancelLabel ?? t("common.cancel")}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className={`px-3 py-1.5 text-xs rounded text-white ${
							danger
								? "bg-accent-red hover:bg-accent-red/80"
								: "bg-accent-blue hover:bg-accent-blue/80"
						}`}
					>
						{confirmLabel ?? t("common.confirm")}
					</button>
				</div>
			</div>
		</div>
	);
}
