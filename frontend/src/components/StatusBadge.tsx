interface StatusBadgeProps {
  label: string;
  colorClassName: string;
  title?: string;
}

/**
 * The rounded-pill status badge shell used across Documents, Knowledge
 * Base, Maintenance Plans, and Reports — previously the exact same
 * Tailwind wrapper string was copy-pasted at every call site, with only
 * the color-map value differing per page's status enum. Each page keeps
 * its own `status -> colorClassName` map (the enums genuinely differ) and
 * passes the resolved class name in here.
 */
export function StatusBadge({ label, colorClassName, title }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${colorClassName}`}
      title={title}
    >
      {label}
    </span>
  );
}
