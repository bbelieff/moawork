import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// tsconfig 의 "@/*" 경로 별칭을 테스트에서도 해석하도록 매핑.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
