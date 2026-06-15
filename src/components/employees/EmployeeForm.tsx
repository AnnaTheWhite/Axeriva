import { useState } from "react";
import { createEmployee } from "../../services/employee.service";

export default function EmployeeForm() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

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
      });

      alert("Employee created successfully");

      setFirstName("");
      setLastName("");
      setPhone("");
      setEmail("");
    } catch (error) {
      console.error(error);

      alert("Failed to create employee");
    }
  };

  return (
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
            setFirstName(e.target.value)
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
            setLastName(e.target.value)
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
  );
}