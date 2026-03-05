import { createSdkGenerator } from "../sdk-common/factory";
import { kotlinBuilder } from "./builder";

export const kotlinSdkGenerator = createSdkGenerator(
  "kotlin-sdk",
  "Generate Kotlin SDK with typed event definitions",
  kotlinBuilder,
);
