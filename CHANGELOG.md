# Changelog

## 2.0.0

### Breaking changes

- Methods throw a `ServiceLayerError` instead of returning `{ error: true, message }`.
- Errors are no longer printed to the console.
- Node.js 18 or later is required.

### Added

- TypeScript sources and type definitions, ESM and CommonJS builds.
- `new ServiceLayer(config)` for multiple independent clients (the default export is still a shared instance).
- `delete`, `logout`, `request` methods and `sessionInfo` getter.
- `find` options: `maxPages`.
- Config options: `language`, `rejectUnauthorized`, `timeout`, `logger`.
- Automatic re-login and single replay when the server answers `401`.
- `ROUTEID` cookie forwarding for load-balanced installations.

### Fixed

- The password was printed when `debug` was enabled.
- `find` ignored its options on the first page and sent `params` twice on the next pages.
- v1 pagination (`odata.nextLink`, `/b1s/v1/` prefix) was not followed.
- Concurrent requests on an expired session triggered several logins.
- The session expiry did not account for activity (Service Layer uses an inactivity timeout).
- The global `axios.defaults` object was modified.
