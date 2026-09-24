import { describe, it, expect } from 'vitest';
import { InMemoryPostgresClient } from '../../src/database/client';

describe('In-memory DB mirrors Postgres parameter binding rules', () => {
  it('rejects extra or missing bound parameters', async () => {
    const db = new InMemoryPostgresClient();
    await expect(db.query('SELECT $1::text AS a', ['x', 'y'])).rejects.toThrow(/supplies 2 parameters, but prepared statement requires 1/);
    await expect(db.query('SELECT $1::text AS a, $2::text AS b', ['x'])).rejects.toThrow(/requires 2/);
    const ok = await db.query("SELECT $1::text AS a, 'price in $' AS literal", ['x']);
    expect(ok.rows[0].a).toBe('x');
    // Queries without a params array (migrations) are not checked
    await expect(db.query('SELECT 1 AS one')).resolves.toBeTruthy();
    await db.close();
  });
});
