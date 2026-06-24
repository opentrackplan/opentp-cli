import { createSdkGenerator } from "../sdk-common/factory";
import { swiftBuilder } from "./builder";

export const swiftSdkGenerator = createSdkGenerator(
  "swift-sdk",
  "Generate Swift SDK with typed event definitions",
  swiftBuilder,
);
