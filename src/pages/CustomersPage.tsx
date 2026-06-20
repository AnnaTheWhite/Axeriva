import { useEffect, useState } from "react";

import {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from "../services/customers.service";

import Modal from "../components/ui/Modal";
import ConfirmModal from "../components/ui/ConfirmModal";
import Toast from "../components/ui/Toast";
import { useToast } from "../hooks/useToast";

import type { Customer } from "../types/customer";

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");

  const { show, message, triggerToast } = useToast();

  const loadCustomers = async () => {
    try {
      const data = await getCustomers();
      setCustomers(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  // Prefill edit form
  useEffect(() => {
    if (customerToEdit) {
      setName(customerToEdit.name);
      setEmail(customerToEdit.email ?? "");
      setPhone(customerToEdit.phone ?? "");
      setAddress(customerToEdit.address ?? "");
    }
  }, [customerToEdit]);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPhone("");
    setAddress("");
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createCustomer({ name, email, phone, address });
      triggerToast("Customer added");
      resetForm();
      setIsAddModalOpen(false);
      await loadCustomers();
    } catch (error) {
      console.error(error);
      triggerToast("Failed to add customer");
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerToEdit) return;
    try {
      await updateCustomer(customerToEdit.id, { name, email, phone, address });
      triggerToast("Customer updated");
      setCustomerToEdit(null);
      resetForm();
      await loadCustomers();
    } catch (error) {
      console.error(error);
      triggerToast("Failed to update customer");
    }
  };

  const confirmDelete = async () => {
    if (!customerToDelete) return;
    try {
      await deleteCustomer(customerToDelete.id);
      setCustomerToDelete(null);
      triggerToast("Customer deleted");
      await loadCustomers();
    } catch (error) {
      console.error(error);
      triggerToast("Failed to delete customer");
    }
  };

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const formFields = (
    <div className="space-y-4">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name *"
        required
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        type="email"
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
      />
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone"
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
      />
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Address"
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
      />
    </div>
  );

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold">Customers</h1>
          <p className="mt-2 text-slate-400">
            Total Customers: {customers.length}
          </p>
        </div>

        <button
          onClick={() => {
            resetForm();
            setIsAddModalOpen(true);
          }}
          className="rounded-xl bg-orange-500 px-5 py-3 font-medium text-white hover:bg-orange-600"
        >
          Add Customer
        </button>
      </div>

      <div className="mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customers..."
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
        />
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="space-y-4">
          {filteredCustomers.map((customer) => (
            <div
              key={customer.id}
              className="rounded-3xl border border-white/10 bg-white/5 p-6"
            >
              <h2 className="text-xl font-semibold">{customer.name}</h2>

              {customer.email && (
                <p className="mt-1 text-slate-400">{customer.email}</p>
              )}
              {customer.phone && (
                <p className="text-slate-400">{customer.phone}</p>
              )}
              {customer.address && (
                <p className="text-slate-400">{customer.address}</p>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setCustomerToEdit(customer)}
                  className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-400 hover:bg-blue-500/20"
                >
                  ✏ Edit
                </button>

                <button
                  onClick={() => setCustomerToDelete(customer)}
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
      <Modal open={isAddModalOpen} title="Add Customer" onClose={() => setIsAddModalOpen(false)}>
        <form onSubmit={handleAdd} className="space-y-4">
          {formFields}
          <button
            type="submit"
            className="w-full rounded-xl bg-orange-500 px-5 py-3 font-medium text-white hover:bg-orange-600"
          >
            Add Customer
          </button>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        open={customerToEdit !== null}
        title="Edit Customer"
        onClose={() => {
          setCustomerToEdit(null);
          resetForm();
        }}
      >
        <form onSubmit={handleEdit} className="space-y-4">
          {formFields}
          <button
            type="submit"
            className="w-full rounded-xl bg-orange-500 px-5 py-3 font-medium text-white hover:bg-orange-600"
          >
            Save Changes
          </button>
        </form>
      </Modal>

      <ConfirmModal
        open={customerToDelete !== null}
        title="Delete Customer"
        message={`Are you sure you want to delete ${customerToDelete?.name ?? ""}?`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDelete}
        onClose={() => setCustomerToDelete(null)}
      />

      <Toast show={show} message={message} />
    </div>
  );
}
