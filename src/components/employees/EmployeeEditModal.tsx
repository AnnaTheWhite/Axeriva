import { useEffect, useState } from "react";

import Modal from "../ui/Modal";
import { updateEmployee } from "../../services/employee.service";

type Employee = {
  id: number;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  status: string;
};

type Props = {
  open: boolean;
  employee: Employee | null;
  onClose: () => void;
  onSuccess: () => void;
};

export default function EmployeeEditModal({
  open,
  employee,
  onClose,
  onSuccess,
}: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("Active");

  useEffect(() => {
    if (employee) {
      setFirstName(employee.firstName);
      setLastName(employee.lastName);
      setPhone(employee.phone ?? "");
      setEmail(employee.email ?? "");
      setStatus(employee.status);
    }
  }, [employee]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!employee) return;

    try {
      await updateEmployee(employee.id, {
        firstName,
        lastName,
        phone,
        email,
        status,
      });

      onSuccess();
      onClose();
    } catch (error) {
      console.error(error);
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} title="Edit Employee" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="First Name"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3"
        />

        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Last Name"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3"
        />

        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3"
        />

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3"
        />

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3"
        >
          <option value="Active">Active</option>
          <option value="Sick">Sick</option>
          <option value="Vacation">Vacation</option>
        </select>

        <button
          type="submit"
          className="w-full rounded-xl bg-orange-500 px-5 py-3 font-medium text-white"
        >
          Save Changes
        </button>
      </form>
    </Modal>
  );
}