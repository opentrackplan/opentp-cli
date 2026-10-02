import pkg from "../package.json";

export const VERSION: string = pkg.version;
export const SPEC_VERSION: string = pkg.specVersion;
export const SPEC_SCHEMAS_URL = `https://opentp.dev/schemas/${SPEC_VERSION}`;
