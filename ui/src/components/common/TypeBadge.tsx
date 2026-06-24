const TYPE_COLORS: Record<string, string> = {
  string: "bg-accent-blue-bg text-accent-blue border-accent-blue-border",
  number: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  integer: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  boolean: "bg-accent-green-bg text-accent-green border-accent-green-border",
  array: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

interface TypeBadgeProps {
  type?: string;
}

export function TypeBadge({ type = "string" }: TypeBadgeProps) {
  const style = TYPE_COLORS[type] ?? TYPE_COLORS.string;
  return (
    <span
      className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono rounded border ${style}`}
    >
      {type}
    </span>
  );
}
