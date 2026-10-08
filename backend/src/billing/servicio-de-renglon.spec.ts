import { servicioDeRenglon } from './servicio-de-renglon';

describe('servicioDeRenglon', () => {
  it.each([
    ['100 Megas F-26', 'internet'],
    ['10Megas(F)', 'internet'],
    ['50 Megas Dedicado', 'internet'],
    ['Hilo Oscuro Medelink', 'internet'],
    ['Ipv4 Publica', 'internet'],
    ['Agregar Internet', 'internet'],
    ['Television26', 'television'],
    ['SoloTelevision22', 'television'],
    ['Punto Adicional', 'television'],
    ['PuntoComercial', 'television'],
    ['DGO ULTRALIGHT + AMAZON PRIME', 'television'],
    ['Afiliación Internet solo', 'otro'],
    ['Afiliación Combo', 'otro'],
    ['Traslado', 'otro'],
    ['Nota Credito', 'otro'],
    ['Equipo TDT', 'otro'],
    ['Repetidor Wifi', 'otro'],
    ['Diseno e Importacion de Datos', 'otro'],
    [null, 'otro'],
  ])('%s → %s', (producto, esperado) => {
    expect(servicioDeRenglon(producto as string | null)).toBe(esperado);
  });
});
