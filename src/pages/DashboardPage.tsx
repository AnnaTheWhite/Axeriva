import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";

export default function DashboardPage() {
  return (
    <main className="flex-1 p-8">
      <PageHeader
        title="Dashboard"
        subtitle="Welcome back to CrewFlow"
      />

      <section
        className="
          grid
          gap-6
          md:grid-cols-2
          xl:grid-cols-4
        "
      >
        <StatCard
          title="Active Projects"
          value="12"
        />

        <StatCard
          title="Active Employees"
          value="38"
        />

        <StatCard
          title="Hours Today"
          value="286"
        />

        <StatCard
          title="Open Tasks"
          value="17"
        />
      </section>
    </main>
  );
}