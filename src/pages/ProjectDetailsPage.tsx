import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import { getProjects } from "../services/project.service";
import type { Project } from "../types/project";
import NotesSection from "../components/project-activity/NotesSection";
import AttachmentsSection from "../components/project-activity/AttachmentsSection";
import ActivityTimeline from "../components/project-activity/ActivityTimeline";
import { useTranslation } from "../i18n";

export default function ProjectDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
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
      <div className="p-4 sm:p-8">
        <EmptyState
          title={t("projects.notFound")}
          description={t("projects.notFoundDesc")}
        />
      </div>
    );
  }

  const hasCoordinates = project.latitude != null && project.longitude != null;

  return (
    <div className="p-4 sm:p-8">
      <Link to="/projects" className="text-sm text-orange-500 hover:underline">
        {t("projects.backToProjects")}
      </Link>

      <PageHeader title={project.name} subtitle={project.description} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-8">
          <h3 className="text-lg font-semibold text-white">{t("projects.overview")}</h3>

          <p className="mt-4 text-sm text-slate-400">{t("table.status")}</p>
          <p className="text-white">{t(`projects.status.${project.status}`) || project.status}</p>

          <p className="mt-4 text-sm text-slate-400">{t("projects.deadline")}</p>
          <p className="text-white">
            {project.deadline
              ? new Date(project.deadline).toLocaleDateString()
              : t("projects.noDeadline")}
          </p>

          {project.customer && (
            <>
              <p className="mt-4 text-sm text-slate-400">{t("projects.customer")}</p>
              <p className="text-white">{project.customer.name}</p>
            </>
          )}
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-8">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">{t("projects.siteLocation")}</h3>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                project.geofenceEnabled
                  ? "bg-green-500/20 text-green-400"
                  : "bg-white/10 text-slate-400"
              }`}
            >
              {project.geofenceEnabled
                ? t("projects.geofenceEnabled")
                : t("projects.geofenceDisabled")}
            </span>
          </div>

          <p className="mt-4 text-sm text-slate-400">{t("projects.address")}</p>
          <p className="text-white">{project.address || t("projects.notSet")}</p>

          <p className="mt-4 text-sm text-slate-400">{t("projects.coordinates")}</p>
          <p className="text-white">
            {hasCoordinates
              ? `${project.latitude}, ${project.longitude}`
              : t("projects.notSet")}
          </p>

          <p className="mt-4 text-sm text-slate-400">{t("projects.geofenceRadius")}</p>
          <p className="text-white">
            {project.geofenceRadius != null ? `${project.geofenceRadius} m` : t("projects.notSet")}
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <NotesSection projectId={project.id} />
        <ActivityTimeline projectId={project.id} />
      </div>

      <div className="mt-6">
        <AttachmentsSection projectId={project.id} canDelete />
      </div>
    </div>
  );
}
