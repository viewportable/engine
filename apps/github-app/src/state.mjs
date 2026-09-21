import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function emptyState() {
  return {
    version: 1,
    installations: {},
    repositories: {},
    projects: {},
    reviews: {},
    deliveries: {},
  };
}

function clone(value) {
  return structuredClone(value);
}

export class MemoryStateStore {
  constructor(initialState = emptyState()) {
    this.state = clone(initialState);
    this.queue = Promise.resolve();
  }

  async read() {
    await this.queue;
    return clone(this.state);
  }

  async transact(mutator) {
    const run = this.queue.then(async () => {
      const next = clone(this.state);
      const result = await mutator(next);
      this.state = next;
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export class JsonFileStateStore extends MemoryStateStore {
  constructor(path, initialState = emptyState()) {
    super(initialState);
    this.path = path;
  }

  static async open(path) {
    let state = emptyState();

    try {
      state = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    return new JsonFileStateStore(path, state);
  }

  async transact(mutator) {
    return super.transact(async (state) => {
      const result = await mutator(state);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await rename(temporary, this.path);
      return result;
    });
  }
}
