import JSZip from 'jszip';
import { emparejar, leerKml, leerKmz, normalizarNombreNap } from './kmz-naps';

/**
 * Ubicación de las cajas NAP desde el KMZ de Google Earth (2026-10-03).
 * Lo delicado es el emparejado por nombre: los del legacy traen espacios y guiones
 * sueltos, y una caja mal emparejada queda pintada en el poste de la de al lado.
 */
const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Red</name>
  <Folder><name>Monterrey</name>
    <Placemark><name>MY-VLS13_12</name><Point><coordinates>-72.8951,4.8761,0</coordinates></Point></Placemark>
    <Placemark><name><![CDATA[JLZ12 15]]></name><Point><coordinates>-72.8960,4.8770</coordinates></Point></Placemark>
    <Placemark><name>Ruta fibra</name><LineString><coordinates>-72.1,4.1 -72.2,4.2</coordinates></LineString></Placemark>
    <Placemark><name>Fuera</name><Point><coordinates>0,0</coordinates></Point></Placemark>
  </Folder>
</Document></kml>`;

describe('KMZ de cajas NAP', () => {
  it('lee los puntos con su carpeta, ignora líneas y descarta coordenadas rotas', () => {
    const { marcadores, descartados } = leerKml(KML);
    expect(marcadores).toEqual([
      { nombre: 'MY-VLS13_12', carpeta: 'Red / Monterrey', lat: 4.8761, lng: -72.8951 },
      { nombre: 'JLZ12 15', carpeta: 'Red / Monterrey', lat: 4.877, lng: -72.896 },
    ]);
    expect(descartados).toBe(1);
  });

  it('abre un .kmz (zip con doc.kml)', async () => {
    const zip = new JSZip();
    zip.file('doc.kml', KML);
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    expect((await leerKmz(buf)).marcadores).toHaveLength(2);
  });

  it('rechaza algo que no es KMZ ni KML', async () => {
    await expect(leerKmz(Buffer.from('hola'))).rejects.toThrow(/no es un KMZ/);
  });

  it('normaliza los nombres del legacy', () => {
    expect(normalizarNombreNap('MY- VLS13 _12')).toBe('MYVLS1312');
    expect(normalizarNombreNap('Olím_ 0/3 -16')).toBe('OLIM0316');
  });

  const naps = [
    { id: 'a', name: 'MY- VLS13 _12', gpsLat: null, gpsLng: null },
    { id: 'b', name: 'MY- JLZ12 _15', gpsLat: '4.8770', gpsLng: '-72.8960' },
    { id: 'c', name: 'MY- LAN10 _01', gpsLat: '4.8', gpsLng: '-72.8' },
    { id: 'd', name: 'YP-BV6-1', gpsLat: null, gpsLng: null },
    { id: 'e', name: 'BV6-1', gpsLat: null, gpsLng: null },
    { id: 'f', name: 'VN-  PAR5 _08', gpsLat: null, gpsLng: null },
    { id: 'g', name: 'YP-PAR5_08', gpsLat: null, gpsLng: null },
  ];
  const mk = (nombre: string, lat = 4.9, lng = -72.9) => ({ nombre, carpeta: '', lat, lng });

  it('exacta aunque cambien espacios y guiones; dice si es nueva, igual o se mueve', () => {
    const [a, b, c] = emparejar([mk('MY-VLS13_12'), mk('my jlz12-15', 4.8770, -72.8960), mk('MY-LAN10_01')], naps);
    expect(a).toMatchObject({ coincidencia: 'exacta', napId: 'a', efecto: 'nueva' });
    expect(b).toMatchObject({ coincidencia: 'exacta', napId: 'b', efecto: 'igual', distancia: 0 });
    expect(c).toMatchObject({ coincidencia: 'exacta', napId: 'c', efecto: 'mueve' });
  });

  it('parecida sólo si es única; con dos candidatas no adivina', () => {
    const [p, amb] = emparejar([mk('LAN10_01'), mk('PAR5 08')], naps);
    expect(p).toMatchObject({ coincidencia: 'parecida', napId: 'c' });
    expect(amb).toMatchObject({ coincidencia: 'ambigua', napId: null });
    expect(amb.candidatas!.sort()).toEqual(['VN-  PAR5 _08', 'YP-PAR5_08']);
  });

  it('BV6-1 exacta no se confunde con YP-BV6-1', () => {
    expect(emparejar([mk('BV6 1')], naps)[0]).toMatchObject({ coincidencia: 'exacta', napId: 'e' });
  });

  it('dos marcadores para la misma caja: vale el primero', () => {
    const [x, y] = emparejar([mk('MY-VLS13_12'), mk('MY VLS13 12', 5, -73)], naps);
    expect(x.coincidencia).toBe('exacta');
    expect(y).toMatchObject({ coincidencia: 'repetida', napId: 'a' });
  });

  it('sin caja', () => {
    expect(emparejar([mk('ZZZ-99')], naps)[0]).toMatchObject({ coincidencia: 'sin_caja', napId: null });
  });
});
