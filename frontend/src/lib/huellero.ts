/**
 * Huellero USB DigitalPersona / HID (U.are.U 4500, 5300…) desde el navegador.
 *
 * El navegador no puede hablar con el huellero por USB: lo hace el agente que HID
 * instala en el PC («HID DigitalPersona Lite Client» o «Authentication Device
 * Client»), que escucha en https://127.0.0.1:52181. La página se conecta a ese
 * agente con el script de HID (`public/vendor/digitalpersona-websdk.min.js`, copia
 * de `@digitalpersona/websdk` 1.1.0), que monta el canal cifrado.
 *
 * Encima del canal va el protocolo «fingerprints», que aquí se habla a mano en vez
 * de traer `@digitalpersona/devices`: esa librería importa un módulo `WebSdk` que no
 * existe en npm (espera el global del script) y el build de Next no la empaqueta.
 * Son cuatro mensajes; todo viaja como JSON en base64url.
 */

const SCRIPT = "/vendor/digitalpersona-websdk.min.js";
/** «Cualquier huellero conectado». */
const CUALQUIERA = "00000000-0000-0000-0000-000000000000";
/** Formato de muestra 5 = imagen PNG (los otros son plantillas para comparar). */
const FORMATO_PNG = 5;

const METODO = { enumerar: 1, iniciar: 3, detener: 4 } as const;
const AVISO = { completada: 0, error: 1, desconectado: 2, conectado: 3, calidad: 4 } as const;

type CanalWebSdk = {
  onConnectionSucceed: () => void;
  onConnectionFailed: () => void;
  onDataReceivedTxt: (data: string) => void;
  connect: () => void;
  disconnect: () => void;
  sendDataTxt: (data: string) => void;
  isConnected: () => boolean;
};

declare global {
  interface Window {
    WebSdk?: { WebChannelClient: new (path: string) => CanalWebSdk };
  }
}

const aB64Url = (texto: string) => {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const bytesDeB64Url = (b64: string) => {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const deB64Url = (b64: string) => new TextDecoder().decode(bytesDeB64Url(b64));

let cargando: Promise<void> | null = null;

function cargarScript(): Promise<void> {
  if (window.WebSdk) return Promise.resolve();
  cargando ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.onload = () => resolve();
    s.onerror = () => {
      cargando = null;
      reject(new Error("No se pudo cargar el componente del huellero"));
    };
    document.head.appendChild(s);
  });
  return cargando;
}

/** Lo que el huellero dice del dedo cuando la lectura no sirve. */
const CALIDAD: Record<number, string> = {
  1: "No se leyó nada: ponga el dedo de nuevo",
  2: "Muy clara: presione un poco más",
  3: "Muy oscura: presione menos o seque el dedo",
  4: "Lectura con ruido: limpie el lector",
  5: "Poco contraste: limpie el lector y el dedo",
  6: "Huella incompleta: apoye toda la yema",
  7: "Dedo descentrado: póngalo en el centro",
  8: "Eso no parece un dedo",
  19: "Presione menos",
  20: "Presione un poco más",
  21: "Dedo húmedo: séquelo",
  23: "Huella muy pequeña: apoye toda la yema",
  24: "Dedo muy girado: póngalo derecho",
};

export type EventosHuellero = {
  /** Llegó una huella: PNG listo para subir. */
  onHuella: (png: Blob) => void;
  /** La lectura salió mal; el texto dice qué corregir. */
  onCalidad?: (mensaje: string) => void;
  onConectado?: () => void;
  onDesconectado?: () => void;
  /** Se perdió el agente local a mitad de la captura. */
  onSinAgente?: () => void;
  /**
   * Cada paso de la conversación con el agente, para dejarlo en el log del servidor:
   * el huellero está en el PC de caja y de otro modo un «no lee» no se puede mirar.
   */
  onTraza?: (texto: string) => void;
};

export class SinAgenteError extends Error {
  constructor() {
    super("No hay respuesta del programa del huellero en este equipo");
  }
}

