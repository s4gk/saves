import { CategoryDto, ConfigDataService, UpdateBranchDto, UpdateCompanyDto } from './config.service';
import { CreateBranchDto, CreateDireccionDto, RenameDireccionDto } from './catalogo-direcciones';

/** Configuración: cajas, sedes y empresa. */
export class ConfigController {
  constructor(private readonly config: ConfigDataService) {}

  cashAccounts() { return this.config.cashAccounts(); }
  branches() { return this.config.branches(); }
  updateBranch(id: string, dto: UpdateBranchDto) { return this.config.updateBranch(id, dto); }
  createBranch(dto: CreateBranchDto) { return this.config.createBranch(dto); }
  deleteBranch(id: string) { return this.config.deleteBranch(id); }

  // --- Direcciones: departamento → ciudad → localidad → barrio ---
  addresses() { return this.config.addresses(); }
  createAddress(nivel: string, dto: CreateDireccionDto) { return this.config.createAddress(nivel, dto); }
  renameAddress(nivel: string, id: string, dto: RenameDireccionDto) { return this.config.renameAddress(nivel, id, dto); }
  deleteAddress(nivel: string, id: string) { return this.config.deleteAddress(nivel, id); }
  // La geografía salió de /configuracion (2026-08-05): la pestaña "Geografía" era un
  // resumen de solo lectura (conteo de departamentos/ciudades/localidades/barrios) y se
  // retiró a pedido del usuario. Con ella se fueron sus dos endpoints. El catálogo
  // geográfico sigue vivo y se consulta por el módulo `geo` (/geo/*), que es el que usan
  // los selectores de dirección y el mapa.
  company() { return this.config.company(); }
  updateCompany(dto: UpdateCompanyDto) { return this.config.updateCompany(dto); }

  // --- Categorías de transacción (tesorería) ---
  categories() { return this.config.categories(); }
  createCategory(dto: CategoryDto) { return this.config.createCategory(dto); }
  updateCategory(id: string, dto: CategoryDto) { return this.config.updateCategory(id, dto); }
  deleteCategory(id: string) { return this.config.deleteCategory(id); }
}
