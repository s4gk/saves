import {
  armarCortesActivaciones, clasificarOrden, esDePrueba, TIPOS_SQL, type FilaOrden, type RetiroSinOrden,
} from './cortes-activaciones';

const orden = (o: Partial<FilaOrden>): FilaOrden => ({
  id: 'o', code: 1, tipo: 'Corte Internet', estado: 'RESUELTO', creadoPor: 'Santiago García',
  fecha: '2026-09-21', clienteId: 'c1', abonado: 100, nombre: 'Ana', sede: 'Yopal', enRouter: true, ...o,
});

describe('clasificarOrden', () => {
  it('separa el evento y el servicio de los tipos reales del legacy', () => {
    expect(clasificarOrden('Corte Internet')).toEqual({ evento: 'CORTE', servicio: 'Internet' });
    expect(clasificarOrden('Reconexion Internet2')).toEqual({ evento: 'RECONEXION', servicio: 'Internet' });
    expect(clasificarOrden('Reconexion television2')).toEqual({ evento: 'RECONEXION', servicio: 'TV' });
    expect(clasificarOrden('Reconexion Combo por dias')).toEqual({ evento: 'RECONEXION', servicio: 'Combo' });
    expect(clasificarOrden('Suspencion Combo')).toEqual({ evento: 'SUSPENSION', servicio: 'Combo' });
    expect(clasificarOrden('Retiro voluntario')).toEqual({ evento: 'RETIRO', servicio: 'General' });
    expect(clasificarOrden('Reinstalacion Television')).toEqual({ evento: 'INSTALACION', servicio: 'TV' });
    expect(clasificarOrden('Instalacion')).toEqual({ evento: 'INSTALACION', servicio: 'General' });
  });

  it('deja fuera lo que no es alta ni corte, aunque empiece parecido', () => {
    expect(clasificarOrden('Instalación y/o Mantenimiento de Equipos Activos d')).toBeNull();
    expect(clasificarOrden('Revision de Internet')).toBeNull();
    expect(clasificarOrden(null)).toBeNull();
  });

  it('el filtro SQL dice lo mismo que la clasificación', () => {
    const re = new RegExp(TIPOS_SQL, 'i');
    for (const t of ['Corte Combo', 'Reconexion Internet', 'Suspension Television', 'Suspencion Internet',
      'Retiro voluntario', 'Instalacion', 'Reinstalación', 'Activacion', 'Instalación y/o Mantenimiento de Equipos Activos d', 'Traslado']) {
      expect(re.test(t)).toBe(clasificarOrden(t) != null);
    }
  });
});

describe('esDePrueba', () => {
  it('reconoce los perfiles de prueba y no a la gente', () => {
    expect(esDePrueba('PRUEBA · Superusuario')).toBe(true);
    expect(esDePrueba('Santiago García')).toBe(false);
    expect(esDePrueba(null)).toBe(false);
  });
});

describe('armarCortesActivaciones', () => {
  it('cuenta una vez la orden repetida el mismo día y descarta las de prueba', () => {
    const r = armarCortesActivaciones([
      orden({ id: 'a' }),
      orden({ id: 'b' }), // el lote corrió dos veces
      orden({ id: 'c', fecha: '2026-09-09' }), // mismo cliente, otro día: sí cuenta
      orden({ id: 'd', clienteId: 'c2', creadoPor: 'PRUEBA · Superusuario' }),
    ], [], []);
    expect(r.cortes).toBe(2);
    expect(r.resumen.find((x) => x.evento === 'CORTE')!.clientes).toBe(1);
    expect(r.depurado).toEqual({ pruebas: 1, duplicadas: 1, retirosSinOrden: 0 });
  });

  it('anuladas y abiertas se ven aparte y no suman', () => {
    const r = armarCortesActivaciones([
      orden({ id: 'a', estado: 'ANULADA' }),
      orden({ id: 'b', estado: 'PENDIENTE', clienteId: 'c2' }),
      orden({ id: 'c', clienteId: 'c3' }),
    ], [], []);
    const corte = r.resumen.find((x) => x.evento === 'CORTE')!;
    expect(corte).toMatchObject({ hechos: 1, anuladas: 1, abiertas: 1 });
  });

  it('el router sólo opina de internet: la TV no tiene con qué confirmarse', () => {
    const r = armarCortesActivaciones([
      orden({ id: 'a', enRouter: true }),
      orden({ id: 'b', clienteId: 'c2', enRouter: false }),
      orden({ id: 'c', clienteId: 'c3', tipo: 'Corte Television', enRouter: false }),
    ], [], []);
    const inet = r.filas.find((f) => f.servicio === 'Internet')!;
    const tv = r.filas.find((f) => f.servicio === 'TV')!;
    expect(inet).toMatchObject({ conRouter: 1, sinRouter: 1 });
    expect(tv).toMatchObject({ conRouter: null, sinRouter: null });
    expect(r.detalle.find((d) => d.servicio === 'TV')!.router).toBeNull();
  });

  it('suma a los retiros sin orden una sola vez y sin repetir a quien ya tiene la orden', () => {
    const hist = (o: Partial<RetiroSinOrden>): RetiroSinOrden => ({
      clienteId: 'r1', abonado: 5, nombre: 'Luis', sede: 'Yopal', fecha: '2026-09-15', nota: 'Retiro por devolución de equipo', ...o,
    });
    const r = armarCortesActivaciones(
      [orden({ tipo: 'Retiro voluntario', clienteId: 'r0' })],
      [hist({}), hist({ fecha: '2026-09-16' }), hist({ clienteId: 'r0' })],
      [],
    );
    expect(r.retiros).toBe(2);
    expect(r.depurado.retirosSinOrden).toBe(1);
    expect(r.detalle.filter((d) => d.origen === 'Sin orden')).toHaveLength(1);
  });

  it('lo del router sin orden va aparte y no entra en los totales', () => {
    const r = armarCortesActivaciones([], [], [
      { fecha: '2026-09-15', accion: 'RECONNECT', acciones: 1619, clientes: 1600 },
      { fecha: '2026-09-14', accion: 'MOROSO_ON', acciones: 44, clientes: 44 },
    ]);
    expect(r.reconexiones).toBe(0);
    expect(r.routerSinOrden).toMatchObject({ cortes: 44, reconexiones: 1619 });
    expect(r.routerSinOrden.porDia[0].fecha).toBe('2026-09-14');
  });
});
