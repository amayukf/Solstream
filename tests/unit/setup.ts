import Module from "module";
import path from "path";

const globalForTestAlias = globalThis as unknown as {
  __solstreamAliasRegistered?: boolean;
};

if (!globalForTestAlias.__solstreamAliasRegistered) {
  const srcRoot = path.resolve(__dirname, "../../src");
  type ResolveFn = (
    request: string,
    parent: unknown,
    isMain: boolean,
    options?: unknown
  ) => string;

  const moduleAny = Module as unknown as { _resolveFilename: ResolveFn };
  const originalResolve = moduleAny._resolveFilename;

  moduleAny._resolveFilename = function resolveWithAtAlias(
    request: string,
    parent: unknown,
    isMain: boolean,
    options?: unknown
  ): string {
    if (typeof request === "string" && request.startsWith("@/")) {
      const mapped = path.join(srcRoot, request.slice(2));
      return originalResolve.call(this, mapped, parent, isMain, options);
    }
    return originalResolve.call(this, request, parent, isMain, options);
  };

  globalForTestAlias.__solstreamAliasRegistered = true;
}
