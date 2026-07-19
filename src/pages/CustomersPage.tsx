import { useEffect, useState } from "react";

import {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerCommunications,
  type CustomerCommunicationLog,
} from "../services/customers.service";

import Modal from "../components/ui/Modal";
import ConfirmModal from "../components/ui/ConfirmModal";
import Toast from "../components/ui/Toast";
import { useToast } from "../hooks/useToast";
import { useTranslation } from "../i18n";
import { useWriteGuard } from "../hooks/useWriteGuard";

import type { Customer } from "../types/customer";

export default function CustomersPage() {
  const { t } = useTranslation();
  const { guardProps } = useWriteGuard();

  const COMMUNICATION_TYPE_LABEL: Record<CustomerCommunicationLog["type"], string> = {
    PhoneCall: t("customers.commType.PhoneCall"),
    Email: t("customers.commType.Email"),
    Meeting: t("customers.commType.Meeting"),
    Other: t("customers.commType.Other"),
  };

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);

  const [historyCustomer, setHistoryCustomer] = useState<Customer | null>(null);
  const [communications, setCommunications] = useState<CustomerCommunicationLog[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

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
      triggerToast(t("customers.added"));
      resetForm();
      setIsAddModalOpen(false);
      await loadCustomers();
    } catch (error) {
      console.error(error);
      triggerToast(t("customers.addFailed"));
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerToEdit) return;
    try {
      await updateCustomer(customerToEdit.id, { name, email, phone, address });
      triggerToast(t("customers.updated"));
      setCustomerToEdit(null);
      resetForm();
      await loadCustomers();
    } catch (error) {
      console.error(error);
      triggerToast(t("customers.updateFailed"));
    }
  };

  const confirmDelete = async () => {
    if (!customerToDelete) return;
    try {
      await deleteCustomer(customerToDelete.id);
      setCustomerToDelete(null);
      triggerToast(t("customers.deleted"));
      await loadCustomers();
    } catch (error) {
      console.error(error);
      triggerToast(t("customers.deleteFailed"));
    }
  };

  async function openHistory(customer: Customer) {
    setHistoryCustomer(customer);
    setIsHistoryLoading(true);
    try {
      const data = await getCustomerCommunications(customer.id);
      setCommunications(data);
    } catch (error) {
      console.error(error);
      triggerToast(t("customers.loadHistoryFailed"));
    } finally {
      setIsHistoryLoading(false);
    }
  }

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const formFields = (
    <div className="space-y-4">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("customers.namePlaceholder")}
        required
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("table.email")}
        type="email"
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
      />
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder={t("table.phone")}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
      />
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder={t("projects.address")}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
      />
    </div>
  );

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-4xl">{t("customers.title")}</h1>
          <p className="mt-2 text-slate-400">
            {t("customers.totalCustomers", { count: customers.length })}
          </p>
        </div>

        <button
          onClick={() => {
            resetForm();
            setIsAddModalOpen(true);
          }}
          {...guardProps}
          className="w-full rounded-xl bg-orange-500 px-5 py-3 font-medium text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {t("customers.addCustomer")}
        </button>
      </div>

      <div className="mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("customers.searchPlaceholder")}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
        />
      </div>

      {loading ? (
        <p>{t("common.loading")}</p>
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

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => openHistory(customer)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:bg-white/10"
                >
                  🕘 {t("customers.history")}
                </button>

                <button
                  onClick={() => setCustomerToEdit(customer)}
                  className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-400 hover:bg-blue-500/20"
                >
                  ✏ {t("common.edit")}
                </button>

                <button
                  onClick={() => setCustomerToDelete(customer)}
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 hover:bg-red-500/20"
                >
                  🗑 {t("common.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      <Modal open={isAddModalOpen} title={t("customers.addModalTitle")} onClose={() => setIsAddModalOpen(false)}>
        <form onSubmit={handleAdd} className="space-y-4">
          {formFields}
          <button
            type="submit"
            className="w-full rounded-xl bg-orange-500 px-5 py-3 font-medium text-white hover:bg-orange-600"
          >
            {t("customers.addCustomer")}
          </button>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        open={customerToEdit !== null}
        title={t("customers.editModalTitle")}
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
            {t("common.saveChanges")}
          </button>
        </form>
      </Modal>

      {/* Communication History — read-only. These rows come from the Owner
          Command Center "Convert to Communication Log" workflow; this is
          the only place they can be reviewed afterward. */}
      <Modal
        open={historyCustomer !== null}
        title={`${t("customers.communicationHistory")} — ${historyCustomer?.name ?? ""}`}
        onClose={() => setHistoryCustomer(null)}
      >
        {isHistoryLoading ? (
          <p className="text-slate-400">{t("common.loading")}</p>
        ) : communications.length === 0 ? (
          <p className="text-slate-400">{t("customers.noCommunication")}</p>
        ) : (
          <div className="space-y-3">
            {communications.map((log) => (
              <div key={log.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">
                    {COMMUNICATION_TYPE_LABEL[log.type]}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(log.occurredAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{log.content}</p>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={customerToDelete !== null}
        title={t("customers.deleteTitle")}
        message={t("customers.deleteMessage", { name: customerToDelete?.name ?? "" })}
        onConfirm={confirmDelete}
        onClose={() => setCustomerToDelete(null)}
      />

      <Toast show={show} message={message} />
    </div>
  );
}
