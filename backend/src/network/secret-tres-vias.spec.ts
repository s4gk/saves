import { fusionarSecret, fotoDe, esPerfilDeRelleno } from './secret-tres-vias';

/**
 * Router ↔ ficha. Caso real: abonada 57372 (Tauramena), a quien le cambiaron en el
 * router las IPs a 10.30.0.1 / 10.30.1.3 mientras la ficha seguía con 10.100.0.1 /
 * 80.0.9.206.
 */
describe('fusionarSecret · qué cambió y en qué lado', () => {
  const FICHA = {
    pppUsername: 'ANACEYLACHACONPABLADOR', pppPassword: '24006196', pppProfile: '300Megas26F',
    ipLocal: '10.100.0.1', ipRemote: '80.0.9.206', netComment: 'GAVAN 57372 VLAN 80 FTTH',
  };
  const ANTES = {
    '.id': '*2F4', name: 'ANACEYLACHACONPABLADOR', password: '24006196', profile: '300Megas26F',
    'local-address': '10.100.0.1', 'remote-address': '80.0.9.206', comment: 'GAVAN 57372 VLAN 80 FTTH',
  };
  const AHORA = { ...ANTES, 'local-address': '10.30.0.1', 'remote-address': '10.30.1.3' };

  it('lo cambiado en el router se trae a la ficha', () => {
    const r = fusionarSecret(FICHA, AHORA, fotoDe(ANTES));
    expect(r.aFicha).toEqual({ ipRemote: '10.30.1.3', ipLocal: '10.30.0.1' });
    expect(r.conflictos).toEqual([]);
  });

  it('lo cambiado en la ficha NO se pisa con el router: queda pendiente de llevar', () => {
    const ficha = { ...FICHA, netComment: 'GAVAN 57372 VLAN 90 FTTH' };
    const r = fusionarSecret(ficha, ANTES, fotoDe(ANTES));
    expect(r.aFicha).toEqual({});
    expect(r.pendientesAlRouter).toEqual(['netComment']);
  });

  it('si cambiaron los dos, gana el router y se marca el conflicto', () => {
    const ficha = { ...FICHA, ipRemote: '10.100.5.5' };
    const r = fusionarSecret(ficha, AHORA, fotoDe(ANTES));
    expect(r.aFicha.ipRemote).toBe('10.30.1.3');
    expect(r.conflictos).toEqual(['ipRemote']);
  });

  it('nunca trae un valor vacío ni una IP que no es IP', () => {
    const router = { ...ANTES, comment: '', 'remote-address': '0' };
    const r = fusionarSecret(FICHA, router, fotoDe(ANTES));
    expect(r.aFicha).toEqual({});
  });

  it('el usuario se compara sin mayúsculas ni espacios', () => {
    const r = fusionarSecret({ ...FICHA, pppUsername: 'AnaCeyla ChaconPablador' }, ANTES, fotoDe(ANTES));
    expect(r.aFicha).toEqual({});
  });

  it('un renombrado en el router viaja a la ficha', () => {
    const r = fusionarSecret(FICHA, { ...ANTES, name: 'ANACEYLACHACON2' }, fotoDe(ANTES));
    expect(r.aFicha).toEqual({ pppUsername: 'ANACEYLACHACON2' });
  });

  describe('primera lectura (sin foto)', () => {
    it('con sinFoto=nada sólo toma la foto', () => {
      expect(fusionarSecret(FICHA, AHORA, null, 'nada').aFicha).toEqual({});
    });
    it('con sinFoto=router trae IPs y comentario', () => {
      expect(fusionarSecret(FICHA, AHORA, null, 'router').aFicha).toEqual({ ipRemote: '10.30.1.3', ipLocal: '10.30.0.1' });
    });
    it('completa un perfil de relleno pero no pisa un perfil real distinto', () => {
      expect(fusionarSecret({ ...FICHA, pppProfile: '-' }, ANTES, null, 'router').aFicha).toEqual({ pppProfile: '300Megas26F' });
      expect(fusionarSecret({ ...FICHA, pppProfile: '50Megas' }, ANTES, null, 'router').aFicha).toEqual({});
      expect(fusionarSecret({ ...FICHA, pppProfile: '300megas26f' }, ANTES, null, 'router').aFicha).toEqual({ pppProfile: '300Megas26F' });
    });
  });

  it('reconoce los perfiles de relleno del legacy', () => {
    for (const v of ['', '-', '0', 'Seleccione...', ' - ']) expect(esPerfilDeRelleno(v)).toBe(true);
    for (const v of ['10Megas', '300Megas26F', 'default']) expect(esPerfilDeRelleno(v)).toBe(false);
  });
});
