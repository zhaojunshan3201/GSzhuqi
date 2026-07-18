export const AXON_PAGE_TITLE = '高采三厂生产动态分析与采油作业管理系统';
export const AXON_AERIAL_VIDEO = new URL('../assets/axon-aerial-background.mp4', import.meta.url).href;

type AxonLandingPageProps = {
  onEnter: () => void;
};

export function AxonLandingPage({ onEnter }: AxonLandingPageProps) {
  return (
    <section id="axon" className="relative flex h-screen w-full flex-col overflow-hidden bg-[#d7d6df] text-[#1B133C]">
      <video
        className="absolute inset-0 z-0 h-[130%] w-full object-cover object-center"
        src={AXON_AERIAL_VIDEO}
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
      />

      <header className="relative z-10 flex justify-center px-4 pt-4 md:pt-6">
        <nav aria-label="主导航" className="flex w-full max-w-4xl items-center justify-between rounded-full border border-white/50 bg-white/45 px-4 py-3 shadow-[0_8px_30px_rgba(27,19,60,0.08)] backdrop-blur-md md:px-5">
          <a href="#axon" aria-label="系统主页" className="flex items-center">
            <svg width="24" height="24" viewBox="0 0 256 256" aria-hidden="true">
              <path d="M 256 256 L 128 256 L 0 128 L 128 128 Z" fill="#1B133C" />
              <path d="M 256 128 L 128 128 L 0 0 L 128 0 Z" fill="#1B133C" />
            </svg>
          </a>
          <div className="hidden items-center gap-6 text-sm font-medium md:flex">
            <a href="#axon" className="transition-opacity hover:opacity-60">生产动态</a>
            <a href="#axon" className="transition-opacity hover:opacity-60">措施跟踪</a>
            <a href="#axon" className="transition-opacity hover:opacity-60">智能分析</a>
            <a href="#axon" className="transition-opacity hover:opacity-60">系统概览</a>
          </div>
          <span aria-hidden="true" className="w-6" />
        </nav>
      </header>

      <main className="relative z-10 mx-auto mt-8 flex w-full max-w-5xl flex-1 flex-col items-center px-6 text-center md:mt-16">
        <p className="rounded-full border border-[#1B133C]/15 bg-white/45 px-3 py-1 text-xs font-semibold tracking-wide backdrop-blur-sm">高采三厂采油作业区</p>
        <h1 className="mt-6 font-[Instrument_Serif] text-5xl leading-[0.94] tracking-[-0.045em] sm:text-6xl md:text-8xl">
          <span className="block">生产动态智能分析</span>
          <span className="block italic">采油作业高效协同</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed sm:text-lg">汇聚区块、单井、措施与井温测试数据，实时掌握生产运行动态；通过智能分析和可视化决策支持，提升采油作业效率与精细化管理水平。</p>
        <button type="button" onClick={onEnter} className="mt-8 rounded-full bg-[#1B133C] px-6 py-3 text-sm font-semibold text-white transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1B133C]">进入系统</button>
      </main>
    </section>
  );
}
