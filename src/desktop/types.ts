export type DesktopPageId =
  | 'dashboard'
  | 'inventory'
  | 'movements'
  | 'orders'
  | 'preparation'
  | 'print_station'
  | 'settings';

export type DesktopSettingsSection =
  | 'profile'
  | 'users_roles'
  | 'depots'
  | 'categories'
  | 'departments_projects'
  | 'emails_smtp'
  | 'license'
  | 'print_station'
  | 'documentation'
  | 'about';

export const DESKTOP_SIDEBAR_COLLAPSED_KEY = 'tot_desktop_sidebar_collapsed_v1';
export const DESKTOP_LAST_PAGE_KEY = 'tot_desktop_last_page_v1';
export const DESKTOP_GLOBAL_DEPOT_KEY = 'tot_desktop_global_depot_v1';
