/**
 * Rutas de fixed-assets — ── FICHERO GENERADO ──
 *
 * Lo genera `scripts/generar-routers.ts` desde el contrato extraído del
 * controlador. Cablea HTTP -> método: extrae los argumentos de `req` y llama.
 * La lógica sigue viviendo en FixedAssetsController, que ya no lleva decoradores.
 *
 * Endpoints: 17
 */
import { crearRouter, manejar } from '../core/http/ruta';
import { validar } from '../core/http/validar';
import { autenticar, exigirArea, usuarioDe } from '../core/auth/instancias';
import { ficheroDe, subirUno } from '../core/http/uploads';
import { FixedAssetsController, subidaExcel, subidaFoto } from './fixed-assets.controller';
import { fixedAssetsService } from '../core/contenedor';
import type { Response } from 'express';
import { existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { diskStorage, memoryStorage } from 'multer';
import { BadRequestException, NotFoundException } from '../core/http/errores';
import { FixedAssetsService, FotoSubida } from './fixed-assets.service';
import { AssetLocationDto, CreateFixedAssetDto, DisposeFixedAssetDto, RunDepreciationDto, UpdateFixedAssetDto } from './dto/fixed-assets.dto';
import { enviarAdjuntoSeguro, mimeAceptado, nombreEnDisco, MIMES_IMAGEN } from '../common/uploads';

/** Instancia única del controlador. Las dependencias salen del contenedor. */
const fixedAssets = new FixedAssetsController(fixedAssetsService);

export const fixedAssetsRouter = crearRouter();
fixedAssetsRouter.get(
  '/',
  autenticar,
  exigirArea('administracion', 'contabilidad', 'gerencia'),
  manejar((req) => fixedAssets.list(req.query as unknown as Record<string, string | undefined>)),
);

fixedAssetsRouter.post(
  '/',
  autenticar,
  exigirArea('administracion', 'contabilidad'),
  manejar((req) => fixedAssets.create(validar(CreateFixedAssetDto, req.body), usuarioDe(req))),
);

fixedAssetsRouter.get(
  '/depreciation/preview',
  autenticar,
  exigirArea('administracion', 'contabilidad'),
  manejar((req) => fixedAssets.depreciationPreview(req.query.year as string, req.query.month as string)),
);

fixedAssetsRouter.post(
  '/depreciation/run',
  autenticar,
  exigirArea('administracion', 'contabilidad'),
  manejar((req) => fixedAssets.runDepreciation(validar(RunDepreciationDto, req.body), usuarioDe(req))),
);

fixedAssetsRouter.get(
  '/export',
  autenticar,
  exigirArea('administracion', 'contabilidad', 'gerencia'),
  manejar((req, res) => fixedAssets.exportExcel(req.query as unknown as Record<string, string | undefined>, res)),
);

fixedAssetsRouter.post(
  '/import',
  autenticar,
  exigirArea('administracion', 'contabilidad'),
  subirUno('file', subidaExcel),
  manejar((req) => fixedAssets.importExcel(ficheroDe(req), usuarioDe(req))),
);

fixedAssetsRouter.get(
  '/meta',
  autenticar,
  exigirArea('administracion', 'contabilidad', 'gerencia'),
  manejar((req) => fixedAssets.meta()),
);

fixedAssetsRouter.get(
  '/template',
  autenticar,
  exigirArea('administracion', 'contabilidad'),
  manejar((req, res) => fixedAssets.template(res)),
);

fixedAssetsRouter.get(
  '/:id',
  autenticar,
  exigirArea('administracion', 'contabilidad', 'gerencia'),
  manejar((req) => fixedAssets.detail(req.params.id)),
);

fixedAssetsRouter.patch(
  '/:id',
  autenticar,
  exigirArea('administracion', 'contabilidad'),
  manejar((req) => fixedAssets.update(req.params.id, validar(UpdateFixedAssetDto, req.body))),
);

fixedAssetsRouter.delete(
  '/:id',
  autenticar,
  exigirArea('administracion', 'contabilidad'),
  manejar((req) => fixedAssets.remove(req.params.id)),
);

fixedAssetsRouter.post(
  '/:id/dispose',
  autenticar,
  exigirArea('administracion', 'contabilidad'),
  manejar((req) => fixedAssets.dispose(req.params.id, validar(DisposeFixedAssetDto, req.body), usuarioDe(req))),
);

fixedAssetsRouter.put(
  '/:id/location',
  autenticar,
  exigirArea('administracion', 'contabilidad'),
  manejar((req) => fixedAssets.setLocation(req.params.id, validar(AssetLocationDto, req.body), usuarioDe(req))),
);

fixedAssetsRouter.delete(
  '/:id/location',
  autenticar,
  exigirArea('administracion', 'contabilidad'),
  manejar((req) => fixedAssets.clearLocation(req.params.id)),
);

fixedAssetsRouter.post(
  '/:id/photos',
  autenticar,
  exigirArea('administracion', 'contabilidad'),
  subirUno('file', subidaFoto),
  manejar((req) => fixedAssets.uploadPhoto(req.params.id, ficheroDe(req), usuarioDe(req))),
);

fixedAssetsRouter.get(
  '/:id/photos/:photoId',
  autenticar,
  exigirArea('administracion', 'contabilidad', 'gerencia'),
  manejar((req, res) => fixedAssets.photo(req.params.id, req.params.photoId, res)),
);

fixedAssetsRouter.delete(
  '/:id/photos/:photoId',
  autenticar,
  exigirArea('administracion', 'contabilidad'),
  manejar((req) => fixedAssets.deletePhoto(req.params.id, req.params.photoId)),
);
