import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .min(2, '账号长度至少为 2 个字符')
  .max(100, '账号长度不能超过 100 个字符')
  .regex(/^[a-zA-Z0-9._@+-]+$/, '账号仅支持字母、数字及 . _ @ + - 符号');

export const passwordSchema = z
  .string()
  .min(8, '密码长度至少为 8 位')
  .max(128, '密码长度不能超过 128 位');

export const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入账号'),
  password: z.string().min(1, '请输入密码'),
});

export const verify2faSchema = z.object({
  challengeToken: z.string().min(10, '无效的验证令牌'),
  code: z.string().trim().min(6, '请输入验证码').max(20, '验证码格式不正确'),
  isRecoveryCode: z.boolean().optional().default(false),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码'),
  newPassword: passwordSchema,
});

export const totpConfirmSchema = z.object({
  setupToken: z.string().min(10, '无效的绑定会话，请重新生成密钥'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, '请输入 6 位数字动态验证码'),
});

export const totpDisableSchema = z
  .object({
    currentPassword: z.string().min(1).optional(),
    totpCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, '请输入 6 位数字动态验证码')
      .optional(),
  })
  .refine((v) => Boolean(v.currentPassword || v.totpCode), {
    message: '请提供当前密码或有效的 6 位动态验证码以关闭 2FA',
  });

export const adminCreateUserSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1, '请输入成员姓名').max(60, '姓名长度不能超过 60 个字符'),
  role: z.enum(['admin', 'user']).default('user'),
});

export const adminUpdateStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
});

export const auditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().trim().optional(),
});

// Phase 2: Notebooks, Sections & Pages
const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, '颜色格式须为 6 位十六进制色值');

export const createNotebookSchema = z.object({
  name: z.string().trim().min(1, '请输入笔记本名称').max(80, '笔记本名称不能超过 80 个字符'),
  icon: z.string().trim().min(1).max(16).optional(),
  color: hexColorSchema.optional(),
  createDefaultSection: z.boolean().optional().default(true),
});

export const updateNotebookSchema = z.object({
  name: z.string().trim().min(1, '笔记本名称不能为空').max(80).optional(),
  icon: z.string().trim().min(1).max(16).optional(),
  color: hexColorSchema.optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const reorderIdsSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

export const createSectionSchema = z.object({
  name: z.string().trim().min(1, '请输入分区名称').max(80, '分区名称不能超过 80 个字符'),
  color: hexColorSchema.optional(),
});

export const updateSectionSchema = z.object({
  name: z.string().trim().min(1, '分区名称不能为空').max(80).optional(),
  color: hexColorSchema.optional(),
  sortOrder: z.number().int().min(0).optional(),
  notebookId: z.string().min(1).optional(),
});

export const createPageSchema = z.object({
  title: z.string().max(200).optional().default(''),
  parentPageId: z.string().min(1).nullable().optional().default(null),
  contentJson: z.string().optional(),
  contentText: z.string().optional(),
});

export const updatePageSchema = z.object({
  title: z.string().max(200).optional(),
  contentJson: z.string().optional(),
  contentText: z.string().optional(),
  isPinned: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  sectionId: z.string().min(1).optional(),
  parentPageId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
