import { Logger } from '../core/logger';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { OltService } from './olt.service';
import { formaHex } from '../common/serial-onu';

export type ResultadoDesautenticar =
  | { accion: 'BORRADA'; olt: string; fsp: string; dryRun: boolean }
  | { accion: 'DE_OTRO'; olt: string; fsp: string; de: string }
  | { accion: 'NO_ESTABA' | 'SIN_SERIAL' | 'SIN_OLT' }
  | { accion: 'ERROR'; error: string };

/**
 * Un equipo que vuelve a bodega sale también de la OLT (2026-09-15, pedido del usuario:
 * "el sistema desautentique el equipo automáticamente una vez que se devuelva").
 *
 * Por qué: la ONU 311071 se devolvió en el inventario pero seguía dada de alta en
 * MONTERREY 0/1/11 a nombre del cliente anterior. Una ONU con alta no sale en el
 * autofind, así que al entregársela a otro cliente la orden no la encontraba, y
 * autenticar la nueva de un cambio de equipo dejaba al cliente con DOS altas.
 *
 * Lo llaman los tres caminos por los que un equipo deja de estar en casa de un
 * cliente: la devolución de la ficha (`returnEquipment`), el cambio de estado en el
 * inventario (`updateEquipment`) y la ONU vieja de un cambio de equipo
 * (`conciliarTrasAutenticar`). Se lanza sin esperar —cada consulta es una sesión
 * telnet/SSH de segundos— y nunca lanza: la devolución ya está guardada y un fallo
 * de la OLT no la deshace; queda anotado en la ficha para que alguien lo termine.
 *
 * La única ONU que NO se borra es la que el inventario de la OLT vincula a OTRO
 * cliente distinto del que la devuelve: eso es una avería de datos y borrarla
 * dejaría sin servicio a quien sí la está usando.
 */
export class OnuAlDevolverService {
  private readonly logger = new Logger('OnuAlDevolver');

  constructor(
    private readonly prisma: PrismaService,
    private readonly olt: OltService,
  ) {}

  async desautenticar(x: {
    serial: string | null;
    code: number;
    /** El cliente que DEVUELVE el equipo (su dueño hasta ahora). */
    subscriberId: string;
    motivo: string;
    ticketCode?: number | null;
    user?: AuthUser | null;
  }): Promise<ResultadoDesautenticar> {
    try {
      const sn = formaHex(x.serial);
      if (!sn) return { accion: 'SIN_SERIAL' };

      // Dónde buscarla: la OLT donde el inventario ya la tiene y la de la sede del
      // cliente (las altas de SmartOLT no están en `OltOnu`).
      const [vinculadas, sub] = await Promise.all([
        this.prisma.oltOnu.findMany({
          where: { sn },
          select: { oltId: true, subscriberId: true, clientName: true, olt: { select: { name: true } } },
        }),
        this.prisma.subscriber.findUnique({ where: { id: x.subscriberId }, select: { branchId: true } }),
      ]);
      const deSede = sub?.branchId
        ? await this.prisma.olt.findMany({
          where: { branchId: sub.branchId },
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
          select: { id: true, name: true },
        })
        : [];
      const nombres = new Map<string, string>();
      for (const v of vinculadas) nombres.set(v.oltId, v.olt?.name ?? 'OLT');
      for (const o of deSede) nombres.set(o.id, o.name);
      if (!nombres.size) return { accion: 'SIN_OLT' };

      for (const [oltId, nombre] of nombres) {
        const r = await this.olt.estadoPorSn(oltId, sn);
        if (!r.ok || !r.estado) continue;
        const e = r.estado;
        const fsp = `${e.frame}/${e.slot}/${e.port} ONT ${e.ont_id}`;

        const ajena = vinculadas.find((v) => v.oltId === oltId && v.subscriberId && v.subscriberId !== x.subscriberId);
        if (ajena) {
          const de = ajena.clientName ?? ajena.subscriberId!;
          await this.anotar(x, `El equipo ${x.code} (S/N ${sn}) se devolvió, pero NO se desautenticó de la OLT ${nombre} (${fsp}): allí figura a nombre de ${de}. Revíselo en Red › OLT.`);
          return { accion: 'DE_OTRO', olt: nombre, fsp, de };
        }

        const del: any = await this.olt.remove(
          oltId, { frame: e.frame, slot: e.slot, port: e.port, ont_id: e.ont_id, sn }, x.user ?? undefined,
        );
        if (!del?.ok) {
          const error = del?.error || 'la OLT rechazó la eliminación';
          await this.anotar(x, `El equipo ${x.code} (S/N ${sn}) se devolvió, pero no se pudo desautenticar de la OLT ${nombre} (${fsp}): ${error}. Elimínelo en Red › OLT.`);
          return { accion: 'ERROR', error };
        }
        if (!del.dryRun) await this.prisma.oltOnu.deleteMany({ where: { sn, oltId } });
        await this.anotar(x, del.dryRun
          ? `Equipo ${x.code} (S/N ${sn}) devuelto: la OLT está en modo simulación, NO se desautenticó de ${nombre} (${fsp}).`
          : `${x.code ? `Equipo ${x.code}` : 'ONU'} (S/N ${sn}) desautenticada de la OLT ${nombre} (${fsp}) · ${x.motivo}`);
        this.logger.log(`ONU ${sn} (equipo ${x.code}) ${del.dryRun ? 'dry-run' : 'eliminada'} de ${nombre} ${fsp} · ${x.motivo}`);
        return { accion: 'BORRADA', olt: nombre, fsp, dryRun: !!del.dryRun };
      }
      return { accion: 'NO_ESTABA' };
    } catch (err) {
      const error = (err as Error).message;
      this.logger.warn(`Desautenticar equipo ${x.code} al devolverlo: ${error}`);
      return { accion: 'ERROR', error };
    }
  }

