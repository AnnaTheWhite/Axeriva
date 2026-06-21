import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import Button from "../components/ui/Button";
import Toast from "../components/ui/Toast";
import DatePicker from "../components/ui/DatePicker";
import { useToast } from "../hooks/useToast";
import {
  getOwnerNotes,
  createOwnerNote,
  updateOwnerNote,
  detectOwnerNoteEntities,
} from "../services/ownerNotes.service";
import { getProjects } from "../services/project.service";
import { getCustomers } from "../services/customers.service";
import { getEmployees } from "../services/employee.service";
import {
  OWNER_NOTE_STATUSES,
  type DetectedEntities,
  type OwnerNote,
  type OwnerNoteStatus,
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

export default function OwnerCommandCenterPage() {
  const [notes, setNotes] = useState<OwnerNote[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Quick capture form
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [captureProjectId, setCaptureProjectId] = useState("");
  const [captureCustomerId, setCaptureCustomerId] = useState("");
  const [captureEmployeeId, setCaptureEmployeeId] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Suggestions panel — detection only, owner decides what (if anything)
  // to link. Re-runs on a short debounce as title/content change.
  const [suggestions, setSuggestions] = useState<DetectedEntities | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<OwnerNoteStatus | "All">("All");
  const [projectFilter, setProjectFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const { show, message, triggerToast } = useToast();

  async function loadNotes() {
    try {
      const data = await getOwnerNotes({
        status: statusFilter === "All" ? undefined : statusFilter,
        projectId: projectFilter ? Number(projectFilter) : undefined,
        customerId: customerFilter ? Number(customerFilter) : undefined,
        date: dateFilter || undefined,
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
  }, []);

  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, projectFilter, customerFilter, dateFilter]);

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
      });
      setTitle("");
      setContent("");
      setCaptureProjectId("");
      setCaptureCustomerId("");
      setCaptureEmployeeId("");
      setSuggestions(null);
      triggerToast("Note captured");
      await loadNotes();
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : "Failed to capture note");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStatusChange(note: OwnerNote, status: OwnerNoteStatus) {
    try {
      const updated = await updateOwnerNote(note.id, { status });
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
    } catch {
      triggerToast("Failed to update status");
    }
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Owner Command Center"
        subtitle="Quick capture for thoughts, reminders, and project notes."
      />

      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
        <h3 className="text-lg font-semibold text-white">Quick Capture</h3>

        <form onSubmit={handleCapture} className="mt-4 space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            required
            className={inputClass}
          />

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Need to order more cable for Kovács project. Peter should visit on Friday."
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
              <option value="">Link to project (optional)</option>
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
              <option value="">Link to customer (optional)</option>
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
              <option value="">Link to employee (optional)</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.firstName} {employee.lastName}
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
                  Detected in this note — link if relevant, or ignore:
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
                      👤 Link Customer: {customer.name}
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
                      📁 Link Project: {project.name}
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
                      🧑‍🔧 Link Employee: {employee.firstName} {employee.lastName}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setSuggestions(null)}
                    className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/10"
                  >
                    Save note only
                  </button>
                </div>
              </div>
            )}

          <Button type="submit">{isSaving ? "Saving..." : "Capture note"}</Button>
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
              {option}
            </button>
          ))}
        </div>

        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-orange-500"
        >
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <select
          value={customerFilter}
          onChange={(e) => setCustomerFilter(e.target.value)}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-orange-500"
        >
          <option value="">All customers</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>

        <div className="w-48">
          <DatePicker value={dateFilter} onChange={setDateFilter} placeholder="Filter by date" />
        </div>

        {(statusFilter !== "All" || projectFilter || customerFilter || dateFilter) && (
          <button
            onClick={() => {
              setStatusFilter("All");
              setProjectFilter("");
              setCustomerFilter("");
              setDateFilter("");
            }}
            className="text-xs text-orange-500 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-6 space-y-4">
        {isLoading ? null : notes.length === 0 ? (
          <EmptyState
            title="No notes yet"
            description="Capture a quick thought above to get started."
          />
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-lg font-semibold text-white">{note.title}</h4>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">
                    {note.content}
                  </p>
                </div>

                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[note.status]}`}
                >
                  {note.status}
                </span>
              </div>

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
                <span>{new Date(note.createdAt).toLocaleDateString()}</span>
              </div>

              <div className="mt-4 flex gap-2">
                {OWNER_NOTE_STATUSES.filter((s) => s !== note.status).map((status) => (
                  <button
                    key={status}
                    onClick={() => handleStatusChange(note, status)}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                  >
                    Move to {status}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <Toast show={show} message={message} />
    </div>
  );
}
