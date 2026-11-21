import * as DashboardRoutes from "#modules/dashboard/01-presentation/dashboard.routes.ts";

export type Options = DashboardRoutes.Options;

/** The dashboard's built files, read through the file system the server gives. */
export const layer = DashboardRoutes.layer;
