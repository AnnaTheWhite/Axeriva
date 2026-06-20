const features = [
  { title: "Employees", description: "Manage your workforce, statuses and contact details." },
  { title: "Projects", description: "Track jobs from planning through completion." },
  { title: "Scheduling", description: "Build shift schedules and assign crews to projects." },
  { title: "Time Tracking", description: "Capture worked hours per employee and project." },
  { title: "Customers", description: "Keep client information and project history in sync." },
  { title: "Reports", description: "Get visibility into activity across your business." },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Features
          </h2>
          <p className="mt-3 text-slate-400">
            One platform covering every part of your daily operations.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500/10">
                <div className="h-3 w-3 rounded-full bg-orange-500" />
              </div>

              <h3 className="mt-5 text-lg font-semibold text-white">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm text-slate-400">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
