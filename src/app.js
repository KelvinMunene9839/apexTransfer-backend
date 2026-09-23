const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { corsOrigin } = require('./config/env');
const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors({ origin: corsOrigin }));
app.use(morgan('tiny'));
app.use(express.json());

app.use(routes);

app.use(errorHandler);

// No app.listen() here — bin/www owns that for local dev. When deployed
// to Vercel (see vercel.json), the exported app is invoked directly as
// the request handler for each function call.
module.exports = app;
