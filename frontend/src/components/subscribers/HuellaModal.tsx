"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/Icon";
import { abrirHuellero, diagnosticarAgente, SinAgenteError, type Huellero } from "@/lib/huellero";

type Paso = "conectando" | "sin-agente" | "bloqueado" | "permiso" | "sin-lector" | "esperando" | "error";

/**
 * Captura de la huella del cliente con el huellero USB (DigitalPersona / HID).
 *
 * El lector queda encendido mientras el modal está abierto: cada dedo que se apoya
 * reemplaza la vista previa, así que repetir una toma mala es volver a poner el
 * dedo. No se guarda nada hasta pulsar «Guardar huella»: la primera lectura casi
 * nunca es la buena y la que se guarda sale impresa en el contrato.
 */
export function HuellaModal({
  open,
  onClose,
  nombre,
  onCapturada,
}: {
  open: boolean;
  onClose: () => void;
  nombre?: string | null;
  /** Sube la imagen por el mismo camino que el archivo elegido a mano. */
  onCapturada: (file: File) => Promise<boolean>;
}) {
  const [paso, setPaso] = useState<Paso>("conectando");
  const [aviso, setAviso] = useState<string | null>(null);
  const [png, setPng] = useState<Blob | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  /** Sube al reintentar: vuelve a correr la conexión con el agente. */
  const [intento, setIntento] = useState(0);
  const huellero = useRef<Huellero | null>(null);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    setPaso("conectando");
    setAviso(null);
    setPng(null);

    async function encender(h: Huellero) {
      const n = await h.lectores();
      traza(`lectores: ${n}`);
      if (n === 0) return setPaso("sin-lector");
      await h.iniciar();
      if (vivo) setPaso("esperando");
    }
    // Lo que pasa con el huellero sólo se ve en el PC de caja: va al log del servidor
    // (`grep Huellero`) para poder diagnosticar un «no lee» sin estar allí.
    const traza = (texto: string) => {
      void fetch("/reporte-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ ruta: window.location.pathname, mensaje: `[Huellero] ${texto}` }),
      }).catch(() => {});
    };
    traza("modal abierto");
    // Sin conexión con el agente: o no está instalado o el navegador no deja llegar a él.
    let diagnosticando = false;
    const sinAgente = () => {
      if (diagnosticando) return;
      diagnosticando = true;
      void diagnosticarAgente(() => vivo && setIntento((n) => n + 1)).then((d) => {
        traza(`diagnóstico: ${d.detalle}`);
        if (!vivo) return;
        // Con el permiso sin contestar la petición se queda colgada: no es que falte el programa.
        if (d.permiso === "denied") setPaso("bloqueado");
        else if (d.permiso === "prompt" && !d.responde) setPaso("permiso");
        else setPaso("sin-agente");
      });
    };
    const fallo = (e: unknown) => {
      traza(`fallo: ${e instanceof Error ? e.message : String(e)}`);
      if (!vivo) return;
      if (e instanceof SinAgenteError) return sinAgente();
      setAviso(e instanceof Error ? e.message : null);
      setPaso("error");
    };

    void abrirHuellero({
      onHuella: (blob) => {
        if (!vivo) return;
        setAviso(null);
        setPng(blob);
      },
      onCalidad: (m) => vivo && setAviso(m),
      // Enchufarlo con el modal abierto lo enciende sin tener que reintentar.
      onConectado: () => {
        if (vivo && huellero.current) void encender(huellero.current).catch(fallo);
      },
      onDesconectado: () => vivo && setPaso("sin-lector"),
      onSinAgente: () => vivo && sinAgente(),
      onTraza: traza,
    })
      .then((h) => {
        if (!vivo) return h.cerrar();
        huellero.current = h;
        return encender(h);
      })
      .catch(fallo);

    return () => {
      vivo = false;
      huellero.current?.cerrar();
      huellero.current = null;
    };
  }, [open, intento]);

  useEffect(() => {
    if (!png) return setVista(null);
    const url = URL.createObjectURL(png);
    setVista(url);
    return () => URL.revokeObjectURL(url);
  }, [png]);

  async function guardar() {
    if (!png) return;
    setGuardando(true);
    try {
      if (await onCapturada(new File([png], "huella.png", { type: "image/png" }))) onClose();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Huella del contrato" maxWidth="max-w-md">
      <p className="mb-2 text-[12px] text-text-tertiary">
        {nombre ? `Huella de ${nombre}. ` : ""}
        Pida al cliente apoyar el índice derecho sobre el lector. Queda en el contrato y en el anexo.
      </p>

      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border-subtle bg-surface-2/30 p-3">
        {vista ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={vista} alt="Huella capturada" className="max-h-full max-w-full rounded object-contain" />
        ) : paso === "conectando" ? (
          <span className="text-[12px] text-text-tertiary">Buscando el huellero…</span>
        ) : paso === "esperando" ? (
          <span className="text-center text-[13px] font-medium text-text-primary">Ponga el dedo en el lector</span>
        ) : paso === "sin-lector" ? (
          <span className="px-4 text-center text-[12px] text-text-secondary">
            No hay ningún huellero conectado. Enchúfelo a un puerto USB de este equipo.
          </span>
        ) : paso === "permiso" ? (
          <div className="px-2 text-center text-[12px] text-text-secondary">
            <p className="font-medium text-text-primary">Falta darle permiso al navegador</p>
            <p className="mt-1">
              Chrome pregunta, arriba a la izquierda, si esta página puede conectarse a apps de este
              dispositivo / a la red local: pulse «Permitir». Si el aviso no aparece, pulse el icono a la
              izquierda de la dirección → «Configuración del sitio» y póngalo en «Permitir».
            </p>
          </div>
        ) : paso === "bloqueado" ? (
          <div className="px-2 text-center text-[12px] text-text-secondary">
            <p className="font-medium text-text-primary">El navegador está bloqueando el huellero</p>
            <p className="mt-1">
              Pulse el icono a la izquierda de la dirección (candado o ajustes), entre a «Configuración del
              sitio» y ponga en «Permitir» el acceso a la red local / a las apps de este dispositivo. Luego
              recargue la página.
            </p>
          </div>
        ) : paso === "sin-agente" ? (
          <div className="px-2 text-center text-[12px] text-text-secondary">
            <p className="font-medium text-text-primary">No responde el programa del huellero</p>
            <p className="mt-1">
              El controlador (driver) solo no basta: hace falta «HID DigitalPersona Lite Client» instalado en
              este equipo (una vez, con Windows). Si ya lo está, reinicie el navegador y, si este pide
              permiso para conectarse a la red local, pulse «Permitir». Mientras tanto puede subir la huella
              como imagen.
            </p>
          </div>
        ) : (
          <span className="px-4 text-center text-[12px] text-error-text">{aviso ?? "No se pudo usar el huellero"}</span>
        )}
      </div>

      <p className="mt-1.5 min-h-[16px] text-center text-[11px] text-warning-text">
        {paso !== "error" && aviso ? aviso : vista ? <span className="text-text-tertiary">Para repetir, vuelva a poner el dedo.</span> : null}
      </p>

      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {(paso === "sin-agente" || paso === "bloqueado" || paso === "permiso" || paso === "sin-lector" || paso === "error") && (
          <Button variant="secondary" onClick={() => setIntento((n) => n + 1)}>
            <Icon name="refresh-cw" size={15} /> Reintentar
          </Button>
        )}
        <Button variant="secondary" onClick={onClose} disabled={guardando}>
          Cancelar
        </Button>
        <Button onClick={() => void guardar()} disabled={!png || guardando}>
          <Icon name="check" size={15} /> {guardando ? "Guardando…" : "Guardar huella"}
        </Button>
      </div>
    </Modal>
  );
}