  /**
   * Todas las ONUs de un cliente que se RETIRA (cierre de la orden de retiro,
   * pedido del usuario 2026-10-06): el equipo no vuelve a bodega por sí solo y,
   * mientras siga dado de alta, no sale en el autofind para el siguiente cliente.
   * Se buscan en los equipos a su nombre y en las ONUs que el inventario de la OLT
   * le vincula. Igual que `desautenticar`: nunca lanza y deja nota en la ficha.
   */
  async desautenticarDelCliente(x: {
    subscriberId: string; motivo: string; ticketCode?: number | null; user?: AuthUser | null;
  }): Promise<ResultadoDesautenticar[]> {
    try {
      const [equipos, onus] = await Promise.all([
        this.prisma.equipment.findMany({ where: { subscriberId: x.subscriberId }, select: { code: true, serial: true } }),
        this.prisma.oltOnu.findMany({ where: { subscriberId: x.subscriberId }, select: { sn: true } }),
      ]);
      const porSn = new Map<string, number>();
      for (const e of equipos) { const sn = formaHex(e.serial); if (sn) porSn.set(sn, e.code); }
      for (const o of onus) { const sn = formaHex(o.sn); if (sn && !porSn.has(sn)) porSn.set(sn, 0); }
      const out: ResultadoDesautenticar[] = [];
      for (const [sn, code] of porSn) {
        out.push(await this.desautenticar({ serial: sn, code, subscriberId: x.subscriberId, motivo: x.motivo, ticketCode: x.ticketCode, user: x.user }));
      }
      return out;
    } catch (err) {
      this.logger.warn(`Desautenticar las ONUs del cliente ${x.subscriberId}: ${(err as Error).message}`);
      return [{ accion: 'ERROR', error: (err as Error).message }];
    }
  }

  private async anotar(x: { subscriberId: string; ticketCode?: number | null; user?: AuthUser | null }, body: string) {
    await this.prisma.subscriberNote
      .create({ data: { subscriberId: x.subscriberId, body, authorName: x.user?.name || x.user?.email || 'sistema' } })
      .catch(() => undefined);
    if (x.ticketCode != null) {
      await this.prisma.ticketThread
        .create({ data: { ticketCode: x.ticketCode, message: body, subscriberId: x.subscriberId, employeeId: 0, date: new Date() } })
        .catch(() => undefined);
    }
  }
}
