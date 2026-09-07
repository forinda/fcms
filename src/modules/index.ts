import { defineModules } from "@forinda/kickjs";

import { SiteModule } from "./site/site.module";

export const modules = defineModules().mount(SiteModule());
