import { usePlatformUser } from "../../core/platform/PlatformProvider";
import { useRole } from "../../core/platform/useRole";
import { useDropdown } from "../../hooks/useDropdown";
import { useT } from "../../i18n";
import { Roles } from "../../types/platform";
import type { UserRole } from "../../types/platform";

const ROLE_BADGE_STYLES: Record<UserRole, string> = {
	[Roles.VIEWER]: "bg-gray-600",
	[Roles.EDITOR]: "bg-blue-600",
	[Roles.ADMIN]: "bg-amber-600",
};

const ROLE_I18N_KEYS: Record<UserRole, "platform.roles.viewer" | "platform.roles.editor" | "platform.roles.admin"> = {
	[Roles.VIEWER]: "platform.roles.viewer",
	[Roles.EDITOR]: "platform.roles.editor",
	[Roles.ADMIN]: "platform.roles.admin",
};

export function UserMenu() {
	const { user, onLogout } = usePlatformUser();
	const { role } = useRole();
	const { t } = useT();

	const menuItems = onLogout ? 1 : 0;
	const dropdown = useDropdown({
		itemCount: menuItems,
		onSelect: (index) => {
			if (index === 0 && onLogout) {
				onLogout();
			}
		},
	});

	if (!user) return null;

	const initial = user.name.charAt(0).toUpperCase();

	return (
		<div className="relative">
			<button
				ref={dropdown.buttonRef}
				onClick={dropdown.toggle}
				onKeyDown={dropdown.onKeyDown}
				aria-label={`${user.name}, ${t(ROLE_I18N_KEYS[role])}`}
				aria-expanded={dropdown.isOpen}
				aria-haspopup="true"
				className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors text-left"
			>
				{user.avatar ? (
					<img
						src={user.avatar}
						alt={user.name}
						className="w-6 h-6 rounded-full shrink-0 object-cover"
					/>
				) : (
					<span className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center bg-surface-tertiary text-content-secondary text-[10px] font-medium">
						{initial}
					</span>
				)}
				<span className="flex-1 min-w-0 text-xs text-content-primary truncate overflow-hidden">
					{user.name}
				</span>
				<span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium text-white ${ROLE_BADGE_STYLES[role]}`}>
					{t(ROLE_I18N_KEYS[role])}
				</span>
			</button>

			{dropdown.isOpen && menuItems > 0 && (
				<div
					ref={dropdown.menuRef}
					role="menu"
					className="absolute bottom-full left-0 right-0 mb-1 bg-surface-secondary border border-edge-primary rounded-lg shadow-lg overflow-hidden z-10"
				>
					{onLogout && (
						<button
							role="menuitem"
							onClick={() => {
								onLogout();
								dropdown.close();
							}}
							className={`w-full px-3 py-2 text-xs text-left text-content-secondary hover:bg-surface-hover transition-colors ${
								dropdown.activeIndex === 0 ? "bg-surface-hover" : ""
							}`}
						>
							{t("platform.user.logout")}
						</button>
					)}
				</div>
			)}
		</div>
	);
}
