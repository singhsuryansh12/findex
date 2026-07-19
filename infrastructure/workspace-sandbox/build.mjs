import { build } from "esbuild";

const sdk = `import { useCallback, useState } from "react";
const unavailable=()=>Promise.reject(new Error("Capability unavailable in the network-denied validation sandbox."));
export const workspace={invoke:unavailable};
export function useCapability(){return useCallback(unavailable,[])}
export function useWorkspaceState(_key,initial){const [value,setValue]=useState(initial);return [value,setValue,true]}
export async function exportWorkspaceData(){return {exported:true}}
`;

await build({
  entryPoints: ["preview.tsx"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  outdir: "dist",
  entryNames: "workspace",
  plugins: [{
    name: "workspace-sdk",
    setup(api) {
      api.onResolve({ filter: /^@findex\/workspace-sdk$/ }, () => ({ path: "workspace-sdk", namespace: "findex" }));
      api.onLoad({ filter: /.*/, namespace: "findex" }, () => ({ contents: sdk, loader: "tsx" }));
    },
  }],
});
