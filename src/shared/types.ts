export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'disabled';

export const GEM_COLORS = [
  '#6366F1', // 星海靛
  '#06B6D4', // 冰川蓝
  '#EC4899', // 樱花晶
  '#10B981', // 薄荷翡
  '#F59E0B', // 琥珀蜜
  '#A855F7', // 紫晶
  '#F43F5E', // 珊瑚红
  '#3B82F6', // 晴空蓝
] as const;

export const NOTEBOOK_ICONS = [
  '💎',
  '✈️',
  '📓',
  '🌿',
  '🚀',
  '📚',
  '💡',
  '🏠',
  '🎨',
  '🔐',
] as const;

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface LoginAuthenticatedResponse {
  status: 'authenticated';
  user: AuthUser;
}

export interface LoginRequires2FAResponse {
  status: 'requires_2fa';
  challengeToken: string;
  expiresInSeconds: number;
}

export type LoginResponse = LoginAuthenticatedResponse | LoginRequires2FAResponse;

export interface TotpSetupResponse {
  setupToken: string;
  secret: string;
  secretFormatted: string;
  otpauthUri: string;
  qrCodeDataUrl: string;
  expiresInSeconds: number;
}

export interface TotpConfirmResponse {
  enabled: true;
  recoveryCodes: string[];
}

export interface AdminUserItem {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface AdminCreateUserResponse {
  user: AdminUserItem;
  temporaryPassword: string;
}

export interface AdminResetPasswordResponse {
  temporaryPassword: string;
}

export interface AuditLogItem {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  actorDisplayName: string | null;
  action: string;
  targetInfo: string | null;
  ipAddress: string | null;
  createdAt: number;
}

export interface PaginatedAuditLogsResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// Phase 2 & 3 Note Entities
export interface NotebookItem {
  id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  sectionCount: number;
  pageCount: number;
  sectionColors: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SectionItem {
  id: string;
  notebookId: string;
  name: string;
  color: string;
  sortOrder: number;
  pageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface PageSummary {
  id: string;
  sectionId: string;
  notebookId: string;
  parentPageId: string | null;
  title: string;
  preview: string;
  isPinned: boolean;
  isDeleted: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  sectionName?: string;
  sectionColor?: string;
  notebookName?: string;
  notebookIcon?: string;
}

export interface PageDetail extends PageSummary {
  contentJson: string;
  contentText: string;
  encryptionVer: number;
}

export interface AttachmentItem {
  id: string;
  pageId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: number;
}

export interface SearchResultItem {
  id: string;
  notebookId: string;
  notebookName: string;
  notebookIcon: string;
  sectionId: string;
  sectionName: string;
  sectionColor: string;
  title: string;
  snippet: string;
  isPinned: boolean;
  updatedAt: number;
}
