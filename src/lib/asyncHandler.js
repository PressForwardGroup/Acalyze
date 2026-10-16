// Express 4 does NOT automatically forward a rejected promise from an async
// route handler to the error-handling middleware — it just becomes an
// unhandled rejection. In modern Node, an unhandled rejection can crash the
// whole process, which is exactly what turns "one bad request" into "the
// entire app is down (502) for everyone until it restarts."
//
// Wrapping every async route in this fixes that: any thrown/rejected error
// gets routed to server.js's error-handling middleware instead, which
// returns a proper JSON 500 and leaves the process running for every other
// request and every other user.
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
