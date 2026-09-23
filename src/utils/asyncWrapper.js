// Forwards rejected promises from async route handlers to Express's error
// middleware instead of leaving them unhandled.
function asyncWrapper(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncWrapper };
