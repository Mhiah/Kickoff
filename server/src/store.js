// Where the server keeps things.
//
// The server needs very little: single values, and small tables of values by name. That is what a
// key-value database gives. This file is the in-memory one, used by the tests and when the server
// is run on a computer for trying things out. The real database has the same four operations.
//
//   get(key)                 a value, or null
//   set(key, value)
//   tableGet(table, name)    one value from a table, or null
//   tableSet(table, name, value)
//   tableAll(table)          every value in a table, as { name: value }

export class MemoryStore {
  values = new Map();
  tables = new Map();

  async get(key) {
    return this.values.has(key) ? structuredClone(this.values.get(key)) : null;
  }
  async set(key, value) {
    this.values.set(key, structuredClone(value));
  }
  async tableGet(table, name) {
    const t = this.tables.get(table);
    return t?.has(name) ? structuredClone(t.get(name)) : null;
  }
  async tableSet(table, name, value) {
    if (!this.tables.has(table)) this.tables.set(table, new Map());
    this.tables.get(table).set(name, structuredClone(value));
  }
  async tableAll(table) {
    return Object.fromEntries([...(this.tables.get(table) ?? [])].map(([name, value]) => [name, structuredClone(value)]));
  }
}
