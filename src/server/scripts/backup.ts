import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { loadConfig } from '../config.js';

function formatStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main() {
  const config = loadConfig();
  const srcDbPath = path.resolve(config.dbPath);

  if (!fs.existsSync(srcDbPath)) {
    console.error(`✖ 未找到 SQLite 数据库文件：${srcDbPath}`);
    process.exitCode = 1;
    return;
  }

  const outArg = process.argv[2];
  const backupDir = outArg
    ? path.resolve(outArg)
    : path.resolve(path.dirname(srcDbPath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const destDbPath = path.join(backupDir, `airnote-${formatStamp()}.db`);
  const db = new DatabaseSync(srcDbPath, { open: true });

  try {
    await backup(db, destDbPath);
    const stat = fs.statSync(destDbPath);
    console.log(`✦ SQLite 在线热备份成功！`);
    console.log(`  源数据库：${srcDbPath}`);
    console.log(`  备份文件：${destDbPath} (${(stat.size / 1024).toFixed(1)} KB)`);
    console.log(`  提示：如需完整迁移，请同时备份附件目录 ${path.resolve(config.uploadsDir)} 与 MASTER_KEY。`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('✖ 备份失败：', err);
  process.exit(1);
});
