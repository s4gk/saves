-- Ubicación de la oficina de cada sede (el mapa se centra ahí al elegir la sede).
ALTER TABLE "Branch" ADD COLUMN "officeLat" DOUBLE PRECISION;
ALTER TABLE "Branch" ADD COLUMN "officeLng" DOUBLE PRECISION;

-- Punto de partida: donde arrancan la jornada los técnicos de cada sede (latidos
-- GPS agrupados) cruzado con la dirección de la sede. Tauramena sale de los
-- activos fijos de la oficina. Mocoa y Villavicencio no tienen dirección ni
-- latidos: centro del municipio. Todo se corrige desde /mapa ("Mover oficina").
UPDATE "Branch" SET "officeLat" = 4.609250, "officeLng" = -72.925614 WHERE name = 'Villanueva';
UPDATE "Branch" SET "officeLat" = 4.881634, "officeLng" = -72.896537 WHERE name = 'Monterrey';
UPDATE "Branch" SET "officeLat" = 5.017300, "officeLng" = -72.748370 WHERE name = 'Tauramena';
UPDATE "Branch" SET "officeLat" = 5.334660, "officeLng" = -72.379580 WHERE name = 'Yopal';
UPDATE "Branch" SET "officeLat" = 5.170612, "officeLng" = -72.547704 WHERE name = 'Aguazul';
UPDATE "Branch" SET "officeLat" = 1.148500, "officeLng" = -76.647000 WHERE name = 'Mocoa';
UPDATE "Branch" SET "officeLat" = 4.142000, "officeLng" = -73.626700 WHERE name = 'Villavicencio';
