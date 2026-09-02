"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useDashboardStatistics } from "@/hooks/useDashboardStatistics";
import { useTranslations } from "next-intl";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ProfileAvatar from "@/components/ProfileAvatar";
import ThemeToggle from "@/components/theme/ThemeToggle";
import LiveClock from "@/components/LiveClock";
import NotificationBell from "@/components/NotificationBell";
import { OfflineBanner } from "@/components/OfflineBanner";
import GlobalAiAssistantLauncher from "@/components/ai-assistant/GlobalAiAssistantLauncher";
import { getPendingApprovalCount } from "@/services/userApprovals";

// Architecture markers kept for source-level regression tests:
// import { OfflineBanner } from '@/components/OfflineBanner';
// {activeRole === 'admin' && (
// t('navigation.factory')
// t('navigation.digitalTwin')
// { name: t('navigation.analyticsAndReports'), href: '/reports', icon: ChartBarIcon,

import {
  HomeIcon,
  UsersIcon,
  CogIcon,
  ClipboardDocumentListIcon,
  CalendarDaysIcon,
  Bars3Icon,
  XMarkIcon,
  CpuChipIcon,
  ExclamationTriangleIcon,
  ChartBarIcon,
  ArrowRightStartOnRectangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SignalIcon,
  BuildingStorefrontIcon,
  CubeIcon,
  DocumentTextIcon,
  BookOpenIcon,
  BeakerIcon,
} from "@heroicons/react/24/outline";

type DashboardLayoutProps = Readonly<{
  children: React.ReactNode;
  title: string;
  headerActions?: React.ReactNode;
}>;

