import { useCallback, useEffect, useState } from "react";

export interface ToastMessage {
	id: string;
	type: "success" | "error";
	text: string;
}

interface ToastContainerProps {
	messages: ToastMessage[];
	onDismiss: (id: string) => void;
}

export function ToastContainer({ messages, onDismiss }: ToastContainerProps) {
	return (
		<div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
			{messages.map((msg) => (
				<ToastItem key={msg.id} message={msg} onDismiss={onDismiss} />
			))}
		</div>
	);
}

function ToastItem({
	message,
	onDismiss,
}: {
	message: ToastMessage;
	onDismiss: (id: string) => void;
}) {
	useEffect(() => {
		const timer = setTimeout(() => onDismiss(message.id), 4000);
		return () => clearTimeout(timer);
	}, [message.id, onDismiss]);

	const colors =
		message.type === "success"
			? "bg-accent-green-bg border-accent-green-border text-accent-green"
			: "bg-accent-red-bg border-accent-red-border text-accent-red";

	return (
		<div
			className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm ${colors}`}
		>
			<span>{message.text}</span>
			<button
				type="button"
				onClick={() => onDismiss(message.id)}
				className="opacity-50 hover:opacity-100 ml-2"
			>
				&times;
			</button>
		</div>
	);
}

let toastCounter = 0;

export function useToast() {
	const [messages, setMessages] = useState<ToastMessage[]>([]);

	const addToast = useCallback((type: "success" | "error", text: string) => {
		const id = `toast-${++toastCounter}`;
		setMessages((prev) => [...prev, { id, type, text }]);
	}, []);

	const dismissToast = useCallback((id: string) => {
		setMessages((prev) => prev.filter((m) => m.id !== id));
	}, []);

	return { messages, addToast, dismissToast };
}
