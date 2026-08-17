import * as React from "react";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type FieldConfig = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "password" | "select";
  placeholder?: string;
  defaultValue?: string;
  options?: string[];
  required?: boolean;
};

export type PromptModalState = {
  open: boolean;
  title: string;
  description?: string;
  fields: FieldConfig[];
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: (values: Record<string, string>) => void;
  onCancel: () => void;
};

export type ConfirmModalState = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function PromptModal({ modalState }: { modalState: PromptModalState | null }) {
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (modalState?.open) {
      const initial: Record<string, string> = {};
      modalState.fields.forEach((field) => {
        initial[field.name] = field.defaultValue ?? "";
      });
      setFormValues(initial);
    }
  }, [modalState]);

  if (!modalState || !modalState.open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    modalState.onConfirm(formValues);
  };

  return (
    <Dialog open={modalState.open} onOpenChange={(open) => !open && modalState.onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{modalState.title}</DialogTitle>
          {modalState.description && (
            <DialogDescription>{modalState.description}</DialogDescription>
          )}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {modalState.fields.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">{field.label}</label>
              {field.type === "textarea" ? (
                <textarea
                  rows={3}
                  value={formValues[field.name] ?? ""}
                  onChange={(e) => setFormValues({ ...formValues, [field.name]: e.target.value })}
                  placeholder={field.placeholder}
                  required={field.required}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
                />
              ) : field.type === "select" ? (
                <select
                  value={formValues[field.name] ?? ""}
                  onChange={(e) => setFormValues({ ...formValues, [field.name]: e.target.value })}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
                >
                  {field.options?.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type ?? "text"}
                  value={formValues[field.name] ?? ""}
                  onChange={(e) => setFormValues({ ...formValues, [field.name]: e.target.value })}
                  placeholder={field.placeholder}
                  required={field.required}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
                />
              )}
            </div>
          ))}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={modalState.onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={modalState.destructive ? "destructive" : "default"}
            >
              {modalState.confirmLabel ?? "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmModal({ modalState }: { modalState: ConfirmModalState | null }) {
  if (!modalState || !modalState.open) return null;

  return (
    <Dialog open={modalState.open} onOpenChange={(open) => !open && modalState.onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{modalState.title}</DialogTitle>
          {modalState.description && (
            <DialogDescription className="mt-2 text-sm text-muted-foreground">
              {modalState.description}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="pt-4">
          <Button type="button" variant="outline" onClick={modalState.onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={modalState.destructive ? "destructive" : "default"}
            onClick={modalState.onConfirm}
          >
            {modalState.confirmLabel ?? "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
