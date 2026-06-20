import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import { getProjects } from "../services/project.service";
import type { Project } from "../types/project";

export default function ProjectDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null | undefined>(undefined);

  useEffect(() => {
    getProjects()
      .then((projects) => {
        setProject(projects.find((p) => p.id === Number(id)) ?? null);
      })
      .catch(() => setProject(null));
  }, [id]);

  if (project === undefined) {
    return null;
  }

  if (project === null) {
    return (
      <div className="p-8">
        <EmptyState
          title="Project not found"
          description="It may have been deleted, or you don't have access to it."
        />
      </div>
    );
  }

  const hasCoordinates = project.latitude != null && project.longitude != null;

  return (
    <div className="p-8">
      <Link to="/projects" className="text-sm text-orange-500 hover:underline">
        ← Back to projects
      </Link>

      <PageHeader title={project.name} subtitle={project.description} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
          <h3 className="text-lg font-semibold text-white">Overview</h3>

          <p className="mt-4 text-sm text-slate-400">Status</p>
          <p className="text-white">{project.status}</p>

          <p className="mt-4 text-sm text-slate-400">Deadline</p>
          <p className="text-white">
            {project.deadline ? new Date(project.deadline).toLocaleDateString() : "No deadline"}
          </p>

          {project.customer && (
            <>
              <p className="mt-4 text-sm text-slate-400">Customer</p>
              <p className="text-white">{project.customer.name}</p>
            </>
          )}
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Site location</h3>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                project.geofenceEnabled
                  ? "bg-green-500/20 text-green-400"
                  : "bg-white/10 text-slate-400"
              }`}
            >
              {project.geofenceEnabled ? "Geofence Enabled" : "Geofence Disabled"}
            </span>
          </div>

          <p className="mt-4 text-sm text-slate-400">Address</p>
          <p className="text-white">{project.address || "Not set"}</p>

          <p className="mt-4 text-sm text-slate-400">Coordinates</p>
          <p className="text-white">
            {hasCoordinates
              ? `${project.latitude}, ${project.longitude}`
              : "Not set"}
          </p>

          <p className="mt-4 text-sm text-slate-400">Geofence radius</p>
          <p className="text-white">
            {project.geofenceRadius != null ? `${project.geofenceRadius} m` : "Not set"}
          </p>
        </div>
      </div>
    </div>
  );
}
