export const PAGE_ACCESS_GROUPS = [
  {
    key: "general",
    pages: ["dashboard", "settings.general"],
  },
  {
    key: "master_run_cuts",
    pages: [
      "master_run_cuts.run_cuts",
      "master_run_cuts.drivers",
      "master_run_cuts.vehicles",
      "master_run_cuts.tracker",
    ],
  },
  {
    key: "deployment",
    pages: [
      "deployment.live_schedule",
      "deployment.standby_utilization",
      "deployment.issue_log",
      "deployment.client_report",
      "deployment.reporting",
      "deployment.schedule_history",
      "deployment.receiving_requests",
      "deployment.posts",
      "deployment.tracker_log",
    ],
  },
  {
    key: "network_success",
    pages: [
      "network_success.excel_submissions",
      "network_success.performance",
      "network_success.reallocation_requests",
      "network_success.posts",
      "network_success.email_templates",
      "network_success.ld_helper",
    ],
  },
  {
    key: "customer_service",
    pages: ["customer_service.monthly_counts", "customer_service.analytics"],
  },
  {
    key: "safety",
    pages: ["safety.accidents", "safety.scores", "safety.analytics"],
  },
  {
    key: "operations_reporting",
    pages: [
      "operations_reporting.kpi_tracker",
      "operations_reporting.monthly_dashboard",
      "operations_reporting.cap",
      "operations_reporting.cap_reporting",
    ],
  },
  {
    key: "executive_reporting",
    pages: ["elt_reporting.operations_report", "leaderboard"],
  },
];

export const PAGE_ACCESS = PAGE_ACCESS_GROUPS.flatMap((group) => group.pages);

const pageAccessSet = new Set(PAGE_ACCESS);
const sectionNames = new Set([
  "master_run_cuts",
  "deployment",
  "network_success",
  "customer_service",
  "safety",
  "operations_reporting",
]);

export const sectionForPage = (page) => {
  const section = String(page || "").split(".")[0];
  return sectionNames.has(section) ? section : null;
};

export const normalizePageAccess = (pages) =>
  Array.isArray(pages) ? [...new Set(pages.filter((page) => pageAccessSet.has(page)))] : undefined;

export const sectionsForPageAccess = (pages) => [
  ...new Set((pages || []).map(sectionForPage).filter(Boolean)),
];

// Users saved before page-level access was introduced continue to receive all
// pages in each section they were already assigned. Editing one of those users
// saves an explicit pageAccess list and opts the account into the new model.
export const canAccessPage = (user, page) => {
  if (!user) return false;
  if (user.role === "ELT") return true;
  if (user.pageAccessConfigured) return (user.pageAccess || []).includes(page);

  if (page === "dashboard") return true;
  if (page === "settings.general") {
    return (user.sections || []).some((section) => ["master_run_cuts", "deployment"].includes(section));
  }
  const section = sectionForPage(page);
  return Boolean(section && (user.sections || []).includes(section));
};

export const canAccessAnyPage = (user, pages) => (pages || []).some((page) => canAccessPage(user, page));

export const canAccessPageSection = (user, section) => {
  if (user?.role === "ELT") return true;
  if (!user?.pageAccessConfigured) return (user?.sections || []).includes(section);
  return (user.pageAccess || []).some((page) => sectionForPage(page) === section);
};
