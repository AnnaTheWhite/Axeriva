import { useState } from "react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Toast from "../ui/Toast";
import { useToast } from "../../hooks/useToast";
import { createInvite } from "../../services/invites.service";

type InviteModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function InviteModal({
  open,
  onClose,
  onSuccess,
}: InviteModalProps) {
  const [email, setEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { show, message, triggerToast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const invite = await createInvite(email);
      setInviteLink(invite.inviteLink ?? null);
      onSuccess();
    } catch (error) {
      triggerToast(
        error instanceof Error ? error.message : "Failed to create invite."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleClose() {
    setEmail("");
    setInviteLink(null);
    onClose();
  }

  return (
    <Modal open={open} title="Invite employee" onClose={handleClose}>
      {inviteLink ? (
        <div className="space-y-4">
          <p className="text-slate-300">
            Invite created. Email sending isn't wired up yet — share this
            link with the employee directly:
          </p>
          <input
            readOnly
            value={inviteLink}
            onClick={(e) => e.currentTarget.select()}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white"
          />
          <Button onClick={handleClose}>Done</Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-white/70">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-orange-500"
            />
          </div>

          <Button type="submit">
            {isSubmitting ? "Sending invite..." : "Send invite"}
          </Button>
        </form>
      )}

      <Toast show={show} message={message} />
    </Modal>
  );
}
