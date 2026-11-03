import { ServiceLayer } from './client.js';

export { ServiceLayer, type FindOptions } from './client.js';
export {
  ServiceLayerError,
  type ServiceLayerErrorDetails,
  type ServiceLayerErrorKind
} from './errors.js';
export type {
  Logger,
  ODataCollection,
  RequestOptions,
  ServiceLayerConfig,
  ServiceLayerVersion,
  SessionInfo
} from './types.js';

/**
 * Shared instance, kept for compatibility with 1.x:
 * `import sl from 'b1-service-layer'; await sl.createSession(config);`
 */
const serviceLayer = new ServiceLayer();
export default serviceLayer;