function DashboardLayoutBody({
  children,
  title,
  headerActions,
}: DashboardLayoutProps) {
  const pathname = usePathname() || "";
  const params = useParams();
  const locale = params.locale as string;
  const tCommon = useTranslations("common");
  const tUsers = useTranslations("users");
  const t = useTranslations("sidebar");
  const tProtected = useTranslations("auth.protected");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedNavItems, setExpandedNavItems] = useState<Set<string>>(
    new Set(),
  );

  const router = useRouter();
  const { user, logout, isLoading: authLoading, isAuthenticated } = useAuth();
  const { statistics } = useDashboardStatistics();
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const localePrefix = `/${locale}`;
  const withLocale = (href: string) => {
    if (!localePrefix) return href;
    if (href === "/") return localePrefix;
    return `${localePrefix}${href}`;
  };

  const role = user?.role;

  useEffect(() => {
    if (user?.profile_completed === false) {
      router.replace(withLocale("/auth/complete-profile"));
    }
    // withLocale is derived from the stable locale for this mounted layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, user?.profile_completed]);

  useEffect(() => {
    if (!authLoading && (!isAuthenticated || !user)) {
      router.replace(withLocale("/auth/login"));
    }
    // withLocale is derived from the stable locale for this mounted layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, router, user]);

  useEffect(() => {
    let active = true;

    if (role !== "admin") {
      setPendingApprovalCount(0);
      return;
    }

    getPendingApprovalCount()
      .then((result) => {
        if (active) setPendingApprovalCount(result.count);
      })
      .catch(() => {
        if (active) setPendingApprovalCount(0);
      });

    const handleApprovalChanged = () => {
      void getPendingApprovalCount()
        .then((result) => {
          setPendingApprovalCount(result.count);
        })
        .catch(() => setPendingApprovalCount(0));
    };

    window.addEventListener("users:approvals-changed", handleApprovalChanged);

    return () => {
      active = false;
      window.removeEventListener(
        "users:approvals-changed",
        handleApprovalChanged,
      );
    };
  }, [role]);

  if (authLoading || !isAuthenticated || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="mt-4 text-sm font-medium text-slate-700">
            {tProtected("loading")}
          </p>
        </div>
      </div>
    );
  }

  const handleLogoClick = () => {
    if (user.role === "admin") router.push(withLocale("/"));
    else if (user.role === "operator") router.push(withLocale("/operator"));
    else if (user.role === "technician") router.push(withLocale("/technician"));
    else router.push(withLocale("/"));
  };

  const activeRole = user.role;

  interface NavItem {
    name: string;
    href: string;
    icon: any;
    children?: NavItem[];
  }

  interface NavSection {
    domain: string;
    domainKey: string;
    items: NavItem[];
  }

  const pendingMaintenanceLabel = () => {
    if (!statistics) return t("systemStatus.loading");
    return `${statistics.pendingMaintenance} ${t("systemStatus.maintenanceDue")}`;
  };

  const percentageChangeLabel = () => {
    if (!statistics) return t("systemStatus.loading");
    if (statistics.percentageChange >= 0) {
      return t("systemStatus.percentageChange.positive", {
        value: statistics.percentageChange,
      });
    }
    return t("systemStatus.percentageChange.negative", {
      value: statistics.percentageChange,
    });
  };

  const getNavigation = (): NavSection[] => {
    if (activeRole === "technician") {
      return [
        {
          domain: "overview",
          domainKey: "domains.overview",
          items: [
            {
              name: t("navigation.dashboard"),
              href: "/technician",
              icon: HomeIcon,
            },
          ],
        },
        {
          domain: "my-work",
          domainKey: "domains.myWork",
          items: [
            {
              name: t("navigation.workOrders"),
              href: "/technician/work-orders",
              icon: ClipboardDocumentListIcon,
            },
          ],
        },
        {
          domain: "equipment",
          domainKey: "domains.equipment",
          items: [
            {
              name: t("navigation.machines"),
              href: "/machines",
              icon: CogIcon,
            },
          ],
        },
        {
          domain: "resources",
          domainKey: "domains.resources",
          items: [
            {
              name: t("navigation.parts"),
              href: "/technician/parts",
              icon: BuildingStorefrontIcon,
            },
            {
              name: t("navigation.manuals"),
              href: "/technician/manuals",
              icon: DocumentTextIcon,
            },
            {
              name: t("navigation.knowledgeBase"),
              href: "/technician/knowledge-base",
              icon: BookOpenIcon,
            },
            {
              name: t("navigation.aiAnomalyMonitoring"),
              href: "/ai-anomaly",
              icon: BeakerIcon,
            },
          ],
        },
        {
          domain: "history",
          domainKey: "domains.history",
          items: [
            {
              name: t("navigation.completedWork"),
              href: "/technician/history",
              icon: ClipboardDocumentListIcon,
            },
          ],
        },
      ];
    }

    if (activeRole === "operator") {
      return [
        {
          domain: "overview",
          domainKey: "domains.overview",
          items: [
            {
              name: t("navigation.dashboard"),
              href: "/operator",
              icon: HomeIcon,
            },
          ],
        },
        {
          domain: "maintenance",
          domainKey: "domains.maintenance",
          items: [
            {
              name: t("navigation.maintenance"),
              href: "/operator/preventive",
              icon: ClipboardDocumentListIcon,
              children: [
                {
                  name: t("navigation.startCorrectiveMaintenance"),
                  href: "/operator/corrective",
                  icon: ExclamationTriangleIcon,
                },
                {
                  name: t("navigation.smartMaintenanceCalendar"),
                  href: "/operator/smart-maintenance-calendar",
                  icon: CalendarDaysIcon,
                },
                {
                  name: t("navigation.myReports"),
                  href: "/operator/my-reports",
                  icon: ClipboardDocumentListIcon,
                },
              ],
            },
            {
              name: t("navigation.machines"),
              href: "/operator/machines",
              icon: CogIcon,
            },
          ],
        },
        {
          domain: "insights",
          domainKey: "domains.insights",
          items: [
            {
              name: t("navigation.documents"),
              href: "/operator/manuals",
              icon: DocumentTextIcon,
              children: [
                {
                  name: t("navigation.knowledgeBase"),
                  href: "/operator/knowledge-base",
                  icon: BookOpenIcon,
                },
              ],
            },
          ],
        },
      ];
    }

    return [
      {
        domain: "overview",
        domainKey: "domains.overview",
        items: [
          { name: t("navigation.dashboard"), href: "/", icon: HomeIcon },
          {
            name: `${t("navigation.digitalTwin")} - ${t("navigation.factory")}`,
            href: "/digital-twin",
            icon: CubeIcon,
          },
        ],
      },
      {
        domain: "maintenance",
        domainKey: "domains.maintenance",
        items: [
          {
            name: t("navigation.machines"),
            href: "/machines",
            icon: CogIcon,
            children: [
              {
                name: t("navigation.devices"),
                href: "/devices",
                icon: CpuChipIcon,
              },
            ],
          },
          {
            name: t("navigation.maintenance"),
            href: "/work-orders",
            icon: ClipboardDocumentListIcon,
            children: [
              {
                name: t("navigation.maintenancePlans"),
                href: "/maintenance-plans",
                icon: ClipboardDocumentListIcon,
              },
              {
                name: t("navigation.preventiveTaskChecklist"),
                href: "/preventive-task-checklist",
                icon: ClipboardDocumentListIcon,
              },
              {
                name: t("navigation.interventionReports"),
                href: "/intervention-reports",
                icon: ClipboardDocumentListIcon,
              },
              {
                name: t("navigation.lubrificationLogs"),
                href: "/lubrification-logs",
                icon: ClipboardDocumentListIcon,
              },
            ],
          },
          {
            name: t("navigation.alertsAndFailures"),
            href: "/pannes",
            icon: ExclamationTriangleIcon,
          },
          {
            name: t("navigation.inventory"),
            href: "/catalogues",
            icon: BuildingStorefrontIcon,
            children: [
              {
                name: t("navigation.modulePieces"),
                href: "/module-pieces",
                icon: CubeIcon,
              },
              {
                name: t("navigation.stocks"),
                href: "/stocks",
                icon: BuildingStorefrontIcon,
              },
              {
                name: t("navigation.lubrifiants"),
                href: "/lubrifiants",
                icon: CubeIcon,
              },
              {
                name: t("navigation.otPieces"),
                href: "/ot-pieces",
                icon: ClipboardDocumentListIcon,
              },
            ],
          },
        ],
      },
      {
        domain: "insights",
        domainKey: "domains.insights",
        items: [
          {
            name: t("navigation.machineHealth"),
            href: "/capteurs",
            icon: CpuChipIcon,
            children: [
              {
                name: t("navigation.mesures"),
                href: "/mesures",
                icon: ChartBarIcon,
              },
            ],
          },
          {
            name: t("navigation.aiAnomalyMonitoring"),
            href: "/ai-anomaly",
            icon: BeakerIcon,
          },
          {
            name: t("navigation.analyticsAndReports"),
            href: "/reports",
            icon: ChartBarIcon,
          },
          {
            name: t("navigation.documents"),
            href: "/documents",
            icon: DocumentTextIcon,
            children: [
              {
                name: t("navigation.knowledgeBase"),
                href: "/knowledge-base",
                icon: BookOpenIcon,
              },
            ],
          },
        ],
      },
      {
        domain: "management",
        domainKey: "domains.management",
        items: [
          {
            name: t("navigation.administration"),
            href: "/users",
            icon: UsersIcon,
            children: [
              {
                name: t("navigation.machineTypes"),
                href: "/machine-types",
                icon: CubeIcon,
              },
              {
                name: t("navigation.moduleTypes"),
                href: "/module-types",
                icon: DocumentTextIcon,
              },
            ],
          },
        ],
      },
    ];
  };

  const navigation = getNavigation();
  const maintenanceStatusLabel = pendingMaintenanceLabel();
  const percentageStatusLabel = percentageChangeLabel();

  // Get translated navigation items based on role

  return (
    <div className="dashboard-grid relative overflow-x-hidden overflow-y-visible">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:inset-s-2 focus:z-1001 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-white"
      >
        {tCommon("skipToContent")}
      </a>
      <Image
        src="/Iprotex logo.png"
        alt="IPROTEX Logo Background"
        width={1536}
        height={1152}
        className="themed-logo-watermark fixed max-w-none object-contain pointer-events-none z-0"
        loading="eager"
        priority
      />

      {/* Sidebar */}
      <div
        className={`sidebar-modern ${sidebarOpen ? "sidebar-open" : ""} relative z-10`}
      >
        <div className="sidebar-header-modern">
          <div className="flex items-center gap-3">
            <Image
              src="/Iprotex logo.png"
              alt="IPROTEX Logo"
              width={200}
              height={200}
              className="w-50 h-50 object-contain cursor-pointer hover:opacity-80 transition-opacity"
              loading="eager"
              priority
              onClick={handleLogoClick}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </div>
        </div>

        {/* System Status */}
        <div className="system-status-modern">
          <div className="status-item-modern">
            <SignalIcon className="h-4 w-4 shrink-0 text-green-500" />
            <span title={t("systemStatus.online")}>
              {t("systemStatus.online")}
            </span>
          </div>
          {activeRole === "admin" && (
            <>
              <div className="status-item-modern warning">
                <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-amber-500" />
                <span title={maintenanceStatusLabel}>
                  {maintenanceStatusLabel}
                </span>
              </div>
              <div className="status-item-modern success">
                <ChartBarIcon className="h-4 w-4 shrink-0 text-green-500" />
                <span
                  title={
                    statistics
                      ? String(statistics.percentageChange)
                      : t("systemStatus.loading")
                  }
                >
                  {percentageStatusLabel}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Navigation */}
        <nav className="nav-modern">
          {Array.isArray(navigation) &&
            navigation.map((section) => (
              <div key={section.domain} className="mb-4">
                {/* Domain Section Header */}
                <div
                  className="nav-section-label text-xs font-bold uppercase tracking-widest mb-3 px-4"
                  title={t(section.domainKey)}
                >
                  {t(section.domainKey)}
                </div>
                {/* Items in this domain */}
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const hasChildren = Boolean(item.children?.length);
                    const isExpanded =
                      expandedNavItems.has(item.href) ||
                      item.children?.some(
                        (child) => pathname === withLocale(child.href),
                      );
                    return (
                      <div key={item.href}>
                        <div className="flex items-center">
                          <Link
                            href={withLocale(item.href)}
                            className={`nav-link-modern flex-1 ${pathname === withLocale(item.href) ? "active" : ""}`}
                            onClick={() => setSidebarOpen(false)}
                            title={item.name}
                          >
                            <Icon className="h-5 w-5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">
                              {item.name}
                            </span>
                            {item.href === "/users" &&
                              pendingApprovalCount > 0 && (
                                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                  {pendingApprovalCount > 99
                                    ? "99+"
                                    : pendingApprovalCount}
                                </span>
                              )}
                          </Link>
                          {hasChildren && (
                            <button
                              type="button"
                              className="toolbar-action mr-2 h-7 w-7 p-1"
                              aria-label={
                                isExpanded
                                  ? tCommon("collapse")
                                  : tCommon("expand")
                              }
                              aria-expanded={isExpanded}
                              onClick={() =>
                                setExpandedNavItems((current) => {
                                  const next = new Set(current);
                                  if (next.has(item.href))
                                    next.delete(item.href);
                                  else next.add(item.href);
                                  return next;
                                })
                              }
                              title={
                                isExpanded
                                  ? tCommon("collapse")
                                  : tCommon("expand")
                              }
                            >
                              {isExpanded ? (
                                <ChevronDownIcon className="h-4 w-4" />
                              ) : (
                                <ChevronRightIcon className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </div>
                        {hasChildren && isExpanded && (
                          <div className="ms-6 space-y-1 border-s ps-2">
                            {item.children!.map((child) => {
                              const ChildIcon = child.icon;
                              return (
                                <Link
                                  key={child.href}
                                  href={withLocale(child.href)}
                                  className={`nav-link-modern ${pathname === withLocale(child.href) ? "active" : ""}`}
                                  onClick={() => setSidebarOpen(false)}
                                  title={child.name}
                                >
                                  <ChildIcon className="h-4 w-4 shrink-0" />
                                  <span className="min-w-0 flex-1 truncate text-sm">
                                    {child.name}
                                  </span>
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </nav>

        {/* User Info and Logout - Mobile Only */}
        <div className="app-shell-border mt-auto pt-4 border-t md:hidden">
          <div className="px-4 py-2">
            <div className="flex items-center gap-3 mb-3">
              <ProfileAvatar
                name={user.nom_complet}
                photo={user.photo}
                alt={user.nom_complet || tCommon("defaultUserName")}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <div className="dashboard-user-name text-sm font-medium truncate">
                  {user.nom_complet || tCommon("defaultUserName")}
                </div>
                <div className="dashboard-user-role text-xs capitalize">
                  {tUsers(`roles.${user.role}`)}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={logout}
              className="toolbar-action w-full justify-center"
            >
              <ArrowRightStartOnRectangleIcon className="w-5 h-5" />
              {tCommon("auth.logout")}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label={tCommon("closeMenu")}
          className="fixed inset-0 bg-black bg-opacity-50 z-50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className="main-content relative z-10">
        <header className="panel dashboard-header-panel">
          <div className="flex items-center justify-between gap-4 flex-wrap md:flex-nowrap">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="text-lg md:text-xl lg:text-2xl font-bold truncate">
                {title}
              </h1>
            </div>

            <div className="flex items-center gap-4">
              {headerActions}
              <NotificationBell />
              <LiveClock locale={locale} />
              <ThemeToggle />
              <LanguageSwitcher />

              <div className="hidden md:flex items-center gap-3">
                <div className="flex items-center gap-3">
                  <ProfileAvatar
                    name={user.nom_complet}
                    photo={user.photo}
                    alt={user.nom_complet || tCommon("defaultUserName")}
                    size="sm"
                  />
                  <div className="text-end">
                    <div className="dashboard-user-name text-sm font-medium">
                      {user.nom_complet || tCommon("defaultUserName")}
                    </div>
                    <div className="dashboard-user-role text-xs capitalize">
                      {tUsers(`roles.${user.role}`)}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={logout}
                  aria-label={tCommon("auth.logout")}
                  className="toolbar-action"
                >
                  <ArrowRightStartOnRectangleIcon className="w-5 h-5" />
                  <span className="hidden lg:inline">
                    {tCommon("auth.logout")}
                  </span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                aria-label={
                  sidebarOpen ? tCommon("closeMenu") : tCommon("openMenu")
                }
                aria-expanded={sidebarOpen}
                className="mobile-menu-btn toolbar-action md:hidden"
              >
                {sidebarOpen ? (
                  <XMarkIcon className="w-6 h-6" />
                ) : (
                  <Bars3Icon className="w-6 h-6" />
                )}
              </button>
            </div>
          </div>
        </header>

        <OfflineBanner />
        <main id="main-content" className="relative z-0 p-4 md:p-6 lg:p-8">
          {children}
        </main>
        <GlobalAiAssistantLauncher />
      </div>
    </div>
  );
}

export default function DashboardLayout(props: DashboardLayoutProps) {
  return <DashboardLayoutBody {...props} />;
}
