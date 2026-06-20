import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import { getProjects } from "../services/project.service";
import type { Project } from "../types/project";

export default function MyProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getProjects()
      .then(setProjects)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="p-8">
      <PageHeader title="My Projects" subtitle="Projects you're assigned to." />

      {isLoading ? null : projects.length === 0 ? (
        <EmptyState title="No projects yet" description="You're not assigned to any project." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl"
            >
              <h3 className="font-semibold text-white">{project.name}</h3>
              <p className="mt-1 text-sm text-slate-400">{project.status}</p>
              {project.customer && (
                <p className="mt-3 text-sm text-slate-400">
                  Customer: {project.customer.name}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
