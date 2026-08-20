'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboardStatistics } from '@/hooks/useDashboardStatistics';
import { useTranslations } from 'next-intl';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ProfileAvatar from '@/components/ProfileAvatar';
import ThemeToggle from '@/components/theme/ThemeToggle';
import LiveClock from '@/components/LiveClock';
import NotificationBell from '@/components/NotificationBell';
import { OfflineBanner } from '@/components/OfflineBanner';
import { getPendingApprovalCount } from '@/services/userApprovals';

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
  ArrowRightOnRectangleIcon,
  SignalIcon,
  BuildingStorefrontIcon,
  CubeIcon,
  DocumentTextIcon,
  BookOpenIcon,
} from '@heroicons/react/24/outline';

type DashboardLayoutProps = Readonly<{
  children: React.ReactNode;
  title: string;
  headerActions?: React.ReactNode;
}>;




function DashboardLayoutBody({ children, title, headerActions }: DashboardLayoutProps) {

  const pathname = usePathname() || "";
  const params = useParams();
  const locale = params.locale as string;
  const tCommon = useTranslations('common');
  const tUsers = useTranslations('users');
  const t = useTranslations('sidebar');
  const tTechnician = useTranslations('technician');
  const [sidebarOpen, setSidebarOpen] = useState(false);


  const router = useRouter();
  const { user, logout } = useAuth();
  const { statistics } = useDashboardStatistics();
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const localePrefix = `/${locale}`;
  const withLocale = (href: string) => {
    if (!localePrefix) return href;
    if (href === '/') return localePrefix;
    return `${localePrefix}${href}`;
  };

  const handleLogoClick = () => {
    if (user?.role === 'admin') router.push(withLocale('/'));
    else if (user?.role === 'operator') router.push(withLocale('/operator'));
    else if (user?.role === 'technician') router.push(withLocale('/technician'));
    else router.push(withLocale('/'));
  };

  const role = user?.role ?? 'operator';

  useEffect(() => {
    if (user?.profile_completed === false) {
      router.replace(withLocale('/auth/complete-profile'));
    }
    // withLocale is derived from the stable locale for this mounted layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, user?.profile_completed]);

  useEffect(() => {
    let active = true;

    if (role !== 'admin') {
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

    window.addEventListener('users:approvals-changed', handleApprovalChanged);

    return () => {
      active = false;
      window.removeEventListener('users:approvals-changed', handleApprovalChanged);
    };
  }, [role]);

  interface NavItem {
    name: string;
    href: string;
    icon: any;
    categoryKey: string;
    domain?: string;
  }

  interface NavSection {
    domain: string;
    domainKey: string;
    items: NavItem[];
  }

  const getNavigation = (): NavSection[] => {
    const adminNav: NavItem[] = [
      { name: t('navigation.dashboard'), href: '/', icon: HomeIcon, categoryKey: 'categories.overview', domain: 'dashboard' },
      { name: t('navigation.users'), href: '/users', icon: UsersIcon, categoryKey: 'categories.users', domain: 'users' },
      { name: t('navigation.machines'), href: '/machines', icon: CogIcon, categoryKey: 'categories.equipment', domain: 'assets' },
      { name: t('navigation.machineTypes'), href: '/machine-types', icon: CubeIcon, categoryKey: 'categories.equipmentTypes', domain: 'assets' },
      { name: t('navigation.moduleTypes'), href: '/module-types', icon: DocumentTextIcon, categoryKey: 'categories.systemModules', domain: 'assets' },
      { name: t('navigation.devices'), href: '/devices', icon: CpuChipIcon, categoryKey: 'categories.equipment', domain: 'assets' },
      { name: t('navigation.workOrders'), href: '/work-orders', icon: ClipboardDocumentListIcon, categoryKey: 'categories.maintenance', domain: 'maintenance' },
      { name: t('navigation.maintenancePlans'), href: '/maintenance-plans', icon: ClipboardDocumentListIcon, categoryKey: 'categories.maintenance', domain: 'maintenance' },
      { name: t('navigation.preventiveTaskChecklist'), href: '/preventive-task-checklist', icon: ClipboardDocumentListIcon, categoryKey: 'categories.maintenance', domain: 'maintenance' },
      { name: t('navigation.interventionReports'), href: '/intervention-reports', icon: ClipboardDocumentListIcon, categoryKey: 'categories.maintenance', domain: 'maintenance' },
      { name: t('navigation.pannes'), href: '/pannes', icon: ExclamationTriangleIcon, categoryKey: 'categories.maintenance', domain: 'failures' },
      { name: t('navigation.panneSolutions'), href: '/panne-solutions', icon: DocumentTextIcon, categoryKey: 'categories.maintenance', domain: 'failures' },
      { name: t('navigation.capteurs'), href: '/capteurs', icon: CpuChipIcon, categoryKey: 'categories.iotMonitoring', domain: 'monitoring' },
      { name: t('navigation.mesures'), href: '/mesures', icon: ChartBarIcon, categoryKey: 'categories.iotMonitoring', domain: 'monitoring' },
      { name: t('navigation.catalogues'), href: '/catalogues', icon: BuildingStorefrontIcon, categoryKey: 'categories.partsInventory', domain: 'inventoryLubrication' },
      { name: t('navigation.modulePieces'), href: '/module-pieces', icon: CubeIcon, categoryKey: 'categories.partsInventory', domain: 'inventoryLubrication' },
      { name: t('navigation.stocks'), href: '/stocks', icon: BuildingStorefrontIcon, categoryKey: 'categories.partsInventory', domain: 'inventoryLubrication' },
      { name: t('navigation.lubrifiants'), href: '/lubrifiants', icon: CubeIcon, categoryKey: 'categories.partsInventory', domain: 'inventoryLubrication' },
      { name: t('navigation.lubrificationLogs'), href: '/lubrification-logs', icon: ClipboardDocumentListIcon, categoryKey: 'categories.partsInventory', domain: 'inventoryLubrication' },
      { name: t('navigation.otPieces'), href: '/ot-pieces', icon: ClipboardDocumentListIcon, categoryKey: 'categories.partsInventory', domain: 'inventoryLubrication' },
      { name: t('navigation.documents'), href: '/documents', icon: DocumentTextIcon, categoryKey: 'categories.technicalReference', domain: 'documents' },
      { name: t('navigation.knowledgeBase'), href: '/knowledge-base', icon: BookOpenIcon, categoryKey: 'categories.technicalReference', domain: 'documents' },
      { name: t('navigation.reports'), href: '/reports', icon: ChartBarIcon, categoryKey: 'categories.technicalReference', domain: 'documents' }
    ];

    const technicianNav: NavItem[] = [
      { name: t('navigation.dashboard'), href: '/technician', icon: HomeIcon, categoryKey: 'categories.overview', domain: 'dashboard' },
      { name: tTechnician('workOrders.title'), href: '/technician/work-orders', icon: ClipboardDocumentListIcon, categoryKey: 'categories.maintenance', domain: 'maintenance' },
      { name: tTechnician('dashboard.sections.current'), href: '/technician/interventions', icon: CogIcon, categoryKey: 'categories.maintenance', domain: 'maintenance' },
      { name: tTechnician('dashboard.sections.waitingPartsTasks'), href: '/technician/waiting-parts', icon: BuildingStorefrontIcon, categoryKey: 'categories.maintenance', domain: 'maintenance' },
      { name: tTechnician('dashboard.sections.recent'), href: '/technician/history', icon: ClipboardDocumentListIcon, categoryKey: 'categories.maintenance', domain: 'maintenance' },
      { name: tTechnician('manuals.title'), href: '/technician/manuals', icon: DocumentTextIcon, categoryKey: 'categories.technicalReference', domain: 'documents' },
      { name: t('navigation.knowledgeBase'), href: '/technician/knowledge-base', icon: BookOpenIcon, categoryKey: 'categories.technicalReference', domain: 'documents' }
    ];

    const operatorNav: NavItem[] = [
      { name: t('navigation.dashboard'), href: '/operator', icon: HomeIcon, categoryKey: 'categories.overview', domain: 'dashboard' },
      { name: t('navigation.startPreventiveMaintenance'), href: '/operator/preventive', icon: ClipboardDocumentListIcon, categoryKey: 'categories.maintenance', domain: 'maintenance' },
      { name: t('navigation.startCorrectiveMaintenance'), href: '/operator/corrective', icon: ExclamationTriangleIcon, categoryKey: 'categories.maintenance', domain: 'maintenance' },
      { name: t('navigation.smartMaintenanceCalendar'), href: '/operator/smart-maintenance-calendar', icon: CalendarDaysIcon, categoryKey: 'categories.maintenance', domain: 'maintenance' },
      { name: t('navigation.machines'), href: '/operator/machines', icon: CogIcon, categoryKey: 'categories.equipment', domain: 'assets' },
      { name: t('navigation.manuals'), href: '/operator/manuals', icon: DocumentTextIcon, categoryKey: 'categories.technicalReference', domain: 'documents' },
      { name: t('navigation.knowledgeBase'), href: '/operator/knowledge-base', icon: BookOpenIcon, categoryKey: 'categories.technicalReference', domain: 'documents' },
      { name: t('navigation.myReports'), href: '/operator/my-reports', icon: ClipboardDocumentListIcon, categoryKey: 'categories.maintenance', domain: 'maintenance' },
    ];

    const navItems = role === 'admin' ? adminNav : role === 'technician' ? technicianNav : operatorNav;

    // Group by domain
    const domainMap: Record<string, NavItem[]> = {};
    const domainOrder = ['dashboard', 'users', 'assets', 'maintenance', 'failures', 'monitoring', 'inventory', 'inventoryLubrication', 'documents'];

    navItems.forEach(item => {
      const domain = item.domain || 'other';
      if (!domainMap[domain]) {
        domainMap[domain] = [];
      }
      domainMap[domain].push(item);
    });

    return domainOrder
      .filter(domain => domainMap[domain])
      .map(domain => ({
        domain,
        domainKey: `domains.${domain}`,
        items: domainMap[domain]
      }));
  };

  const navigation = getNavigation();

  // Get translated navigation items based on role

  return (
    <div className="dashboard-grid relative overflow-x-hidden overflow-y-visible" >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:inset-s-2 focus:z-1001 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-white"
      >
        {tCommon('skipToContent')}
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
      <div className={`sidebar-modern ${sidebarOpen ? 'sidebar-open' : ''} relative z-10`}>
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
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
        </div>

        {/* System Status */}
        <div className="system-status-modern">
          <div className="status-item-modern">
            <SignalIcon className="h-4 w-4 shrink-0 text-green-500" />
            <span title={t('systemStatus.online')}>{t('systemStatus.online')}</span>
          </div>
          {role === 'admin' && (
            <>
              <div className="status-item-modern warning">
                <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-amber-500" />
                <span title={statistics ? `${statistics.pendingMaintenance} ${t('systemStatus.maintenanceDue')}` : t('systemStatus.loading')}>{statistics ? `${statistics.pendingMaintenance} ${t('systemStatus.maintenanceDue')}` : t('systemStatus.loading')}</span>
              </div>
              <div className="status-item-modern success">
                <ChartBarIcon className="h-4 w-4 shrink-0 text-green-500" />
                <span title={statistics ? String(statistics.percentageChange) : t('systemStatus.loading')}>
                  {statistics ? (
                    statistics.percentageChange >= 0
                      ? t('systemStatus.percentageChange.positive', { value: statistics.percentageChange })
                      : t('systemStatus.percentageChange.negative', { value: statistics.percentageChange })
                  ) : (
                    t('systemStatus.loading')
                  )}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Navigation */}
        <nav className="nav-modern">
          {Array.isArray(navigation) && navigation.map((section) => (
            <div key={section.domain} className="mb-4">
              {/* Domain Section Header */}
              <div className="nav-section-label text-xs font-bold uppercase tracking-widest mb-3 px-4" title={t(section.domainKey)}>
                {t(section.domainKey)}
              </div>
              {/* Items in this domain */}
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={withLocale(item.href)}
                      className={`nav-link-modern ${pathname === withLocale(item.href) ? 'active' : ''}`}
                      onClick={() => setSidebarOpen(false)}
                      title={item.name}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      {item.href === '/users' && pendingApprovalCount > 0 && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          {pendingApprovalCount > 99 ? '99+' : pendingApprovalCount}
                        </span>
                      )}
                    </Link>
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
                name={user?.nom_complet}
                photo={user?.photo}
                alt={user?.nom_complet || tCommon('defaultUserName')}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <div className="dashboard-user-name text-sm font-medium truncate">{user?.nom_complet || tCommon('defaultUserName')}</div>
                <div className="dashboard-user-role text-xs capitalize">{user?.role ? tUsers(`roles.${user.role}`)
                  : tCommon('user')}</div>
              </div>
            </div>

            <button type="button"
              onClick={logout}
              className="toolbar-action w-full justify-center"
            >
              <ArrowRightOnRectangleIcon className="w-5 h-5" />
              {tCommon('auth.logout')}
            </button>
          </div>
        </div>


      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label={tCommon('closeMenu')}
          className="fixed inset-0 bg-black bg-opacity-50 z-50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className="main-content relative z-10">
        <header className="panel dashboard-header-panel">
          <div className="flex items-center justify-between gap-4 flex-wrap md:flex-nowrap">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="text-lg md:text-xl lg:text-2xl font-bold truncate">{title}</h1>
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
                    name={user?.nom_complet}
                    photo={user?.photo}
                    alt={user?.nom_complet || tCommon('defaultUserName')}
                    size="sm"
                  />
                  <div className="text-end">
                    <div className="dashboard-user-name text-sm font-medium">{user?.nom_complet || tCommon('defaultUserName')}</div>
                    <div className="dashboard-user-role text-xs capitalize">{user?.role ? tUsers(`roles.${user.role}`)
                      : tCommon('user')}</div>
                  </div>
                </div>

                <button type="button"
                  onClick={logout}
                  aria-label={tCommon('auth.logout')}
                  className="toolbar-action"
                >
                  <ArrowRightOnRectangleIcon className="w-5 h-5" />
                  <span className="hidden lg:inline">{tCommon('auth.logout')}</span>
                </button>
              </div>

              <button type="button"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                aria-label={sidebarOpen ? tCommon('closeMenu') : tCommon('openMenu')}
                aria-expanded={sidebarOpen}
                className="mobile-menu-btn toolbar-action md:hidden"
              >
                {sidebarOpen ? <XMarkIcon className="w-6 h-6" /> : <Bars3Icon className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </header>

        <OfflineBanner />
        <main id="main-content" className="relative z-0 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>

  );
}

export default function DashboardLayout(props: DashboardLayoutProps) {
  return <DashboardLayoutBody {...props} />;
}

