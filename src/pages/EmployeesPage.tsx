import { useEffect, useState } from "react";

import EmployeeEditModal from "../components/employees/EmployeeEditModal";
import InviteModal from "../components/employees/InviteModal";
import ConfirmModal from "../components/ui/ConfirmModal";
import Toast from "../components/ui/Toast";

import { useToast } from "../hooks/useToast";
import { useWriteGuard } from "../hooks/useWriteGuard";
import { useTranslation } from "../i18n";

import {
  getEmployees,
  updateEmployeeStatus,
  deleteEmployee,
} from "../services/employee.service";
import { getInvites } from "../services/invites.service";

import type { Employee } from "../types/employee";
import type { Invitation } from "../services/invites.service";

export default function EmployeesPage() {
  const { t } = useTranslation();
  const { guardProps } = useWriteGuard();

  const [employees, setEmployees] =
    useState<Employee[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [search, setSearch] =
    useState("");

  const [employeeToDelete, setEmployeeToDelete] =
    useState<Employee | null>(null);

  const [employeeToEdit, setEmployeeToEdit] =
    useState<Employee | null>(null);

  const [isInviteModalOpen, setIsInviteModalOpen] =
    useState(false);

  const [invites, setInvites] =
    useState<Invitation[]>([]);

  const { show, message, triggerToast } =
    useToast();

  const loadEmployees = async () => {
    try {
      const data = await getEmployees();
      setEmployees(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const loadInvites = async () => {
    try {
      const data = await getInvites();
      setInvites(data.filter((invite) => !invite.acceptedAt));
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    loadEmployees();
    loadInvites();
  }, []);

  const handleStatusChange = async (
    employeeId: number,
    status: string
  ) => {
    try {
      await updateEmployeeStatus(
        employeeId,
        status
      );

      triggerToast(t("employees.statusUpdated"));

      await loadEmployees();
    } catch (error) {
      console.error(error);
    }
  };

  const confirmDelete = async () => {
    if (!employeeToDelete) return;

    try {
      await deleteEmployee(
        employeeToDelete.id
      );

      triggerToast(t("employees.deleted"));

      setEmployeeToDelete(null);

      await loadEmployees();
    } catch (error) {
      console.error(error);

      triggerToast(
        error instanceof Error
          ? error.message
          : t("employees.deleteFailed")
      );

      setEmployeeToDelete(null);
    }
  };

  const filteredEmployees =
    employees.filter((employee) =>
      employee.firstName
        .toLowerCase()
        .includes(search.toLowerCase()) ||
      employee.lastName
        .toLowerCase()
        .includes(search.toLowerCase()) ||
      employee.email
        ?.toLowerCase()
        .includes(search.toLowerCase())
    );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Active":
        return (
          <span className="rounded-full bg-green-500/20 px-3 py-1 text-xs font-medium text-green-400">
            {t("employees.statusActive")}
          </span>
        );

      case "Sick":
        return (
          <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-medium text-red-400">
            {t("employees.statusSick")}
          </span>
        );

      case "Vacation":
        return (
          <span className="rounded-full bg-yellow-500/20 px-3 py-1 text-xs font-medium text-yellow-400">
            {t("employees.statusVacation")}
          </span>
        );

      default:
        return status;
    }
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-4xl">
            {t("employees.title")}
          </h1>

          <p className="mt-2 text-slate-400">
            {t("employees.totalEmployees", { count: employees.length })}
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setIsInviteModalOpen(true)}
            {...guardProps}
            className="w-full rounded-xl bg-orange-500 px-5 py-3 font-medium text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {t("employees.inviteEmployee")}
          </button>
        </div>
      </div>

      {invites.length > 0 && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="mb-2 text-sm font-medium text-slate-300">
            {t("employees.pendingInvites")}
          </p>
          <ul className="space-y-1">
            {invites.map((invite) => (
              <li key={invite.id} className="text-sm text-slate-400">
                {invite.email} — {t("employees.expires")}{" "}
                {new Date(invite.expiresAt).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-6">
        <input
          type="text"
          placeholder={t("employees.searchPlaceholder")}
          value={search}
          onChange={(e) =>
            setSearch(e.target.value)
          }
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3"
        />
      </div>

      {loading ? (
        <p>{t("common.loading")}</p>
      ) : (
        <>
          {/* Mobile: cards (no horizontal scroll). Desktop: table. */}
          <div className="space-y-4 sm:hidden">
            {filteredEmployees.map((employee) => (
              <div
                key={employee.id}
                className="rounded-3xl border border-white/10 bg-white/5 p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">
                      {employee.firstName} {employee.lastName}
                    </p>
                    {employee.email && (
                      <p className="text-sm text-slate-400">{employee.email}</p>
                    )}
                    {employee.phone && (
                      <p className="text-sm text-slate-400">{employee.phone}</p>
                    )}
                  </div>
                  {getStatusBadge(employee.status)}
                </div>

                <select
                  value={employee.status}
                  onChange={(e) => handleStatusChange(employee.id, e.target.value)}
                  className="mt-4 w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2"
                >
                  <option value="Active">{t("employees.statusActive")}</option>
                  <option value="Sick">{t("employees.statusSick")}</option>
                  <option value="Vacation">{t("employees.statusVacation")}</option>
                </select>

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setEmployeeToEdit(employee)}
                    className="flex-1 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-400 hover:bg-blue-500/20"
                  >
                    ✏ {t("common.edit")}
                  </button>

                  <button
                    onClick={() => setEmployeeToDelete(employee)}
                    className="flex-1 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 hover:bg-red-500/20"
                  >
                    🗑 {t("common.delete")}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-3xl border border-white/10 bg-white/5 sm:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    <th className="p-4">{t("table.id")}</th>
                    <th className="p-4">{t("table.firstName")}</th>
                    <th className="p-4">{t("table.lastName")}</th>
                    <th className="p-4">{t("table.phone")}</th>
                    <th className="p-4">{t("table.email")}</th>
                    <th className="p-4">{t("table.status")}</th>
                    <th className="p-4">{t("table.change")}</th>
                    <th className="p-4">{t("table.actions")}</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredEmployees.map((employee) => (
                    <tr
                      key={employee.id}
                      className="border-b border-white/5"
                    >
                      <td className="p-4">{employee.id}</td>
                      <td className="p-4">{employee.firstName}</td>
                      <td className="p-4">{employee.lastName}</td>
                      <td className="p-4">{employee.phone}</td>
                      <td className="p-4">{employee.email}</td>

                      <td className="p-4">
                        {getStatusBadge(employee.status)}
                      </td>

                      <td className="p-4">
                        <select
                          value={employee.status}
                          onChange={(e) =>
                            handleStatusChange(
                              employee.id,
                              e.target.value
                            )
                          }
                          className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2"
                        >
                          <option value="Active">{t("employees.statusActive")}</option>
                          <option value="Sick">{t("employees.statusSick")}</option>
                          <option value="Vacation">{t("employees.statusVacation")}</option>
                        </select>
                      </td>

                      <td className="p-4 flex gap-2">
                        <button
                          onClick={() =>
                            setEmployeeToEdit(employee)
                          }
                          className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-400 hover:bg-blue-500/20"
                        >
                          ✏ {t("common.edit")}
                        </button>

                        <button
                          onClick={() =>
                            setEmployeeToDelete(employee)
                          }
                          className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 hover:bg-red-500/20"
                        >
                          🗑 {t("common.delete")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <InviteModal
        open={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        onSuccess={loadInvites}
      />

      <EmployeeEditModal
        open={employeeToEdit !== null}
        employee={employeeToEdit}
        onClose={() => setEmployeeToEdit(null)}
        onSuccess={loadEmployees}
      />

      <ConfirmModal
        open={employeeToDelete !== null}
        title={t("employees.deleteTitle")}
        message={t("employees.deleteMessage", {
          name: `${employeeToDelete?.firstName ?? ""} ${employeeToDelete?.lastName ?? ""}`,
        })}
        onConfirm={confirmDelete}
        onClose={() => setEmployeeToDelete(null)}
      />

      <Toast show={show} message={message} />
    </div>
  );
}