export type DiagnosticoAgente = {
  /** Permiso del navegador para hablar con programas de este mismo equipo. */
  permiso: "granted" | "denied" | "prompt" | "desconocido";
  /** Algo contestó en el puerto del agente. */
  responde: boolean;
  detalle: string;
};

/**
 * Por qué no hubo conexión con el agente. «No está instalado» y «el navegador no deja»
 * se ven igual desde el script de HID; Chrome (desde la 142) pide permiso para que una
 * página de internet hable con 127.0.0.1 y, si se negó, todo falla sin decir nada.
 */
export async function diagnosticarAgente(alConceder?: () => void): Promise<DiagnosticoAgente> {
  let permiso: DiagnosticoAgente["permiso"] = "desconocido";
  for (const nombre of ["loopback-network", "local-network-access"]) {
    try {
      const r = await navigator.permissions.query({ name: nombre as PermissionName });
      permiso = r.state;
      // En cuanto el usuario pulsa «Permitir» se reintenta solo.
      r.onchange = () => { if (r.state === "granted") alConceder?.(); };
      break;
    } catch { /* este navegador no conoce ese permiso */ }
  }
  const url = "https://127.0.0.1:52181/get_connection";
  const probar = async (mode: RequestMode) => {
    try {
      const r = await fetch(url, { mode, signal: AbortSignal.timeout(4000) });
      return `${mode}: ${r.type === "opaque" ? "opaca" : r.status}`;
    } catch (e) {
      return `${mode}: ${e instanceof Error ? `${e.name} ${e.message}` : String(e)}`;
    }
  };
  const [cors, sinCors] = [await probar("cors"), await probar("no-cors")];
  const responde = /: (opaca|\d+)$/.test(cors) || /: (opaca|\d+)$/.test(sinCors);
  return { permiso, responde, detalle: `permiso ${permiso} · ${cors} · ${sinCors}` };
}

export type Huellero = {
  /** Cuántos huelleros ve el agente. */
  lectores: () => Promise<number>;
  /** Enciende el lector: a partir de aquí cada dedo llega por `onHuella`. */
  iniciar: () => Promise<void>;
  cerrar: () => void;
};

