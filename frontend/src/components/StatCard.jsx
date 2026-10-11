function StatCard({ title, value, icon: Icon, subtitle }) {
  return (
    <div className="rounded-ui border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
      <div className="flex items-start justify-between">
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
        {Icon ? <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" /> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
    </div>
  );
}

export default StatCard;
