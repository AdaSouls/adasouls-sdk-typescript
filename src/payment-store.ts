import type { PaymentInstruction } from "./types.js";

/**
 * What a GuardedWallet knows about one payment it started. Written
 * *before* `send` is called (the write-ahead), so a payment that might
 * have gone out is never forgotten:
 * - `sending`: `send` was called; whether it went out isn't known yet.
 * - `sent`: it went out, as `txHash`; it may not have been reported yet.
 */
export interface PaymentRecord {
  economicActionId: string;
  state: "sending" | "sent";
  /** What was being sent. Null when the record came from a manual `wallet.report()`. */
  payment: Readonly<PaymentInstruction> | null;
  txHash: string | null;
  /** When `send` was called (ISO 8601): reconcilers look for the transaction from here on. */
  sendingAt: string;
}

/**
 * Where a GuardedWallet keeps its PaymentRecords. For an agent that
 * runs for days, this must survive a restart: a payment recorded only in
 * memory is paid again by the next process. Implementations must make
 * `claim` atomic (only one caller, across processes, gets true) and
 * durable before it resolves.
 */
export interface PaymentStore {
  get(economicActionId: string): Promise<PaymentRecord | undefined>;
  /** Stores `record` if there is none for its action yet. Resolves false, writing nothing, if there is one. */
  claim(record: PaymentRecord): Promise<boolean>;
  /** Replaces the record for its action. */
  put(record: PaymentRecord): Promise<void>;
  delete(economicActionId: string): Promise<void>;
}

/**
 * The default store. **Unsafe across restarts**: a process that dies
 * between sending and reporting forgets the payment, and the next one
 * pays it again. Fine for tests and short scripts; give anything that
 * runs unattended a FilePaymentStore or your own PaymentStore.
 */
export class MemoryPaymentStore implements PaymentStore {
  private readonly records = new Map<string, PaymentRecord>();

  async get(id: string) {
    const r = this.records.get(id);
    return r && { ...r };
  }

  async claim(record: PaymentRecord) {
    if (this.records.has(record.economicActionId)) return false;
    this.records.set(record.economicActionId, { ...record });
    return true;
  }

  async put(record: PaymentRecord) {
    this.records.set(record.economicActionId, { ...record });
  }

  async delete(id: string) {
    this.records.delete(id);
  }
}

// Loaded on first use, so the rest of the SDK stays free of Node built-ins.
const fsp = () => import("node:fs/promises");
const nodePath = () => import("node:path");

/**
 * Keeps one JSON file per action in `dir`, for Node. A record is written
 * to a temporary file, flushed, then hard-linked into place: the link
 * fails if the file already exists, which makes `claim` atomic across
 * processes sharing the directory, and a crash never leaves a
 * half-written record behind. Use a local disk: network filesystems
 * don't all honour exclusive links.
 */
export class FilePaymentStore implements PaymentStore {
  constructor(private readonly dir: string) {
    if (!dir?.trim()) throw new TypeError("FilePaymentStore needs a directory");
  }

  async get(id: string): Promise<PaymentRecord | undefined> {
    const fs = await fsp();
    try {
      return JSON.parse(await fs.readFile(await this.file(id), "utf8")) as PaymentRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async claim(record: PaymentRecord): Promise<boolean> {
    const fs = await fsp();
    const tmp = await this.writeTemp(record);
    try {
      await fs.link(tmp, await this.file(record.economicActionId));
      await this.syncDir();
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  async put(record: PaymentRecord): Promise<void> {
    const fs = await fsp();
    await fs.rename(await this.writeTemp(record), await this.file(record.economicActionId));
    await this.syncDir();
  }

  async delete(id: string): Promise<void> {
    const fs = await fsp();
    await fs.rm(await this.file(id), { force: true });
    await this.syncDir();
  }

  private async file(id: string) {
    return (await nodePath()).join(this.dir, `${encodeURIComponent(id)}.json`);
  }

  private async writeTemp(record: PaymentRecord): Promise<string> {
    const fs = await fsp();
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = (await nodePath()).join(this.dir, `.${encodeURIComponent(record.economicActionId)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
    const handle = await fs.open(tmp, "wx");
    try {
      await handle.writeFile(JSON.stringify(record));
      await handle.sync();
    } finally {
      await handle.close();
    }
    return tmp;
  }

  /** Makes the new directory entry itself durable. Not every platform can open a directory (Windows): best effort there. */
  private async syncDir() {
    const fs = await fsp();
    let handle;
    try {
      handle = await fs.open(this.dir, "r");
      await handle.sync();
    } catch {
      // ignore
    } finally {
      await handle?.close();
    }
  }
}
