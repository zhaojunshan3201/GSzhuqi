import { useState, type ReactNode } from 'react';
import type { SidebarTab } from '../lib/sidebarNavigation';

const VIDEO_URL = new URL('../assets/datacore-oilfield.mp4', import.meta.url).href;
const links: Array<{ label: string; tab: SidebarTab }> = [
  { label: '基本情况', tab: 'dashboard' },
  { label: '分析系统', tab: 'well' },
  { label: '重点情况', tab: 'analysis' },
  { label: '措施项目', tab: 'measures' },
  { label: '产量掌控', tab: 'productionForecast' },
];

export function DatacoreLandingPage({ onEnter, onLogin, onNavigate, loginOverlay }: { onEnter: () => void; onLogin: () => void; onNavigate: (tab: SidebarTab) => void; loginOverlay?: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <section className="relative min-h-screen overflow-hidden bg-black text-white">
      <video className="absolute inset-0 h-full w-full object-cover" src={VIDEO_URL} autoPlay muted loop playsInline aria-hidden="true" />
      <header className="relative z-20 flex items-center justify-between px-6 py-4 lg:px-[120px]">
        <span aria-hidden="true" />
        <nav className="hidden items-center gap-8 font-['Manrope'] text-sm font-medium text-white lg:flex" aria-label="主导航">
          {links.map((link) => <button key={link.tab} type="button" onClick={() => onNavigate(link.tab)} className="transition-opacity hover:opacity-80">{link.label}</button>)}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <button type="button" onClick={onLogin} className="rounded-lg border border-[#d4d4d4] bg-white px-4 py-2 text-sm font-semibold text-[#171717]">系统登录</button>
          <button type="button" onClick={onEnter} className="rounded-lg bg-[#7b39fc] px-4 py-2 text-sm font-semibold text-[#fafafa] shadow-lg shadow-[#7b39fc]/30 transition-colors hover:bg-[#8a50ff]">进入系统</button>
        </div>
        <button type="button" onClick={() => setMenuOpen(true)} className="text-2xl text-white lg:hidden" aria-label="打开菜单">☰</button>
      </header>

      {menuOpen && <div className="fixed inset-0 z-30 flex flex-col bg-black px-6 py-5 lg:hidden">
        <button type="button" onClick={() => setMenuOpen(false)} className="self-end text-3xl" aria-label="关闭菜单">×</button>
        <nav className="mt-16 flex flex-col gap-8 font-['Manrope'] text-3xl font-medium">{links.map((link) => <button key={link.tab} type="button" onClick={() => onNavigate(link.tab)} className="text-left">{link.label}</button>)}</nav>
        <button type="button" onClick={onEnter} className="mt-auto rounded-lg bg-[#7b39fc] px-5 py-3 font-['Cabin'] text-base">进入系统</button>
      </div>}

      <main id="datacore" className="relative z-10 mx-auto flex min-h-[calc(100vh-64px)] max-w-6xl -translate-y-8 flex-col items-center justify-center px-6 pb-16 pt-8 text-center sm:pb-20">
        <div className="mt-12 inline-flex h-[42px] items-center gap-2 rounded-[10px] border border-[rgba(164,132,215,0.5)] bg-[rgba(85,80,110,0.4)] px-3 pr-4 text-sm text-white backdrop-blur font-['Cabin']">
          <span className="rounded-md bg-[#7b39fc] px-2 py-1 text-xs">智能生产</span> 数据驱动精细化管理
        </div>
        <h1 className="mt-8 max-w-6xl font-sans text-5xl font-semibold leading-[1.28] tracking-[0.02em] sm:text-7xl lg:text-[88px]"><span className="block">高采三区数智化</span><span className="block">注采管理系统</span></h1>
        <p className="mt-9 max-w-3xl font-['Inter'] text-base leading-relaxed text-white/75 sm:text-lg">汇聚区块、单井、措施与井温测试数据，实时掌握生产运行动态，以可视化分析与智能决策支持提升采油作业效率。</p>
        <div className="mt-10 flex flex-wrap justify-center gap-4 font-['Cabin'] text-base font-medium">
          <button type="button" onClick={onEnter} className="rounded-[10px] bg-[#7b39fc] px-6 py-3 text-white transition-colors hover:bg-[#8a50ff]">进入生产动态</button>
          <button type="button" onClick={onEnter} className="rounded-[10px] bg-[#2b2344] px-6 py-3 text-[#f6f7f9] transition-colors hover:bg-[#3c315f]">查看系统概览</button>
        </div>
      </main>
      {loginOverlay}
    </section>
  );
}
