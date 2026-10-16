// Lets the tests run with no database and no installed `pg`: imports of the
// Postgres driver are redirected to an in-memory stand-in that serves fixtures.
const STUBS = { pg: new URL('./stubs/pg.js', import.meta.url).href, 'dotenv/config': new URL('./stubs/dotenv.js', import.meta.url).href };
export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
  return next(specifier, context);
}
