import { useEffect, useState } from "react";

import { getEmployees } from "../services/employee.service";
import type { Employee } from "../types/employee";

import EmployeeModal from "../components/employees/EmployeeModal";

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
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

    loadEmployees();
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-4xl font-bold">
          Employees
        </h1>

        <button
          onClick={() => setIsModalOpen(true)}
          className="
            rounded-xl
            bg-orange-500
            px-5
            py-3
            font-medium
            text-white
            transition
            hover:bg-orange-600
          "
        >
          Add Employee
        </button>
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
              </tr>
            </thead>

            <tbody>
              {employees.map((employee) => (
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
                    {employee.active
                      ? "Active"
                      : "Inactive"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EmployeeModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}