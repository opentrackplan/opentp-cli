// A transform plugin that prints to stdout when it is imported and when its step is built. `opentp mcp`
// must keep all of it off stdout, which carries only the MCP protocol (tests/mcp-smoke.mjs checks it).
console.log("noisy-step: console.log at import");
console.table([{ plugin: "noisy-step" }]);
console.dir({ plugin: "noisy-step" });
process.stdout.write("noisy-step: process.stdout.write at import\n");

export default {
  name: "noisy-step",
  factory: () => {
    console.log("noisy-step: console.log in factory");
    return (value) => value;
  },
};
