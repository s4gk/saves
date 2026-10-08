import type { Response } from 'express';
import { existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { diskStorage, memoryStorage } from 'multer';
import { BadRequestException, NotFoundException } from '../core/http/errores';
import { FixedAssetsService, FotoSubida } from './fixed-assets.service';
import { AssetLocationDto, CreateFixedAssetDto, DisposeFixedAssetDto, RunDepreciationDto, UpdateFixedAssetDto } from './dto/fixed-assets.dto';
import { AuthUser } from '../auth/current-user.decorator';
// Lo usan el `fileFilter` de la subida (que vive en el router generado) y la
// descarga: nunca se sirve una foto sin `enviarAdjuntoSeguro`.
import { enviarAdjuntoSeguro, mimeAceptado, nombreEnDisco, MIMES_IMAGEN } from '../common/uploads';

export const UPLOAD_ROOT = join(process.cwd(), 'uploads', 'fixed-assets');
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024; // 20 MB, lo que pesa una foto de celular

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Activos fijos: registro con fotos, depreciación mensual y cargue por Excel. */
export class FixedAssetsController {
  constructor(private readonly assets: FixedAssetsService) {}

  meta() { return this.assets.meta(); }

  list(q: Record<string, string | undefined>) {
    return this.assets.list({
      search: q.search, categoryId: q.categoryId, branchId: q.branchId, status: q.status,
      page: Number(q.page), pageSize: Number(q.pageSize),
    });
  }

  detail(id: string) { return this.assets.detail(id); }
  create(dto: CreateFixedAssetDto, user: AuthUser) { return this.assets.create(dto, user); }
  update(id: string, dto: UpdateFixedAssetDto) { return this.assets.update(id, dto); }
  dispose(id: string, dto: DisposeFixedAssetDto, user: AuthUser) { return this.assets.dispose(id, dto, user); }

  /** GPS tomado con el celular parado junto al equipo. */
  setLocation(id: string, dto: AssetLocationDto, user: AuthUser) { return this.assets.setLocation(id, dto, user); }
  clearLocation(id: string) { return this.assets.clearLocation(id); }

  async remove(id: string) {
    const r = await this.assets.remove(id);
    // El registro ya no está; las fotos en disco sobran pero no rompen nada.
    try { rmSync(join(UPLOAD_ROOT, id), { recursive: true, force: true }); } catch { /* ya no estaba */ }
    return { id: r.id, deleted: true };
  }

  // ---- Fotos ----

  uploadPhoto(id: string, file: FotoSubida, user: AuthUser) {
    return this.assets.addPhoto(id, file, user);
  }

  async photo(id: string, photoId: string, res: Response) {
    const p = await this.assets.photo(id, photoId);
    const abs = join(UPLOAD_ROOT, id, p.storedName);
    if (!existsSync(abs)) throw new NotFoundException('La foto ya no está en el servidor');
    return enviarAdjuntoSeguro(res, abs, p.originalName);
  }

  async deletePhoto(id: string, photoId: string) {
    const p = await this.assets.deletePhoto(id, photoId);
    try { unlinkSync(join(UPLOAD_ROOT, id, p.storedName)); } catch { /* ya no estaba */ }
    return { id: photoId, deleted: true };
  }

  // ---- Depreciación ----

  depreciationPreview(year?: string, month?: string) {
    return this.assets.depreciationPreview(Number(year), Number(month));
  }

  runDepreciation(dto: RunDepreciationDto, user: AuthUser) {
    return this.assets.runDepreciation(dto.year, dto.month, user);
  }

  // ---- Excel ----

  async template(res: Response) {
    const buf = await this.assets.template();
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-activos-fijos.xlsx"');
    res.send(buf);
  }

  async exportExcel(q: Record<string, string | undefined>, res: Response) {
    const buf = await this.assets.exportExcel({ search: q.search, categoryId: q.categoryId, branchId: q.branchId, status: q.status });
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="activos-fijos-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
  }

  /** Cargue masivo desde la plantilla (.xlsx). Campo "file". */
  importExcel(file: { buffer: Buffer }, user: AuthUser) {
    if (!file?.buffer) throw new BadRequestException('Sube un archivo .xlsx en el campo "file".');
    return this.assets.importExcel(file.buffer, user);
  }
}

/** Configuración de multer de las dos subidas. Se referencian desde el contrato. */
export const subidaFoto = {
  storage: diskStorage({
    destination: (req, _file, cb) => {
      const dir = join(UPLOAD_ROOT, (req.params as { id: string }).id);
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    // La extensión sale del MIME validado, nunca del nombre que manda el cliente.
    filename: (_req, file, cb) => cb(null, nombreEnDisco(randomUUID(), file.mimetype)),
  }),
  limits: { fileSize: MAX_PHOTO_BYTES },
  fileFilter: (_req: unknown, file: { mimetype: string }, cb: (e: Error | null, ok?: boolean) => void) => {
    const ok = mimeAceptado(file.mimetype, MIMES_IMAGEN);
    cb(ok ? null : new BadRequestException('Sólo se aceptan fotos (JPG, PNG, WEBP, HEIC)'), ok);
  },
};

export const subidaExcel = {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: unknown, file: { mimetype: string; originalname: string }, cb: (e: Error | null, ok?: boolean) => void) => {
    const ok = /spreadsheet|excel/.test(file.mimetype) || file.originalname.toLowerCase().endsWith('.xlsx');
    cb(ok ? null : new BadRequestException('Sube el archivo en formato .xlsx'), ok);
  },
};
