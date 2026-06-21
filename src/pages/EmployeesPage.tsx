import { useEffect, useState } from "react";

import EmployeeEditModal from "../components/employees/EmployeeEditModal";
import InviteModal from "../components/employees/InviteModal";
import ConfirmModal from "../components/ui/ConfirmModal";
import Toast from "../components/ui/Toast";

import { useToast } from "../hooks/useToast";

import {
  getEmployees,
  updateEmployeeStatus,
  deleteEmployee,
} from "../services/employee.service";
import { getInvites } from "../services/invites.service";

import type { Employee } from "../types/employee";
import type { Invitation } from "../services/invites.service";

export default function EmployeesPage() {
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

      triggerToast("Status updated");

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

      triggerToast("Employee deleted");

      setEmployeeToDelete(null);

      await loadEmployees();
    } catch (error) {
      console.error(error);

      triggerToast(
        error instanceof Error
          ? error.message
          : "Failed to delete employee"
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
            Active
          </span>
        );

      case "Sick":
        return (
          <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-medium text-red-400">
            Sick
          </span>
        );

      case "Vacation":
        return (
          <span className="rounded-full bg-yellow-500/20 px-3 py-1 text-xs font-medium text-yellow-400">
            Vacation
          </span>
        );

      default:
        return status;
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold">
            Employees
          </h1>

          <p className="mt-2 text-slate-400">
            Total Employees: {employees.length}
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setIsInviteModalOpen(true)}
            className="rounded-xl bg-orange-500 px-5 py-3 font-medium text-white hover:bg-orange-600"
          >
            Invite employee
          </button>
        </div>
      </div>

      {invites.length > 0 && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="mb-2 text-sm font-medium text-slate-300">
            Pending invites
          </p>
          <ul className="space-y-1">
            {invites.map((invite) => (
              <li key={invite.id} className="text-sm text-slate-400">
                {invite.email} — expires{" "}
                {new Date(invite.expiresAt).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-6">
        <input
          type="text"
          placeholder="Search employees..."
          value={search}
          onChange={(e) =>
            setSearch(e.target.value)
          }
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3"
        />
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="p-4">ID</th>
                <th className="p-4">First Name</th>
                <th className="p-4">Last Name</th>
                <th className="p-4">Phone</th>
                <th className="p-4">Email</th>
                <th className="p-4">Status</th>
                <th className="p-4">Change</th>
                <th className="p-4">Actions</th>
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
                      <option value="Active">Active</option>
                      <option value="Sick">Sick</option>
                      <option value="Vacation">Vacation</option>
                    </select>
                  </td>

                  <td className="p-4 flex gap-2">
                    <button
                      onClick={() =>
                        setEmployeeToEdit(employee)
                      }
                      className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-400 hover:bg-blue-500/20"
                    >
                      ✏ Edit
                    </button>

                    <button
                      onClick={() =>
                        setEmployeeToDelete(employee)
                      }
                      className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 hover:bg-red-500/20"
                    >
                      🗑 Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        title="Delete Employee"
        message={`Are you sure you want to delete ${employeeToDelete?.firstName ?? ""} ${employeeToDelete?.lastName ?? ""}?`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDelete}
        onClose={() => setEmployeeToDelete(null)}
      />

      <Toast show={show} message={message} />
    </div>
  );
}