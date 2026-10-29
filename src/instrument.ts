// Imported first in main.ts so Sentry is ready before the rest of the app loads.
import { parseEnv } from './config/env';
import { initSentry } from './infra/sentry/sentry';

initSentry(parseEnv());
