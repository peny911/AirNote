import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { passwordSchema, usernameSchema } from '../../shared/validators.js';
import { loadConfig } from '../config.js';
import { initDatabase } from '../db/client.js';
import { writeAuditLog } from '../security/audit.js';
import { generateId } from '../security/crypto.js';
import { generateTemporaryPassword, hashPassword } from '../security/password.js';

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function main() {
  const config = loadConfig();
  const db = initDatabase(config.dbPath, config.uploadsDir);

  try {
    const existingAdmin = db
      .prepare("SELECT id, username, display_name FROM users WHERE role = 'admin' LIMIT 1")
      .get() as { id: string; username: string; display_name: string } | undefined;

    if (existingAdmin && !process.argv.includes('--force')) {
      console.log(
        `ℹ 已存在超级管理员账号：${existingAdmin.display_name} (${existingAdmin.username})。如需额外创建管理员，请附加 --force 参数。`,
      );
      return;
    }

    let username = readArg('--username') || process.env.AIRNOTE_ADMIN_USER;
    let displayName = readArg('--display-name') || process.env.AIRNOTE_ADMIN_NAME;
    let password = readArg('--password') || process.env.AIRNOTE_ADMIN_PASS;
    let generatedPassword = false;

    if (!username || !displayName || !password) {
      const rl = readline.createInterface({ input, output });
      try {
        console.log('✦ AirNote 首次初始化 — 创建超级管理员账号\n');
        if (!username) {
          username = (await rl.question('管理员登录账号 / 邮箱 (例: admin@airnote.local): ')).trim();
        }
        if (!displayName) {
          displayName = (await rl.question('管理员显示姓名 (例: 管理员): ')).trim() || '管理员';
        }
        if (!password) {
          const inputPass = (
            await rl.question('管理员密码（至少 8 位，直接回车自动生成高强度密码）: ')
          ).trim();
          if (inputPass) {
            password = inputPass;
          } else {
            password = generateTemporaryPassword(16);
            generatedPassword = true;
          }
        }
      } finally {
        rl.close();
      }
    }

    const userCheck = usernameSchema.safeParse(username);
    if (!userCheck.success) {
      console.error(`✖ 账号格式无效：${userCheck.error.issues[0]?.message}`);
      process.exitCode = 1;
      return;
    }

    const passCheck = passwordSchema.safeParse(password);
    if (!passCheck.success) {
      console.error(`✖ 密码格式无效：${passCheck.error.issues[0]?.message}`);
      process.exitCode = 1;
      return;
    }

    const dup = db
      .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)')
      .get(userCheck.data);
    if (dup) {
      console.error(`✖ 账号 ${userCheck.data} 已存在，请换一个账号名。`);
      process.exitCode = 1;
      return;
    }

    const id = generateId();
    const passwordHash = await hashPassword(passCheck.data);
    const now = Date.now();

    db.prepare(
      `INSERT INTO users (
         id, username, display_name, password_hash, role, status,
         totp_enabled, must_change_password, created_at
       ) VALUES (?, ?, ?, ?, 'admin', 'active', 0, 0, ?)`,
    ).run(id, userCheck.data, displayName.trim(), passwordHash, now);

    writeAuditLog(db, {
      actorId: id,
      action: 'cli_init_admin',
      targetInfo: `username=${userCheck.data}`,
      ipAddress: 'cli',
    });

    console.log('\n✦ 超级管理员账号创建成功！');
    console.log(`  登录账号：${userCheck.data}`);
    console.log(`  显示姓名：${displayName.trim()}`);
    if (generatedPassword) {
      console.log(`  初始密码：${passCheck.data}`);
      console.log('  ⚠ 请立即妥善保存此密码，登录后可在「安全与 2FA 设置」中修改并开启 2FA。');
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('✖ 初始化管理员失败：', err);
  process.exit(1);
});
