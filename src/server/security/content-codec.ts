/**
 * ADR-01 正文编解码预留抽象层：
 * 首版使用 encryption_ver = 0（明文透传），以完整发挥 SQLite FTS5 原生检索能力并避免密钥丢失风险；
 * 未来若需启用落盘加密，仅需新增 encryption_ver = 1 的 AES-256-GCM 编解码实现即可平滑演进。
 */
export interface EncodedPageContent {
  contentJson: string;
  contentText: string;
  encryptionVer: number;
}

export interface ContentCodec {
  readonly version: number;
  encode(contentJson: string, contentText: string): EncodedPageContent;
  decode(stored: EncodedPageContent): { contentJson: string; contentText: string };
}

export class PlaintextContentCodec implements ContentCodec {
  public readonly version = 0;

  encode(contentJson: string, contentText: string): EncodedPageContent {
    return {
      contentJson,
      contentText,
      encryptionVer: this.version,
    };
  }

  decode(stored: EncodedPageContent): { contentJson: string; contentText: string } {
    if (stored.encryptionVer !== 0) {
      throw new Error(`Unsupported page encryption_ver: ${stored.encryptionVer}`);
    }
    return {
      contentJson: stored.contentJson,
      contentText: stored.contentText,
    };
  }
}

export const defaultContentCodec: ContentCodec = new PlaintextContentCodec();
