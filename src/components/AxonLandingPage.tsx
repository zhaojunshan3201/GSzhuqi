export const AXON_PAGE_TITLE = 'Axon — Digital Workers for Mundane Workflows';

export const AXON_VIDEO_URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260714_113715_c7e0daa0-8bdd-4486-a2da-040901f8f0ea.mp4';

type AxonLandingPageProps = {
  onEnter: () => void;
};

export function AxonLandingPage({ onEnter }: AxonLandingPageProps) {
  return (
    <section id="axon" className="relative h-screen w-full overflow-hidden flex flex-col bg-[#d7d6df] text-[#1B133C]">
      <video
        className="absolute inset-0 z-0 w-full h-[130%] object-cover object-top"
        src={AXON_VIDEO_URL}
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
      />

      <header className="relative z-10 flex justify-center px-4 pt-4 md:pt-6">
        <nav
          aria-label="Primary navigation"
          className="flex w-full max-w-4xl items-center justify-between rounded-full border border-white/50 bg-white/45 px-4 py-3 shadow-[0_8px_30px_rgba(27,19,60,0.08)] backdrop-blur-md md:px-5"
        >
          <a href="#axon" aria-label="Axon home" className="flex items-center">
            <svg width="24" height="24" viewBox="0 0 256 256" aria-hidden="true">
              <path d="M 256 256 L 128 256 L 0 128 L 128 128 Z" fill="#1B133C" />
              <path d="M 256 128 L 128 128 L 0 0 L 128 0 Z" fill="#1B133C" />
            </svg>
          </a>
          <div className="hidden items-center gap-6 text-sm font-medium md:flex">
            <a href="#axon" className="transition-opacity hover:opacity-60">Features</a>
            <a href="#axon" className="transition-opacity hover:opacity-60">Plans</a>
            <a href="#axon" className="transition-opacity hover:opacity-60">Security</a>
            <a href="#axon" className="transition-opacity hover:opacity-60">About</a>
          </div>
          <span aria-hidden="true" className="w-6" />
        </nav>
      </header>

      <main className="relative z-10 mx-auto mt-8 flex w-full max-w-5xl flex-1 flex-col items-center px-6 text-center md:mt-16">
        <p className="rounded-full border border-[#1B133C]/15 bg-white/45 px-3 py-1 text-xs font-semibold tracking-wide backdrop-blur-sm">
          Y Combinator
        </p>
        <h1 className="mt-6 font-[Instrument_Serif] text-5xl leading-[0.94] tracking-[-0.045em] sm:text-6xl md:text-8xl">
          <span className="block">Deploy digital workers</span>
          <span className="block italic">for mundane workflows</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed sm:text-lg">
          Eliminate your tedious browser work and 10x your team&apos;s capacity. Put intelligent agents on every routine process so you grow faster and deliver more for clients — effortlessly.
        </p>
        <button
          type="button"
          onClick={onEnter}
          className="mt-8 rounded-full bg-[#1B133C] px-6 py-3 text-sm font-semibold text-white transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1B133C]"
        >
          Get Early Access
        </button>
      </main>
    </section>
  );
}
