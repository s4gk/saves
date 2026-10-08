import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/** Gestión de Cartera sobre una fila del seguimiento. `categoria: null` = volver a la automática. */
export class GestionarCarteraDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() categoria?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000) observaciones?: string | null;
}
