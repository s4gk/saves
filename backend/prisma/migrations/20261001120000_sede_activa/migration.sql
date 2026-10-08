-- Interruptor de sede: una sede desactivada no se ofrece en ningún selector ni filtro,
-- pero NO se borra nada — sus clientes, facturas, órdenes y movimientos siguen igual.
-- Ver `src/common/sedes-activas.ts` y el comentario del campo en schema.prisma.
ALTER TABLE "Branch" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Mocoa y Villavicencio se apagan a pedido del usuario (2026-10-01): ya no se opera
-- en ellas, así que estorbaban en todos los desplegables. Se desactivan, no se borran:
-- Mocoa conserva 50 abonados (49 activos) y Villavicencio 95, con su historia.
UPDATE "Branch" SET "isActive" = false WHERE name IN ('Mocoa', 'Villavicencio');
