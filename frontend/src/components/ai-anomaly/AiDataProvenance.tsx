type ProvenanceItem = Readonly<{
  label: string;
  value: string;
}>;

export default function AiDataProvenance({
  items,
  notice,
}: Readonly<{
  items: ProvenanceItem[];
  notice?: string;
}>) {
  return (
    <aside className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
      <dl className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={`${item.label}:${item.value}`}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-blue-700">
              {item.label}
            </dt>
            <dd className="font-semibold">{item.value}</dd>
          </div>
        ))}
      </dl>
      {notice ? <p className="mt-2 text-xs leading-5">{notice}</p> : null}
    </aside>
  );
}
