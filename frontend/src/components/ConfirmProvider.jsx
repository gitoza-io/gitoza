import { createContext, useCallback, useContext, useRef, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

const ConfirmContext = createContext(null);

/**
 * Wraps the app and provides `useConfirm()` for async confirmation dialogs (replaces window.confirm).
 */
export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({
        title: options.title ?? "Confirm",
        description: options.description ?? "",
        confirmLabel: options.confirmLabel ?? "Confirm",
        cancelLabel: options.cancelLabel ?? "Cancel",
        variant: options.variant ?? "default",
        closeOnBackdrop: options.closeOnBackdrop !== false,
      });
    });
  }, []);

  const handleClose = useCallback((result) => {
    setDialog(null);
    const r = resolveRef.current;
    resolveRef.current = null;
    if (r) r(result);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={!!dialog}
        title={dialog?.title}
        description={dialog?.description}
        confirmLabel={dialog?.confirmLabel}
        cancelLabel={dialog?.cancelLabel}
        variant={dialog?.variant}
        closeOnBackdrop={dialog?.closeOnBackdrop}
        onConfirm={() => handleClose(true)}
        onCancel={() => handleClose(false)}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return ctx;
}
