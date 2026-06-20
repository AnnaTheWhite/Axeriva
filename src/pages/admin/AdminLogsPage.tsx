import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/ui/EmptyState";

export default function AdminLogsPage() {
  return (
    <div className="p-8">
      <PageHeader title="Logs" subtitle="Platform activity log." />

      <EmptyState
        title="Not implemented yet"
        description="Logging needs a real observability backend — this is a placeholder."
      />
    </div>
  );
}
