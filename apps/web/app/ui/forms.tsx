"use client";

import { useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Icon, type IconName } from "./icons";

/** Submit button that disables itself and shows progress while its form's server action runs. */
export function SubmitButton({ children, pending: pendingLabel, className, icon, name, value, disabled }: {
  children: React.ReactNode; pending?: string; className?: string; icon?: IconName; name?: string; value?: string; disabled?: boolean;
}) {
  const { pending, data } = useFormStatus();
  // With several submit buttons in one form, only the one that was pressed shows the spinner.
  const mine = pending && (!name || data?.get(name) === value);
  return (
    <button type="submit" className={className} name={name} value={value} disabled={disabled || pending} aria-busy={mine || undefined}>
      {mine ? <span className="spinner" aria-hidden /> : icon ? <Icon name={icon} size={16} /> : null}
      {mine && pendingLabel ? pendingLabel : children}
    </button>
  );
}

/**
 * A button that opens a confirmation dialog before running a destructive server action.
 * Uses the native <dialog> element: focus is trapped, Escape and the backdrop close it.
 */
export function ConfirmButton({ action, label, title, children, confirmLabel, pendingLabel, className = "danger", icon, hidden }: {
  action: (formData: FormData) => void | Promise<void>; label: string; title: string; children: React.ReactNode;
  confirmLabel: string; pendingLabel?: string; className?: string; icon?: IconName; hidden?: Record<string, string>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onClick = (e: MouseEvent) => { // a click on the backdrop lands on the dialog itself, outside its box
      const r = d.getBoundingClientRect();
      if (e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) d.close();
    };
    d.addEventListener("click", onClick);
    return () => d.removeEventListener("click", onClick);
  }, []);
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.showModal()}>
        {icon && <Icon name={icon} size={16} />}{label}
      </button>
      <dialog ref={ref} className="modal" aria-labelledby={titleId}>
        <form action={action}>
          {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div className="modal-icon"><Icon name="alert" size={22} /></div>
          <h2 id={titleId}>{title}</h2>
          <div className="modal-body">{children}</div>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={() => ref.current?.close()} autoFocus>Cancel</button>
            <SubmitButton className="danger-solid" pending={pendingLabel}>{confirmLabel}</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
