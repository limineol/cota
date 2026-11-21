import type * as Title from "#modules/request-log/03-domain/title.ts";
import { timeOf } from "./columns.ts";

export const titleRowOf = (report: Title.Report) => ({
  session: report.session,
  title: report.title,
  reported_at: timeOf(report.reportedAt),
  machine: report.machine,
  reported_by: report.reportedBy,
});
