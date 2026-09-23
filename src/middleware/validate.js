const { ApiError } = require('../utils/ApiError');

// validator(req.body) returns true if valid, or a string error message.
function validateBody(validator) {
  return (req, res, next) => {
    const result = validator(req.body);
    if (result !== true) {
      throw new ApiError(400, typeof result === 'string' ? result : 'Invalid request body');
    }
    next();
  };
}

module.exports = { validateBody };
