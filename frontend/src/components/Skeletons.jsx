/**
 * Skeleton placeholders shown while the first data load is in flight.
 * Shapes mirror the real dashboard so nothing jumps when content arrives.
 */
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading trap data">
      <div className="skeleton h-40 rounded-[1.25rem]" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card flex flex-col gap-3 p-4!">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-7 w-20" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="card flex flex-col gap-4 lg:col-span-3">
          <div className="skeleton h-4 w-40" />
          <div className="skeleton aspect-[4/3] w-full" />
        </div>
        <div className="card flex flex-col gap-3 lg:col-span-2">
          <div className="skeleton h-4 w-44" />
          <div className="skeleton h-20 w-full" />
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-3" style={{ width: `${90 - i * 12}%` }} />
          ))}
        </div>
      </div>
      <p className="sr-only">Loading trap data…</p>
    </div>
  );
}
