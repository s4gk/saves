"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Icon } from "@/components/Icon";

/**
 * Diálogo de confirmación reutilizable (reemplaza a window.confirm).
 * Controlado por `open`; llama a `onConfirm` al aceptar y `onClose` al cancelar.
 *
 * Para acciones que tocan producción de verdad, `requireText` obliga a teclear
 * un texto exacto (normalmente el serial o el nombre del recurso). Pulsar
 * "Aceptar" por inercia es justo como se borra lo que no se quería borrar.
 *
 * `requireReason` pide además el PORQUÉ (mínimo 3 caracteres) y se lo pasa a
 * `onConfirm`: en un borrado la fila desaparece y el motivo es lo único que queda
 * para responder después "¿quién borró esto y por qué?".
 */
export function ConfirmDialog({
  open,
  title = "Confirmar acción",
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "danger",
  icon,
  busy = false,
  requireText,
  requireHint,
  detail,
  requireReason = false,
  reasonLabel = "Motivo",
  reasonPlaceholder = "¿Por qué se elimina?",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  icon?: string;
  busy?: boolean;
  /** Si se indica, hay que teclearlo exactamente para habilitar el botón. */
  requireText?: string;
  /** Texto sobre el campo de confirmación. */
  requireHint?: React.ReactNode;
  /** Bloque secundario (comandos, consecuencias) bajo el mensaje principal. */
  detail?: React.ReactNode;
  /** Exige escribir el motivo; llega a `onConfirm` ya recortado. */
  requireReason?: boolean;
  reasonLabel?: React.ReactNode;
  reasonPlaceholder?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const danger = tone === "danger";
  const [tecleado, setTecleado] = useState("");
  const [motivo, setMotivo] = useState("");

  // Limpiar al abrir: si no, se arrastra lo escrito en la confirmación anterior
  // y el botón aparecería ya habilitado para OTRO recurso.
  useEffect(() => { if (open) { setTecleado(""); setMotivo(""); } }, [open]);

  const faltaMotivo = requireReason && motivo.trim().length < 3;
  const bloqueado = (!!requireText && tecleado.trim() !== requireText.trim()) || faltaMotivo;
  const confirmar = () => onConfirm(motivo.trim());

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-md">
      <div className="flex gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${danger ? "bg-error-soft text-error-text" : "bg-brand-soft text-brand"}`}>
          <Icon name={icon ?? (danger ? "alert-triangle" : "alert-circle")} size={20} />
        </span>
        {/* min-w-0: sin esto el item flex no baja de su ancho de contenido y un
            mensaje con texto largo sin espacios desborda el modal en vez de cortarse. */}
        <div className="min-w-0 flex-1 text-[13px] text-text-secondary">{message}</div>
      </div>

      {detail && <div className="mt-3">{detail}</div>}

      {requireReason && (
        <label className="mt-4 block text-[12px] text-text-secondary">
          {reasonLabel} <span className="text-error-text">*</span>
          <Textarea
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={reasonPlaceholder}
            maxLength={500}
            rows={3}
            className="mt-1"
          />
        </label>
      )}

      {requireText && (
        <label className="mt-4 block text-[12px] text-text-secondary">
          {requireHint ?? <>Escriba <span className="font-mono font-semibold text-text-primary">{requireText}</span> para confirmar</>}
          <Input
            autoFocus={!requireReason}
            value={tecleado}
            onChange={(e) => setTecleado(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !bloqueado && !busy) confirmar(); }}
            placeholder={requireText}
            className="mt-1 font-mono"
          />
        </label>
      )}

      {/* En móvil los botones se apilan a ancho completo (acción principal
          arriba, cancelar abajo, como una hoja de acciones nativa); desde `sm`
          vuelven a la fila alineada a la derecha. */}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose} disabled={busy} className="w-full sm:w-auto">
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          onClick={confirmar}
          disabled={busy || bloqueado}
          className="w-full sm:w-auto"
        >
          {busy && <Icon name="loader" size={15} className="animate-spin" />}
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
