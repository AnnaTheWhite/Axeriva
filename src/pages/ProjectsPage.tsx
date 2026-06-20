import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import ProjectModal from "../components/projects/ProjectModal";
import ProjectEditModal from "../components/projects/ProjectEditModal";
import AssignEmployeeModal from "../components/projects/AssignEmployeeModal";
import ConfirmModal from "../components/ui/ConfirmModal";
import Toast from "../components/ui/Toast";

import { useToast } from "../hooks/useToast";
import { getProjects, deleteProject } from "../services/project.service";

import type { Project } from "../types/project";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [projectToEdit, setProjectToEdit] = useState<Project | null>(null);
  const [projectToAssign, setProjectToAssign] = useState<Project | null>(null);

  const { show, message, triggerToast } = useToast();

  const loadProjects = async () => {
    try {
      const data = await getProjects();
      setProjects(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const confirmDelete = async () => {
    if (!projectToDelete) return;
    try {
      await deleteProject(projectToDelete.id);
      setProjectToDelete(null);
      triggerToast("Project deleted");
      await loadProjects();
    } catch (error) {
      console.error(error);
      triggerToast("Failed to delete project");
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      Planned: "bg-slate-500/20 text-slate-300",
      Active: "bg-blue-500/20 text-blue-400",
      Completed: "bg-green-500/20 text-green-400",
    };
    return (
      <span
        className={`rounded-full px-3 py-1 text-xs font-medium ${
          styles[status] ?? "bg-white/10 text-white"
        }`}
      >
        {status}
      </span>
    );
  };

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold">Projects</h1>
          <p className="mt-2 text-slate-400">
            Total Projects: {projects.length}
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="rounded-xl bg-orange-500 px-5 py-3 font-medium text-white hover:bg-orange-600"
        >
          Add Project
        </button>
      </div>

      <div className="mb-6">
        <input
          type="text"
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3"
        />
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="space-y-4">
          {filteredProjects.map((project) => (
            <div
              key={project.id}
              className="rounded-3xl border border-white/10 bg-white/5 p-6"
            >
              <div className="flex items-start justify-between">
                <div>
                  <Link
                    to={`/projects/${project.id}`}
                    className="text-xl font-semibold hover:text-orange-400"
                  >
                    {project.name}
                  </Link>
                  {project.description && (
                    <p className="mt-1 text-slate-400">{project.description}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      project.geofenceEnabled
                        ? "bg-green-500/20 text-green-400"
                        : "bg-white/10 text-slate-400"
                    }`}
                  >
                    {project.geofenceEnabled ? "Geofence Enabled" : "Geofence Disabled"}
                  </span>
                  {getStatusBadge(project.status)}
                </div>
              </div>

              <p className="mt-2 text-slate-400">
                Deadline:{" "}
                {project.deadline
                  ? new Date(project.deadline).toLocaleDateString()
                  : "No deadline"}
              </p>

              {project.customer && (
                <p className="text-slate-400">
                  Customer: {project.customer.name}
                </p>
              )}

              {project.assignments && project.assignments.length > 0 && (
                <p className="mt-1 text-slate-400">
                  Team:{" "}
                  {project.assignments
                    .map(
                      (a) => `${a.employee.firstName} ${a.employee.lastName}`
                    )
                    .join(", ")}
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setProjectToEdit(project)}
                  className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-400 hover:bg-blue-500/20"
                >
                  ✏ Edit
                </button>

                <button
                  onClick={() => setProjectToAssign(project)}
                  className="rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm text-purple-400 hover:bg-purple-500/20"
                >
                  👤 Assign
                </button>

                <button
                  onClick={() => setProjectToDelete(project)}
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 hover:bg-red-500/20"
                >
                  🗑 Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      <ProjectModal
        open={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => {
          triggerToast("Project created");
          loadProjects();
        }}
      />

      {/* Edit Modal */}
      <ProjectEditModal
        open={projectToEdit !== null}
        project={projectToEdit}
        onClose={() => setProjectToEdit(null)}
        onSuccess={() => {
          triggerToast("Project updated");
          loadProjects();
        }}
      />

      {/* Assign Modal */}
      <AssignEmployeeModal
        open={projectToAssign !== null}
        project={projectToAssign}
        onClose={() => setProjectToAssign(null)}
        onSuccess={loadProjects}
      />

      {/* Delete Confirm */}
      <ConfirmModal
        open={projectToDelete !== null}
        title="Delete Project"
        message={`Are you sure you want to delete ${projectToDelete?.name ?? ""}?`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDelete}
        onClose={() => setProjectToDelete(null)}
      />

      <Toast show={show} message={message} />
    </div>
  );
}
