import type {
  AdminCreateUserResponse,
  AdminResetPasswordResponse,
  AdminUserItem,
  ApiErrorResponse,
  AttachmentItem,
  AuthUser,
  LoginResponse,
  NotebookItem,
  PageDetail,
  PageSummary,
  PaginatedAuditLogsResponse,
  SearchResultItem,
  SectionItem,
  TotpConfirmResponse,
  TotpSetupResponse,
  UserRole,
  UserStatus,
} from '@shared/types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  const data = (await res.json().catch(() => null)) as T | ApiErrorResponse | null;

  if (!res.ok) {
    const errPayload = (data as ApiErrorResponse | null)?.error;
    throw new ApiError(
      res.status,
      errPayload?.code || 'HTTP_ERROR',
      errPayload?.message || `请求失败 (${res.status})`,
      errPayload?.details,
    );
  }

  return data as T;
}

export const authApi = {
  me(): Promise<{ user: AuthUser }> {
    return request('/api/auth/me');
  },

  login(username: string, password: string): Promise<LoginResponse> {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  verify2fa(
    challengeToken: string,
    code: string,
    isRecoveryCode = false,
  ): Promise<{ status: 'authenticated'; user: AuthUser }> {
    return request('/api/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken, code, isRecoveryCode }),
    });
  },

  logout(): Promise<{ ok: true }> {
    return request('/api/auth/logout', { method: 'POST' });
  },

  changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true; user: AuthUser }> {
    return request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  setup2fa(): Promise<TotpSetupResponse> {
    return request('/api/auth/2fa/setup', { method: 'POST' });
  },

  confirm2fa(setupToken: string, code: string): Promise<TotpConfirmResponse> {
    return request('/api/auth/2fa/confirm', {
      method: 'POST',
      body: JSON.stringify({ setupToken, code }),
    });
  },

  disable2fa(payload: { currentPassword?: string; totpCode?: string }): Promise<{ enabled: false }> {
    return request('/api/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export const adminApi = {
  listUsers(): Promise<{ users: AdminUserItem[] }> {
    return request('/api/admin/users');
  },

  createUser(input: {
    username: string;
    displayName: string;
    role: UserRole;
  }): Promise<AdminCreateUserResponse> {
    return request('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateUserStatus(id: string, status: UserStatus): Promise<{ user: AdminUserItem }> {
    return request(`/api/admin/users/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  resetPassword(id: string): Promise<AdminResetPasswordResponse> {
    return request(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
      method: 'POST',
    });
  },

  reset2fa(id: string): Promise<{ user: AdminUserItem }> {
    return request(`/api/admin/users/${encodeURIComponent(id)}/reset-2fa`, {
      method: 'POST',
    });
  },

  listAuditLogs(params: { page?: number; pageSize?: number; action?: string } = {}): Promise<PaginatedAuditLogsResponse> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params.action) qs.set('action', params.action);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/api/admin/audit-logs${suffix}`);
  },
};

export const notesApi = {
  listNotebooks(): Promise<{ notebooks: NotebookItem[] }> {
    return request('/api/notebooks');
  },

  createNotebook(input: {
    name: string;
    icon?: string;
    color?: string;
    createDefaultSection?: boolean;
  }): Promise<{ notebook: NotebookItem; defaultSection?: SectionItem }> {
    return request('/api/notebooks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateNotebook(
    id: string,
    patch: { name?: string; icon?: string; color?: string; sortOrder?: number },
  ): Promise<{ notebook: NotebookItem }> {
    return request(`/api/notebooks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  reorderNotebooks(orderedIds: string[]): Promise<{ ok: true; notebooks: NotebookItem[] }> {
    return request('/api/notebooks/reorder', {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    });
  },

  deleteNotebook(id: string): Promise<{ ok: true }> {
    return request(`/api/notebooks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  listAllSections(): Promise<{ sections: SectionItem[] }> {
    return request('/api/sections');
  },

  listSections(notebookId: string): Promise<{ sections: SectionItem[] }> {
    return request(`/api/notebooks/${encodeURIComponent(notebookId)}/sections`);
  },

  createSection(
    notebookId: string,
    input: { name: string; color?: string },
  ): Promise<{ section: SectionItem }> {
    return request(`/api/notebooks/${encodeURIComponent(notebookId)}/sections`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateSection(
    id: string,
    patch: { name?: string; color?: string; sortOrder?: number; notebookId?: string },
  ): Promise<{ section: SectionItem }> {
    return request(`/api/sections/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  reorderSections(notebookId: string, orderedIds: string[]): Promise<{ ok: true; sections: SectionItem[] }> {
    return request(`/api/notebooks/${encodeURIComponent(notebookId)}/sections/reorder`, {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    });
  },

  deleteSection(id: string): Promise<{ ok: true }> {
    return request(`/api/sections/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  listPages(sectionId: string): Promise<{ pages: PageSummary[] }> {
    return request(`/api/sections/${encodeURIComponent(sectionId)}/pages`);
  },

  createPage(
    sectionId: string,
    input: { title?: string; parentPageId?: string | null } = {},
  ): Promise<{ page: PageDetail }> {
    return request(`/api/sections/${encodeURIComponent(sectionId)}/pages`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  reorderPages(sectionId: string, orderedIds: string[]): Promise<{ ok: true; pages: PageSummary[] }> {
    return request(`/api/sections/${encodeURIComponent(sectionId)}/pages/reorder`, {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    });
  },

  getPage(pageId: string): Promise<{ page: PageDetail }> {
    return request(`/api/pages/${encodeURIComponent(pageId)}`);
  },

  updatePage(
    pageId: string,
    patch: {
      title?: string;
      contentJson?: string;
      contentText?: string;
      isPinned?: boolean;
      isDeleted?: boolean;
      sectionId?: string;
      parentPageId?: string | null;
      sortOrder?: number;
    },
  ): Promise<{ page: PageDetail }> {
    return request(`/api/pages/${encodeURIComponent(pageId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  deletePage(pageId: string, permanent = false): Promise<{ ok: true; permanent: boolean }> {
    const suffix = permanent ? '?permanent=true' : '';
    return request(`/api/pages/${encodeURIComponent(pageId)}${suffix}`, {
      method: 'DELETE',
    });
  },

  listPinnedPages(): Promise<{ pages: PageSummary[] }> {
    return request('/api/pages/pinned');
  },

  listTrashPages(): Promise<{ pages: PageSummary[] }> {
    return request('/api/pages/trash');
  },

  emptyTrash(): Promise<{ ok: true; deletedCount: number }> {
    return request('/api/pages/trash/empty', {
      method: 'DELETE',
    });
  },

  quickSearch(q: string): Promise<{ pages: PageSummary[] }> {
    const qs = new URLSearchParams({ q });
    return request(`/api/pages/quick-search?${qs.toString()}`);
  },
};

export const searchApi = {
  search(q: string, limit = 30): Promise<{ results: SearchResultItem[] }> {
    const qs = new URLSearchParams({ q, limit: String(limit) });
    return request(`/api/search?${qs.toString()}`);
  },
};

export const attachmentsApi = {
  list(pageId: string): Promise<{ attachments: AttachmentItem[] }> {
    return request(`/api/pages/${encodeURIComponent(pageId)}/attachments`);
  },

  async upload(pageId: string, file: File): Promise<{ attachment: AttachmentItem }> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/pages/${encodeURIComponent(pageId)}/attachments`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    const data = (await res.json().catch(() => null)) as
      | { attachment: AttachmentItem }
      | ApiErrorResponse
      | null;
    if (!res.ok) {
      const errPayload = (data as ApiErrorResponse | null)?.error;
      throw new ApiError(
        res.status,
        errPayload?.code || 'UPLOAD_ERROR',
        errPayload?.message || `上传失败 (${res.status})`,
      );
    }
    return data as { attachment: AttachmentItem };
  },

  remove(attachmentId: string): Promise<{ ok: true }> {
    return request(`/api/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'DELETE',
    });
  },
};