export async function abrirHuellero(ev: EventosHuellero): Promise<Huellero> {
  await cargarScript();
  if (!window.WebSdk) throw new Error("No se pudo cargar el componente del huellero");

  type Pendiente = { metodo: number; enviado: boolean; cuerpo: string; resolve: (d: string) => void; reject: (e: Error) => void };
  let pendientes: Pendiente[] = [];
  let cerrado = false;
  const canal = new window.WebSdk.WebChannelClient("fingerprints");

  const despachar = () => {
    for (const p of pendientes) {
      if (p.enviado) continue;
      canal.sendDataTxt(p.cuerpo);
      p.enviado = true;
    }
  };

  const traza = (t: string) => { try { ev.onTraza?.(t); } catch { /* el log no puede tumbar la captura */ } };
  canal.onConnectionSucceed = () => { traza("agente conectado"); despachar(); };
  canal.onConnectionFailed = () => {
    traza(`conexión con el agente fallida (pendientes: ${pendientes.length})`);
    const cola = pendientes;
    pendientes = [];
    cola.forEach((p) => p.reject(new SinAgenteError()));
    if (!cerrado && cola.length === 0) ev.onSinAgente?.();
  };
  canal.onDataReceivedTxt = (data) => {
    if (cerrado) return;
    // El script de HID se traga lo que reviente aquí dentro: sin este try una
    // respuesta con otra forma de la esperada se ve como «pongo el dedo y no pasa nada».
    try {
      recibir(data);
    } catch (e) {
      traza(`mensaje del agente no entendido: ${e instanceof Error ? e.message : String(e)} · ${data.slice(0, 300)}`);
      ev.onCalidad?.("El huellero respondió algo inesperado: ponga el dedo de nuevo");
    }
  };
  const recibir = (data: string) => {
    const msg = JSON.parse(deB64Url(data)) as { Type: number; Data?: string };
    const cuerpo = msg.Data ? JSON.parse(deB64Url(msg.Data)) : {};
    if (msg.Type === 0) {
      // Respuesta a una orden: se empareja por método, que es como las devuelve el agente.
      const i = pendientes.findIndex((p) => p.enviado && p.metodo === cuerpo.Method);
      if (i < 0) return;
      const [p] = pendientes.splice(i, 1);
      const hr = cuerpo.Result >>> 0;
      traza(`respuesta método ${cuerpo.Method} resultado 0x${hr.toString(16)}`);
      if (hr > 0x7fffffff) p.reject(new Error(`El huellero respondió con error 0x${hr.toString(16)}`));
      else p.resolve(cuerpo.Data ?? "");
      return;
    }
    const detalle = cuerpo.Data ? JSON.parse(deB64Url(cuerpo.Data)) : {};
    traza(
      `aviso ${cuerpo.Event}` +
        (cuerpo.Event === AVISO.completada
          ? ` formato ${detalle.SampleFormat} muestras ${String(detalle.Samples ?? "").slice(0, 60)}…`
          : ` ${JSON.stringify(detalle).slice(0, 200)}`),
    );
    switch (cuerpo.Event) {
      case AVISO.completada: {
        // Según la versión del agente la muestra llega como texto o envuelta en {Data}.
        const crudo = typeof detalle.Samples === "string" ? JSON.parse(detalle.Samples) : detalle.Samples;
        const primera = Array.isArray(crudo) ? crudo[0] : crudo;
        const b64 = typeof primera === "string" ? primera : primera?.Data;
        if (typeof b64 !== "string" || !b64) throw new Error("muestra sin imagen");
        ev.onHuella(new Blob([bytesDeB64Url(b64)], { type: "image/png" }));
        break;
      }
      case AVISO.calidad:
        if (detalle.Quality) ev.onCalidad?.(CALIDAD[detalle.Quality] ?? "Lectura deficiente: ponga el dedo de nuevo");
        break;
      case AVISO.error:
        ev.onCalidad?.("El huellero falló al leer: ponga el dedo de nuevo");
        break;
      case AVISO.conectado:
        ev.onConectado?.();
        break;
      case AVISO.desconectado:
        ev.onDesconectado?.();
        break;
    }
  };

  const enviar = (metodo: number, parametros?: object) =>
    new Promise<string>((resolve, reject) => {
      const orden = { Method: metodo, Parameters: parametros ? aB64Url(JSON.stringify(parametros)) : undefined };
      const p: Pendiente = { metodo, enviado: false, cuerpo: aB64Url(JSON.stringify(orden)), resolve, reject };
      pendientes.push(p);
      // Si el agente no está instalado el script de HID reintenta un buen rato antes
      // de rendirse: a los 8 s ya se sabe que no hay nadie al otro lado.
      setTimeout(() => {
        const i = pendientes.indexOf(p);
        if (i < 0) return;
        pendientes.splice(i, 1);
        traza(`sin respuesta al método ${metodo} en 8 s (conectado: ${canal.isConnected()})`);
        reject(new SinAgenteError());
      }, 8000);
      if (canal.isConnected()) despachar();
      else canal.connect();
    });

  return {
    lectores: async () => {
      const data = await enviar(METODO.enumerar);
      const lista = data ? JSON.parse(deB64Url(data)) : {};
      traza(`lectores (crudo): ${data ? JSON.stringify(lista).slice(0, 300) : "respuesta vacía"}`);
      return (JSON.parse(lista.DeviceIDs || "[]") as string[]).length;
    },
    iniciar: async () => {
      await enviar(METODO.iniciar, { DeviceID: CUALQUIERA, SampleType: FORMATO_PNG });
    },
    cerrar: () => {
      if (cerrado) return;
      // Sin soltar el lector se queda con la luz encendida y otra pestaña no puede usarlo.
      void enviar(METODO.detener, { DeviceID: CUALQUIERA })
        .catch(() => {})
        .finally(() => {
          cerrado = true;
          try { canal.disconnect(); } catch { /* ya estaba caído */ }
        });
    },
  };
}
