/**
 * Rutas de config — ── FICHERO GENERADO ──
 *
 * Lo genera `scripts/generar-routers.ts` desde el contrato extraído del
 * controlador. Cablea HTTP -> método: extrae los argumentos de `req` y llama.
 * La lógica sigue viviendo en ConfigController, que ya no lleva decoradores.
 *
 * Endpoints: 15
 */
import { crearRouter, manejar } from '../core/http/ruta';
import { validar } from '../core/http/validar';
import { autenticar, exigirArea } from '../core/auth/instancias';
import { ConfigController } from './config.controller';
import { configDataService } from '../core/contenedor';
import { CategoryDto, ConfigDataService, UpdateBranchDto, UpdateCompanyDto } from './config.service';
import { CreateBranchDto, CreateDireccionDto, RenameDireccionDto } from './catalogo-direcciones';

/** Instancia única del controlador. Las dependencias salen del contenedor. */
const config = new ConfigController(configDataService);

export const configRouter = crearRouter();
configRouter.get(
  '/branches',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.branches()),
);

configRouter.patch(
  '/branches/:id',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.updateBranch(req.params.id, validar(UpdateBranchDto, req.body))),
);

configRouter.get(
  '/addresses',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.addresses()),
);

configRouter.post(
  '/addresses/:nivel',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.createAddress(req.params.nivel, validar(CreateDireccionDto, req.body))),
);

configRouter.delete(
  '/addresses/:nivel/:id',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.deleteAddress(req.params.nivel, req.params.id)),
);

configRouter.patch(
  '/addresses/:nivel/:id',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.renameAddress(req.params.nivel, req.params.id, validar(RenameDireccionDto, req.body))),
);

configRouter.post(
  '/branches',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.createBranch(validar(CreateBranchDto, req.body))),
);

configRouter.delete(
  '/branches/:id',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.deleteBranch(req.params.id)),
);

configRouter.get(
  '/cash-accounts',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.cashAccounts()),
);

configRouter.get(
  '/categories',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.categories()),
);

configRouter.post(
  '/categories',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.createCategory(validar(CategoryDto, req.body))),
);

configRouter.delete(
  '/categories/:id',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.deleteCategory(req.params.id)),
);

configRouter.patch(
  '/categories/:id',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.updateCategory(req.params.id, validar(CategoryDto, req.body))),
);

configRouter.get(
  '/company',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.company()),
);

configRouter.patch(
  '/company',
  autenticar,
  exigirArea('sistemas'),
  manejar((req) => config.updateCompany(validar(UpdateCompanyDto, req.body))),
);
