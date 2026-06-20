import { Link } from "react-router-dom";

export default function LandingNavbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0f172a]/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="text-xl font-bold text-white">
          Axeriva
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
          <a href="#benefits" className="hover:text-white">
            Why Axeriva
          </a>
          <a href="#features" className="hover:text-white">
            Features
          </a>
          <Link to="/pricing" className="hover:text-white">
            Pricing
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="rounded-xl px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-orange-600"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
