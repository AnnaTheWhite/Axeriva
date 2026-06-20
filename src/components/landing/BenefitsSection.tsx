const benefits = [
  { title: "Shift scheduling", description: "Plan and assign shifts in minutes." },
  { title: "Employee management", description: "Keep your whole crew organized in one place." },
  { title: "Project tracking", description: "See the status of every job at a glance." },
  { title: "Customer management", description: "Centralize client details and project history." },
  { title: "Time tracking", description: "Log hours worked, accurately and effortlessly." },
  { title: "Multi-site & multi-team", description: "Run several locations and teams from one account." },
  { title: "Mobile friendly", description: "Works smoothly on phones, tablets and desktop." },
];

export default function BenefitsSection() {
  return (
    <section id="benefits" className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Why CrewFlow?
          </h2>
          <p className="mt-3 text-slate-400">
            Everything you need to run a field service business, without the
            spreadsheets.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {benefits.map((benefit) => (
            <div
              key={benefit.title}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl transition hover:border-orange-500/40"
            >
              <h3 className="font-semibold text-white">{benefit.title}</h3>
              <p className="mt-2 text-sm text-slate-400">
                {benefit.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
