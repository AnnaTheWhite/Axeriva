import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import Button from "../components/ui/Button";
import Toast from "../components/ui/Toast";
import DatePicker from "../components/ui/DatePicker";
import ConfirmModal from "../components/ui/ConfirmModal";
import { useToast } from "../hooks/useToast";
import { useTranslation } from "../i18n";
import { translateOwnerNoteStatus, translatePriority } from "../i18n/labels";
import {
  getOwnerNotes,
  createOwnerNote,
  updateOwnerNote,
  deleteOwnerNote,
  detectOwnerNoteEntities,
  getOwnerNotesDashboard,
} from "../services/ownerNotes.service";
import { getProjects } from "../services/project.service";
import { getCustomers } from "../services/customers.service";
import { getEmployees } from "../services/employee.service";
import {
  OWNER_NOTE_STATUSES,
  PRIORITIES,
  type DetectedEntities,
  type OwnerNote,
  type OwnerNoteDashboard,
  type OwnerNoteStatus,
  type Priority,
} from "../types/ownerNote";
import type { Project } from "../types/project";
import type { Customer } from "../services/customers.service";
import type { Employee } from "../types/employee";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-orange-500";

const STATUS_STYLES: Record<OwnerNoteStatus, string> = {
  Inbox: "bg-orange-500/20 text-orange-400",
  Reviewed: "bg-blue-500/20 text-blue-400",
  Archived: "bg-white/10 text-slate-400",
};

const PRIORITY_STYLES: Record<Priority, string> = {
  Low: "bg-white/10 text-slate-400",
  Medium: "bg-blue-500/20 text-blue-400",
  High: "bg-orange-500/20 text-orange-400",
  Urgent: "bg-red-500/20 text-red-400",
};

