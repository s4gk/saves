import { avisoAprobado, diaBogota, motivoParaNoAplicar, TransaccionWompi } from './aprobados-tardios';

const aviso = (status: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  event: 'transaction.updated',
  data: { transaction: { id: '1238668-1789836461-16102', reference: '4779d408', status, ...extra } },
});

const tx = (extra: Partial<TransaccionWompi> = {}): TransaccionWompi => ({
  id: '1238668-1789836461-16102', status: 'APPROVED', reference: '4779d408',
  amount_in_cents: 7550000, currency: 'COP', payment_method_type: 'PSE', ...extra,
});

describe('avisoAprobado', () => {
  it('lee el aprobado con su id de Wompi con guiones', () => {
    expect(avisoAprobado(aviso('APPROVED'))).toEqual({
      reference: '4779d408', transactionId: '1238668-1789836461-16102', status: 'APPROVED',
    });
  });

  it('ignora rechazos, avisos de PayU y basura', () => {
    expect(avisoAprobado(aviso('DECLINED'))).toBeNull();
    expect(avisoAprobado('date=2022.06.27&state_pol=6')).toBeNull();
    expect(avisoAprobado(JSON.stringify({ data: {} }))).toBeNull();
    expect(avisoAprobado(aviso('APPROVED', { reference: '' }))).toBeNull();
  });
});

describe('motivoParaNoAplicar', () => {
  const base = { reference: '4779d408', debe: 75500, pagosPosteriores: 0 };

  it('aplica el caso del 19-sep (abonado 55714): rechazado y aprobado al reintentar', () => {
    expect(motivoParaNoAplicar({ ...base, tx: tx() })).toBeNull();
  });

  it('no se cree el aviso: manda lo que diga Wompi', () => {
    expect(motivoParaNoAplicar({ ...base, tx: null })).toMatch(/no encuentra/);
    expect(motivoParaNoAplicar({ ...base, tx: tx({ status: 'DECLINED' }) })).toMatch(/DECLINED/);
    expect(motivoParaNoAplicar({ ...base, tx: tx({ reference: 'otra' }) })).toMatch(/otra referencia/);
  });

  it('el valor tiene que ser el de la orden, al peso', () => {
    expect(motivoParaNoAplicar({ ...base, tx: tx({ amount_in_cents: 7500000 }) })).toMatch(/no coincide/);
    expect(motivoParaNoAplicar({ ...base, tx: tx({ currency: 'USD' }) })).toMatch(/moneda/);
  });

  it('si hay otro pago desde ese día no se aplica: puede estar cargado a mano', () => {
    expect(motivoParaNoAplicar({ ...base, tx: tx(), pagosPosteriores: 1 })).toMatch(/a mano/);
  });
});

describe('diaBogota', () => {
  it('las 9 de la noche en Colombia siguen siendo el mismo día', () => {
    expect(diaBogota('2026-09-20T02:00:00Z')).toBe('2026-09-19');
    expect(diaBogota('2026-09-19T16:48:45Z')).toBe('2026-09-19');
  });
});
