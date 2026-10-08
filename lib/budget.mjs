import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Budget {
  constructor(path, cap = 5, initial = 0) {
    this.path = path; this.cap = cap; this.spent = initial;
    this.reservations = new Map(); this.queue = Promise.resolve();
  }
  async load() {
    try {
      const lines = (await readFile(this.path, 'utf8')).split('\n').filter(Boolean);
      for (const line of lines) {
        const event = JSON.parse(line);
        if (event.type === 'reserve') this.reservations.set(event.id, event.amount);
        if (event.type === 'settle' && this.reservations.has(event.id)) {
          this.reservations.delete(event.id); this.spent += event.amount;
        }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }
  summary() {
    const reserved = [...this.reservations.values()].reduce((a, b) => a + b, 0);
    return { capUsd: this.cap, estimatedSpentUsd: this.spent, reservedUsd: reserved, availableUsd: Math.max(0, this.cap - this.spent - reserved), unknownReservations: this.reservations.size };
  }
  transact(operation) {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }
  async record(event) {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + '\n');
  }
  reserve(amount, kind) {
    return this.transact(async () => {
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid budget reservation');
      if (this.summary().availableUsd < amount) throw Object.assign(new Error('The $5 project API budget is exhausted.'), { status: 402 });
      const id = randomUUID();
      await this.record({ type: 'reserve', id, amount, kind });
      this.reservations.set(id, amount);
      return id;
    });
  }
  settle(id, amount, kind) {
    return this.transact(async () => {
      if (!this.reservations.has(id)) return;
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid charge');
      await this.record({ type: 'settle', id, amount, kind });
      this.reservations.delete(id); this.spent += amount;
    });
  }
}