export default function OwnerCommandCenterPage() {
  const { t } = useTranslation();

  const [notes, setNotes] = useState<OwnerNote[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dashboard, setDashboard] = useState<OwnerNoteDashboard | null>(null);

  // Edit note
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [editCustomerId, setEditCustomerId] = useState("");
  const [editEmployeeId, setEditEmployeeId] = useState("");
  const [isEditSaving, setIsEditSaving] = useState(false);

  // Delete note
  const [noteToDelete, setNoteToDelete] = useState<OwnerNote | null>(null);

  // Quick capture form
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [captureProjectId, setCaptureProjectId] = useState("");
  const [captureCustomerId, setCaptureCustomerId] = useState("");
  const [captureEmployeeId, setCaptureEmployeeId] = useState("");
  const [capturePriority, setCapturePriority] = useState<Priority>("Medium");
  const [isSaving, setIsSaving] = useState(false);

  // Suggestions panel — detection only, owner decides what (if anything)
  // to link. Re-runs on a short debounce as title/content change.
  const [suggestions, setSuggestions] = useState<DetectedEntities | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<OwnerNoteStatus | "All">("All");
  const [projectFilter, setProjectFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "All">("All");
  const [pinnedFilter, setPinnedFilter] = useState(false);

  const { show, message, triggerToast } = useToast();

  function loadDashboard() {
    getOwnerNotesDashboard().then(setDashboard).catch(console.error);
  }

  async function loadNotes() {
    try {
      const data = await getOwnerNotes({
        status: statusFilter === "All" ? undefined : statusFilter,
        projectId: projectFilter ? Number(projectFilter) : undefined,
        customerId: customerFilter ? Number(customerFilter) : undefined,
        date: dateFilter || undefined,
        priority: priorityFilter === "All" ? undefined : priorityFilter,
        pinned: pinnedFilter || undefined,
      });
      setNotes(data);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    Promise.all([getProjects(), getCustomers(), getEmployees()])
      .then(([projectData, customerData, employeeData]) => {
        setProjects(projectData);
        setCustomers(customerData);
        setEmployees(employeeData);
      })
      .catch(console.error);
    loadDashboard();
  }, []);

  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, projectFilter, customerFilter, dateFilter, priorityFilter, pinnedFilter]);

  // Debounced detection — suggestions only, nothing is linked until the
  // owner explicitly clicks one of the "Link ..." buttons below.
  useEffect(() => {
    const text = `${title} ${content}`.trim();

    if (!text) {
      setSuggestions(null);
      return;
    }

    const timer = setTimeout(() => {
      detectOwnerNoteEntities(text)
        .then(setSuggestions)
        .catch(() => setSuggestions(null));
    }, 400);

    return () => clearTimeout(timer);
  }, [title, content]);

  async function handleCapture(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);

    try {
      await createOwnerNote({
        title,
        content,
        projectId: captureProjectId ? Number(captureProjectId) : null,
        customerId: captureCustomerId ? Number(captureCustomerId) : null,
        employeeId: captureEmployeeId ? Number(captureEmployeeId) : null,
        priority: capturePriority,
      });
      setTitle("");
      setContent("");
      setCaptureProjectId("");
      setCaptureCustomerId("");
      setCaptureEmployeeId("");
      setCapturePriority("Medium");
      setSuggestions(null);
      triggerToast(t("commandCenter.noteCaptured"));
      await loadNotes();
      loadDashboard();
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : t("commandCenter.captureFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStatusChange(note: OwnerNote, status: OwnerNoteStatus) {
    try {
      const updated = await updateOwnerNote(note.id, { status });
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      loadDashboard();
    } catch {
      triggerToast(t("commandCenter.statusUpdateFailed"));
    }
  }

  async function handlePriorityChange(note: OwnerNote, priority: Priority) {
    try {
      const updated = await updateOwnerNote(note.id, { priority });
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      loadDashboard();
    } catch {
      triggerToast(t("commandCenter.priorityUpdateFailed"));
    }
  }

  async function handlePinToggle(note: OwnerNote) {
    try {
      const updated = await updateOwnerNote(note.id, { pinned: !note.pinned });
      setNotes((prev) => {
        const next = prev.map((n) => (n.id === note.id ? updated : n));
        return [...next].sort((a, b) => Number(b.pinned) - Number(a.pinned));
      });
      loadDashboard();
    } catch {
      triggerToast(t("commandCenter.pinUpdateFailed"));
    }
  }

  function startEdit(note: OwnerNote) {
    setEditingNoteId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditProjectId(note.projectId ? String(note.projectId) : "");
    setEditCustomerId(note.customerId ? String(note.customerId) : "");
    setEditEmployeeId(note.employeeId ? String(note.employeeId) : "");
  }

  async function handleEditSave(note: OwnerNote) {
    setIsEditSaving(true);
    try {
      const updated = await updateOwnerNote(note.id, {
        title: editTitle,
        content: editContent,
        projectId: editProjectId ? Number(editProjectId) : null,
        customerId: editCustomerId ? Number(editCustomerId) : null,
        employeeId: editEmployeeId ? Number(editEmployeeId) : null,
      });
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      setEditingNoteId(null);
      triggerToast(t("commandCenter.noteUpdated"));
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : t("commandCenter.noteUpdateFailed"));
    } finally {
      setIsEditSaving(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!noteToDelete) return;
    try {
      await deleteOwnerNote(noteToDelete.id);
      setNotes((prev) => prev.filter((n) => n.id !== noteToDelete.id));
      setNoteToDelete(null);
      triggerToast(t("commandCenter.noteDeleted"));
      loadDashboard();
    } catch {
      triggerToast(t("commandCenter.noteDeleteFailed"));
    }
  }

  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title={t("commandCenter.title")}
        subtitle={t("commandCenter.subtitle")}
      />

      {dashboard && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: t("commandCenter.totalNotes"), value: dashboard.total },
            { label: t("commandCenter.status.Inbox"), value: dashboard.inbox },
            { label: t("commandCenter.status.Reviewed"), value: dashboard.reviewed },
            { label: t("commandCenter.status.Archived"), value: dashboard.archived },
            { label: t("commandCenter.urgent"), value: dashboard.urgent },
            { label: t("commandCenter.pinned"), value: dashboard.pinned },
          ].map((card) => (
            <div key={card.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs text-slate-400">{card.label}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{card.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
        <h3 className="text-lg font-semibold text-white">{t("commandCenter.quickCapture")}</h3>

        <form onSubmit={handleCapture} className="mt-4 space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("commandCenter.titlePlaceholder")}
            required
            className={inputClass}
          />

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t("commandCenter.contentPlaceholder")}
            required
            rows={3}
            className={inputClass}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <select
              value={captureProjectId}
              onChange={(e) => setCaptureProjectId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t("commandCenter.linkProject")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>

            <select
              value={captureCustomerId}
              onChange={(e) => setCaptureCustomerId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t("commandCenter.linkCustomer")}</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>

            <select
              value={captureEmployeeId}
              onChange={(e) => setCaptureEmployeeId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t("commandCenter.linkEmployee")}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.firstName} {employee.lastName}
                </option>
              ))}
            </select>

            <select
              value={capturePriority}
              onChange={(e) => setCapturePriority(e.target.value as Priority)}
              className={inputClass}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {t("commandCenter.priorityLabel", { priority: translatePriority(t, priority) })}
                </option>
              ))}
            </select>
          </div>

          {suggestions &&
            (suggestions.customers.length > 0 ||
              suggestions.projects.length > 0 ||
              suggestions.employees.length > 0) && (
              <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4">
                <p className="mb-3 text-sm font-medium text-orange-400">
                  {t("commandCenter.detected")}
                </p>

                <div className="flex flex-wrap gap-2">
                  {suggestions.customers.map((customer) => (
                    <button
                      key={`customer-${customer.id}`}
                      type="button"
                      onClick={() => setCaptureCustomerId(String(customer.id))}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        captureCustomerId === String(customer.id)
                          ? "bg-orange-500 text-white"
                          : "bg-white/10 text-slate-200 hover:bg-white/20"
                      }`}
                    >
                      👤 {t("commandCenter.linkCustomerAction", { name: customer.name })}
                    </button>
                  ))}

                  {suggestions.projects.map((project) => (
                    <button
                      key={`project-${project.id}`}
                      type="button"
                      onClick={() => setCaptureProjectId(String(project.id))}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        captureProjectId === String(project.id)
                          ? "bg-orange-500 text-white"
                          : "bg-white/10 text-slate-200 hover:bg-white/20"
                      }`}
                    >
                      📁 {t("commandCenter.linkProjectAction", { name: project.name })}
                    </button>
                  ))}

                  {suggestions.employees.map((employee) => (
                    <button
                      key={`employee-${employee.id}`}
                      type="button"
                      onClick={() => setCaptureEmployeeId(String(employee.id))}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        captureEmployeeId === String(employee.id)
                          ? "bg-orange-500 text-white"
                          : "bg-white/10 text-slate-200 hover:bg-white/20"
                      }`}
                    >
                      🧑‍🔧{" "}
                      {t("commandCenter.linkEmployeeAction", {
                        name: `${employee.firstName} ${employee.lastName}`,
                      })}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setSuggestions(null)}
                    className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/10"
                  >
                    {t("commandCenter.saveNoteOnly")}
                  </button>
                </div>
              </div>
            )}

          <Button type="submit">{isSaving ? t("common.saving") : t("commandCenter.captureNote")}</Button>
        </form>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          {(["All", ...OWNER_NOTE_STATUSES] as const).map((option) => (
            <button
              key={option}
              onClick={() => setStatusFilter(option)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                statusFilter === option
                  ? "bg-orange-500 text-white"
                  : "bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              {option === "All" ? t("common.all") : translateOwnerNoteStatus(t, option)}
            </button>
          ))}
        </div>

        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-orange-500 sm:w-auto"
        >
          <option value="">{t("commandCenter.allProjects")}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <select
          value={customerFilter}
          onChange={(e) => setCustomerFilter(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-orange-500 sm:w-auto"
        >
          <option value="">{t("commandCenter.allCustomers")}</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>

        <div className="w-full sm:w-48">
          <DatePicker value={dateFilter} onChange={setDateFilter} placeholder={t("commandCenter.filterByDate")} />
        </div>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as Priority | "All")}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-orange-500 sm:w-auto"
        >
          <option value="All">{t("commandCenter.allPriorities")}</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {translatePriority(t, priority)}
            </option>
          ))}
        </select>

        <button
          onClick={() => setPinnedFilter((v) => !v)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
            pinnedFilter ? "bg-orange-500 text-white" : "bg-white/5 text-slate-400 hover:bg-white/10"
          }`}
        >
          📌 {t("commandCenter.pinnedOnly")}
        </button>

        {(statusFilter !== "All" || projectFilter || customerFilter || dateFilter || priorityFilter !== "All" || pinnedFilter) && (
          <button
            onClick={() => {
              setStatusFilter("All");
              setProjectFilter("");
              setCustomerFilter("");
              setDateFilter("");
              setPriorityFilter("All");
              setPinnedFilter(false);
            }}
            className="text-xs text-orange-500 hover:underline"
          >
            {t("common.clearFilters")}
          </button>
        )}
      </div>

      <div className="mt-6 space-y-4">
        {isLoading ? null : notes.length === 0 ? (
          <EmptyState
            title={t("commandCenter.noNotesYet")}
            description={t("commandCenter.noNotesYetDesc")}
          />
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className={`rounded-3xl border p-6 backdrop-blur-xl ${
                note.pinned ? "border-orange-500/40 bg-orange-500/5" : "border-white/10 bg-white/5"
              }`}
            >
              {editingNoteId === note.id ? (
                <div className="space-y-3">
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className={inputClass}
                    placeholder={t("commandCenter.titlePlaceholder")}
                  />
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className={inputClass}
                    rows={3}
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <select value={editProjectId} onChange={(e) => setEditProjectId(e.target.value)} className={inputClass}>
                      <option value="">{t("commandCenter.noProjectOption")}</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                    <select value={editCustomerId} onChange={(e) => setEditCustomerId(e.target.value)} className={inputClass}>
                      <option value="">{t("commandCenter.noCustomerOption")}</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name}
                        </option>
                      ))}
                    </select>
                    <select value={editEmployeeId} onChange={(e) => setEditEmployeeId(e.target.value)} className={inputClass}>
                      <option value="">{t("commandCenter.noEmployeeOption")}</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.firstName} {employee.lastName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => handleEditSave(note)}>
                      {isEditSaving ? t("common.saving") : t("common.saveChanges")}
                    </Button>
                    <button
                      onClick={() => setEditingNoteId(null)}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="flex items-center gap-2 text-lg font-semibold text-white">
                      {note.pinned && <span title="Pinned">📌</span>}
                      {note.title}
                    </h4>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">
                      {note.content}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${PRIORITY_STYLES[note.priority]}`}>
                      {translatePriority(t, note.priority)}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[note.status]}`}
                    >
                      {translateOwnerNoteStatus(t, note.status)}
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {note.project && (
                  <span className="rounded-full bg-white/10 px-3 py-1 text-slate-300">
                    📁 {note.project.name}
                  </span>
                )}
                {note.customer && (
                  <span className="rounded-full bg-white/10 px-3 py-1 text-slate-300">
                    👤 {note.customer.name}
                  </span>
                )}
                {note.employee && (
                  <span className="rounded-full bg-white/10 px-3 py-1 text-slate-300">
                    🧑‍🔧 {note.employee.firstName} {note.employee.lastName}
                  </span>
                )}
                {note.conversions && note.conversions.length > 0 && (
                  <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-emerald-400">
                    ✓ {t("commandCenter.converted", { count: note.conversions.length })}
                  </span>
                )}
                <span>{new Date(note.createdAt).toLocaleDateString()}</span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {OWNER_NOTE_STATUSES.filter((s) => s !== note.status).map((status) => (
                  <button
                    key={status}
                    onClick={() => handleStatusChange(note, status)}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                  >
                    {t("commandCenter.moveTo", { status: translateOwnerNoteStatus(t, status) })}
                  </button>
                ))}

                <button
                  onClick={() => handlePinToggle(note)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                >
                  {note.pinned ? t("commandCenter.unpin") : t("commandCenter.pin")}
                </button>

                <select
                  value={note.priority}
                  onChange={(e) => handlePriorityChange(note, e.target.value as Priority)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-orange-500"
                >
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {translatePriority(t, priority)}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => startEdit(note)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                >
                  {t("common.edit")}
                </button>

                <button
                  onClick={() => setNoteToDelete(note)}
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20"
                >
                  {t("common.delete")}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmModal
        open={noteToDelete !== null}
        title={t("commandCenter.deleteTitle")}
        message={t("commandCenter.deleteMessage", { title: noteToDelete?.title ?? "" })}
        onConfirm={handleDeleteConfirm}
        onClose={() => setNoteToDelete(null)}
      />

      <Toast show={show} message={message} />
    </div>
  );
}
