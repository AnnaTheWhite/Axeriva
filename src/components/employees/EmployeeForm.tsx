import { useState } from "react";

import { createEmployee } from "../../services/employee.service";

import { useToast } from "../../hooks/useToast";
import Toast from "../ui/Toast";

type EmployeeFormProps = {
  onSuccess: () => void;
};

export default function EmployeeForm({
  onSuccess,
}: EmployeeFormProps) {
  const [firstName, setFirstName] =
    useState("");

  const [lastName, setLastName] =
    useState("");

  const [phone, setPhone] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [status, setStatus] =
    useState("Active");

  const {
    show,
    message,
    triggerToast,
  } = useToast();

  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    try {
      await createEmployee({
        firstName,
        lastName,
        phone,
        email,
        status,
      });

      setFirstName("");
      setLastName("");
      setPhone("");
      setEmail("");
      setStatus("Active");

      triggerToast(
        "Employee created successfully"
      );

      onSuccess();
    } catch (error) {
      console.error(error);

      triggerToast(
        "Failed to create employee"
      );
    }
  };

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        <div>
          <label className="mb-2 block text-sm">
            First Name
          </label>

          <input
            value={firstName}
            onChange={(e) =>
              setFirstName(
                e.target.value
              )
            }
            className="
              w-full
              rounded-xl
              border
              border-white/10
              bg-white/5
              px-4
              py-3
              outline-none
            "
          />
        </div>

        <div>
          <label className="mb-2 block text-sm">
            Last Name
          </label>

          <input
            value={lastName}
            onChange={(e) =>
              setLastName(
                e.target.value
              )
            }
            className="
              w-full
              rounded-xl
              border
              border-white/10
              bg-white/5
              px-4
              py-3
              outline-none
            "
          />
        </div>

        <div>
          <label className="mb-2 block text-sm">
            Phone
          </label>

          <input
            value={phone}
            onChange={(e) =>
              setPhone(e.target.value)
            }
            className="
              w-full
              rounded-xl
              border
              border-white/10
              bg-white/5
              px-4
              py-3
              outline-none
            "
          />
        </div>

        <div>
          <label className="mb-2 block text-sm">
            Email
          </label>

          <input
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            className="
              w-full
              rounded-xl
              border
              border-white/10
              bg-white/5
              px-4
              py-3
              outline-none
            "
          />
        </div>

        <div>
          <label className="mb-2 block text-sm">
            Status
          </label>

          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value)
            }
            className="
              w-full
              rounded-xl
              border
              border-white/10
              bg-white/5
              px-4
              py-3
              outline-none
            "
          >
            <option value="Active">
              Active
            </option>

            <option value="Sick">
              Sick
            </option>

            <option value="Vacation">
              Vacation
            </option>
          </select>
        </div>

        <button
          type="submit"
          className="
            w-full
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
          Save Employee
        </button>
      </form>

      <Toast
        show={show}
        message={message}
      />
    </>
  );
}