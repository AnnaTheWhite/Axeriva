import { useState } from "react";

export function useToast() {
  const [show, setShow] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const triggerToast = (
    text: string
  ) => {
    setMessage(text);
    setShow(true);

    setTimeout(() => {
      setShow(false);
    }, 3000);
  };

  return {
    show,
    message,
    triggerToast,
  };
}