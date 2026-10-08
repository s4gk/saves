import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export const ASSET_STATUS = ['ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED'] as const;

/** Alta de un activo fijo. Las fechas van como `YYYY-MM-DD`. */
export class CreateFixedAssetDto {
  /** Vacío = se asigna el siguiente `AF-00001`. */
  @IsOptional() @IsString() code?: string;
  @IsString() @MinLength(2) name!: string;
  @IsString() categoryId!: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() serialNumber?: string;
  /** `Branch.id` de la sede donde está el equipo. */
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() responsible?: string;
  @IsOptional() @IsString() supplier?: string;
  @IsOptional() @IsString() invoiceNumber?: string;
  @IsString() acquisitionDate!: string;
  /** Desde cuándo se deprecia. Vacío = la fecha de compra. */
  @IsOptional() @IsString() inServiceDate?: string;
  @IsNumber() @Min(0) acquisitionCost!: number;
  @IsOptional() @IsNumber() @Min(0) residualValue?: number;
  /** Vacío = la vida útil de la categoría. */
  @IsOptional() @IsInt() @Min(1) @Max(1200) usefulLifeMonths?: number;
  /** Vacío = el centro de costo de la sede. */
  @IsOptional() @IsString() costCenterId?: string;
  @IsOptional() @IsString() notes?: string;
  /** GPS tomado en el sitio al crear el activo (opcional). */
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsNumber() @Min(0) gpsAccuracy?: number;
}

export class UpdateFixedAssetDto {
  @IsOptional() @IsString() @MinLength(1) code?: string;
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() responsible?: string;
  @IsOptional() @IsString() supplier?: string;
  @IsOptional() @IsString() invoiceNumber?: string;
  @IsOptional() @IsString() acquisitionDate?: string;
  @IsOptional() @IsString() inServiceDate?: string;
  @IsOptional() @IsNumber() @Min(0) acquisitionCost?: number;
  @IsOptional() @IsNumber() @Min(0) residualValue?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1200) usefulLifeMonths?: number;
  @IsOptional() @IsString() costCenterId?: string;
  @IsOptional() @IsString() notes?: string;
}

/** Ubicación GPS capturada con el celular en el sitio. */
export class AssetLocationDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  /** Precisión que reporta el dispositivo, en metros. */
  @IsOptional() @IsNumber() @Min(0) accuracy?: number;
}

/** Baja o venta del activo. */
export class DisposeFixedAssetDto {
  @IsString() date!: string;
  /** Lo que se recibió si se vendió; 0 o vacío si se dio de baja. */
  @IsOptional() @IsNumber() @Min(0) proceeds?: number;
  @IsString() @MinLength(3) reason!: string;
}

/** Depreciación de un mes: contabiliza hasta el cierre de `year`-`month`. */
export class RunDepreciationDto {
  @IsInt() @Min(2000) @Max(2100) year!: number;
  @IsInt() @Min(1) @Max(12) month!: number;
}
