import pkg from "../package.json";

export const VERSION = (pkg as { version: string }).version;
export const SPEC_VERSION = (pkg as { specVersion: string }).specVersion;
export const SPEC_SCHEMAS_URL = `https://opentp.dev/schemas/${SPEC_VERSION}`;
