const roundLabels = ['本轮', '上轮', '上上轮'];

export function MeasureWellSelection() {
  const loading = false;

  return (
    <div className="page-stack animate-in fade-in duration-300">
      <div className="app-card p-6">
        <h3 className="text-lg font-bold text-slate-900">措施选井</h3>
        <p className="mt-1 text-sm text-slate-500">根据历史措施轮次和生产表现筛选潜力井。</p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.7fr)]">
        <section className="app-card overflow-hidden">
          <div className="app-card-header">
            <h4 className="font-bold text-slate-800">选井列表</h4>
            <p className="mt-1 text-sm text-slate-500">按综合评分排序</p>
          </div>
          <div className="flex min-h-[360px] items-center justify-center px-6 text-center text-sm text-slate-400">
            {loading ? '选井数据加载中...' : '暂无选井数据，数据接入后将在此展示。'}
          </div>
        </section>

        <section className="space-y-6">
          <div className="app-card overflow-hidden">
            <div className="app-card-header">
              <h4 className="font-bold text-slate-800">近三轮日产油曲线</h4>
              <p className="mt-1 text-sm text-slate-500">选择左侧井号后查看轮次对比。</p>
            </div>
            <div className="flex h-[300px] items-center justify-center bg-slate-50 px-6 text-center text-sm text-slate-400">
              {loading ? '曲线加载中...' : '暂无曲线数据'}
            </div>
          </div>

          <div className="app-card overflow-hidden">
            <div className="app-card-header">
              <h4 className="font-bold text-slate-800">近三轮措施参数</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">轮次</th>
                    <th className="px-4 py-3 font-semibold">转抽时间</th>
                    <th className="px-4 py-3 font-semibold">注汽量</th>
                    <th className="px-4 py-3 font-semibold">峰值日产油</th>
                    <th className="px-4 py-3 font-semibold">周期产油</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-400">
                  {roundLabels.map((label) => (
                    <tr key={label}>
                      <td className="px-4 py-3 font-medium text-slate-600">{label}</td>
                      <td className="px-4 py-3">--</td>
                      <td className="px-4 py-3">--</td>
                      <td className="px-4 py-3">--</td>
                      <td className="px-4 py-3">--</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
