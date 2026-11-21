/* ADR-0019 wants nothing of Bun reachable from @cota/hub/api, but api.ts
   reaches apps/hub/src/shared/03-domain/conversation.ts through
   search.api.ts, and its digestOf hashes with Bun.CryptoHasher. Nothing the
   dashboard runs calls it, so the build leaves it out (tooling/web-build.test.ts
   fails if it does not); this declares only what that line uses, so the
   dashboard type-checks without Bun's types, and goes when digestOf stops
   using Bun. */
declare namespace Bun {
  class CryptoHasher {
    constructor(algorithm: "sha256");
    update(data: string): CryptoHasher;
    digest(encoding: "hex"): string;
  }
}
